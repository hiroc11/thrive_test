// SQLite（Node 組み込みの node:sqlite）。1台のサーバーで数万人規模まではこれで足りる。
// それ以上に増えたら、同じテーブル構成のまま PostgreSQL へ移す想定。
import { DatabaseSync } from 'node:sqlite';

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  nickname TEXT NOT NULL,
  birth_year INTEGER NOT NULL,
  friend_code TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  stamps INTEGER NOT NULL DEFAULT 0,
  stamp_day TEXT NOT NULL DEFAULT '',
  free_day TEXT NOT NULL DEFAULT '',
  since_rare INTEGER NOT NULL DEFAULT 0,
  since_sr INTEGER NOT NULL DEFAULT 0
);

-- ログイン用トークンはハッシュだけ保存する
CREATE TABLE IF NOT EXISTS tokens (
  hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);

-- 機種変更用の引き継ぎコード（1回だけ使える）
CREATE TABLE IF NOT EXISTS transfer_codes (
  hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  used INTEGER NOT NULL DEFAULT 0
);

-- デザインごとの発行済み枚数（通し番号の元）
CREATE TABLE IF NOT EXISTS serials (
  code TEXT PRIMARY KEY,
  issued INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS stickers (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  no INTEGER NOT NULL,
  pos INTEGER NOT NULL,
  acquired_at INTEGER NOT NULL,
  via TEXT NOT NULL,
  UNIQUE (code, no)
);
CREATE INDEX IF NOT EXISTS stickers_user ON stickers(user_id, pos);

-- 図鑑：一度でも手に入れたデザイン
CREATE TABLE IF NOT EXISTS seen (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  PRIMARY KEY (user_id, code)
);

CREATE TABLE IF NOT EXISTS friend_requests (
  id TEXT PRIMARY KEY,
  from_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS fr_to ON friend_requests(to_id, status);

-- 友達関係は両方向の2行で持つ
CREATE TABLE IF NOT EXISTS friends (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  friend_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, friend_id)
);

CREATE TABLE IF NOT EXISTS blocks (
  user_id TEXT NOT NULL,
  blocked_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, blocked_id)
);

CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  reporter_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- 交換。a と b は参加者。offer/ask はシールIDの配列（JSON）
CREATE TABLE IF NOT EXISTS trades (
  id TEXT PRIMARY KEY,
  a TEXT NOT NULL,
  b TEXT NOT NULL,
  mode TEXT NOT NULL,
  status TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 0,
  a_offer TEXT NOT NULL DEFAULT '[]',
  b_offer TEXT NOT NULL DEFAULT '[]',
  a_ask TEXT NOT NULL DEFAULT '[]',
  b_ask TEXT NOT NULL DEFAULT '[]',
  a_ready INTEGER NOT NULL DEFAULT -1,
  b_ready INTEGER NOT NULL DEFAULT -1,
  a_stamp TEXT,
  b_stamp TEXT,
  result TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS trades_pair ON trades(a, b, status);

-- ご意見（アカウントを消しても内容は残し、誰のものかは消す）
CREATE TABLE IF NOT EXISTS feedback (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  category TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- 分析用のイベント（継続率・毎日の利用者数）
CREATE TABLE IF NOT EXISTS events (
  user_id TEXT NOT NULL,
  day TEXT NOT NULL,
  type TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS events_day ON events(day, type);
`;

export function openDb(file = ':memory:') {
  const db = new DatabaseSync(file);
  db.exec(SCHEMA);
  return db;
}

// BEGIN IMMEDIATE で書き込みを1本にし、途中で失敗したら全部戻す
export function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
