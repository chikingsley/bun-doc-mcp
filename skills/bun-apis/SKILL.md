---
name: Bun Native APIs
description: >-
  Use this skill when the user asks to build HTTP servers, handle WebSockets,
  work with databases (SQLite, Postgres, Redis), read/write files, run shell
  commands, hash passwords, use glob patterns, parse YAML/TOML, or perform
  any task that has a Bun-native API. Also use when the user imports or
  mentions express, pg, better-sqlite3, ioredis, ws, node-fetch, axios, execa,
  dotenv, bcrypt, glob, fs-extra, cheerio, or similar Node.js packages.
  Triggers on: "create a server", "connect to database", "read a file",
  "run a command", "hash password", "WebSocket", "fetch API".
version: 1.0.0
---

Always prefer Bun-native APIs over npm packages. They are faster, have zero dependencies, and are built into the runtime. Use `search_bun_docs` and `read_bun_doc` to get the latest API details when writing code.

## HTTP Server (`Bun.serve()`)

Replaces: express, koa, hapi, fastify, polka, micro

```typescript
Bun.serve({
  port: 3000,
  routes: {
    '/': () => new Response('Home'),
    '/api/users/:id': (req) => Response.json({ id: req.params.id }),
    '/api/posts': {
      GET: () => Response.json({ posts: [] }),
      POST: async (req) => {
        const body = await req.json();
        return Response.json(body, { status: 201 });
      },
    },
    '/static': Bun.file('./public/index.html'),
  },
  fetch(req) {
    return new Response('Not Found', { status: 404 });
  },
});
```

Key features: route params (`:id`), wildcards (`*`), per-method handlers, static responses (zero-alloc), file serving (`sendfile`), hot reload via `server.reload()`, Unix sockets, TLS/HTTPS.

## WebSocket (built into `Bun.serve()`)

Replaces: ws, socket.io, engine.io

```typescript
Bun.serve({
  fetch(req, server) {
    if (server.upgrade(req, { data: { user: 'alice' } })) return;
    return new Response('Not a WebSocket', { status: 400 });
  },
  websocket: {
    open(ws) {
      ws.subscribe('chat');
    },
    message(ws, msg) {
      ws.publish('chat', `${ws.data.user}: ${msg}`);
    },
    close(ws) {
      ws.unsubscribe('chat');
    },
  },
});
```

Key features: pub/sub topics, per-message compression, backpressure handling, contextual data via `ws.data`.

## SQLite (`bun:sqlite`)

Replaces: better-sqlite3, sql.js

```typescript
import { Database } from 'bun:sqlite';

const db = new Database('mydb.sqlite');
db.run('PRAGMA journal_mode = WAL');

const insert = db.query(
  'INSERT INTO users (name, email) VALUES ($name, $email)'
);
insert.run({ $name: 'Alice', $email: 'alice@example.com' });

const users = db.query('SELECT * FROM users WHERE name = ?').all('Alice');
const user = db.query('SELECT * FROM users WHERE id = ?').get(1);

// Transactions
const insertMany = db.transaction((items) => {
  for (const item of items) insert.run(item);
});

// Map to class instances
class User {
  name!: string;
  get initials() {
    return this.name[0];
  }
}
db.query('SELECT * FROM users').as(User).all();
```

Key features: 3-6x faster than better-sqlite3, `.as(Class)` mapping, `.iterate()` streaming, WAL mode, ES module import with `import db from "./my.sqlite" with { type: "sqlite" }`.

## PostgreSQL/MySQL (`Bun.sql`)

Replaces: pg, postgres.js, mysql2

```typescript
import { sql, SQL } from 'bun';

// Auto-reads DATABASE_URL / POSTGRES_URL env var
const users = await sql`SELECT * FROM users WHERE active = ${true}`;

// MySQL
const mysql = new SQL('mysql://user:pass@localhost:3306/mydb');

// Bulk insert
await sql`INSERT INTO users ${sql(newUsers)}`;

// Transactions
await sql.begin(async (tx) => {
  await tx`INSERT INTO users (name) VALUES (${'Alice'})`;
  await tx`UPDATE accounts SET balance = balance - 100 WHERE user_id = 1`;
});
```

Key features: tagged template literals (SQL injection safe), connection pooling, prepared statements, auto-detection from connection string.

## Redis (`Bun.redis`)

Replaces: ioredis, redis, node-redis

```typescript
import { redis, RedisClient } from 'bun';

// Auto-reads REDIS_URL env var
await redis.set('key', 'value');
const val = await redis.get('key');

// Pub/Sub
const sub = new RedisClient('redis://localhost:6379');
await sub.subscribe('events', (msg, channel) => console.log(msg));
await redis.publish('events', 'Hello!');
```

