// DSH's Windows sandbox blocks child processes that capture output through a pipe (spawn EPERM).
// Vite probes network drives with exec("net use") when it starts; make that a no-op. Test-only.
const cp = require('node:child_process');

const stub = function (command, options, callback) {
  if (typeof options === 'function') {
    callback = options;
    options = undefined;
  }
  if (typeof callback === 'function') {
    process.nextTick(() => callback(Object.assign(new Error('spawn disabled (sandbox)'), { code: 'EPERM' }), '', ''));
  }
  return { on() { return this; }, kill() {}, unref() {}, stdout: null, stderr: null };
};

cp.exec = stub;
