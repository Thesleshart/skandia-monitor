/**
 * run-job.js — Ejecuta el scrape diario una sola vez y termina.
 * Usado por GitHub Actions (no levanta servidor Express).
 * También funciona localmente: node src/run-job.js
 */

require('dotenv').config();

const { scrapeSkandiaData } = require('./scraper');
const {
  initSchema, saveRecord,
  getFirstRecordOfYear, getFirstRecordOfMonth, getPreviousRecord,
  getRecordByDate, getLatestRecord,
} = require('./database');
const { syncToGoogleSheets } = require('./googleSheets');
const { getVariaciones }     = require('./utils/calculations');
const { sendDailySummary }   = require('./notifier');

async function main() {
  const t0     = Date.now();
  const userId = process.env.USER_ID || 'sebastian';
  const sep    = '─'.repeat(52);
  console.log(`\n${sep}`);
  console.log(`[JOB] INICIO  ${new Date().toISOString()} (usuario: ${userId})`);
  console.log(sep);

  try {
    await initSchema();

    // 1 ── Scraping
    console.log('[JOB] 1/4  Scraping...');
    const data = await scrapeSkandiaData();

    if (!data.total && !data.capital) {
      throw new Error('Datos vacíos — revisa selectores en scraper.js');
    }

    // 2 ── Persistencia
    console.log('[JOB] 2/4  Guardando en Turso...');
    await saveRecord(data, userId, 'skandia');

    // 2b ── Relleno de huecos: si Skandia repitió la fecha de ayer (no actualizó),
    // y el registro de "ayer" aún no existe, lo creamos repitiendo el último dato disponible.
    const ayer = new Date();
    ayer.setDate(ayer.getDate() - 1);
    const ayerStr = ayer.toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });

    if (data.fecha < ayerStr) {
      const existeAyer = await getRecordByDate(ayerStr, userId);
      if (!existeAyer) {
        console.log(`[JOB] Skandia no actualizó (fecha=${data.fecha}, ayer=${ayerStr}). Repitiendo último dato disponible...`);
        const ultimo = await getLatestRecord(userId);
        if (ultimo) {
          await saveRecord({ ...ultimo, fecha: ayerStr }, userId, 'carry_forward');
          console.log(`[JOB] Registro ${ayerStr} creado con fuente=carry_forward (repite ${ultimo.fecha})`);
        }
      }
    }

    // 3 ── Variaciones + Google Sheets
    console.log('[JOB] 3/4  Variaciones + Google Sheets...');
    const [year, month] = data.fecha.split('-').map(Number);
    const [yesterday, firstOfMonth, firstOfYear] = await Promise.all([
      getPreviousRecord(data.fecha, userId),
      getFirstRecordOfMonth(year, month, userId),
      getFirstRecordOfYear(year, userId),
    ]);
    const variaciones = getVariaciones(data, { yesterday, firstOfMonth, firstOfYear });
    console.log('[JOB] Variaciones:', JSON.stringify(variaciones));
    await syncToGoogleSheets(data, variaciones);

    // 4 ── Email
    console.log('[JOB] 4/4  Enviando resumen por email...');
    await sendDailySummary(data, variaciones, userId);

    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`\n[JOB] COMPLETADO en ${elapsed}s`);
    console.log(`       Fecha: ${data.fecha}`);
    console.log(`       Total: ${data.total}`);
    console.log(sep + '\n');

    process.exit(0);

  } catch (err) {
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.error(`\n[JOB] ERROR (${elapsed}s): ${err.message}`);
    console.log(sep + '\n');
    process.exit(1);
  }
}

main();
