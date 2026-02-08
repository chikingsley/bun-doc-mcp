---
name: Node to Bun Migration
description: >-
  Use this skill when the user wants to migrate a Node.js project to Bun,
  replace a Node.js package with a Bun-native alternative, or convert
  Node.js API usage patterns to Bun equivalents. Also use when discussing
  Express-to-Bun.serve migration, Jest-to-bun:test migration, or any
  "how do I do X in Bun instead of Y" question. Triggers on: "migrate to Bun",
  "replace express", "switch from jest", "convert to Bun", "Bun equivalent",
  "move from Node to Bun", "port to Bun".
version: 1.0.0
---

Guide migrations from Node.js packages to Bun-native alternatives. Always use `search_bun_docs` and `read_bun_doc` to verify the latest API patterns before writing migration code.

## Migration Priority Matrix

Migrate in this order (highest impact first):

1. **Runtime & env**: Remove `dotenv` (Bun auto-loads `.env`)
2. **HTTP server**: express/koa/fastify to `Bun.serve()`
3. **Database**: pg/better-sqlite3/ioredis to Bun.sql/bun:sqlite/Bun.redis
4. **Testing**: jest/vitest/mocha to `bun:test`
5. **Utilities**: node-fetch, execa, glob, bcrypt, etc.
6. **Bundler**: webpack/esbuild/rollup to `Bun.build()`
7. **Package manager**: npm/yarn/pnpm to `bun install`

## Express / Koa / Fastify to `Bun.serve()`

### Route mapping

```typescript
// EXPRESS
app.get('/', (req, res) => res.send('Home'));
app.get('/users/:id', (req, res) => res.json({ id: req.params.id }));
app.post('/users', express.json(), async (req, res) => {
  const user = await createUser(req.body);
  res.status(201).json(user);
});

// BUN
Bun.serve({
  routes: {
    '/': () => new Response('Home'),
    '/users/:id': (req) => Response.json({ id: req.params.id }),
    '/users': {
      POST: async (req) => {
        const body = await req.json();
        const user = await createUser(body);
        return Response.json(user, { status: 201 });
      },
    },
  },
  fetch(req) {
    return new Response('Not Found', { status: 404 });
  },
});
```

### Middleware pattern

Express middleware doesn't have a direct equivalent. Instead:

```typescript
// Authentication middleware pattern
async function withAuth(req: Request): Response | null {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  return null; // continue to handler
}

Bun.serve({
  routes: {
    '/api/protected': async (req) => {
      const authError = await withAuth(req);
      if (authError) return authError;
      return Response.json({ data: 'secret' });
    },
  },
  fetch(req) {
    return new Response('Not Found', { status: 404 });
  },
});
```

### Static files

```typescript
// EXPRESS
app.use(express.static('public'));

// BUN - serve files directly in routes
Bun.serve({
  routes: {
    '/favicon.ico': Bun.file('./public/favicon.ico'),
    '/static/*': async (req) => {
      const path = new URL(req.url).pathname.replace('/static/', '');
      const file = Bun.file(`./public/${path}`);
      return (await file.exists())
        ? new Response(file)
        : new Response('Not Found', { status: 404 });
    },
  },
  fetch(req) {
    return new Response('Not Found', { status: 404 });
  },
});
```

## Jest / Vitest to `bun:test`

This is the easiest migration. Most patterns work as-is.

### Import change

```typescript
// JEST/VITEST
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
// or
import { describe, it, expect, vi } from 'vitest';

// BUN
import { describe, it, expect, beforeEach, mock, spyOn } from 'bun:test';
// vi is also available as alias for vitest compat
import { vi } from 'bun:test';
```

### Mocking differences

```typescript
// JEST
jest.mock('./module', () => ({ foo: 'bar' }));
const fn = jest.fn(() => 42);
jest.spyOn(obj, 'method');

// BUN
mock.module('./module', () => ({ foo: 'bar' }));
const fn = mock(() => 42);
spyOn(obj, 'method');
```

### Configuration

```typescript
// jest.config.js → bunfig.toml
// transform: {} → not needed (native TS/JSX)
// testMatch → Bun auto-discovers *.test.ts
// setupFiles → [test] preload

// bunfig.toml
// [test]
// preload = ["./setup.ts"]
// timeout = 10000
```

### What works identically

- `describe`, `it`, `test`, `expect` and all matchers
- `beforeAll`, `beforeEach`, `afterEach`, `afterAll`
- `test.skip`, `test.only`, `test.each`
- Snapshot testing (`.toMatchSnapshot()`, `.toMatchInlineSnapshot()`)
- Async tests, done callbacks
- `expect.assertions(n)`, `expect.hasAssertions()`

