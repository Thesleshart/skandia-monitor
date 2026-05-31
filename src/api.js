require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const {
  getAllRecords, getLatestRecord, getRecordByDate,
  getRecordsByDateRange, getFirstRecordOfYear,
  getFirstRecordOfMonth, getPreviousRecord,
} = require('./database');
const { getVariaciones } = require('./utils/calculations');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// ── Helpers ──────────────────────────────────────────────────

async function buildVariaciones(record, userId) {
  if (!record) return null;
  const [year, month] = record.fecha.split('-').map(Number);
  const [yesterday, firstOfMonth, firstOfYear] = await Promise.all([
    getPreviousRecord(record.fecha, userId),
    getFirstRecordOfMonth(year, month, userId),
    getFirstRecordOfYear(year, userId),
  ]);
  return getVariaciones(record, { yesterday, firstOfMonth, firstOfYear });
}

async function withVars(record, userId) {
  return { ...record, variaciones: await buildVariaciones(record, userId) };
}

// ── Endpoints (soportan ?user=sebastian o ?user=cliente) ─────

app.get('/api/latest', async (req, res) => {
  try {
    const userId = req.query.user || 'sebastian';
    const r = await getLatestRecord(userId);
    if (!r) return res.status(404).json({ error: 'Sin registros todavía' });
    res.json(await withVars(r, userId));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/history', async (req, res) => {
  try {
    const userId = req.query.user || 'sebastian';
    const { start, end, limit } = req.query;
    let records = await ((start && end)
      ? getRecordsByDateRange(start, end, userId)
      : getAllRecords(userId));
    if (limit) records = records.slice(0, parseInt(limit, 10));
    const withVariaciones = await Promise.all(records.map(r => withVars(r, userId)));
    res.json({ total: withVariaciones.length, records: withVariaciones });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/record/:fecha', async (req, res) => {
  try {
    const userId = req.query.user || 'sebastian';
    const r = await getRecordByDate(req.params.fecha, userId);
    if (!r) return res.status(404).json({ error: 'Fecha no encontrada' });
    res.json(await withVars(r, userId));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/stats', async (req, res) => {
  try {
    const userId = req.query.user || 'sebastian';
    const all = await getAllRecords(userId);
    if (!all.length) return res.json({ registros: 0 });
    const totales = all.map(r => r.total).filter(Boolean);
    const latest  = all[0];
    const oldest  = all[all.length - 1];
    res.json({
      registros:           all.length,
      primer_registro:     oldest.fecha,
      ultimo_registro:     latest.fecha,
      saldo_actual:        latest.total,
      saldo_minimo:        Math.min(...totales),
      saldo_maximo:        Math.max(...totales),
      variacion_total_pct: oldest.total
        ? +((latest.total - oldest.total) / Math.abs(oldest.total) * 100).toFixed(2)
        : null,
      variaciones_hoy: await buildVariaciones(latest, userId),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/export', async (req, res) => {
  try {
    const userId  = req.query.user || 'sebastian';
    const records = await getAllRecords(userId);
    const datos   = await Promise.all(records.map(r => withVars(r, userId)));
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition',
      `attachment; filename="skandia-${userId}-${new Date().toISOString().split('T')[0]}.json"`);
    res.json({ exportado_en: new Date().toISOString(), total: datos.length, datos });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Dashboard HTML ───────────────────────────────────────────
// Tu dashboard:      skandia-monitor.onrender.com/
// Dashboard cliente: skandia-monitor.onrender.com/cliente
app.get('/',         (_req, res) => res.send(buildDashboard('sebastian')));
app.get('/cliente',  (_req, res) => res.send(buildDashboard('cliente')));

function startServer(triggerHandler) {
  if (triggerHandler) {
    app.post('/api/trigger', async (req, res) => {
      res.json({ message: 'Job iniciado', ts: new Date().toISOString() });
      triggerHandler().catch(console.error);
    });
  }
  return new Promise(resolve => {
    const server = app.listen(PORT, () => {
      console.log(`[API] http://localhost:${PORT}  (dashboard + REST)`);
      resolve(server);
    });
  });
}

module.exports = { app, startServer };
if (require.main === module) startServer().catch(console.error);

// ── Dashboard HTML inline ─────────────────────────────────────
function buildDashboard(userId) {
  const apiBase = userId === 'sebastian' ? '' : '';
  const userParam = `?user=${userId}`;
  const title = userId === 'sebastian' ? '📈 Skandia Monitor' : '📈 Skandia Monitor — Cliente';
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0f172a;color:#e2e8f0;min-height:100vh}
.wrap{max-width:1100px;margin:0 auto;padding:28px 20px}
h1{font-size:1.75rem;font-weight:700;color:#f1f5f9}
.sub{color:#64748b;font-size:.85rem;margin:.3rem 0 2rem}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(195px,1fr));gap:14px;margin-bottom:2rem}
.card{background:#1e293b;border:1px solid #334155;border-radius:10px;padding:18px}
.lbl{font-size:.7rem;text-transform:uppercase;letter-spacing:.06em;color:#64748b;margin-bottom:6px}
.val{font-size:1.4rem;font-weight:700;color:#f1f5f9}
.sub-val{font-size:.8rem;margin-top:5px}
.pos{color:#22c55e}.neg{color:#ef4444}.neu{color:#64748b}
.sec{font-size:.75rem;text-transform:uppercase;letter-spacing:.07em;color:#475569;margin-bottom:10px;margin-top:1.5rem}
table{width:100%;border-collapse:collapse;background:#1e293b;border-radius:10px;overflow:hidden;font-size:.85rem}
th{background:#334155;padding:10px 14px;text-align:left;color:#94a3b8;font-size:.72rem;text-transform:uppercase}
td{padding:10px 14px;border-bottom:1px solid #1e293b}
tr:last-child td{border-bottom:none}
tr:hover td{background:#263248}
.badge{display:inline-block;padding:2px 7px;border-radius:99px;font-size:.72rem;font-weight:600}
.bp{background:#14532d;color:#22c55e}.bn{background:#450a0a;color:#ef4444}
.links{display:flex;gap:8px;flex-wrap:wrap;margin-top:1.8rem}
.link{background:#1e293b;color:#94a3b8;padding:5px 10px;border-radius:6px;font-size:.75rem;font-family:monospace;text-decoration:none}
.link:hover{background:#334155;color:#f1f5f9}
</style>
</head>
<body>
<div class="wrap">
  <h1>${title}</h1>
  <p class="sub" id="last-update">Cargando...</p>

  <div class="grid" id="cards"><div style="color:#64748b">Cargando...</div></div>

  <div class="sec">Composición del portafolio</div>
  <table><thead><tr><th>Fondo</th><th>%</th><th>Saldo</th></tr></thead>
  <tbody id="pfbody"><tr><td colspan="3" style="color:#64748b;text-align:center">—</td></tr></tbody></table>

  <div class="sec" style="margin-top:2rem">Histórico reciente</div>
  <table><thead><tr><th>Fecha</th><th>Capital</th><th>Rendimientos</th><th>Total</th><th>Var. Diaria</th><th>Var. Mensual</th></tr></thead>
  <tbody id="histbody"><tr><td colspan="6" style="color:#64748b;text-align:center">—</td></tr></tbody></table>

  <div class="links">
    <span style="color:#64748b;font-size:.8rem;align-self:center">API:</span>
    <a class="link" href="/api/latest${userParam}">/api/latest</a>
    <a class="link" href="/api/history${userParam}">/api/history</a>
    <a class="link" href="/api/stats${userParam}">/api/stats</a>
    <a class="link" href="/api/export${userParam}">/api/export</a>
  </div>
</div>

<script>
const USER='${userId}';
const fmt = n => n!=null ? new Intl.NumberFormat('es-CO',{style:'currency',currency:'COP',minimumFractionDigits:0}).format(n) : 'N/A';
const pct = v => v!=null ? (v>0?'+':'')+v.toFixed(2)+'%' : 'N/A';
const cls = v => v==null?'neu':v>0?'pos':v<0?'neg':'neu';
const badge = v => v==null?'':v>0?'<span class="badge bp">'+pct(v)+'</span>':'<span class="badge bn">'+pct(v)+'</span>';

async function load(){
  try{
    const [lat,hist]=await Promise.all([
      fetch('/api/latest?user='+USER).then(r=>r.json()),
      fetch('/api/history?user='+USER+'&limit=30').then(r=>r.json()),
    ]);
    document.getElementById('last-update').textContent='Última actualización: '+(lat.fecha||'Sin datos');
    const v=lat.variaciones||{};
    document.getElementById('cards').innerHTML=\`
      <div class="card"><div class="lbl">Saldo Total</div><div class="val">\${fmt(lat.total)}</div><div class="sub-val \${cls(v.diaria)}">Hoy: \${pct(v.diaria)}</div></div>
      <div class="card"><div class="lbl">Capital</div><div class="val">\${fmt(lat.capital)}</div></div>
      <div class="card"><div class="lbl">Rendimientos del día</div><div class="val \${lat.rendimientos>=0?'pos':'neg'}">\${fmt(lat.rendimientos)}</div></div>
      <div class="card"><div class="lbl">Var. Mensual</div><div class="val \${cls(v.mensual)}">\${pct(v.mensual)}</div></div>
      <div class="card"><div class="lbl">Var. Anual</div><div class="val \${cls(v.anual)}">\${pct(v.anual)}</div></div>
      <div class="card"><div class="lbl">Cuenta Contingente</div><div class="val">\${fmt(lat.cuenta_contingente)}</div></div>
    \`;
    const pf=lat.portafolio||[];
    document.getElementById('pfbody').innerHTML=pf.length
      ?pf.map(f=>\`<tr><td>\${f.nombre}</td><td>\${f.porcentaje!=null?f.porcentaje.toFixed(1)+'%':'—'}</td><td>\${fmt(f.saldo)}</td></tr>\`).join('')
      :'<tr><td colspan="3" style="color:#64748b;text-align:center">Sin datos de portafolio</td></tr>';
    const rec=(hist.records||[]);
    document.getElementById('histbody').innerHTML=rec.length
      ?rec.map(r=>{const rv=r.variaciones||{};return\`<tr><td>\${r.fecha}</td><td>\${fmt(r.capital)}</td><td class="\${r.rendimientos>=0?'pos':'neg'}">\${fmt(r.rendimientos)}</td><td>\${fmt(r.total)}</td><td>\${badge(rv.diaria)||pct(rv.diaria)}</td><td>\${badge(rv.mensual)||pct(rv.mensual)}</td></tr>\`;}).join('')
      :'<tr><td colspan="6" style="color:#64748b;text-align:center">Sin historial aún</td></tr>';
  }catch(e){console.error(e);}
}

load();
setInterval(load,60_000);
</script>
</body>
</html>`;
}
