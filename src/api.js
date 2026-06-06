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
  const userParam = `?user=${userId}`;
  const title = userId === 'sebastian' ? '📈 Skandia Monitor' : '📈 Skandia Monitor — Cliente';
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<script src="https://cdn.jsdelivr.net/npm/apexcharts@3.49.0/dist/apexcharts.min.js"><\/script>
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
/* ── Gráfica ── */
.chart-card{background:#1e293b;border:1px solid #334155;border-radius:10px;padding:20px 16px 4px;margin-bottom:2rem}
.chart-header{display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:10px;margin-bottom:2px}
.chart-total{font-size:1.6rem;font-weight:700;color:#f1f5f9;line-height:1.1}
.chart-sub{font-size:.78rem;color:#64748b;margin-top:3px}
.range-btns{display:flex;gap:5px;flex-shrink:0}
.rbtn{background:transparent;color:#64748b;border:1px solid #334155;padding:4px 11px;border-radius:6px;font-size:.73rem;cursor:pointer;transition:all .15s;font-family:inherit}
.rbtn:hover{border-color:#3b82f6;color:#93c5fd}
.rbtn.active{background:#3b82f6;color:#fff;border-color:#3b82f6}
</style>
</head>
<body>
<div class="wrap">
  <h1>${title}</h1>
  <p class="sub" id="last-update">Cargando...</p>

  <div class="grid" id="cards"><div style="color:#64748b">Cargando...</div></div>

  <!-- GRÁFICA -->
  <div class="sec">Evolución del portafolio</div>
  <div class="chart-card">
    <div class="chart-header">
      <div>
        <div class="chart-total" id="chart-val">—</div>
        <div class="chart-sub"  id="chart-lbl">Pasa el cursor sobre la gráfica para ver el detalle</div>
      </div>
      <div class="range-btns">
        <button class="rbtn"        id="btn-7D"  onclick="setRange('7D')">7D</button>
        <button class="rbtn"        id="btn-MTD" onclick="setRange('MTD')">MTD</button>
        <button class="rbtn"        id="btn-YTD" onclick="setRange('YTD')">YTD</button>
        <button class="rbtn active" id="btn-ALL" onclick="setRange('ALL')">Todo</button>
      </div>
    </div>
    <div id="apex-chart"></div>
  </div>

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
const USER = '${userId}';
const fmt  = n => n!=null ? new Intl.NumberFormat('es-CO',{style:'currency',currency:'COP',minimumFractionDigits:0}).format(n) : 'N/A';
const fmtK = n => n!=null ? new Intl.NumberFormat('es-CO',{style:'currency',currency:'COP',minimumFractionDigits:0,notation:'compact'}).format(n) : '';
const pct  = v => v!=null ? (v>0?'+':'')+v.toFixed(2)+'%' : 'N/A';
const cls  = v => v==null?'neu':v>0?'pos':v<0?'neg':'neu';
const badge = v => v==null?'':v>0?'<span class="badge bp">'+pct(v)+'</span>':'<span class="badge bn">'+pct(v)+'</span>';
const MES  = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];

// ── GRÁFICA ──────────────────────────────────────────────────
let allHistory  = [];
let apexChart   = null;
let curRange    = 'ALL';
let latestTotal = null;

function filterRange(records, range) {
  const sorted = [...records].sort((a,b) => a.fecha.localeCompare(b.fecha));
  if (range === 'ALL') return sorted;
  const now = new Date(), y = now.getFullYear(), m = now.getMonth();
  if (range === '7D')  return sorted.filter(r => (now - new Date(r.fecha+'T12:00:00')) / 86400000 <= 7);
  if (range === 'MTD') return sorted.filter(r => { const d=new Date(r.fecha+'T12:00:00'); return d.getFullYear()===y && d.getMonth()===m; });
  if (range === 'YTD') return sorted.filter(r => r.fecha.startsWith(String(y)));
  return sorted;
}

function setRange(range) {
  curRange = range;
  document.querySelectorAll('.rbtn').forEach(b => b.classList.remove('active'));
  document.getElementById('btn-'+range).classList.add('active');
  renderChart(filterRange(allHistory, range));
}

function renderChart(records) {
  if (!records.length) return;

  // Marcar aportes de capital
  const annotations = [];
  for (let i = 1; i < records.length; i++) {
    if ((records[i].capital||0) > (records[i-1].capital||0)) {
      annotations.push({
        x: new Date(records[i].fecha+'T12:00:00').getTime(),
        borderColor: '#3b82f6',
        label: {
          borderColor: '#3b82f6',
          style: { color:'#fff', background:'#1d4ed8', fontSize:'10px', padding:{left:5,right:5,top:2,bottom:2} },
          text: '+ Aporte',
        },
      });
    }
  }

  const toTs   = r => new Date(r.fecha+'T12:00:00').getTime();
  const series = [
    { name: 'Saldo Total',       data: records.map(r => ({ x: toTs(r), y: r.total        })) },
    { name: 'Capital Invertido', data: records.map(r => ({ x: toTs(r), y: r.capital      })) },
    { name: 'Rendimientos',      data: records.map(r => ({ x: toTs(r), y: r.rendimientos })) },
  ];

  const opts = {
    series,
    chart: {
      type: 'area', height: 270,
      background: 'transparent',
      toolbar: { show: false },
      zoom: { enabled: false },
      animations: { enabled: true, speed: 400 },
      events: {
        // dataPointIndex solo se activa encima de un punto exacto.
        // Usamos el tooltip custom (ver abajo) para actualizar el header
        // en cualquier posición horizontal del cursor.
        mouseLeave() {
          document.getElementById('chart-val').textContent = fmt(latestTotal);
          document.getElementById('chart-lbl').textContent = 'Pasa el cursor sobre la gráfica para ver el detalle';
        },
      },
    },
    theme: { mode: 'dark' },
    colors: ['#22c55e', '#3b82f6', '#f59e0b'],
    fill: {
      type: ['gradient', 'gradient', 'gradient'],
      gradient: {
        type: 'vertical',
        shadeIntensity: 1,
        opacityFrom: [0.3,  0.08, 0.2],
        opacityTo:   [0.02, 0.02, 0.02],
        stops: [0, 100],
      },
    },
    stroke: { curve: 'smooth', width: [2, 1.5, 1.5], dashArray: [0, 5, 4] },
    dataLabels: { enabled: false },
    markers: { size: 0, hover: { size: 5 } },
    xaxis: {
      type: 'datetime',
      labels: { style:{ colors:'#64748b', fontSize:'11px' }, datetimeUTC: false },
      axisBorder: { color:'#1e293b' },
      axisTicks:  { color:'#1e293b' },
      tooltip: { enabled: false },
    },
    yaxis: {
      labels: {
        style: { colors:'#64748b', fontSize:'11px' },
        formatter: v => fmtK(v),
      },
      tickAmount: 4,
    },
    tooltip: {
      shared: true,       // muestra ambas series al hover
      intersect: false,   // activa en toda la línea, no solo sobre puntos exactos
      theme: 'dark',
      x: {
        formatter: val => {
          const d = new Date(val);
          return d.getDate()+' '+MES[d.getMonth()]+' '+d.getFullYear();
        },
      },
      y: {
        formatter: (val, opts) => {
          // Actualiza el header con los datos del punto bajo el cursor
          if (opts && opts.seriesIndex === 0) {
            document.getElementById('chart-val').textContent = fmt(val);
            const idx = opts.dataPointIndex;
            if (idx >= 0 && records[idx]) {
              const r = records[idx];
              const [yy,mm,dd] = r.fecha.split('-');
              document.getElementById('chart-lbl').textContent =
                dd+' '+MES[+mm-1]+' '+yy+'  ·  Capital: '+fmt(r.capital)+'  ·  Rend: '+fmt(r.rendimientos);
            }
          }
          return fmt(val);
        },
      },
    },
    grid: { borderColor:'#1e293b', strokeDashArray:3, padding:{ left:4, right:8 } },
    legend: {
      labels: { colors:'#94a3b8' },
      position: 'top', horizontalAlign: 'right', fontSize: '12px',
      markers: { width:10, height:10, radius:2 },
    },
    annotations: { xaxis: annotations },
  };

  if (apexChart) {
    apexChart.updateOptions(opts, true, true);
  } else {
    apexChart = new ApexCharts(document.getElementById('apex-chart'), opts);
    apexChart.render();
  }
}

// ── CARGA PRINCIPAL ───────────────────────────────────────
async function load() {
  try {
    const [lat, hist] = await Promise.all([
      fetch('/api/latest?user='+USER).then(r=>r.json()),
      fetch('/api/history?user='+USER).then(r=>r.json()),
    ]);

    // Resumen cards
    document.getElementById('last-update').textContent = 'Última actualización: '+(lat.fecha||'Sin datos');
    latestTotal = lat.total;
    document.getElementById('chart-val').textContent = fmt(lat.total);
    const v = lat.variaciones||{};
    document.getElementById('cards').innerHTML = \`
      <div class="card"><div class="lbl">Saldo Total</div><div class="val">\${fmt(lat.total)}</div><div class="sub-val \${cls(v.diaria)}">Hoy: \${pct(v.diaria)}</div></div>
      <div class="card"><div class="lbl">Capital</div><div class="val">\${fmt(lat.capital)}</div></div>
      <div class="card"><div class="lbl">Rendimientos</div><div class="val \${lat.rendimientos>=0?'pos':'neg'}">\${fmt(lat.rendimientos)}</div></div>
      <div class="card"><div class="lbl">Var. Mensual</div><div class="val \${cls(v.mensual)}">\${pct(v.mensual)}</div></div>
      <div class="card"><div class="lbl">Var. Anual</div><div class="val \${cls(v.anual)}">\${pct(v.anual)}</div></div>
      <div class="card"><div class="lbl">Cuenta Contingente</div><div class="val">\${fmt(lat.cuenta_contingente)}</div></div>
    \`;

    // Portafolio
    const pf = lat.portafolio||[];
    document.getElementById('pfbody').innerHTML = pf.length
      ? pf.map(f=>\`<tr><td>\${f.nombre}</td><td>\${f.porcentaje!=null?f.porcentaje.toFixed(1)+'%':'—'}</td><td>\${fmt(f.saldo)}</td></tr>\`).join('')
      : '<tr><td colspan="3" style="color:#64748b;text-align:center">Sin datos de portafolio</td></tr>';

    // Tabla histórico (últimos 30)
    const all = hist.records||[];
    document.getElementById('histbody').innerHTML = all.slice(0,30).length
      ? all.slice(0,30).map(r=>{ const rv=r.variaciones||{}; return \`<tr><td>\${r.fecha}</td><td>\${fmt(r.capital)}</td><td class="\${r.rendimientos>=0?'pos':'neg'}">\${fmt(r.rendimientos)}</td><td>\${fmt(r.total)}</td><td>\${badge(rv.diaria)||pct(rv.diaria)}</td><td>\${badge(rv.mensual)||pct(rv.mensual)}</td></tr>\`; }).join('')
      : '<tr><td colspan="6" style="color:#64748b;text-align:center">Sin historial aún</td></tr>';

    // Gráfica (todos los registros)
    allHistory = all;
    renderChart(filterRange(allHistory, curRange));

  } catch(e) { console.error(e); }
}

load();
setInterval(load, 60_000);
<\/script>
</body>
</html>`;
}
