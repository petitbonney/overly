//! Owns the Node sidecar process: spawn it, wait for `ready`, restart it with backoff after a
//! crash, never restart it after `fatal`, and shut it down (or kill it) on Quit.

use std::collections::HashMap;
use std::fmt;
use std::io;
use std::path::PathBuf;
use std::process::Stdio;
use std::time::Duration;

use serde_json::Value;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::{mpsc, oneshot, watch};
use tokio::time::{Instant, sleep, sleep_until, timeout};

use crate::backoff::{Backoff, DEFAULT_INITIAL, DEFAULT_MAX};
use crate::job::ChildJob;
use crate::protocol::{
    self, DashboardUrlResult, FatalParams, Incoming, METHOD_NOT_FOUND, ReadyParams, RpcError,
};
use crate::status::Status;

/// How long to keep reading a sidecar's stdout after it exited, for a `fatal` line still in flight.
const EXIT_DRAIN: Duration = Duration::from_millis(500);

/// Windows: don't open a console window for the sidecar.
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

pub struct SupervisorConfig {
    pub node: PathBuf,
    pub script: PathBuf,
    /// Arguments after the script.
    pub args: Vec<String>,
    /// How long the sidecar may take to send `ready`.
    pub ready_timeout: Duration,
    /// How long a request to the sidecar may take.
    pub request_timeout: Duration,
    /// How long the sidecar may take to exit after `shutdown` before it is killed.
    pub shutdown_timeout: Duration,
    pub backoff_initial: Duration,
    pub backoff_max: Duration,
    /// After this long running, the restart backoff starts over.
    pub stable_after: Duration,
}

impl SupervisorConfig {
    pub fn new(node: PathBuf, script: PathBuf) -> Self {
        Self {
            node,
            script,
            args: vec!["--rpc".into()],
            ready_timeout: Duration::from_secs(20),
            request_timeout: Duration::from_secs(5),
            shutdown_timeout: Duration::from_secs(8),
            backoff_initial: DEFAULT_INITIAL,
            backoff_max: DEFAULT_MAX,
            stable_after: Duration::from_secs(60),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SupervisorError {
    NotRunning(String),
    Timeout,
    Rpc(String),
}

impl fmt::Display for SupervisorError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NotRunning(message) => write!(f, "Overly isn't running: {message}"),
            Self::Timeout => write!(f, "Overly took too long to start"),
            Self::Rpc(message) => write!(f, "The Overly server didn't answer: {message}"),
        }
    }
}

impl std::error::Error for SupervisorError {}

enum Request {
    DashboardUrl(oneshot::Sender<Result<String, SupervisorError>>),
    Shutdown(oneshot::Sender<()>),
}

/// A cheap handle to the supervisor task. Clones share the same sidecar.
#[derive(Clone)]
pub struct SupervisorHandle {
    requests: mpsc::UnboundedSender<Request>,
    status: watch::Receiver<Status>,
    ready_timeout: Duration,
}

fn stopped() -> SupervisorError {
    SupervisorError::NotRunning("Overly has stopped".into())
}

impl SupervisorHandle {
    /// Starts the supervisor task. Must be called inside a tokio runtime.
    pub fn spawn(config: SupervisorConfig) -> Self {
        let (status_tx, status) = watch::channel(Status::Starting);
        let (requests, requests_rx) = mpsc::unbounded_channel();
        let ready_timeout = config.ready_timeout;
        tokio::spawn(supervise(config, status_tx, requests_rx));
        Self {
            requests,
            status,
            ready_timeout,
        }
    }

    /// A handle that never started, for example because Node.js wasn't found.
    pub fn failed(message: String) -> Self {
        let (_, status) = watch::channel(Status::Fatal { message });
        let (requests, _) = mpsc::unbounded_channel();
        Self {
            requests,
            status,
            ready_timeout: Duration::ZERO,
        }
    }

    pub fn status(&self) -> watch::Receiver<Status> {
        self.status.clone()
    }

