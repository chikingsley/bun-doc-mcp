---
name: bun-check
description: Scan a project for Node.js patterns that should be Bun-native
allowed-tools:
  - Read
  - Glob
  - Grep
  - Bash
  - search_bun_docs
  - read_bun_doc
argument-hint: '[path or package.json]'
---

Audit the current project (or specified path) for Node.js packages and patterns that have Bun-native replacements. Produce a prioritized report.

## Steps

1. Read `package.json` (or the file at the given path) to get all dependencies and devDependencies.

2. Check each dependency against the Bun-native alternatives list:

   **Direct replacements (high priority):**
   - express, koa, hapi, fastify → `Bun.serve()`
   - pg, postgres → `Bun.sql`
   - better-sqlite3 → `bun:sqlite`
   - ioredis, redis → `Bun.redis`
   - ws, socket.io → `WebSocket` via `Bun.serve()`
   - jest, vitest, mocha → `bun:test`
   - webpack, esbuild, rollup → `Bun.build()`
   - dotenv → `Bun.env` (auto-loads .env)
   - node-fetch, axios, got → built-in `fetch`
   - execa, shelljs → `Bun.$`
   - glob, fast-glob → `Bun.Glob`
   - bcrypt, bcryptjs → `Bun.password`
   - fs-extra → `Bun.file()` / `Bun.write()`

   **Partial replacements (medium priority):**
   - Packages where Bun covers common use cases but the package has extra features

3. Scan source files (`.ts`, `.js`, `.tsx`, `.jsx`) for Node.js API usage patterns:
   - `require('fs')` or `import fs from 'fs'` → suggest `Bun.file()`
   - `require('child_process')` → suggest `Bun.$` or `Bun.spawn`
   - `require('crypto').createHash` → suggest `Bun.CryptoHasher`
   - `new WebSocket` from `ws` package → suggest Bun.serve websocket upgrade
   - `process.env` without typed access → suggest `Bun.env`

4. Use `search_bun_docs` to look up migration guidance for each flagged item.

5. Output a report in this format:

```markdown
## Bun Migration Report

### High Priority (drop-in replacements)

| Package | Bun Alternative | Files Using It | Migration Effort |
| ------- | --------------- | -------------- | ---------------- |
| express | Bun.serve()     | 3 files        | Medium           |

### Medium Priority (partial replacements)

...

### Source Code Patterns

| Pattern         | Location        | Bun Alternative   |
| --------------- | --------------- | ----------------- |
| fs.readFileSync | src/utils.ts:15 | Bun.file().text() |

### Summary

- X packages can be replaced with Bun-native APIs
- Estimated migration: Y high-priority, Z medium-priority changes
```

6. If the user provided a specific file path instead of package.json, scan only that file for patterns.
