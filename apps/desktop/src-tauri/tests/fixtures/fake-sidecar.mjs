// A stand-in for the Overly server in the supervisor tests. It speaks the sidecar protocol
// (docs/sidecar-protocol.md) and behaves according to --mode:
//   ready       sends ready, answers getDashboardUrl and shutdown, exits on stdin EOF
//   crash       exits with 1 at once
//   crash-once  crashes if the --marker file doesn't exist (and creates it), then acts as ready
//   fatal       sends fatal and exits with 1
//   fatal-after-exit  exits with 1 at once; a grandchild sharing stdout sends fatal 200 ms later
//   hang        acts as ready, but ignores shutdown and stdin EOF
//   silent      never writes anything and never exits
import { spawn } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

function option(name) {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function send(message, then) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`, then);
}

const keepAlive = () => setInterval(() => undefined, 60_000);

let mode = option('mode') ?? 'ready';
const marker = option('marker');

if (mode === 'crash-once') {
  if (marker !== undefined && !existsSync(marker)) {
    writeFileSync(marker, '');
    process.exit(1);
  }
  mode = 'ready';
}

if (mode === 'crash') process.exit(1);

if (mode === 'fatal-after-exit') {
  // Reproduces the race where the shell sees the exit before the last stdout lines.
  const line = JSON.stringify({
    jsonrpc: '2.0',
    method: 'fatal',
    params: { code: 'port_in_use', message: 'Port 1234 is in use' },
  });
  spawn(
    process.execPath,
    ['-e', 'setTimeout(() => process.stdout.write(process.argv[1] + "\\n"), 200)', line],
    { stdio: ['ignore', 'inherit', 'inherit'] },
  );
  process.exit(1);
} else if (mode === 'fatal') {
  send({ method: 'fatal', params: { code: 'port_in_use', message: 'Port 1234 is in use' } }, () =>
    process.exit(1),
  );
} else if (mode === 'silent') {
  keepAlive();
} else {
  const hang = mode === 'hang';
  if (hang) keepAlive();
  send({ method: 'ready', params: { port: 1234, version: 'test' } });
  const lines = createInterface({ input: process.stdin });
  lines.on('line', (line) => {
    const message = JSON.parse(line);
    if (message.method === 'getDashboardUrl') {
      send({ id: message.id, result: { url: 'http://127.0.0.1:1234/?t=fake' } });
    } else if (message.method === 'shutdown' && !hang) {
      send({ id: message.id, result: {} }, () => process.exit(0));
    }
  });
  lines.on('close', () => {
    if (!hang) process.exit(0);
  });
}
