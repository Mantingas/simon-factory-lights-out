import Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs'

const DB_DIR = path.join(process.cwd(), 'data')
const DB_PATH = path.join(DB_DIR, 'ntbro.db')

let _db = null

function getDb() {
  if (_db) return _db

  if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true })
  }

  _db = new Database(DB_PATH)
  _db.pragma('journal_mode = WAL')
  _db.pragma('foreign_keys = ON')

  migrate(_db)
  return _db
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS clients (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'warm' CHECK(status IN ('hot', 'warm', 'cold')),
      last_contact_at TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS demands (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      type TEXT NOT NULL CHECK(type IN ('apartment', 'house')),
      rooms INTEGER NOT NULL,
      city TEXT NOT NULL,
      budget REAL NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS properties (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL CHECK(type IN ('apartment', 'house')),
      rooms INTEGER NOT NULL,
      city TEXT NOT NULL,
      price REAL NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS interactions (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      type TEXT NOT NULL CHECK(type IN ('call', 'sms', 'meeting')),
      timestamp TEXT NOT NULL,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      type TEXT NOT NULL CHECK(type IN ('call', 'follow_up', 're_engage', 'match_call', 'callback')),
      priority REAL NOT NULL DEFAULT 0,
      due_date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'done')),
      source TEXT NOT NULL DEFAULT 'system' CHECK(source IN ('system', 'match_engine', 'post_call', 'user')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_dedup
      ON tasks(client_id, type)
      WHERE status = 'pending';
  `)
}

export { migrate }
export default getDb