    /// A dashboard URL with a fresh one-time token. Waits while the sidecar starts or restarts,
    /// and fails at once after a fatal error or during shutdown.
    pub async fn dashboard_url(&self) -> Result<String, SupervisorError> {
        let mut status = self.status.clone();
        let running = async {
            loop {
                match &*status.borrow_and_update() {
                    Status::Running { .. } => return Ok(()),
                    Status::Fatal { message } => {
                        return Err(SupervisorError::NotRunning(message.clone()));
                    }
                    Status::Stopping | Status::Stopped => return Err(stopped()),
                    Status::Starting | Status::Restarting { .. } => {}
                }
                if status.changed().await.is_err() {
                    return Err(stopped());
                }
            }
        };
        timeout(self.ready_timeout, running)
            .await
            .map_err(|_| SupervisorError::Timeout)??;

        let (reply, answer) = oneshot::channel();
        self.requests
            .send(Request::DashboardUrl(reply))
            .map_err(|_| stopped())?;
        answer.await.map_err(|_| stopped())?
    }

    /// Stops the sidecar and resolves once it has exited. Safe to call more than once.
    pub async fn shutdown(&self) {
        let (reply, done) = oneshot::channel();
        if self.requests.send(Request::Shutdown(reply)).is_ok() {
            let _ = done.await;
        }
    }
}

enum Outcome {
    Stopped,
    Fatal(String),
    Crashed,
}

async fn supervise(
    config: SupervisorConfig,
    status: watch::Sender<Status>,
    mut requests: mpsc::UnboundedReceiver<Request>,
) {
    let job = ChildJob::new()
        .inspect_err(|error| log::warn!("Can't create the sidecar job object: {error}"))
        .ok();
    let mut backoff = Backoff::new(config.backoff_initial, config.backoff_max);
    let mut waiters = Vec::new();

    loop {
        status.send_replace(Status::Starting);
        let outcome = match Sidecar::spawn(&config, job.as_ref()) {
            Ok(sidecar) => {
                sidecar
                    .run(&config, &status, &mut requests, &mut backoff, &mut waiters)
                    .await
            }
            Err(error) => Outcome::Fatal(format!(
                "Can't start Node.js ({}): {error}",
                config.node.display()
            )),
        };
        match outcome {
            Outcome::Stopped => break,
            Outcome::Fatal(message) => {
                log::error!("The Overly server can't start: {message}");
                status.send_replace(Status::Fatal {
                    message: message.clone(),
                });
                idle_until_shutdown(&message, &mut requests, &mut waiters).await;
                break;
            }
            Outcome::Crashed => {
                let delay = backoff.next_delay();
                log::warn!("The Overly server stopped; restarting in {delay:?}");
                status.send_replace(Status::Restarting {
                    attempt: backoff.attempt(),
                });
                if !wait_before_restart(delay, &mut requests, &mut waiters).await {
                    break;
                }
            }
        }
    }

    status.send_replace(Status::Stopped);
    for waiter in waiters {
        let _ = waiter.send(());
    }
}

/// Between restarts. Returns false when it's time to stop instead.
async fn wait_before_restart(
    delay: Duration,
    requests: &mut mpsc::UnboundedReceiver<Request>,
    waiters: &mut Vec<oneshot::Sender<()>>,
) -> bool {
    let wake = sleep(delay);
    tokio::pin!(wake);
    loop {
        tokio::select! {
            () = &mut wake => return true,
            request = requests.recv() => match request {
                Some(Request::DashboardUrl(reply)) => {
                    let _ = reply.send(Err(SupervisorError::NotRunning("Overly is restarting".into())));
                }
                Some(Request::Shutdown(reply)) => {
                    waiters.push(reply);
                    return false;
                }
                None => return false,
            },
        }
    }
}

