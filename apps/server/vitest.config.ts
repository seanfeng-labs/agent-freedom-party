import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    setupFiles: ['./test/setup.ts'],
    // 每个 test file 隔离进程，避免 session 单例污染
    pool: 'forks',
    poolOptions: {
      forks: { singleFork: true },
    },
    testTimeout: 10_000,
  },
})
