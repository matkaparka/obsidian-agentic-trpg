// DSH 的 Windows 沙箱不允许子进程通过管道捕获输出（spawn EPERM）。
// Vite 在 Windows 上启动时会 exec("net use") 探测网络驱动器；这里把它变成 no-op。
// 只影响测试启动，不影响被测代码（被测代码里没有 child_process）。
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
