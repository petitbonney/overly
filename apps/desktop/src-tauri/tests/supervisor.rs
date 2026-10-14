//! Runs the supervisor against a fake sidecar (tests/fixtures/fake-sidecar.mjs). Needs `node` on PATH.

use std::path::{Path, PathBuf};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use overly_desktop_lib::status::Status;
use overly_desktop_lib::supervisor::{SupervisorConfig, SupervisorError, SupervisorHandle};

fn config(mode: &str) -> SupervisorConfig {
    let fixture = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/fake-sidecar.mjs");
    let mut config = SupervisorConfig::new(PathBuf::from("node"), fixture);
    config.args = vec![format!("--mode={mode}")];
    config.ready_timeout = Duration::from_secs(5);
    config.request_timeout = Duration::from_secs(2);
    config.shutdown_timeout = Duration::from_millis(300);
    config.backoff_initial = Duration::from_millis(10);
    config.backoff_max = Duration::from_millis(50);
    config
}

fn marker() -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    std::env::temp_dir().join(format!("overly-crash-once-{nanos}"))
}

async fn wait_for(handle: &SupervisorHandle, wanted: impl Fn(&Status) -> bool) -> Status {
    let mut status = handle.status();
    tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            let current = status.borrow_and_update().clone();
            if wanted(&current) {
                return current;
            }
            status.changed().await.expect("the supervisor stopped");
        }
    })
    .await
    .expect("timed out waiting for a status")
}

#[tokio::test(flavor = "multi_thread")]
async fn opens_dashboard_url_when_running() {
    let handle = SupervisorHandle::spawn(config("ready"));
    assert_eq!(
        handle.dashboard_url().await,
        Ok("http://127.0.0.1:1234/?t=fake".to_string())
    );
    assert_eq!(
        handle.status().borrow().clone(),
        Status::Running { port: 1234 }
    );
    handle.shutdown().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn restarts_after_a_crash_with_backoff() {
    let handle = SupervisorHandle::spawn(config("crash"));
    wait_for(
        &handle,
        |status| matches!(status, Status::Restarting { attempt } if *attempt >= 2),
    )
    .await;
    handle.shutdown().await;
    assert_eq!(handle.status().borrow().clone(), Status::Stopped);
}

#[tokio::test(flavor = "multi_thread")]
async fn does_not_restart_after_fatal() {
    let handle = SupervisorHandle::spawn(config("fatal"));
    let fatal = Status::Fatal {
        message: "Port 1234 is in use".into(),
    };
    wait_for(&handle, |status| *status == fatal).await;
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert_eq!(handle.status().borrow().clone(), fatal);
}

#[tokio::test(flavor = "multi_thread")]
async fn restarts_when_ready_never_arrives() {
    let mut config = config("silent");
    config.ready_timeout = Duration::from_millis(300);
    let handle = SupervisorHandle::spawn(config);
    wait_for(&handle, |status| {
        matches!(status, Status::Restarting { attempt: 1 })
    })
    .await;
    handle.shutdown().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn missing_node_is_fatal() {
    let mut config = config("ready");
    config.node = PathBuf::from("does-not-exist-overly-node");
    let handle = SupervisorHandle::spawn(config);
    let status = wait_for(&handle, |status| matches!(status, Status::Fatal { .. })).await;
    assert!(
        status.label().starts_with("Error: Can't start Node.js"),
        "{status:?}"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn dashboard_url_waits_for_restart() {
    let mut config = config("crash-once");
    config.args.push(format!("--marker={}", marker().display()));
    let handle = SupervisorHandle::spawn(config);
    assert_eq!(
        handle.dashboard_url().await,
        Ok("http://127.0.0.1:1234/?t=fake".to_string())
    );
    handle.shutdown().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn dashboard_url_fails_fast_when_fatal() {
    let handle = SupervisorHandle::spawn(config("fatal"));
    let started = Instant::now();
    let result = handle.dashboard_url().await;
    assert_eq!(
        result,
        Err(SupervisorError::NotRunning("Port 1234 is in use".into()))
    );
    assert!(
        started.elapsed() < Duration::from_secs(1),
        "{:?}",
        started.elapsed()
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn failed_handle_reports_its_error() {
    let handle = SupervisorHandle::failed("Can't find the Node.js runtime".into());
    assert_eq!(
        handle.dashboard_url().await,
        Err(SupervisorError::NotRunning(
            "Can't find the Node.js runtime".into()
        ))
    );
    handle.shutdown().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn shuts_down_cleanly() {
    let handle = SupervisorHandle::spawn(config("ready"));
    wait_for(&handle, |status| matches!(status, Status::Running { .. })).await;
    handle.shutdown().await;
    assert_eq!(handle.status().borrow().clone(), Status::Stopped);
    // A second Quit is harmless.
    handle.shutdown().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn kills_a_sidecar_that_ignores_shutdown() {
    let handle = SupervisorHandle::spawn(config("hang"));
    wait_for(&handle, |status| matches!(status, Status::Running { .. })).await;
    let started = Instant::now();
    handle.shutdown().await;
    assert!(
        started.elapsed() < Duration::from_millis(1500),
        "{:?}",
        started.elapsed()
    );
    assert_eq!(handle.status().borrow().clone(), Status::Stopped);
}
