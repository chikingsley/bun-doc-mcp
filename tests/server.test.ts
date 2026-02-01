import { expect, test, beforeAll, afterAll, describe } from 'bun:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Database } from 'bun:sqlite';
import { createMcpServer, type IndexedResource } from '../server.ts';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

describe('MCP Server Integration Tests', () => {
  let client: Client;
  let serverTransport: InMemoryTransport;
  let clientTransport: InMemoryTransport;
  let db: Database;
  let resourceIndex: Map<string, IndexedResource>;
  const bunVersion = Bun.version;
  const docsDir = `${process.env.HOME}/.cache/bun-doc-mcp/${bunVersion}/docs`;

  beforeAll(async () => {
    // Skip if docs not cached
    if (!existsSync(docsDir)) {
      console.log('Docs not cached, skipping tests');
      return;
    }

    // Initialize real database
    const dbPath = `${process.env.HOME}/.cache/bun-doc-mcp/${bunVersion}/search.db`;
    db = new Database(dbPath);

    // Build minimal resource index for testing
    resourceIndex = new Map();
    const docsJsonPath = join(docsDir, 'docs.json');

    if (existsSync(docsJsonPath)) {
      const file = Bun.file(docsJsonPath);
      const docs = await file.json();

      for (const tab of docs.navigation.tabs) {
        if (!tab.groups) continue;
        for (const group of tab.groups) {
          if (!group.pages) continue;
          for (const pagePath of group.pages) {
            const slug = pagePath.replace(/^\//, '');
            const parts = slug.split('/');
            const lastPart = parts[parts.length - 1] || slug;
            const title = lastPart
              .split('-')
              .map((w: string) => w.charAt(0).toUpperCase() + w.slice(1))
              .join(' ');

            // Try to find the actual file
            const candidates = [
              join(docsDir, `${slug}.md`),
              join(docsDir, `${slug}.mdx`),
              join(docsDir, slug, 'index.md'),
              join(docsDir, slug, 'index.mdx'),
            ];

            for (const candidate of candidates) {
              if (existsSync(candidate)) {
                resourceIndex.set(`buncument://${slug}`, {
                  uri: `buncument://${slug}`,
                  name: title,
                  description: `${tab.tab} / ${group.group}`,
                  mimeType: 'text/markdown',
                  filePath: candidate,
                });
                break;
              }
            }
          }
        }
      }
    }

    // Create server with real data
    const server = await createMcpServer(docsDir, db, resourceIndex);

    // Create in-memory transport pair
    [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();

    // Connect server to its transport
    await server.connect(serverTransport);

    // Create and connect client
    client = new Client({
      name: 'test-client',
      version: '1.0.0',
    });
    await client.connect(clientTransport);
  });

  afterAll(async () => {
    if (client) await client.close();
    if (db) db.close();
  });

  test('can list tools', async () => {
    if (!client) {
      console.log('Skipping - no client');
      return;
    }

    const tools = await client.listTools();
    expect(tools.tools).toBeDefined();
    expect(tools.tools.length).toBe(3); // search, read, list

    const toolNames = tools.tools.map((t: { name: string }) => t.name);
    expect(toolNames).toContain('search_bun_docs');
    expect(toolNames).toContain('read_bun_doc');
    expect(toolNames).toContain('list_bun_docs');
  });

  test('can call list_bun_docs', async () => {
    if (!client) {
      console.log('Skipping - no client');
      return;
    }

    const result = await client.callTool({
      name: 'list_bun_docs',
      arguments: { limit: 5 },
    });

    expect(result).toBeDefined();
    expect(result.content).toBeDefined();

    const content = result.content as Array<{ type: string; text: string }>;
    expect(content.length).toBeGreaterThan(0);

    const firstContent = content[0];
    if (!firstContent) {
      throw new Error('Expected content to have at least one item');
    }
    const text = firstContent.text;
    const docs = JSON.parse(text);
    expect(Array.isArray(docs)).toBe(true);
    expect(docs.length).toBeGreaterThan(0);
    expect(docs[0]).toHaveProperty('uri');
    expect(docs[0]).toHaveProperty('title');
  });

  test('can call read_bun_doc with valid slug', async () => {
    if (!client) {
      console.log('Skipping - no client');
      return;
    }

    const result = await client.callTool({
      name: 'read_bun_doc',
      arguments: { path: 'index' },
    });

    expect(result).toBeDefined();
    expect(result.content).toBeDefined();
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0]?.text).toContain('#');
  });

  test('read_bun_doc returns error for invalid slug', async () => {
    if (!client) {
      console.log('Skipping - no client');
      return;
    }

    const result = await client.callTool({
      name: 'read_bun_doc',
      arguments: { path: 'nonexistent-page-12345' },
    });

    expect(result).toBeDefined();
    expect(result.isError).toBe(true);
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0]?.text).toContain('Read error');
  });

  test('can call search_bun_docs', async () => {
    if (!client) {
      console.log('Skipping - no client');
      return;
    }

    const result = await client.callTool({
      name: 'search_bun_docs',
      arguments: { query: 'WebSocket', limit: 5 },
    });

    expect(result).toBeDefined();
    expect(result.content).toBeDefined();

    const content = result.content as Array<{ type: string; text: string }>;
    const firstContent = content[0];
    if (!firstContent) {
      throw new Error('Expected content to have at least one item');
    }
    const text = firstContent.text;
    const results = JSON.parse(text);
    expect(Array.isArray(results)).toBe(true);
    // Should return results or empty array, not error
    expect(result.isError).toBeFalsy();
  });
});
