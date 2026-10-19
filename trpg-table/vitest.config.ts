import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    testTimeout: 20_000,
    // Windows 沙箱不允许 fork 子进程；线程池不需要 spawn。
    pool: 'threads',
  },
});
