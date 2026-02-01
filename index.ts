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
    'bun-doc-mcp',
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
        // Skip tabs without groups (like Reference, Blog, Feedback)
        if (!tab.groups || tab.groups.length === 0) {
          continue;
        }

        for (const group of tab.groups) {
          if (!group.pages) continue;

          for (const pagePath of group.pages) {
            // pagePath is like "/runtime/bun-apis" - remove leading slash
            const slug = pagePath.replace(/^\//, '');
            // Extract title from slug (last part, titlecase)
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
  // Check if FTS index needs rebuilding
  const countRow = db.query('SELECT COUNT(*) as count FROM docs_fts').get() as {
    count: number;
  };
  const needsFtsRebuild = countRow.count === 0;

  if (needsFtsRebuild) {
    clearSearchIndex();
  }

  let navIndexed = 0;
  let navMissing = 0;
  for (const [slug, pageInfo] of PAGE_MAP.entries()) {
    if (pageInfo.disabled || pageInfo.href) {
      continue;
    }

    // Try multiple file extensions: .md, .mdx, index.md, index.mdx
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
      navMissing++;
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

    // Index in FTS5
    if (needsFtsRebuild) {
      const file = Bun.file(filePath);
      const content = await file.text();
      indexDocument(slug, pageInfo.title, pageInfo.divider, content);
    }

    navIndexed++;
  }
  print(
    `Indexed ${navIndexed} nav pages${navMissing > 0 ? ` (${navMissing} missing)` : ''}`
  );

  const guidesDir = join(DOCS_DIR, 'guides');
  let guidesIndexed = 0;
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
      await Bun.$`find ${guidesDir} -type f -name "*.md" 2>/dev/null`
        .text()
        .catch(() => '');
    const allMdxFiles =
      await Bun.$`find ${guidesDir} -type f -name "*.mdx" 2>/dev/null`
        .text()
        .catch(() => '');
    const allFiles = allMdFiles + '\n' + allMdxFiles;
    for (const filePath of allFiles.trim().split('\n').filter(Boolean)) {
      const relativePath = filePath
        .replace(DOCS_DIR + '/', '')
        .replace(/\.mdx?$/, '');
      const file = Bun.file(filePath);
      const content = await file.text();
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

      // Index in FTS5
      if (needsFtsRebuild) {
        indexDocument(
          relativePath,
          frontmatter.name || filename,
          'Guides',
          content
        );
      }

      guidesIndexed++;
    }

    const subdirs =
      await Bun.$`find ${guidesDir} -mindepth 1 -type d 2>/dev/null`
        .text()
        .catch(() => '');
    for (const dirPath of subdirs.trim().split('\n').filter(Boolean)) {
      const relativePath = dirPath.replace(DOCS_DIR + '/', '');
      const pathParts = dirPath.split('/');
      const dirname = pathParts[pathParts.length - 1] || '';
      const indexPath = join(dirPath, 'index.json');
      let dirName = dirname;
      let dirDescription = 'Directory';

      if (existsSync(indexPath)) {
        try {
          const indexFile = Bun.file(indexPath);
          const indexData = await indexFile.json();
          dirName = indexData.name || dirname;
          dirDescription = indexData.description || 'Directory';
        } catch {
          // Use default values if index.json cannot be read
        }
      }

      RESOURCE_INDEX.set(`buncument://${relativePath}`, {
        uri: `buncument://${relativePath}`,
        name: dirName,
        description: dirDescription,
        mimeType: 'application/json',
        isDirectory: true,
      });
    }
  }
  print(`Indexed ${guidesIndexed} guides files`);

  const ecosystemDir = join(DOCS_DIR, 'ecosystem');
  let ecosystemIndexed = 0;
  if (existsSync(ecosystemDir)) {
    const allMdFiles =
      await Bun.$`find ${ecosystemDir} -type f -name "*.md" 2>/dev/null`
        .text()
        .catch(() => '');
    const allMdxFiles =
      await Bun.$`find ${ecosystemDir} -type f -name "*.mdx" 2>/dev/null`
        .text()
        .catch(() => '');
    const allFiles = allMdFiles + '\n' + allMdxFiles;
    for (const filePath of allFiles.trim().split('\n').filter(Boolean)) {
      const relativePath = filePath
        .replace(DOCS_DIR + '/', '')
        .replace(/\.mdx?$/, '');
      const filename =
        filePath
          .split('/')
          .pop()
          ?.replace(/\.mdx?$/, '') || '';
      const file = Bun.file(filePath);
      const content = await file.text();
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

      // Index in FTS5
      if (needsFtsRebuild) {
        indexDocument(relativePath, title, 'Ecosystem', content);
      }

      ecosystemIndexed++;
    }
  }
  print(`Indexed ${ecosystemIndexed} ecosystem files`);

  TOTAL_RESOURCE_COUNT = RESOURCE_INDEX.size;
  const ftsCount = (
    db.query('SELECT COUNT(*) as count FROM docs_fts').get() as {
      count: number;
    }
  ).count;
  print(`Total indexed resources: ${TOTAL_RESOURCE_COUNT} (FTS: ${ftsCount})`);
}

await buildResourceIndex();

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
      if (match && match[1] && match[2]) {
        frontmatter[match[1]] = match[2];
      }
    }
    i++;
  }

  return {
    name: frontmatter.name,
    description: frontmatter.description,
  };
}

