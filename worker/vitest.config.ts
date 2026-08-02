import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  cloudflareTest,
  readD1Migrations,
} from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
)

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      miniflare: {
        compatibilityDate: '2026-07-31',
        compatibilityFlags: ['nodejs_compat'],
        d1Databases: ['DB'],
        r2Buckets: ['PDF_BUCKET'],
        bindings: {
          ALLOWED_ORIGIN: 'http://localhost:5173',
          GOOGLE_CLIENT_ID: 'test-client-id',
          R2_ACCOUNT_ID: 'test-account-id',
          R2_BUCKET_NAME: 'pocket-pdf-test',
          R2_ACCESS_KEY_ID: 'test-access-key',
          R2_SECRET_ACCESS_KEY: 'test-secret-key',
          ADMIN_SECRET: 'test-admin-secret',
          TEST_MIGRATIONS: await readD1Migrations(
            path.join(projectRoot, 'migrations'),
          ),
        },
      },
    })),
  ],
  test: {
    include: ['worker/test/**/*.test.ts'],
    setupFiles: ['worker/test/applyMigrations.ts'],
  },
})
