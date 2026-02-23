#!/usr/bin/env bun

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { join, dirname } from 'node:path';
import { existsSync, mkdirSync, mkdtempSync } from 'node:fs';
import { $ } from 'bun';
import { Database } from 'bun:sqlite';

import { getPackageVersion } from './macros.ts' with { type: 'macro' };
const VERSION = await getPackageVersion();

const DEFAULT_SEARCH_LIMIT = 30;
const SCHEMA_VERSION = 1;

// Simple TTL cache
const searchCacheMap = new Map<
  string,
  { value: SearchResult[]; expiry: number }
>();
const CACHE_TTL = 1000 * 60 * 5;

function cacheGet(key: string): SearchResult[] | undefined {
  const entry = searchCacheMap.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiry) {
    searchCacheMap.delete(key);
    return undefined;
  }
  return entry.value;
}

function cacheSet(key: string, value: SearchResult[]): void {
  searchCacheMap.set(key, { value, expiry: Date.now() + CACHE_TTL });
  if (searchCacheMap.size > 1000) {
    const now = Date.now();
    for (const [k, v] of searchCacheMap) {
      if (now > v.expiry) searchCacheMap.delete(k);
    }
  }
}

// FTS5 search (inline, no Worker)
function sanitizeFtsQuery(query: string): string {
  return query
    .split(/\s+/)
    .filter((term) => term.length > 0)
    .map((term) => {
      const cleaned = term.replace(/[":*^()]/g, '');
      if (!cleaned) return null;
      return `"${cleaned}"`;
    })
    .filter(Boolean)
    .join(' OR ');
}

function searchDocuments(
  database: Database,
  query: string,
  searchPath: string = '',
  limit: number = DEFAULT_SEARCH_LIMIT
): SearchResult[] {
  const sanitized = sanitizeFtsQuery(query);
  if (!sanitized) return [];

  let sql = `
    SELECT uri, title, bm25(docs_fts, 1.0, 2.0, 1.5, 3.0, 1.0) as score,
      snippet(docs_fts, 4, '>>>', '<<<', '...', 32) as snippet
    FROM docs_fts WHERE docs_fts MATCH ?
  `;
  const params: (string | number)[] = [sanitized];
  if (searchPath) {
    sql += ` AND uri LIKE ?`;
    params.push(`${searchPath}%`);
  }
  sql += ` ORDER BY score LIMIT ?`;
  params.push(limit);

  const rows = database.prepare(sql).all(...params) as Array<{
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

function ftsSearch(
  database: Database,
  query: string,
  searchPath: string = '',
  limit: number = DEFAULT_SEARCH_LIMIT
): SearchResult[] {
  const cacheKey = `${query}|${searchPath}|${limit}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;
  const results = searchDocuments(database, query, searchPath, limit);
  cacheSet(cacheKey, results);
  return results;
}

type IndexedResource = {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
  filePath?: string;
  isDirectory?: boolean;
};

type SearchResult = {
  uri: string;
  title: string;
  score: number;
  snippet: string;
};

type NavPage = {
  type: 'page';
  slug: string;
  title: string;
  disabled?: boolean;
  href?: string;
  description?: string;
};

type NavDivider = {
  type: 'divider';
  title: string;
};

type NavItem = NavPage | NavDivider;

type Nav = {
  items: NavItem[];
};

type PageInfo = {
  title: string;
  description: string;
  divider: string;
  disabled?: boolean;
  href?: string;
};

if (process.argv.includes('--version') || process.argv.includes('-v')) {
  console.log(VERSION);
  process.exit(0);
}

function print(s: string): boolean {
  if (process.stdout.isTTY === true) {
    console.log(s);
    return true;
  }
  return false;
}

async function downloadDocsFromGitHub(
  version: string,
  targetDir: string
): Promise<void> {
  const gitTag = `bun-v${version}`;
  const repoUrl = 'https://github.com/oven-sh/bun.git';
  mkdirSync(dirname(targetDir), { recursive: true });
  const tempDir = mkdtempSync(join(dirname(targetDir), '.tmp-git-'));

  const cleanupTemp = async () => {
    try {
      await $`rm -rf ${tempDir}`.quiet();
    } catch {
      return;
    }
  };

  try {
    console.error(`Downloading Bun documents for ${gitTag}`);
    await $`git clone --filter=blob:none --sparse --depth 1 --branch ${gitTag} ${repoUrl} ${tempDir}`.quiet();
    await $`cd ${tempDir} && git sparse-checkout set docs`.quiet();

    const sourceDir = join(tempDir, 'docs');
    if (!existsSync(sourceDir)) {
      throw new Error(`Documentation not found in tag ${gitTag}`);
    }

    await $`rm -rf ${targetDir}`.quiet().catch(() => {});
    await $`mv ${sourceDir} ${targetDir}`.quiet();
  } catch (error) {
    throw new Error(
      `Failed to download docs: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  } finally {
    await cleanupTemp();
  }
}

function listVersionCandidates(version: string): string[] {
  const base = version.split('+')[0] || version;
  const candidates = new Set<string>();
  if (base) {
    candidates.add(base);
    const dash = base.indexOf('-');
    if (dash > -1) {
      const release = base.slice(0, dash);
      if (release) {
        candidates.add(release);
      }
    }
  }
  return Array.from(candidates);
}

async function downloadDocsWithFallback(
  versions: string[],
  targetDir: string
): Promise<void> {
  let lastError: Error | undefined;
  for (const version of versions) {
    try {
      await downloadDocsFromGitHub(version, targetDir);
      return;
    } catch (error) {
      if (error instanceof Error) {
        lastError = error;
      } else {
        lastError = new Error(String(error));
      }
    }
  }
  if (lastError) {
    throw lastError;
  }
}

async function initializeDocsDir(): Promise<string> {
  const bunVersion = Bun.version;
  const versionCandidates = listVersionCandidates(bunVersion);
  const cacheDocsDir = join(
    Bun.env.HOME || '/tmp',
    '.cache',
    'bun-mcp-server',
    bunVersion,
    'docs'
  );

  // First check: if directory doesn't exist, download
  if (!existsSync(cacheDocsDir)) {
    await downloadDocsWithFallback(versionCandidates, cacheDocsDir);
  }

  // Check for docs.json (new Mintlify format) or nav.ts (old format)
  const docsJsonPath = join(cacheDocsDir, 'docs.json');
  const navTsPath = join(cacheDocsDir, 'nav.ts');

  if (!existsSync(docsJsonPath) && !existsSync(navTsPath)) {
    console.error('docs.json/nav.ts not found, re-downloading docs...');
    await $`rm -rf ${cacheDocsDir}`.quiet().catch(() => {});
    await downloadDocsWithFallback(versionCandidates, cacheDocsDir);

    // Final check
    if (!existsSync(docsJsonPath) && !existsSync(navTsPath)) {
      console.error(
        `Error: No navigation file found in Bun ${bunVersion} documentation.`
      );
      console.error(
        'This may indicate an incompatible Bun version or repository structure change.'
      );
      process.exit(1);
    }
  }

  return cacheDocsDir;
}

const DOCS_DIR = await initializeDocsDir();

// SQLite FTS5 search database
const DB_PATH = join(dirname(DOCS_DIR), 'search.db');
function initializeSearchDatabase(): Database {
  const needsRebuild = !existsSync(DB_PATH);
  const database = new Database(DB_PATH);

  // Check schema version
  let currentVersion = 0;
  try {
    const row = database.query('SELECT version FROM schema_version').get() as {
      version: number;
    } | null;
    if (row) currentVersion = row.version;
  } catch {
    // Table doesn't exist, needs rebuild
  }

  if (needsRebuild || currentVersion < SCHEMA_VERSION) {
    // Drop and recreate tables
    database.exec(`
      DROP TABLE IF EXISTS docs_fts;
      DROP TABLE IF EXISTS schema_version;

      CREATE TABLE schema_version (version INTEGER);
      INSERT INTO schema_version VALUES (${SCHEMA_VERSION});

      CREATE VIRTUAL TABLE docs_fts USING fts5(
        uri,
        title,
        category,
        summary,
        content,
        tokenize='porter unicode61'
      );
    `);
  }

  return database;
}

const db = initializeSearchDatabase();

// Global resource index
const RESOURCE_INDEX = new Map<string, IndexedResource>();
let TOTAL_RESOURCE_COUNT = 0;

// Types for docs.json (Mintlify format)
type DocsJsonGroup = {
  group: string;
  icon?: string;
  pages: string[];
};

type DocsJsonTab = {
  tab: string;
  icon?: string;
  groups: DocsJsonGroup[];
};

type DocsJson = {
  navigation: {
    tabs: DocsJsonTab[];
  };
};

// Parse docs.json (new Mintlify format) or nav.ts (old format)
async function parseNavigation(): Promise<Map<string, PageInfo>> {
  const docsJsonPath = join(DOCS_DIR, 'docs.json');
  const navTsPath = join(DOCS_DIR, 'nav.ts');
  const pageMap = new Map<string, PageInfo>();

  if (existsSync(docsJsonPath)) {
    // New Mintlify format
    try {
      const file = Bun.file(docsJsonPath);
      const docsJson: DocsJson = await file.json();

      for (const tab of docsJson.navigation.tabs) {
        if (!tab.groups || tab.groups.length === 0) continue;

        for (const group of tab.groups) {
          if (!group.pages) continue;

          for (const pagePath of group.pages) {
            const slug = pagePath.replace(/^\//, '');
            const parts = slug.split('/');
            const lastPart = parts[parts.length - 1] || slug;
            const title = lastPart
              .split('-')
              .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
              .join(' ');

            pageMap.set(slug, {
              title: title,
              description: '',
              divider: `${tab.tab} / ${group.group}`,
            });
          }
        }
      }
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Failed to parse docs.json: ${error.message}`);
      }
      throw new Error('Failed to parse docs.json');
    }
  } else if (existsSync(navTsPath)) {
    // Old nav.ts format
    try {
      const navModule = await import(navTsPath);
      const nav: Nav = navModule.default;

      let currentDivider = '';

      for (const item of nav.items) {
        if (item.type === 'divider') {
          currentDivider = item.title;
        } else if (item.type === 'page') {
          pageMap.set(item.slug, {
            title: item.title,
            description: item.description || '',
            divider: currentDivider,
            disabled: item.disabled,
            href: item.href,
          });
        }
      }
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Failed to parse nav.ts: ${error.message}`);
      }
      throw new Error('Failed to parse nav.ts');
    }
  }

  return pageMap;
}

const PAGE_MAP = await parseNavigation();

async function buildResourceIndex(): Promise<void> {
  const countRow = db.query('SELECT COUNT(*) as count FROM docs_fts').get() as {
    count: number;
  };
  const needsFtsRebuild = countRow.count === 0;

  const docsToWorker: Array<{
    uri: string;
    title: string;
    category: string;
    summary: string;
    content: string;
  }> = [];

  for (const [slug, pageInfo] of PAGE_MAP.entries()) {
    if (pageInfo.disabled || pageInfo.href) continue;

    let filePath = '';
    const candidates = [
      join(DOCS_DIR, `${slug}.md`),
      join(DOCS_DIR, `${slug}.mdx`),
      join(DOCS_DIR, slug, 'index.md'),
      join(DOCS_DIR, slug, 'index.mdx'),
    ];

    for (const candidate of candidates) {
      if (existsSync(candidate)) {
        filePath = candidate;
        break;
      }
    }

    if (!filePath) {
      continue;
    }

    const description =
      pageInfo.divider && pageInfo.description
        ? `${pageInfo.divider} / ${pageInfo.description}`
        : pageInfo.description || pageInfo.divider || '';

    const uri = `buncument://${slug}`;
    RESOURCE_INDEX.set(uri, {
      uri: uri,
      name: pageInfo.title,
      description: description,
      mimeType: 'text/markdown',
      filePath: filePath,
    });

    if (needsFtsRebuild) {
      const content = await Bun.file(filePath).text();
      docsToWorker.push({
        uri: slug,
        title: pageInfo.title,
        category: pageInfo.divider,
        summary: extractSummary(content),
        content,
      });
    }
  }

  const guidesDir = join(DOCS_DIR, 'guides');
  if (existsSync(guidesDir)) {
    RESOURCE_INDEX.set('buncument://guides', {
      uri: 'buncument://guides',
      name: 'Guides',
      description:
        'A collection of code samples and walkthroughs for performing common tasks with Bun.',
      mimeType: 'application/json',
      isDirectory: true,
    });

    const allMdFiles =
      await Bun.$`find ${guidesDir} -type f \( -name "*.md" -o -name "*.mdx" \) 2>/dev/null`.text();
    for (const filePath of allMdFiles.trim().split('\n').filter(Boolean)) {
      const relativePath = filePath
        .replace(DOCS_DIR + '/', '')
        .replace(/\.mdx?$/, '');
      const content = await Bun.file(filePath).text();
      const frontmatter = parseFrontmatter(content);
      const filename =
        filePath
          .split('/')
          .pop()
          ?.replace(/\.mdx?$/, '') || '';
      const firstLine = content.split('\n')[0] || '';

      const uri = `buncument://${relativePath}`;
      RESOURCE_INDEX.set(uri, {
        uri: uri,
        name: frontmatter.name || filename,
        description:
          frontmatter.description || firstLine.substring(0, 100) || '',
        mimeType: 'text/markdown',
        filePath: filePath,
      });

      if (needsFtsRebuild) {
        docsToWorker.push({
          uri: relativePath,
          title: frontmatter.name || filename,
          category: 'Guides',
          summary: extractSummary(content),
          content,
        });
      }
    }
  }

  const ecosystemDir = join(DOCS_DIR, 'ecosystem');
  if (existsSync(ecosystemDir)) {
    const allMdFiles =
      await Bun.$`find ${ecosystemDir} -type f \( -name "*.md" -o -name "*.mdx" \) 2>/dev/null`.text();
    for (const filePath of allMdFiles.trim().split('\n').filter(Boolean)) {
      const relativePath = filePath
        .replace(DOCS_DIR + '/', '')
        .replace(/\.mdx?$/, '');
      const filename =
        filePath
          .split('/')
          .pop()
          ?.replace(/\.mdx?$/, '') || '';
      const content = await Bun.file(filePath).text();
      const firstLine = content.split('\n')[0] || filename;
      const title = filename.charAt(0).toUpperCase() + filename.slice(1);

      const uri = `buncument://${relativePath}`;
      RESOURCE_INDEX.set(uri, {
        uri: uri,
        name: title,
        description: firstLine.substring(0, 100),
        mimeType: 'text/markdown',
        filePath: filePath,
      });

      if (needsFtsRebuild) {
        docsToWorker.push({
          uri: relativePath,
          title: title,
          category: 'Ecosystem',
          summary: extractSummary(content),
          content,
        });
      }
    }
  }

  if (needsFtsRebuild && docsToWorker.length > 0) {
    print(`Rebuilding FTS index with ${docsToWorker.length} documents...`);
    db.exec('BEGIN TRANSACTION');
    db.exec('DELETE FROM docs_fts');
    const insertStmt = db.prepare(
      'INSERT INTO docs_fts (uri, title, category, summary, content) VALUES (?, ?, ?, ?, ?)'
    );
    for (const doc of docsToWorker) {
      insertStmt.run(
        doc.uri,
        doc.title,
        doc.category,
        doc.summary,
        doc.content
      );
    }
    db.exec('COMMIT');
  }

  TOTAL_RESOURCE_COUNT = RESOURCE_INDEX.size;
  print(`Total indexed resources: ${TOTAL_RESOURCE_COUNT}`);
}

function parseFrontmatter(content: string): {
  name?: string;
  description?: string;
} {
  const lines = content.split('\n');
  if (lines[0] !== '---') return {};
  const frontmatter: Record<string, string> = {};
  let i = 1;
  while (i < lines.length && lines[i] !== '---') {
    const line = lines[i];
    if (line) {
      const match = line.match(/^(\w+):\s*(.*)$/);
      if (match && match[1] && match[2]) frontmatter[match[1]] = match[2];
    }
    i++;
  }
  return { name: frontmatter.name, description: frontmatter.description };
}

function stripFrontmatter(content: string): string {
  if (!content.startsWith('---')) return content;
  const endIdx = content.indexOf('---', 3);
  if (endIdx === -1) return content;
  return content.slice(endIdx + 3).replace(/^\n+/, '');
}

function extractSummary(content: string, maxLength: number = 300): string {
  let text = content;
  if (text.startsWith('---')) {
    const endIdx = text.indexOf('---', 3);
    if (endIdx !== -1) text = text.slice(endIdx + 3);
  }
  text = text
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`]+`/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '')
    .replace(/\n+/g, ' ')
    .trim();
  if (text.length > maxLength) return text.slice(0, maxLength) + '...';
  return text;
}

await buildResourceIndex();

async function grepDocuments(
  pattern: string,
  searchPath: string = '',
  limit: number = DEFAULT_SEARCH_LIMIT,
  flags: string = 'gi'
): Promise<SearchResult[]> {
  const regex = new RegExp(pattern, flags.includes('g') ? flags : flags + 'g');
  const results: SearchResult[] = [];
  for (const [uri, resource] of RESOURCE_INDEX.entries()) {
    if (resource.isDirectory || !resource.filePath) continue;
    if (searchPath && !uri.replace('buncument://', '').startsWith(searchPath))
      continue;
    try {
      const content = await Bun.file(resource.filePath).text();
      const matches = content.match(regex);
      if (matches) {
        const matchIndex = content.search(regex);
        const start = Math.max(0, matchIndex - 50);
        const end = Math.min(content.length, matchIndex + 100);
        const snippet = content.slice(start, end).replace(/\n+/g, ' ').trim();
        results.push({
          uri,
          title: resource.name,
          score: matches.length,
          snippet: `...${snippet}...`,
        });
      }
    } catch {
      // Ignore read errors
    }
    if (results.length >= limit * 2) break;
  }
  return results.sort((a, b) => b.score - a.score).slice(0, limit);
}

const server = new McpServer(
  { name: 'bun-mcp-server', version: VERSION },
  {
    capabilities: { tools: {}, resources: {} },
    instructions: `This MCP server provides access to Bun documentation with FTS5 search and caching.`,
  }
);

server.registerTool(
  'search_bun_docs',
  {
    description: 'Search Bun documentation using FTS5 (optimized).',
    inputSchema: {
      query: z.string(),
      path: z.string().optional(),
      limit: z.number().optional(),
    },
  },
  async ({ query, path, limit }) => {
    try {
      const results = ftsSearch(db, query, path, limit);
      return { content: [{ type: 'text', text: JSON.stringify(results) }] };
    } catch (e) {
      return { content: [{ type: 'text', text: String(e) }], isError: true };
    }
  }
);

server.registerTool(
  'grep_bun_docs',
  {
    description: 'Search using Regex.',
    inputSchema: {
      pattern: z.string(),
      path: z.string().optional(),
      limit: z.number().optional(),
      flags: z.string().optional(),
    },
  },
  async ({ pattern, path, limit, flags }) => {
    try {
      const results = await grepDocuments(pattern, path, limit, flags);
      return { content: [{ type: 'text', text: JSON.stringify(results) }] };
    } catch (e) {
      return { content: [{ type: 'text', text: String(e) }], isError: true };
    }
  }
);

server.registerTool(
  'read_bun_doc',
  {
    description: 'Read a doc.',
    inputSchema: {
      path: z.string(),
      maxLines: z.number().optional(),
      offset: z.number().optional(),
    },
  },
  async ({ path, maxLines = 200, offset = 0 }) => {
    try {
      const slug = path.replace(/^\/+/, '').replace(/\.md$/, '');
      const resource = RESOURCE_INDEX.get(`buncument://${slug}`);
      if (!resource?.filePath) throw new Error('Not found');
      const content = stripFrontmatter(
        await Bun.file(resource.filePath).text()
      );
      const lines = content.split('\n');
      return {
        content: [
          {
            type: 'text',
            text: lines
              .slice(offset, offset + (maxLines || lines.length))
              .join('\n'),
          },
        ],
      };
    } catch (e) {
      return { content: [{ type: 'text', text: String(e) }], isError: true };
    }
  }
);

server.registerTool(
  'list_bun_docs',
  {
    description: 'List docs.',
    inputSchema: {
      category: z.string().optional(),
      limit: z.number().optional(),
    },
  },
  ({ category, limit = 50 }) => {
    const results = Array.from(RESOURCE_INDEX.entries())
      .filter(
        ([uri]) =>
          !category || uri.replace('buncument://', '').startsWith(category)
      )
      .slice(0, limit)
      .map(([uri, r]) => ({ uri, title: r.name, description: r.description }));
    return { content: [{ type: 'text', text: JSON.stringify(results) }] };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
print(`Bun MCP Server v${VERSION} connected via Stdio`);