function extractSummary(content: string, maxLength: number = 300): string {
  // Remove frontmatter
  let text = content;
  if (text.startsWith('---')) {
    const endIdx = text.indexOf('---', 3);
    if (endIdx !== -1) {
      text = text.slice(endIdx + 3);
    }
  }

  // Remove markdown headers, code blocks, and links
  text = text
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`]+`/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/\n+/g, ' ')
    .trim();

  // Cut at sentence boundary if possible
  if (text.length > maxLength) {
    const truncated = text.slice(0, maxLength);
    const lastSentence = truncated.lastIndexOf('. ');
    if (lastSentence > maxLength * 0.5) {
      return truncated.slice(0, lastSentence + 1);
    }
    return truncated + '...';
  }
  return text;
}

function indexDocument(
  uri: string,
  title: string,
  category: string,
  content: string
): void {
  const summary = extractSummary(content);
  const insertStmt = db.prepare(
    'INSERT INTO docs_fts (uri, title, category, summary, content) VALUES (?, ?, ?, ?, ?)'
  );
  insertStmt.run(uri, title, category, summary, content);
}

function clearSearchIndex(): void {
  db.exec('DELETE FROM docs_fts');
}

function sanitizeFtsQuery(query: string): string {
  // Escape special FTS5 characters and quote each term
  // FTS5 special chars: " * ^ : OR AND NOT NEAR ( )
  return query
    .split(/\s+/)
    .filter((term) => term.length > 0)
    .map((term) => {
      // Remove or escape special characters
      const cleaned = term.replace(/[":*^()]/g, '');
      if (!cleaned) return null;
      // Quote the term to treat it as literal
      return `"${cleaned}"`;
    })
    .filter(Boolean)
    .join(' OR ');
}

function searchDocuments(
  query: string,
  searchPath: string = '',
  limit: number = DEFAULT_SEARCH_LIMIT
): SearchResult[] {
  const sanitizedQuery = sanitizeFtsQuery(query);
  if (!sanitizedQuery) {
    return [];
  }

  // Build query with optional path filter
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
    score: Math.round(-row.score * 100) / 100, // Negate BM25 (lower is better) and round
    snippet: row.snippet.replace(/>>>/g, '**').replace(/<<</g, '**'),
  }));
}

// Keep regex search as fallback for complex patterns
async function grepDocuments(
  pattern: string,
  searchPath: string = '',
  limit: number = DEFAULT_SEARCH_LIMIT,
  flags: string = 'gi'
): Promise<SearchResult[]> {
  const allowedFlags = ['g', 'i', 'm', 'u', 'y', 's'];
  const flagList = flags
    ? Array.from(
        new Set(flags.split('').filter((flag) => allowedFlags.includes(flag)))
      )
    : [];
  if (!flagList.includes('g')) {
    flagList.push('g');
  }
  const finalFlags = flagList.join('') || 'g';

  let regex: RegExp;
  try {
    regex = new RegExp(pattern, finalFlags);
  } catch {
    throw new Error(`Invalid regular expression: ${pattern}`);
  }

  const results: SearchResult[] = [];

  for (const [uri, resource] of RESOURCE_INDEX.entries()) {
    if (resource.isDirectory || !resource.filePath) {
      continue;
    }

    if (searchPath) {
      const resourcePath = uri.replace('buncument://', '');
      if (!resourcePath.startsWith(searchPath)) {
        continue;
      }
    }

    try {
      const file = Bun.file(resource.filePath);
      const content = await file.text();
      const matches = content.match(regex);
      if (matches && matches.length > 0) {
        // Generate snippet around first match
        const matchIndex = content.search(regex);
        const start = Math.max(0, matchIndex - 50);
        const end = Math.min(content.length, matchIndex + 100);
        let snippet = content.slice(start, end).replace(/\n+/g, ' ').trim();
        if (start > 0) snippet = '...' + snippet;
        if (end < content.length) snippet = snippet + '...';

        results.push({
          uri: resource.uri,
          title: resource.name,
          score: matches.length,
          snippet: snippet,
        });
      }
    } catch (error) {
      console.error(`Failed to read ${resource.filePath}:`, error);
    }
  }

  return results.sort((a, b) => b.score - a.score).slice(0, limit);
}

