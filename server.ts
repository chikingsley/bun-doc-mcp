import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { Database } from 'bun:sqlite';

const DEFAULT_SEARCH_LIMIT = 30;

// Types
export type IndexedResource = {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
  filePath?: string;
  isDirectory?: boolean;
};

export type SearchResult = {
  uri: string;
  title: string;
  score: number;
  snippet: string;
};

// Create server function that can be used in tests
export async function createMcpServer(
  docsDir: string,
  db: Database,
  resourceIndex: Map<string, IndexedResource>
): Promise<McpServer> {
  const VERSION = '3.0.0-test';

  const server = new McpServer(
    {
      name: 'bun-doc-mcp',
      version: VERSION,
    },
    {
      capabilities: {
        tools: {},
        resources: {},
      },
      instructions: `This MCP server provides access to Bun documentation with full-text search.`,
    }
  );

  // Search function
  function searchDocuments(
    query: string,
    searchPath: string = '',
    limit: number = DEFAULT_SEARCH_LIMIT
  ): SearchResult[] {
    const sanitizedQuery = query
      .split(/\s+/)
      .filter((term) => term.length > 0)
      .map((term) => {
        const cleaned = term.replace(/[":*^()]/g, '');
        if (!cleaned) return null;
        return `"${cleaned}"`;
      })
      .filter(Boolean)
      .join(' OR ');

    if (!sanitizedQuery) {
      return [];
    }

    let sql = `
      SELECT
        uri,
        title,
        bm25(docs_fts, 1.0, 2.0, 1.5, 3.0, 1.0) as score,
        snippet(docs_fts, 4, '>>>', '<<<', '...', 32) as snippet
      FROM docs_fts
      WHERE docs_fts MATCH ?
    `;

    const params: (string | number)[] = [sanitizedQuery];

    if (searchPath) {
      sql += ` AND uri LIKE ?`;
      params.push(`${searchPath}%`);
    }

    sql += ` ORDER BY score LIMIT ?`;
    params.push(limit);

    const stmt = db.prepare(sql);
    const rows = stmt.all(...params) as Array<{
      uri: string;
      title: string;
      score: number;
      snippet: string;
    }>;

    return rows.map((row) => ({
      uri: `buncument://${row.uri}`,
      title: row.title,
      score: Math.round(-row.score * 100) / 100,
      snippet: row.snippet.replace(/>>>/g, '**').replace(/<<</g, '**'),
    }));
  }

  // Read document function
  async function readDocument(input: string): Promise<string> {
    let value = input.trim();
    if (!value) {
      throw new Error('Document slug is required');
    }
    if (value.includes('://')) {
      throw new Error('Use documentation slugs like runtime/bun-apis');
    }
    value = value.replace(/^\/+/, '').replace(/\/+$/, '');
    if (value.endsWith('.md')) {
      value = value.slice(0, -3);
    }
    if (!value) {
      throw new Error('Document slug is required');
    }
    const key = `buncument://${value}`;
    const resource = resourceIndex.get(key);
    if (!resource) {
      throw new Error(`Document not found for slug: ${input}`);
    }
    if (!resource.filePath || resource.isDirectory) {
      throw new Error(`Requested slug is not a document: ${input}`);
    }
    const file = Bun.file(resource.filePath);
    return file.text();
  }

  // Register tools
  server.registerTool(
    'search_bun_docs',
    {
      description: `Search Bun documentation using full-text search with BM25 ranking.`,
      inputSchema: {
        query: z.string().describe('Search query (natural language)'),
        path: z
          .string()
          .optional()
          .describe('Optional path prefix to filter results'),
        limit: z.number().optional().describe(`Maximum number of results`),
      },
    },
    ({ query, path, limit = DEFAULT_SEARCH_LIMIT }) => {
      try {
        const results = searchDocuments(query, path, limit);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(results, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Search error: ${error instanceof Error ? error.message : 'Unknown error'}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    'read_bun_doc',
    {
      description: 'Read a Bun documentation markdown file by slug.',
      inputSchema: {
        path: z
          .string()
          .describe('Slug of the document to read (e.g., runtime/bun-apis)'),
      },
    },
    async ({ path }) => {
      try {
        const content = await readDocument(path);
        return {
          content: [
            {
              type: 'text',
              text: content,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Read error: ${error instanceof Error ? error.message : 'Unknown error'}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    'list_bun_docs',
    {
      description: 'List available Bun documentation pages.',
      inputSchema: {
        category: z.string().optional().describe('Optional category filter'),
        limit: z.number().optional().describe('Maximum number of results'),
      },
    },
    ({ category, limit = 50 }) => {
      const results: Array<{
        uri: string;
        title: string;
        description: string;
      }> = [];

      for (const [uri, resource] of resourceIndex.entries()) {
        if (resource.isDirectory) continue;

        if (category) {
          const slug = uri.replace('buncument://', '');
          if (!slug.startsWith(category)) continue;
        }

        results.push({
          uri: uri,
          title: resource.name,
          description: resource.description,
        });

        if (results.length >= limit) break;
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(results, null, 2),
          },
        ],
      };
    }
  );

  return server;
}
