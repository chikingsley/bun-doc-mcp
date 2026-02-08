---
name: bun-migrate
description: Generate a migration plan to replace a Node.js package or pattern with Bun-native code
allowed-tools:
  - Read
  - Write
  - Edit
  - Glob
  - Grep
  - Bash
  - search_bun_docs
  - read_bun_doc
argument-hint: '<package-name or file-path>'
---

Migrate a specific Node.js package or file to use Bun-native APIs. The argument can be a package name (e.g., `express`) or a file path (e.g., `src/server.ts`).

## Steps

### If argument is a package name:

1. Search `package.json` to confirm the package is installed.
2. Use `search_bun_docs` and `read_bun_doc` to find the Bun-native replacement documentation.
3. Use `Grep` to find ALL files importing/requiring the package.
4. For each file, read it and generate a migration plan showing:
   - Current code using the Node.js package
   - Equivalent Bun-native code
   - Any behavioral differences or caveats
5. Ask user: "Ready to apply these changes?"
6. If yes, edit each file to use Bun-native APIs.
7. Remove the package: `bun remove <package-name>`
8. Run `bun test` if tests exist to verify nothing broke.

### If argument is a file path:

1. Read the file.
2. Identify all Node.js package imports and Node.js API patterns.
3. For each pattern found, use `search_bun_docs` to look up the Bun alternative.
4. Present a side-by-side migration plan for each pattern.
5. Ask user: "Ready to apply these changes?"
6. If yes, edit the file.

### Common migrations reference:

**express/koa/fastify → Bun.serve()**

```typescript
// Before
const app = express();
app.get('/api', (req, res) => res.json({ ok: true }));
app.listen(3000);

// After
Bun.serve({
  port: 3000,
  routes: {
    '/api': () => Response.json({ ok: true }),
  },
});
```

**pg → Bun.sql**

```typescript
// Before
import { Pool } from 'pg';
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [id]);

// After
const sql = Bun.sql;
const users = await sql`SELECT * FROM users WHERE id = ${id}`;
```

**better-sqlite3 → bun:sqlite**

```typescript
// Before
import Database from 'better-sqlite3';
const db = new Database('mydb.sqlite');
const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id);

// After
import { Database } from 'bun:sqlite';
const db = new Database('mydb.sqlite');
const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
```

**jest/vitest → bun:test**

```typescript
// Before
import { describe, it, expect } from 'vitest';

// After
import { describe, it, expect } from 'bun:test';
// Most Jest/Vitest patterns work as-is with bun:test
```

**dotenv → Bun.env**

```typescript
// Before
import 'dotenv/config';
const apiKey = process.env.API_KEY;

// After (just delete the import - Bun auto-loads .env)
const apiKey = Bun.env.API_KEY;
```

Always use `search_bun_docs` to get the latest API details rather than relying solely on these examples.
