/**
 * database.js — Turso (libSQL) como capa de persistencia.
 *
 * En LOCAL (desarrollo):  usa archivo SQLite en /data/skandia.db
 *   TURSO_DATABASE_URL=file:data/skandia.db   ← sin auth token
 *
 * En RENDER (producción): usa Turso cloud gratis
 *   TURSO_DATABASE_URL=libsql://tu-db.turso.io
 *   TURSO_AUTH_TOKEN=eyJ...
 *
 * Configura tu cuenta gratis en https://turso.tech (sin tarjeta)
 */

require('dotenv').config();
const { createClient } = require('@libsql/client');
const path = require('path');
const fs   = require('fs');

// Detectar modo local vs. cloud
const isLocal = !process.env.TURSO_DATABASE_URL ||
  process.env.TURSO_DATABASE_URL.startsWith('file:');

const DB_URL = process.env.TURSO_DATABASE_URL ||
  `file:${path.join(__dirname, '..', 'data', 'skandia.db')}`;

if (isLocal) {
  fs.mkdirSync(path.join(__dirname, '..', 'data'), { recursive: true });
}

const client = createClient({
  url:       DB_URL,
  authToken: process.env.TURSO_AUTH_TOKEN, // undefined en local → ignorado
});

// ──────────────────────────────────────────────
// INIT
// ──────────────────────────────────────────────

async function initSchema() {
  // ── Migración: agregar user_id si la tabla existe sin esa columna ──
  try {
    const { rows: cols } = await client.execute('PRAGMA table_info(daily_records)');
    if (cols.length > 0) {
      const hasUserId = cols.some(r => r.name === 'user_id');
      if (!hasUserId) {
        console.log('[DB] Migrando schema: agregando user_id...');
        // Recrear tabla con el nuevo schema preservando datos
        await client.execute(`
          CREATE TABLE daily_records_v2 (
            id                 INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id            TEXT    NOT NULL DEFAULT 'sebastian',
            fecha              TEXT    NOT NULL,
            capital            REAL,
            rendimientos       REAL,
            total              REAL,
            cuenta_contingente REAL,
            created_at         TEXT DEFAULT (datetime('now')),
            UNIQUE(user_id, fecha)
          )
        `);
        await client.execute(`
          INSERT INTO daily_records_v2 (id, user_id, fecha, capital, rendimientos, total, cuenta_contingente, created_at)
          SELECT id, 'sebastian', fecha, capital, rendimientos, total, cuenta_contingente, created_at
          FROM daily_records
        `);
        await client.execute('DROP TABLE daily_records');
        await client.execute('ALTER TABLE daily_records_v2 RENAME TO daily_records');
        console.log('[DB] Migración completada: user_id agregado, datos preservados');
      }
    }
  } catch (e) {
    // Tabla no existe aún — se crea abajo
  }

  // ── Crear tablas (fresh install o post-migración) ──────────────────
  await client.executeMultiple(`
    CREATE TABLE IF NOT EXISTS daily_records (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id            TEXT    NOT NULL DEFAULT 'sebastian',
      fecha              TEXT    NOT NULL,
      capital            REAL,
      rendimientos       REAL,
      total              REAL,
      cuenta_contingente REAL,
      created_at         TEXT DEFAULT (datetime('now')),
      UNIQUE(user_id, fecha)
    );

    CREATE TABLE IF NOT EXISTS portafolio (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      record_id  INTEGER NOT NULL,
      nombre     TEXT    NOT NULL,
      porcentaje REAL,
      saldo      REAL,
      FOREIGN KEY (record_id) REFERENCES daily_records(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_dr_fecha   ON daily_records(fecha);
    CREATE INDEX IF NOT EXISTS idx_dr_user    ON daily_records(user_id);
    CREATE INDEX IF NOT EXISTS idx_pf_record  ON portafolio(record_id);
  `);
  console.log(`[DB] Conectado a: ${DB_URL}`);
}

// ──────────────────────────────────────────────
// WRITE
// ──────────────────────────────────────────────

