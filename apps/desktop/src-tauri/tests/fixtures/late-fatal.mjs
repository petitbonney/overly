// Started by fake-sidecar.mjs in fatal-after-exit mode, sharing the sidecar's stdout. It signals on
// stderr that it runs (so the sidecar can exit first), then sends `fatal` 100 ms later. Its code
// lives in this file, not in a `node -e` argument, to stay clear of Windows command-line quoting.
process.stderr.write('up');
setTimeout(() => {
  const fatal = {
    jsonrpc: '2.0',
    method: 'fatal',
    params: { code: 'port_in_use', message: 'Port 1234 is in use' },
  };
  process.stdout.write(`${JSON.stringify(fatal)}\n`);
}, 100);
