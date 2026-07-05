import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

export const db = new Database(path.join(dataDir, 'qutie.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS requirements (
    id TEXT PRIMARY KEY,
    source_type TEXT NOT NULL,
    source_ref TEXT,
    text TEXT NOT NULL,
    testable INTEGER NOT NULL DEFAULT 1,
    ambiguous INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS test_cases (
    id TEXT PRIMARY KEY,
    requirement_id TEXT,
    title TEXT NOT NULL,
    type TEXT NOT NULL,
    preconditions TEXT,
    steps TEXT NOT NULL,
    test_data TEXT,
    expected_result TEXT NOT NULL,
    status TEXT DEFAULT 'draft',
    jira_key TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (requirement_id) REFERENCES requirements(id)
  );

  CREATE TABLE IF NOT EXISTS test_runs (
    id TEXT PRIMARY KEY,
    target_url TEXT NOT NULL,
    environment TEXT,
    start_time TEXT,
    end_time TEXT,
    summary TEXT,
    readiness_score REAL,
    readiness_band TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS results (
    id TEXT PRIMARY KEY,
    test_case_id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    status TEXT NOT NULL,
    actual_result TEXT,
    failing_step INTEGER,
    evidence_path TEXT,
    timestamp TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (test_case_id) REFERENCES test_cases(id),
    FOREIGN KEY (run_id) REFERENCES test_runs(id)
  );

  CREATE TABLE IF NOT EXISTS bugs (
    id TEXT PRIMARY KEY,
    result_id TEXT NOT NULL,
    title TEXT NOT NULL,
    severity TEXT NOT NULL,
    priority TEXT NOT NULL,
    report_body TEXT,
    jira_key TEXT,
    status TEXT DEFAULT 'pending',
    signature TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (result_id) REFERENCES results(id)
  );

  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor TEXT,
    action TEXT,
    details TEXT,
    timestamp TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS session_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT DEFAULT (datetime('now'))
  );
`);

export function getSessionState(key: string): string {
  const row = db.prepare('SELECT value FROM session_state WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value ?? '';
}

export function setSessionState(key: string, value: string) {
  db.prepare(
    'INSERT INTO session_state (key, value, updated_at) VALUES (?, ?, datetime(\'now\')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime(\'now\')'
  ).run(key, value);
}

export function audit(actor: string, action: string, details: Record<string, unknown>) {
  db.prepare('INSERT INTO audit_log (actor, action, details) VALUES (?, ?, ?)').run(
    actor,
    action,
    JSON.stringify(details)
  );
}
