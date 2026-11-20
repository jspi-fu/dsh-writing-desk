import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./vitest.setup.ts'],
    include: ['__tests__/**/*.test.ts'],
  },
  resolve: {
    // tsc(pnpm build)会把 .js/.d.ts 吐在 src/ 里(上游遗留,gitignore 覆盖),
    // .ts 排在 .js 之前,测试永远吃源码而不是过期的编译产物
    extensions: ['.mts', '.ts', '.tsx', '.mjs', '.jsx', '.js', '.json'],
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
