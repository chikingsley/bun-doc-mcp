import { Database } from 'bun:sqlite';

declare var self: Worker;

let db: Database | null = null;

self.onmessage = (event) => {
  const { type, payload } = event.data;

  switch (type) {
    case 'INIT':
      try {
        db = new Database(payload.dbPath);
        self.postMessage({ type: 'INIT_SUCCESS' });
      } catch (error) {
        self.postMessage({ type: 'ERROR', payload: error instanceof Error ? error.message : String(error) });
      }
      break;

    case 'SEARCH':
      if (!db) {
        self.postMessage({ type: 'ERROR', payload: 'Database not initialized' });
        return;
      }
      try {
        const { query, searchPath, limit } = payload;
        const results = searchDocuments(db, query, searchPath, limit);
        self.postMessage({ type: 'SEARCH_RESULTS', payload: results });
      } catch (error) {
        self.postMessage({ type: 'ERROR', payload: error instanceof Error ? error.message : String(error) });
      }
      break;

    case 'REBUILD_INDEX':
      if (!db) {
        self.postMessage({ type: 'ERROR', payload: 'Database not initialized' });
        return;
      }
      try {
        db.exec('BEGIN TRANSACTION');
        db.exec('DELETE FROM docs_fts');
        const insertStmt = db.prepare(
          'INSERT INTO docs_fts (uri, title, category, summary, content) VALUES (?, ?, ?, ?, ?)'
        );
        for (const doc of payload as Array<{ uri: string, title: string, category: string, summary: string, content: string }>) {
          insertStmt.run(doc.uri, doc.title, doc.category, doc.summary, doc.content);
        }
        db.exec('COMMIT');
        self.postMessage({ type: 'REBUILD_SUCCESS' });
      } catch (error) {
        db.exec('ROLLBACK');
        self.postMessage({ type: 'ERROR', payload: error instanceof Error ? error.message : String(error) });
      }
      break;
  }
};

function searchDocuments(db: Database, query: string, searchPath: string = '', limit: number = 30) {
  const sanitizedQuery = sanitizeFtsQuery(query);
  if (!sanitizedQuery) return [];

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
  const rows = stmt.all(...params) as Array<{ uri: string; title: string; score: number; snippet: string }>;

  return rows.map((row) => ({
    uri: `buncument://${row.uri}`,
    title: row.title,
    score: Math.round(-row.score * 100) / 100,
    snippet: row.snippet.replace(/>>>/g, '**').replace(/<<</g, '**'),
  }));
}

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