/// After a fatal error: answer requests until Quit.
async fn idle_until_shutdown(
    message: &str,
    requests: &mut mpsc::UnboundedReceiver<Request>,
    waiters: &mut Vec<oneshot::Sender<()>>,
) {
    while let Some(request) = requests.recv().await {
        match request {
            Request::DashboardUrl(reply) => {
                let _ = reply.send(Err(SupervisorError::NotRunning(message.into())));
            }
            Request::Shutdown(reply) => {
                waiters.push(reply);
                return;
            }
        }
    }
}

fn fatal_message(params: Value) -> String {
    match serde_json::from_value::<FatalParams>(params) {
        Ok(params) => params.message,
        Err(error) => format!("The server sent an invalid fatal message: {error}"),
    }
}

struct Sidecar {
    child: Child,
    stdin: ChildStdin,
    messages: mpsc::UnboundedReceiver<Incoming>,
}

impl Sidecar {
    fn spawn(config: &SupervisorConfig, job: Option<&ChildJob>) -> io::Result<Self> {
        let mut command = Command::new(&config.node);
        command
            .arg(&config.script)
            .args(&config.args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        #[cfg(windows)]
        command.creation_flags(CREATE_NO_WINDOW);

        let mut child = command.spawn()?;
        if let Some(job) = job {
            if let Err(error) = job.assign(&child) {
                log::warn!("Can't add the sidecar to the job object: {error}");
            }
        }
        let missing = || io::Error::other("the sidecar's stdio isn't piped");
        let stdin = child.stdin.take().ok_or_else(missing)?;
        let stdout = child.stdout.take().ok_or_else(missing)?;
        let stderr = child.stderr.take().ok_or_else(missing)?;

        let (messages_tx, messages) = mpsc::unbounded_channel();
        tokio::spawn(async move {
            let mut lines = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                match protocol::parse_line(&line) {
                    Ok(message) => {
                        if messages_tx.send(message).is_err() {
                            break;
                        }
                    }
                    Err(error) => log::warn!(target: "sidecar", "{error}: {line}"),
                }
            }
        });
        tokio::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                log::info!(target: "sidecar", "{line}");
            }
        });

        Ok(Self {
            child,
            stdin,
            messages,
        })
    }

    async fn write(&mut self, line: &str) {
        let written = async {
            self.stdin.write_all(line.as_bytes()).await?;
            self.stdin.flush().await
        };
        if let Err(error) = written.await {
            log::warn!("Can't write to the sidecar: {error}");
        }
    }

    /// Runs until this sidecar process exits.
    async fn run(
        mut self,
        config: &SupervisorConfig,
        status: &watch::Sender<Status>,
        requests: &mut mpsc::UnboundedReceiver<Request>,
        backoff: &mut Backoff,
        waiters: &mut Vec<oneshot::Sender<()>>,
    ) -> Outcome {
        let never = Instant::now() + Duration::from_secs(60 * 60 * 24 * 365);
        let ready_deadline = Instant::now() + config.ready_timeout;
        let mut stable_at = never;
        let mut stop_deadline = never;
        let mut running = false;
        let mut stopping = false;
        let mut killed = false;
        let mut requests_open = true;
        let mut messages_open = true;
        let mut fatal: Option<String> = None;
        let mut next_id: u64 = 1;
        let mut pending: HashMap<u64, oneshot::Sender<Result<Value, RpcError>>> = HashMap::new();

        loop {
            tokio::select! {
                exit = self.child.wait() => {
                    match exit {
                        Ok(code) => log::info!("The Overly server exited ({code})"),
                        Err(error) => log::warn!("Can't wait for the Overly server: {error}"),
                    }
                    // The exit can be seen before the last stdout lines: read them until EOF, so
                    // a `fatal` sent just before exiting isn't mistaken for a crash.
                    if messages_open {
                        let drain = async {
                            while let Some(message) = self.messages.recv().await {
                                if let Incoming::Notification { method, params } = message {
                                    if method == protocol::FATAL {
                                        fatal = Some(fatal_message(params));
                                    }
                                }
                            }
                        };
                        let _ = timeout(EXIT_DRAIN, drain).await;
                    }
                    // Dropping `pending` fails the requests still waiting for an answer.
                    return if stopping {
                        Outcome::Stopped
                    } else if let Some(message) = fatal {
                        Outcome::Fatal(message)
                    } else {
                        Outcome::Crashed
                    };
                }

                message = self.messages.recv(), if messages_open => match message {
                    None => messages_open = false,
                    Some(Incoming::Notification { method, params }) if method == protocol::READY => {
                        match serde_json::from_value::<ReadyParams>(params) {
                            Ok(ready) => {
                                running = true;
                                stable_at = Instant::now() + config.stable_after;
                                if !stopping {
                                    status.send_replace(Status::Running { port: ready.port });
                                }
                            }
                            Err(error) => log::warn!("Invalid ready notification: {error}"),
                        }
                    }
                    Some(Incoming::Notification { method, params }) if method == protocol::FATAL => {
                        fatal = Some(fatal_message(params));
                    }
                    Some(Incoming::Notification { method, .. }) => {
                        log::debug!("Ignored sidecar notification {method}");
                    }
                    Some(Incoming::Response { id, outcome }) => {
                        if let Some(reply) = pending.remove(&id) {
                            let _ = reply.send(outcome);
                        }
                    }
                    Some(Incoming::Request { id, method, .. }) => {
                        let message = format!("Method not found: {method}");
                        self.write(&protocol::encode_error(&id, METHOD_NOT_FOUND, &message)).await;
                    }
                },

                request = requests.recv(), if requests_open => match request {
                    Some(Request::DashboardUrl(reply)) => {
                        if !running || stopping {
                            let _ = reply.send(Err(SupervisorError::NotRunning("Overly is starting".into())));
                            continue;
                        }
                        let id = next_id;
                        next_id += 1;
                        let (answer_tx, answer) = oneshot::channel();
                        pending.insert(id, answer_tx);
                        self.write(&protocol::encode_request(id, protocol::GET_DASHBOARD_URL, None)).await;
                        let request_timeout = config.request_timeout;
                        tokio::spawn(async move {
                            let result = match timeout(request_timeout, answer).await {
                                Err(_) => Err(SupervisorError::Rpc("the request timed out".into())),
                                Ok(Err(_)) => Err(SupervisorError::Rpc("the server stopped".into())),
                                Ok(Ok(Err(error))) => Err(SupervisorError::Rpc(error.message)),
                                Ok(Ok(Ok(value))) => serde_json::from_value::<DashboardUrlResult>(value)
                                    .map(|result| result.url)
                                    .map_err(|error| SupervisorError::Rpc(error.to_string())),
                            };
                            let _ = reply.send(result);
                        });
                    }
                    Some(Request::Shutdown(reply)) => {
                        waiters.push(reply);
                        if !stopping {
                            stopping = true;
                            status.send_replace(Status::Stopping);
                            stop_deadline = Instant::now() + config.shutdown_timeout;
                            let id = next_id;
                            next_id += 1;
                            self.write(&protocol::encode_request(id, protocol::SHUTDOWN, None)).await;
                        }
                    }
                    None => {
                        // Every handle is gone: stop.
                        requests_open = false;
                        if !stopping {
                            stopping = true;
                            stop_deadline = Instant::now() + config.shutdown_timeout;
                            self.write(&protocol::encode_request(next_id, protocol::SHUTDOWN, None)).await;
                        }
                    }
                },

                () = sleep_until(ready_deadline), if !running && !stopping && !killed => {
                    log::warn!("The Overly server didn't get ready within {:?}", config.ready_timeout);
                    killed = true;
                    let _ = self.child.start_kill();
                }

                () = sleep_until(stable_at), if running => {
                    backoff.reset();
                    stable_at = never;
                }

                () = sleep_until(stop_deadline), if stopping && !killed => {
                    log::warn!("The Overly server didn't exit within {:?}; killing it", config.shutdown_timeout);
                    killed = true;
                    let _ = self.child.start_kill();
                }
            }
        }
    }
}