function normalizeSlug(input: string): string {
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
  return `buncument://${value}`;
}

async function readDocument(input: string): Promise<string> {
  const key = normalizeSlug(input);
  const resource = RESOURCE_INDEX.get(key);
  if (!resource) {
    throw new Error(`Document not found for slug: ${input}`);
  }
  if (!resource.filePath || resource.isDirectory) {
    throw new Error(`Requested slug is not a document: ${input}`);
  }
  const file = Bun.file(resource.filePath);
  return file.text();
}

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
    instructions: `This MCP server provides access to Bun documentation with full-text search (FTS5 + BM25 ranking).

## How to use:
- Use **search_bun_docs** for natural language queries (recommended) - uses FTS5 with BM25 ranking
- Use **grep_bun_docs** for regex patterns when you need exact matching
- Call **read_bun_doc** with a documentation slug to fetch the full markdown

## APIs
- \`Bun.serve()\` supports WebSockets, HTTPS, and routes. Don't use \`express\`.
- \`bun:sqlite\` for SQLite. Don't use \`better-sqlite3\`.
- \`Bun.redis\` for Redis. Don't use \`ioredis\`.
- \`Bun.sql\` for Postgres. Don't use \`pg\` or \`postgres.js\`.
- \`WebSocket\` is built-in. Don't use \`ws\`.
- Prefer \`Bun.file\` over \`node:fs\`'s readFile/writeFile
- Bun.$\`ls\` instead of execa.

## Tips:
- **ALWAYS** read the documents to find if bun have a better version before you start use any node API
- Check 'api/' for API references, 'guides/' for walkthroughs, and 'runtime/' for runtime specifics
- Search results include snippets showing context around matches`,
  }
);

server.registerTool(
  'search_bun_docs',
  {
    description: `Search Bun documentation using full-text search with BM25 ranking.
Returns: Array of results with uri, title, relevance score, and snippet showing context.

This is the recommended search tool - it uses SQLite FTS5 with Porter stemming,
so "running" matches "run", "runs", etc.

Examples:
- Search for WebSocket: query: 'websocket server'
- Find SQLite APIs: query: 'sqlite database', path: 'api/'
- Search guides: query: 'http request', path: 'guides/'`,
    inputSchema: {
      query: z.string().describe('Search query (natural language)'),
      path: z
        .string()
        .optional()
        .describe(
          "Optional path prefix to filter results (e.g., 'api/' or 'guides/')"
        ),
      limit: z
        .number()
        .optional()
        .describe(
          `Maximum number of results to return (default: ${DEFAULT_SEARCH_LIMIT})`
        ),
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
  'grep_bun_docs',
  {
    description: `Search Bun documentation using JavaScript regular expressions.
Use this for exact pattern matching when FTS search isn't precise enough.
Returns: Array of results with uri, title, match count, and snippet.

Examples:
- Exact API name: pattern: 'Bun\\.serve'
- Find all imports: pattern: 'import.*from', path: 'guides/'
- Complex patterns: pattern: 'Bun\\.(serve|file|write)'`,
    inputSchema: {
      pattern: z.string().describe('JavaScript regex pattern to search for'),
      path: z
        .string()
        .optional()
        .describe("Optional path to search in (e.g., 'api/' or 'guides/')"),
      limit: z
        .number()
        .optional()
        .describe(
          `Maximum number of results to return (default: ${DEFAULT_SEARCH_LIMIT})`
        ),
      flags: z
        .string()
        .optional()
        .describe("Regex flags (default: 'gi' for global case-insensitive)"),
    },
  },
  async ({ pattern, path, limit = DEFAULT_SEARCH_LIMIT, flags }) => {
    try {
      const results = await grepDocuments(pattern, path, limit, flags);
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
            text: `Grep error: ${error instanceof Error ? error.message : 'Unknown error'}`,
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
    description: `List available Bun documentation pages, optionally filtered by category.
Returns: Array of documents with uri, title, and description.

Categories: API, Runtime, Bundler, Test, Package manager, Guides, Ecosystem`,
    inputSchema: {
      category: z
        .string()
        .optional()
        .describe(
          "Optional category to filter by (e.g., 'api/', 'guides/', 'runtime/')"
        ),
      limit: z
        .number()
        .optional()
        .describe('Maximum number of results to return (default: 50)'),
    },
  },
  ({ category, limit = 50 }) => {
    const results: Array<{ uri: string; title: string; description: string }> =
      [];

    for (const [uri, resource] of RESOURCE_INDEX.entries()) {
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

if (
  print(`Bun documents cached in ${DOCS_DIR}, please attach by a MCP client.`)
) {
  process.exit(0);
}

const transport = new StdioServerTransport();
await server.connect(transport);
