# Bun Documentation MCP Server

This is a Model Context Protocol (MCP) server that provides access to Bun documentation with full-text search powered by SQLite FTS5.

## Project Overview

This MCP server downloads Bun documentation from GitHub and provides access through a searchable interface. It automatically caches documentation locally, builds a SQLite FTS5 search index with BM25 ranking, and allows AI assistants to search and read Bun documentation efficiently.

## Technical Decisions

### Project Structure

- Single `index.ts` implementation
- Minimal dependencies: `@modelcontextprotocol/sdk` and `zod`
- Uses `bun:sqlite` for FTS5 full-text search

### Documentation Slugs

- Documentation entries are addressed by slug (e.g., `runtime/bun-apis`, `guides/http`)
- Slugs mirror the Bun docs navigation structure; no custom URI scheme required
- Supports both `.md` and `.mdx` files

### Documentation Source

- Downloads from GitHub using git sparse checkout for efficiency
- Automatically caches in `$HOME/.cache/bun-doc-mcp/{version}/docs`
- Supports both `docs.json` (Mintlify format) and legacy `nav.ts` navigation
- Builds SQLite FTS5 search index (`search.db`) for fast queries

### MCP Tools

- `search_bun_docs`: **recommended** - full-text search with BM25 ranking, returns snippets with context
- `grep_bun_docs`: regex search for exact pattern matching
- `list_bun_docs`: browse documentation by category
- `read_bun_doc`: return raw markdown for a documentation slug

## Development Guidelines

### Code Style

- Keep responses concise - this is a CLI tool
- No unnecessary comments in code
- Follow existing patterns in the codebase

## Testing Guidelines

### MCP Server Testing

After making code changes that affect MCP functionality:

1. **User must restart MCP server** - ask user to restart
2. **Wait for restart confirmation** - Don't proceed until user confirms restart
3. **Test core functionality** using MCP tools:
   - Test `search_bun_docs` (FTS5 search)
   - Test `grep_bun_docs` (regex search)
   - Test `list_bun_docs` (browse by category)
   - Test `read_bun_doc` (read document)

### Command-line Testing

Since the bash tool doesn't have TTY, use JSON-RPC protocol for testing:

```bash
# Test FTS5 search (recommended)
echo '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"search_bun_docs","arguments":{"query":"websocket server"}},"id":1}' | bun run index.ts 2>/dev/null | jq '.result.content[0].text | fromjson | .[0:3]'

# Test regex search
echo '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"grep_bun_docs","arguments":{"pattern":"Bun\\.serve"}},"id":1}' | bun run index.ts 2>/dev/null | jq '.result.content[0].text | fromjson | length'

# Test listing docs by category
echo '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"list_bun_docs","arguments":{"category":"runtime/http"}},"id":1}' | bun run index.ts 2>/dev/null | jq '.result.content[0].text | fromjson'

# Test reading a document by slug
echo '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"read_bun_doc","arguments":{"path":"runtime/bun-apis"}},"id":1}' | bun run index.ts 2>/dev/null | jq -r '.result.content[0].text' | head -20
```

## Important Notes

- Always consult Bun documentation before making modifications
- Use pure Bun APIs whenever possible to complete tasks
- **MUST** use `bun run` instead of `npm run`
