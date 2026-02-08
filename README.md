# <img src="https://bun.com/logo.svg" height="20"> Bun Documentation MCP + Claude Code Plugin

A Model Context Protocol (MCP) server and Claude Code plugin that makes Claude a Bun expert. Provides intelligent access to [Bun](https://bun.com) documentation with full-text search, plus skills, commands, and hooks that proactively guide you toward Bun-native APIs.

## What's Included

### MCP Server (4 tools)

| Tool              | Description                                      |
| ----------------- | ------------------------------------------------ |
| `search_bun_docs` | Full-text search with SQLite FTS5 + BM25 ranking |
| `grep_bun_docs`   | JavaScript regex pattern matching                |
| `read_bun_doc`    | Read markdown documentation by slug (paginated)  |
| `list_bun_docs`   | Browse docs by category                          |

### Claude Code Plugin

| Component      | Description                                                                                               |
| -------------- | --------------------------------------------------------------------------------------------------------- |
| **3 Skills**   | Pre-loaded knowledge: Bun-native APIs, Node-to-Bun migration recipes, testing/bundling/package management |
| **1 Agent**    | `bun-optimizer` - proactively scans JS/TS files for Node.js patterns that should be Bun-native            |
| **2 Commands** | `/bun-docs:bun-check` (audit project) and `/bun-docs:bun-migrate` (migrate a package/file)                |
| **1 Hook**     | Intercepts `bun add express` (and 40+ other packages) with Bun-native alternative warnings                |

## Installation

### As a Claude Code Plugin (recommended)

```bash
# Add the marketplace
/plugin marketplace add chikingsley/bun-mcp-server

# Install the plugin
/plugin install bun-docs@bun-plugins
```

This gives you everything: MCP tools, skills, commands, agent, and hooks.

### MCP Server Only

If you just want the documentation search tools:

```bash
claude mcp add bun-docs bunx bun-mcp-server
```

### Local Plugin (for development)

```bash
# Symlink into your global plugins directory
mkdir -p ~/.claude/plugins
ln -s /path/to/bun-doc-mcp ~/.claude/plugins/bun-docs
```

## Usage

### Skills (automatic)

Just ask questions - Claude automatically activates the right skill:

- "How do I create an HTTP server in Bun?" (activates bun-apis skill)
- "Migrate this Express app to Bun" (activates bun-migration skill)
- "How do I write tests with bun:test?" (activates bun-testing skill)

### Commands

```text
/bun-docs:bun-check              # Scan project for Node.js anti-patterns
/bun-docs:bun-check package.json # Audit specific file
/bun-docs:bun-migrate express    # Migrate a specific package to Bun-native
/bun-docs:bun-migrate src/db.ts  # Migrate a specific file
```

### Hook (automatic)

When Claude runs `bun add express`, `bun add pg`, `bun add ws`, or any of 40+ Node.js packages, you'll see a warning like:

> **Bun Alternative Available**
> `express` has a Bun-native replacement: **Bun.serve()**

### Agent (automatic)

After Claude writes or edits JS/TS files, the `bun-optimizer` agent can proactively scan for Node.js patterns and suggest Bun-native replacements.

## Packages Intercepted by Hook

**Web Frameworks**: express, koa, hapi, fastify, polka, micro
**Database**: pg, postgres, better-sqlite3, ioredis, redis
**WebSocket**: ws, socket.io, engine.io
**HTTP**: node-fetch, cross-fetch, axios, got, ky, superagent
**Shell**: execa, shelljs, cross-spawn
**Files**: glob, fast-glob, globby, fs-extra, chokidar
**Env**: dotenv, dotenv-expand
**Crypto**: bcrypt, bcryptjs, argon2
**Testing**: jest, vitest, mocha, chai, jasmine
**Bundler**: webpack, esbuild, rollup, parcel, tsup

## Development

```bash
bun install
bun run build
bun run test
bun run lint
bun run typecheck
```

## How the MCP Server Works

1. Downloads Bun docs from GitHub (matching your Bun version) via sparse checkout
2. Builds SQLite FTS5 search index with BM25 ranking
3. Caches docs and index in `~/.cache/bun-mcp-server/{version}/`
4. Serves search, read, and browse tools over stdio

## License

MIT
