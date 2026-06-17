/**
 * Load coverage-service/.env then run `prisma <args…>`.
 * Prisma CLI only reads .env next to schema.prisma; our env file lives one
 * level up (coverage-service/.env) so we preload it here for db:* scripts.
 */
const { spawnSync } = require('node:child_process');
const { resolve } = require('node:path');

require('dotenv').config({ path: resolve(__dirname, '../../.env') });

// `prisma generate` validates the schema env() refs but does not connect.
// CI has no coverage-service/.env — use a throwaway URL so generate succeeds.
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL =
    'postgresql://prisma:prisma@127.0.0.1:5432/prisma?schema=public';
}

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('usage: node scripts/with-env.cjs <prisma-subcommand> [args…]');
  process.exit(1);
}

const result = spawnSync('pnpm', ['exec', 'prisma', ...args], {
  stdio: 'inherit',
  env: process.env,
  cwd: resolve(__dirname, '..'),
});

process.exit(result.status ?? 1);