Key features: native RESP3, automatic pipelining, auto-reconnect, TLS.

## File I/O (`Bun.file()` / `Bun.write()`)

Replaces: fs.readFile, fs.writeFile, fs-extra, graceful-fs

```typescript
// Read
const file = Bun.file('data.json');
const text = await file.text();
const json = await file.json();
const bytes = await file.bytes();
const exists = await file.exists();

// Write
await Bun.write('output.txt', 'Hello!');
await Bun.write('copy.txt', Bun.file('input.txt'));

// Streaming write
const writer = Bun.file('log.txt').writer();
writer.write('line 1\n');
writer.flush();
writer.end();

// Delete
await Bun.file('temp.txt').delete();
```

## Shell (`Bun.$`)

Replaces: execa, shelljs, zx, cross-spawn

```typescript
import { $ } from 'bun';

await $`echo "Hello World!"`;
const output = await $`ls -la`.text();
const data = await $`cat package.json`.json();

// Pipes, env, cwd
await $`echo $FOO`.env({ FOO: 'bar' });
await $`pwd`.cwd('/tmp');

// Error handling
const { stdout, exitCode } = await $`may-fail`.nothrow().quiet();
```

Key features: cross-platform, auto-escaping (injection safe), built-in commands, pipe support, `.text()/.json()/.lines()/.blob()`.

## Spawn (`Bun.spawn()`)

Replaces: child_process.spawn, child_process.exec

```typescript
const proc = Bun.spawn(['bun', '--version'], {
  cwd: './subdir',
  onExit(proc, exitCode) {
    console.log('exited:', exitCode);
  },
});
const output = await proc.stdout.text();

// IPC between processes
const child = Bun.spawn(['bun', 'child.ts'], {
  ipc(message) {
    console.log('from child:', message);
  },
});
child.send('hello');
```

## Password Hashing (`Bun.password`)

Replaces: bcrypt, bcryptjs, argon2

```typescript
const hash = await Bun.password.hash('password'); // argon2id default
const hash2 = await Bun.password.hash('password', {
  algorithm: 'bcrypt',
  cost: 10,
});
const ok = await Bun.password.verify('password', hash); // auto-detects algorithm
```

## Crypto Hashing (`Bun.CryptoHasher`)

Replaces: crypto.createHash

```typescript
new Bun.CryptoHasher('sha256').update('data').digest('hex');

// HMAC
const hmac = new Bun.CryptoHasher('sha256', 'secret-key');
hmac.update('data').digest('hex');

// Non-cryptographic (fast, for hash tables)
Bun.hash('data'); // Wyhash
Bun.hash.crc32('data');
```

## Glob (`Bun.Glob`)

Replaces: glob, fast-glob, minimatch, globby

```typescript
import { Glob } from 'bun';

const glob = new Glob('**/*.ts');
for await (const file of glob.scan('.')) console.log(file);

// Sync
for (const file of glob.scanSync({ cwd: './src', dot: true }))
  console.log(file);

// Pattern matching
new Glob('*.{ts,tsx}').match('index.ts'); // true
```

## Environment Variables (`Bun.env`)

Replaces: dotenv, dotenv-expand, cross-env

Bun auto-loads `.env`, `.env.local`, `.env.development`, etc. No import needed.

```typescript
const key = Bun.env.API_KEY; // or process.env.API_KEY
```

## Additional Built-ins

| Need         | Bun API                                      | Replaces                 |
| ------------ | -------------------------------------------- | ------------------------ |
| Fetch        | `fetch()` (built-in)                         | node-fetch, axios, got   |
| Semver       | `Bun.semver.satisfies()`                     | semver                   |
| YAML         | `Bun.YAML.parse()` or `import from "x.yaml"` | js-yaml, yaml            |
| TOML         | `import from "x.toml"`                       | @iarna/toml              |
| HTML rewrite | `new HTMLRewriter()`                         | cheerio (for transforms) |
| S3 storage   | `Bun.s3.file(key)`                           | @aws-sdk/client-s3       |
| Sleep        | `Bun.sleep(ms)`                              | delay                    |
| Deep equals  | `Bun.deepEquals(a, b)`                       | lodash.isEqual           |
| Escape HTML  | `Bun.escapeHTML(str)`                        | escape-html              |
| Which binary | `Bun.which("node")`                          | which                    |
| Gzip         | `Bun.gzipSync()` / `Bun.gunzipSync()`        | zlib, pako               |
| Secrets      | `Bun.secrets.get/set/delete`                 | keytar                   |
| Transpile    | `new Bun.Transpiler()`                       | @swc/core, @babel/core   |
