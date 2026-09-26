import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { FIELDS, STATUSES, PROPERTY_TYPES, TRANSACTION_TYPES } from './schema.js';

const COLUMNS = Object.keys(FIELDS);

const SORTS = {
  updated_desc: 'updated_at DESC, id DESC',
  created_desc: 'created_at DESC, id DESC',
  price_asc: 'price IS NULL, price ASC, id DESC',
  price_desc: 'price IS NULL, price DESC, id DESC',
  area_desc: 'floor_area IS NULL, floor_area DESC, id DESC',
  walk_asc: 'walk_minutes IS NULL, walk_minutes ASC, id DESC',
  built_desc: 'built_year IS NULL, built_year DESC, id DESC',
  name_asc: 'name ASC, id DESC',
};

export function openDatabase(path = ':memory:') {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS properties (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      property_type TEXT NOT NULL,
      transaction_type TEXT NOT NULL,
      status TEXT NOT NULL,
      price INTEGER,
      management_fee INTEGER,
      address TEXT,
      nearest_station TEXT,
      walk_minutes INTEGER,
      floor_area REAL,
      land_area REAL,
      layout TEXT,
      built_year INTEGER,
      structure TEXT,
      owner_name TEXT,
      owner_contact TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
    CREATE INDEX IF NOT EXISTS idx_properties_status ON properties(status);
    CREATE INDEX IF NOT EXISTS idx_properties_updated ON properties(updated_at);
  `);
  return createRepository(db);
}

function toPlain(row) {
  return row ? { ...row } : null;
}

function createRepository(db) {
  const getStmt = db.prepare('SELECT * FROM properties WHERE id = ?');

  function buildWhere(filters = {}) {
    const clauses = [];
    const params = {};
    if (filters.q) {
      clauses.push(`(name LIKE :q ESCAPE '\\' OR address LIKE :q ESCAPE '\\' OR nearest_station LIKE :q ESCAPE '\\'
        OR layout LIKE :q ESCAPE '\\' OR owner_name LIKE :q ESCAPE '\\' OR notes LIKE :q ESCAPE '\\')`);
      params.q = `%${String(filters.q).replace(/[\\%_]/g, (c) => '\\' + c)}%`;
    }
    for (const key of ['property_type', 'transaction_type', 'status']) {
      if (filters[key]) {
        clauses.push(`${key} = :${key}`);
        params[key] = String(filters[key]);
      }
    }
    const numeric = [
      ['min_price', 'price >= :min_price'],
      ['max_price', 'price <= :max_price'],
      ['min_area', 'floor_area >= :min_area'],
      ['max_walk', 'walk_minutes <= :max_walk'],
    ];
    for (const [key, clause] of numeric) {
      if (filters[key] !== undefined && filters[key] !== '') {
        const n = Number(filters[key]);
        if (Number.isFinite(n)) {
          clauses.push(clause);
          params[key] = n;
        }
      }
    }
    return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params };
  }

  return {
    close() {
      db.close();
    },

    list(filters = {}) {
      const { where, params } = buildWhere(filters);
      const order = SORTS[filters.sort] ?? SORTS.updated_desc;
      const limit = Math.min(Math.max(parseInt(filters.limit, 10) || 100, 1), 1000);
      const offset = Math.max(parseInt(filters.offset, 10) || 0, 0);
      const total = db.prepare(`SELECT COUNT(*) AS n FROM properties ${where}`).get(params).n;
      const items = db
        .prepare(`SELECT * FROM properties ${where} ORDER BY ${order} LIMIT :limit OFFSET :offset`)
        .all({ ...params, limit, offset })
        .map(toPlain);
      return { total, limit, offset, items };
    },

    get(id) {
      return toPlain(getStmt.get(id));
    },

    create(data) {
      const cols = COLUMNS.filter((c) => Object.hasOwn(data, c));
      const sql = `INSERT INTO properties (${cols.join(', ')}) VALUES (${cols.map((c) => ':' + c).join(', ')})`;
      const params = Object.fromEntries(cols.map((c) => [c, data[c]]));
      const { lastInsertRowid } = db.prepare(sql).run(params);
      return this.get(Number(lastInsertRowid));
    },

    update(id, data) {
      const cols = COLUMNS.filter((c) => Object.hasOwn(data, c));
      if (cols.length === 0) return this.get(id);
      const sets = cols.map((c) => `${c} = :${c}`).join(', ');
      const params = Object.fromEntries(cols.map((c) => [c, data[c]]));
      const { changes } = db
        .prepare(`UPDATE properties SET ${sets}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = :id`)
        .run({ ...params, id });
      return changes ? this.get(id) : null;
    },

    remove(id) {
      return db.prepare('DELETE FROM properties WHERE id = ?').run(id).changes > 0;
    },

    stats() {
      const total = db.prepare('SELECT COUNT(*) AS n FROM properties').get().n;
      const countBy = (col, values) => {
        const rows = db.prepare(`SELECT ${col} AS k, COUNT(*) AS n FROM properties GROUP BY ${col}`).all();
        const map = Object.fromEntries(values.map((v) => [v, 0]));
        for (const r of rows) map[r.k] = r.n;
        return map;
      };
      const avg = db
        .prepare(
          `SELECT transaction_type AS k, ROUND(AVG(price)) AS avg_price, COUNT(price) AS n
           FROM properties WHERE price IS NOT NULL AND status != '非公開' GROUP BY transaction_type`,
        )
        .all();
      const averagePrice = Object.fromEntries(TRANSACTION_TYPES.map((t) => [t, null]));
      for (const r of avg) averagePrice[r.k] = r.avg_price;
      return {
        total,
        byStatus: countBy('status', STATUSES),
        byPropertyType: countBy('property_type', PROPERTY_TYPES),
        byTransactionType: countBy('transaction_type', TRANSACTION_TYPES),
        averagePrice,
      };
    },
  };
}

export const SORT_KEYS = Object.keys(SORTS);