async function saveRecord(data, userId = 'sebastian') {
  await client.execute({
    sql: `INSERT INTO daily_records (user_id, fecha, capital, rendimientos, total, cuenta_contingente)
          VALUES (:user_id, :fecha, :capital, :rendimientos, :total, :cuenta_contingente)
          ON CONFLICT(user_id, fecha) DO UPDATE SET
            capital            = excluded.capital,
            rendimientos       = excluded.rendimientos,
            total              = excluded.total,
            cuenta_contingente = excluded.cuenta_contingente`,
    args: {
      user_id:            userId,
      fecha:              data.fecha,
      capital:            data.capital            ?? null,
      rendimientos:       data.rendimientos       ?? null,
      total:              data.total              ?? null,
      cuenta_contingente: data.cuenta_contingente ?? null,
    },
  });

  const { rows } = await client.execute({
    sql:  'SELECT id FROM daily_records WHERE user_id = ? AND fecha = ?',
    args: [userId, data.fecha],
  });
  const recordId = rows[0].id;

  // Reemplazar portafolio del día
  await client.execute({ sql: 'DELETE FROM portafolio WHERE record_id = ?', args: [recordId] });

  for (const item of data.portafolio || []) {
    await client.execute({
      sql:  'INSERT INTO portafolio (record_id, nombre, porcentaje, saldo) VALUES (?,?,?,?)',
      args: [recordId, item.nombre, item.porcentaje ?? null, item.saldo ?? null],
    });
  }

  console.log(`[DB] Guardado: ${data.fecha} (id=${recordId})`);
  return recordId;
}

// ──────────────────────────────────────────────
// READ — helpers
// ──────────────────────────────────────────────

function toObj(row) {
  // @libsql/client devuelve Row objects — los convertimos a objetos planos
  return row ? Object.fromEntries(Object.entries(row)) : null;
}

async function _withPortafolio(row) {
  if (!row) return null;
  const rec = toObj(row);
  const { rows } = await client.execute({
    sql:  'SELECT nombre, porcentaje, saldo FROM portafolio WHERE record_id = ? ORDER BY id',
    args: [rec.id],
  });
  rec.portafolio = rows.map(toObj);
  return rec;
}

async function getRecordByDate(fecha, userId = 'sebastian') {
  const { rows } = await client.execute({
    sql: 'SELECT * FROM daily_records WHERE user_id = ? AND fecha = ?',
    args: [userId, fecha],
  });
  return _withPortafolio(rows[0]);
}

async function getLatestRecord(userId = 'sebastian') {
  const { rows } = await client.execute({
    sql:  'SELECT * FROM daily_records WHERE user_id = ? ORDER BY fecha DESC LIMIT 1',
    args: [userId],
  });
  return _withPortafolio(rows[0]);
}

async function getAllRecords(userId = 'sebastian') {
  const { rows } = await client.execute({
    sql:  'SELECT * FROM daily_records WHERE user_id = ? ORDER BY fecha DESC',
    args: [userId],
  });
  return Promise.all(rows.map(_withPortafolio));
}

async function getRecordsByDateRange(startDate, endDate, userId = 'sebastian') {
  const { rows } = await client.execute({
    sql:  'SELECT * FROM daily_records WHERE user_id = ? AND fecha BETWEEN ? AND ? ORDER BY fecha ASC',
    args: [userId, startDate, endDate],
  });
  return Promise.all(rows.map(_withPortafolio));
}

async function getFirstRecordOfYear(year, userId = 'sebastian') {
  const { rows } = await client.execute({
    sql:  'SELECT * FROM daily_records WHERE user_id = ? AND fecha LIKE ? ORDER BY fecha ASC LIMIT 1',
    args: [userId, `${year}-%`],
  });
  return rows[0] ? toObj(rows[0]) : null;
}

async function getFirstRecordOfMonth(year, month, userId = 'sebastian') {
  const m = String(month).padStart(2, '0');
  const { rows } = await client.execute({
    sql:  'SELECT * FROM daily_records WHERE user_id = ? AND fecha LIKE ? ORDER BY fecha ASC LIMIT 1',
    args: [userId, `${year}-${m}-%`],
  });
  return rows[0] ? toObj(rows[0]) : null;
}

async function getPreviousRecord(fecha, userId = 'sebastian') {
  const { rows } = await client.execute({
    sql:  'SELECT * FROM daily_records WHERE user_id = ? AND fecha < ? ORDER BY fecha DESC LIMIT 1',
    args: [userId, fecha],
  });
  return rows[0] ? toObj(rows[0]) : null;
}

module.exports = {
  initSchema, saveRecord,
  getRecordByDate, getLatestRecord, getAllRecords,
  getRecordsByDateRange, getFirstRecordOfYear,
  getFirstRecordOfMonth, getPreviousRecord,
};
