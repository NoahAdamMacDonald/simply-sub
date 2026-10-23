import { applyD1Migrations } from 'cloudflare:test';
import { env } from 'cloudflare:workers';

// Brings the test D1 up to date with migrations/ before each test file (vitest.config.ts).
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