### Bun additions (no Jest equivalent)

- `test.if(condition)`, `test.skipIf()`, `test.todoIf()`
- `test.failing()` for known-broken tests
- `test.concurrent`, `test.serial`
- `onTestFinished()` per-test cleanup hook

## pg / postgres.js to `Bun.sql`

```typescript
// PG
import { Pool } from 'pg';
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
await pool.end();

// BUN (reads DATABASE_URL automatically)
import { sql } from 'bun';
const users = await sql`SELECT * FROM users WHERE id = ${id}`;
// No pool management needed, no .end() needed
```

### Transactions

```typescript
// PG
const client = await pool.connect();
try {
  await client.query('BEGIN');
  await client.query('INSERT INTO users (name) VALUES ($1)', ['Alice']);
  await client.query(
    'UPDATE accounts SET balance = balance - 100 WHERE user_id = $1',
    [1]
  );
  await client.query('COMMIT');
} catch (e) {
  await client.query('ROLLBACK');
} finally {
  client.release();
}

// BUN
await sql.begin(async (tx) => {
  await tx`INSERT INTO users (name) VALUES (${'Alice'})`;
  await tx`UPDATE accounts SET balance = balance - 100 WHERE user_id = ${1}`;
}); // auto-rollback on error, auto-commit on success
```

## better-sqlite3 to `bun:sqlite`

Nearly drop-in. Change the import:

```typescript
// BEFORE
import Database from 'better-sqlite3';

// AFTER
import { Database } from 'bun:sqlite';
```

Key difference: `db.query()` in Bun replaces `db.prepare()` in better-sqlite3. Both work similarly. The API is almost identical: `.get()`, `.all()`, `.run()`, `.values()`.

## ioredis / redis to `Bun.redis`

```typescript
// IOREDIS
import Redis from 'ioredis';
const redis = new Redis(process.env.REDIS_URL);
await redis.set('key', 'value');
const val = await redis.get('key');

// BUN (reads REDIS_URL automatically)
import { redis } from 'bun';
await redis.set('key', 'value');
const val = await redis.get('key');
```

## dotenv removal

The simplest migration. Just delete it:

```typescript
// DELETE THIS LINE (or the import)
import 'dotenv/config';
// require("dotenv").config();

// These all work without dotenv in Bun:
process.env.API_KEY;
Bun.env.API_KEY;
import.meta.env.API_KEY;
```

Then: `bun remove dotenv`

Bun auto-loads `.env`, `.env.local`, `.env.development`, `.env.production` with variable expansion.

## webpack / esbuild / rollup to `Bun.build()`

```typescript
// WEBPACK (webpack.config.js)
module.exports = {
  entry: './src/index.tsx',
  output: { path: path.resolve('dist'), filename: '[name].[contenthash].js' },
  module: {
    rules: [
      /* ts-loader, css-loader, etc. */
    ],
  },
  plugins: [
    /* HtmlWebpackPlugin, etc. */
  ],
};

// BUN
await Bun.build({
  entrypoints: ['./src/index.tsx'],
  outdir: './dist',
  splitting: true,
  minify: true,
  sourcemap: 'linked',
  naming: '[dir]/[name]-[hash].[ext]',
});
// No loaders needed - Bun handles TS, JSX, CSS, JSON, TOML, YAML natively
```

## npm / yarn / pnpm to bun

| npm/yarn/pnpm           | bun                     |
| ----------------------- | ----------------------- |
| `npm install`           | `bun install`           |
| `npm add react`         | `bun add react`         |
| `npm add -D typescript` | `bun add -d typescript` |
| `npm remove react`      | `bun remove react`      |
| `npm run build`         | `bun run build`         |
| `npx cowsay`            | `bunx cowsay`           |
| `npm test`              | `bun test`              |
| `npm publish`           | `bun publish`           |
| `npm pack`              | `bun pm pack`           |
| `npm outdated`          | `bun outdated`          |

Lockfile migration is automatic: Bun reads `package-lock.json`, `yarn.lock`, and `pnpm-lock.yaml` and creates `bun.lock`.

## Migration Checklist

When migrating a project:

1. Install Bun: `curl -fsSL https://bun.sh/install | bash`
2. Run `bun install` (auto-migrates lockfile)
3. Remove `dotenv` imports (Bun auto-loads `.env`)
4. Replace test runner imports with `bun:test`
5. Replace HTTP framework with `Bun.serve()`
6. Replace database clients with Bun-native alternatives
7. Replace utility packages (fetch, glob, bcrypt, execa)
8. Replace bundler config with `Bun.build()`
9. Update CI/CD scripts to use `bun` commands
10. Remove unused packages: `bun remove <package>`
