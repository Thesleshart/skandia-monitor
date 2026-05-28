/**
 * scheduler.js — Entry point principal.
 * Arranca el servidor Express y programa el cron diario.
 * node src/scheduler.js
 */

require('dotenv').config();
const cron = require('node-cron');
const { scrapeSkandiaData }     = require('./scraper');
const {
  initSchema, saveRecord,
  getFirstRecordOfYear, getFirstRecordOfMonth, getPreviousRecord,
} = require('./database');
const { syncToGoogleSheets }    = require('./googleSheets');
const { getVariaciones }        = require('./utils/calculations');
const { startServer }           = require('./api');
const { sendDailySummary }      = require('./notifier');

// 7:00 AM Colombia (America/Bogota = UTC-5, sin DST)
// node-cron soporta timezone directamente
const SCHEDULE = process.env.CRON_SCHEDULE || '0 7 * * 1-5';
const TZ       = 'America/Bogota';

// ──────────────────────────────────────────────────────────────
// JOB
// ──────────────────────────────────────────────────────────────
async function runDailyJob() {
  const t0 = Date.now();
  const sep = '─'.repeat(52);
  console.log(`\n${sep}`);
  console.log(`[JOB] INICIO  ${new Date().toISOString()}`);
  console.log(sep);

  try {
    // 1 ── Scraping
    console.log('[JOB] 1/3  Scraping...');
    const data = await scrapeSkandiaData();

    if (!data.total && !data.capital) {
      throw new Error('Scraped data está vacío — revisa selectores en scraper.js');
    }

    // 2 ── Persistencia
    console.log('[JOB] 2/3  Guardando en Turso...');
    await saveRecord(data);

    // 3 ── Cálculos + sync
    console.log('[JOB] 3/3  Variaciones + Google Sheets...');
    const [year, month] = data.fecha.split('-').map(Number);
    const [yesterday, firstOfMonth, firstOfYear] = await Promise.all([
      getPreviousRecord(data.fecha),
      getFirstRecordOfMonth(year, month),
      getFirstRecordOfYear(year),
    ]);
    const variaciones = getVariaciones(data, { yesterday, firstOfMonth, firstOfYear });
    console.log('[JOB] Variaciones:', JSON.stringify(variaciones));

    await syncToGoogleSheets(data, variaciones);

    // 4 ── Notificación por correo
    console.log('[JOB] 4/4  Enviando resumen por email...');
    await sendDailySummary(data, variaciones);

    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`\n[JOB] ✓ Completado en ${elapsed}s`);
    console.log(`       Fecha: ${data.fecha}`);
    console.log(`       Total: ${data.total}`);
    console.log(sep + '\n');

    return { ok: true, data, variaciones };

  } catch (err) {
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.error(`\n[JOB] ✗ Error (${elapsed}s): ${err.message}`);
    console.log(sep + '\n');
    return { ok: false, error: err.message };
  }
}

// ──────────────────────────────────────────────────────────────
// ARRANCAR
// ──────────────────────────────────────────────────────────────
(async () => {
  // Inicializar tablas en Turso/SQLite
  await initSchema();

  // Servidor Express (pasamos runDailyJob para el endpoint POST /api/trigger)
  await startServer(runDailyJob);

  // Cron
  if (!cron.validate(SCHEDULE)) {
    console.error(`[CRON] Expresión inválida: "${SCHEDULE}"`);
    process.exit(1);
  }
  cron.schedule(SCHEDULE, runDailyJob, { timezone: TZ });
  console.log(`[CRON] Programado: "${SCHEDULE}" (${TZ})`);
  console.log('[CRON] Próxima ejecución: 7:00 AM siguiente día hábil\n');

  // Ejecutar inmediatamente si se pasa --now
  if (process.argv.includes('--now')) {
    console.log('[CRON] --now detectado, ejecutando job ahora...');
    await runDailyJob();
  }
})();

module.exports = { runDailyJob };
