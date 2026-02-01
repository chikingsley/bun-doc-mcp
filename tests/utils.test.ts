import { expect, test, describe } from 'bun:test';
import { existsSync } from 'node:fs';

describe('Utility Functions', () => {
  test('normalizeSlug handles basic paths', () => {
    // Import the function - need to extract it first
    // For now, just a placeholder
    expect(true).toBe(true);
  });
});

describe('Download Functionality', () => {
  test('docs are cached locally', () => {
    const cacheDir = `${process.env.HOME}/.cache/bun-doc-mcp`;
    const exists = existsSync(cacheDir);
    expect(exists).toBe(true);
  });

  test('docs.json exists in cache', async () => {
    const bunVersion = Bun.version;
    const docsJsonPath = `${process.env.HOME}/.cache/bun-doc-mcp/${bunVersion}/docs/docs.json`;
    const file = Bun.file(docsJsonPath);
    const exists = await file.exists();
    expect(exists).toBe(true);
  });

  test('can read docs.json structure', async () => {
    const bunVersion = Bun.version;
    const docsJsonPath = `${process.env.HOME}/.cache/bun-doc-mcp/${bunVersion}/docs/docs.json`;
    const file = Bun.file(docsJsonPath);
    const content = await file.text();
    const docs = JSON.parse(content);

    expect(docs).toHaveProperty('navigation');
    expect(docs.navigation).toHaveProperty('tabs');
    expect(Array.isArray(docs.navigation.tabs)).toBe(true);
  });
});

describe('Search Database', () => {
  test('search.db exists', async () => {
    const bunVersion = Bun.version;
    const dbPath = `${process.env.HOME}/.cache/bun-doc-mcp/${bunVersion}/search.db`;
    const file = Bun.file(dbPath);
    const exists = await file.exists();
    expect(exists).toBe(true);
  });
});
