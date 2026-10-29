import { applyD1Migrations } from 'cloudflare:test';
import { env } from 'cloudflare:workers';

// Brings the test D1s up to date before each test file (vitest.config.ts): the catalog's with migrations/, the user
// data's with migrations-user/.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
await applyD1Migrations(env.USER_DB, env.TEST_USER_MIGRATIONS);
