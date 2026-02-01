# <img src="https://bun.com/logo.svg" height="20"> Bun Documentation MCP

A Model Context Protocol (MCP) server that provides intelligent access to [Bun](https://bun.com) documentation. Enables AI assistants to search, read, and query Bun docs with full-text search capabilities.

## ✨ Features

- **📚 Full-text search**: SQLite FTS5 with BM25 ranking for fast, relevant search results
- **🔍 Regex search**: JavaScript regex support for precise pattern matching
- **📖 Document reading**: Access complete markdown documentation by slug
- **📑 Document listing**: Browse available docs by category
- **🔄 Version-matched**: Automatically downloads docs matching your Bun version from GitHub
- **⚡ Fast local caching**: Docs cached in `~/.cache/bun-mcp-server/` with SQLite search index
- **🤖 AI-optimized**: Structured for AI assistants with relevance scoring and context snippets

## 🛠️ Available Tools

### `search_bun_docs`

Full-text search using SQLite FTS5 with Porter stemming ("running" matches "run", "runs", etc.)

- **Parameters**: `query` (string), optional `path` filter, optional `limit`
- **Returns**: Ranked results with title, score, and highlighted snippet

### `grep_bun_docs`

Regex pattern matching for exact searches

- **Parameters**: `pattern` (regex), optional `path` filter, optional `flags`, optional `limit`
- **Returns**: Matches with context snippets

### `read_bun_doc`

Read complete markdown documentation

- **Parameters**: `path` (slug like `runtime/bun-apis` or `guides/http`)
- **Returns**: Full markdown content

### `list_bun_docs`

Browse available documentation

- **Parameters**: optional `category` filter (e.g., `api/`, `guides/`), optional `limit`
- **Returns**: List of documents with URIs and descriptions

## 🚀 Installation

### Via Claude Code (recommended)

```bash
claude mcp add bun-docs bunx bun-mcp-server
```

### Via npx/bunx

```bash
bunx bun-mcp-server
```

### Manual MCP Configuration

```json
{
  "mcpServers": {
    "bun-docs": {
      "type": "stdio",
      "command": "bunx",
      "args": ["bun-mcp-server"],
      "env": {}
    }
  }
}
```

## 🔧 Development

### Setup

```bash
bun install
```

### Build

```bash
bun run build
```

### Test

```bash
bun run test        # Run all tests
bun run test:e2e    # Run E2E tests only
```

### Lint & Type Check

```bash
bun run lint
bun run typecheck
```

## 📁 How It Works

1. **First run**: Downloads Bun docs from GitHub (matching your Bun version) using sparse checkout
2. **Indexing**: Builds SQLite FTS5 search index with BM25 ranking
3. **Caching**: Stores docs and search index in `~/.cache/bun-doc-mcp/{version}/`
4. **Subsequent runs**: Uses cached docs (re-downloads if corrupted)

## 📝 Usage Examples

Once installed, ask your AI assistant:

- "Search for WebSocket server examples" → uses `search_bun_docs`
- "Show me the Bun.serve() API documentation" → uses `read_bun_doc`
- "Find all examples using SQLite" → uses `grep_bun_docs`
- "List all available guides" → uses `list_bun_docs`
