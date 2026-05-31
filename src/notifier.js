/**
 * notifier.js — Envía el resumen diario por correo después de cada scrape.
 *
 * Usa Resend HTTP API (funciona en Render — no usa puertos SMTP bloqueados).
 * Configurar en Render Environment:
 *   RESEND_API_KEY=re_xxxxxxxxxxxxxxxx  ← desde resend.com/api-keys
 *   NOTIFY_EMAIL=sebastiancanoarias@gmail.com ← destinatario
 */

const { formatCOP, formatPct } = require('./utils/calculations');

const BASE_URL = 'https://skandia-monitor.onrender.com';

function getDashboardUrl(userId) {
  return userId === 'cliente' ? `${BASE_URL}/cliente` : BASE_URL;
}

/**
 * Devuelve emoji y color según el valor de una variación.
 */
function varStyle(pct) {
  if (pct == null) return { emoji: '➖', color: '#888888', text: 'N/A' };
  if (pct > 0)     return { emoji: '📈', color: '#22c55e', text: formatPct(pct) };
  if (pct < 0)     return { emoji: '📉', color: '#ef4444', text: formatPct(pct) };
  return             { emoji: '➖', color: '#888888', text: '0.00%' };
}

/**
 * Construye el HTML del correo.
 */
function buildEmailHtml(data, variaciones, fecha, dashboardUrl) {
  const DASHBOARD_URL = dashboardUrl;
  const dv = varStyle(variaciones?.diaria);
  const mv = varStyle(variaciones?.mensual);
  const av = varStyle(variaciones?.anual);

  // Diferencia absoluta diaria
  const diffDiaria = (variaciones?.diaria != null && data.total != null)
    ? data.total - (data.total / (1 + variaciones.diaria / 100))
    : null;

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
</head>
<body style="margin:0;padding:0;background:#0f172a;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f172a;padding:32px 0;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0"
               style="background:#1e293b;border-radius:12px;overflow:hidden;
                      border:1px solid #334155;max-width:560px;width:100%;">

          <!-- HEADER -->
          <tr>
            <td style="background:linear-gradient(135deg,#1e40af,#3b82f6);
                       padding:28px 32px;text-align:center;">
              <p style="margin:0;font-size:22px;font-weight:700;color:#ffffff;
                        letter-spacing:-0.5px;">
                📊 Skandia Monitor
              </p>
              <p style="margin:6px 0 0;font-size:13px;color:#bfdbfe;">
                Resumen diario — ${fecha}
              </p>
            </td>
          </tr>

          <!-- ESTADO -->
          <tr>
            <td style="padding:24px 32px 0;">
              <p style="margin:0;background:#064e3b;border:1px solid #065f46;
                        border-radius:8px;padding:10px 16px;font-size:13px;
                        color:#6ee7b7;text-align:center;">
                ✅ Scrape completado exitosamente
              </p>
            </td>
          </tr>

          <!-- SALDO TOTAL (protagonista) -->
          <tr>
            <td style="padding:24px 32px 0;text-align:center;">
              <p style="margin:0;font-size:11px;font-weight:600;color:#94a3b8;
                        letter-spacing:1px;text-transform:uppercase;">Saldo Total</p>
              <p style="margin:8px 0 0;font-size:38px;font-weight:700;color:#f8fafc;
                        letter-spacing:-1px;">
                ${formatCOP(data.total)}
              </p>
              ${diffDiaria != null ? `
              <p style="margin:6px 0 0;font-size:14px;color:${dv.color};">
                ${dv.emoji} ${diffDiaria >= 0 ? '+' : ''}${formatCOP(diffDiaria)} hoy
              </p>` : ''}
            </td>
          </tr>

          <!-- CAPITAL / RENDIMIENTOS -->
          <tr>
            <td style="padding:20px 32px 0;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td width="48%" style="background:#0f172a;border-radius:8px;
                                         padding:16px;text-align:center;
                                         border:1px solid #334155;">
                    <p style="margin:0;font-size:10px;font-weight:600;color:#64748b;
                               letter-spacing:1px;text-transform:uppercase;">Capital</p>
                    <p style="margin:6px 0 0;font-size:18px;font-weight:700;
                               color:#e2e8f0;">
                      ${formatCOP(data.capital)}
                    </p>
                  </td>
                  <td width="4%"></td>
                  <td width="48%" style="background:#0f172a;border-radius:8px;
                                         padding:16px;text-align:center;
                                         border:1px solid #334155;">
                    <p style="margin:0;font-size:10px;font-weight:600;color:#64748b;
                               letter-spacing:1px;text-transform:uppercase;">Rendimientos</p>
                    <p style="margin:6px 0 0;font-size:18px;font-weight:700;
                               color:#22c55e;">
                      ${formatCOP(data.rendimientos)}
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- VARIACIONES -->
          <tr>
            <td style="padding:20px 32px 0;">
              <p style="margin:0 0 12px;font-size:11px;font-weight:600;color:#94a3b8;
                        letter-spacing:1px;text-transform:uppercase;">Variaciones</p>
              <table width="100%" cellpadding="0" cellspacing="0"
                     style="background:#0f172a;border-radius:8px;border:1px solid #334155;
                            overflow:hidden;">
                <tr style="border-bottom:1px solid #1e293b;">
                  <td style="padding:12px 16px;font-size:13px;color:#94a3b8;">Hoy</td>
                  <td style="padding:12px 16px;text-align:right;font-size:14px;
                             font-weight:700;color:${dv.color};">
                    ${dv.emoji} ${dv.text}
                  </td>
                </tr>
                <tr style="border-bottom:1px solid #1e293b;">
                  <td style="padding:12px 16px;font-size:13px;color:#94a3b8;">Mensual</td>
                  <td style="padding:12px 16px;text-align:right;font-size:14px;
                             font-weight:700;color:${mv.color};">
                    ${mv.emoji} ${mv.text}
                  </td>
                </tr>
                <tr>
                  <td style="padding:12px 16px;font-size:13px;color:#94a3b8;">Anual</td>
                  <td style="padding:12px 16px;text-align:right;font-size:14px;
                             font-weight:700;color:${av.color};">
                    ${av.emoji} ${av.text}
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- PORTAFOLIO (top fondos) -->
          ${data.portafolio && data.portafolio.length > 0 ? `
          <tr>
            <td style="padding:20px 32px 0;">
              <p style="margin:0 0 12px;font-size:11px;font-weight:600;color:#94a3b8;
                        letter-spacing:1px;text-transform:uppercase;">Composición del Portafolio</p>
              <table width="100%" cellpadding="0" cellspacing="0"
                     style="background:#0f172a;border-radius:8px;border:1px solid #334155;
                            overflow:hidden;">
                ${data.portafolio.map((f, i) => `
                <tr style="${i < data.portafolio.length - 1 ? 'border-bottom:1px solid #1e293b;' : ''}">
                  <td style="padding:10px 16px;font-size:12px;color:#e2e8f0;">
                    ${f.nombre}
                  </td>
                  <td style="padding:10px 16px;text-align:center;font-size:12px;
                             color:#94a3b8;white-space:nowrap;">
                    ${f.porcentaje != null ? f.porcentaje + '%' : '—'}
                  </td>
                  <td style="padding:10px 16px;text-align:right;font-size:12px;
                             font-weight:600;color:#e2e8f0;white-space:nowrap;">
                    ${formatCOP(f.saldo)}
                  </td>
                </tr>`).join('')}
              </table>
            </td>
          </tr>` : ''}

          <!-- CTA — DASHBOARD -->
          <tr>
            <td style="padding:28px 32px;">
              <a href="${DASHBOARD_URL}"
                 style="display:block;background:linear-gradient(135deg,#1e40af,#3b82f6);
                        color:#ffffff;text-decoration:none;text-align:center;
                        padding:14px 24px;border-radius:8px;font-size:14px;
                        font-weight:600;letter-spacing:0.3px;">
                Ver Dashboard Completo →
              </a>
            </td>
          </tr>

          <!-- FOOTER -->
          <tr>
            <td style="padding:0 32px 24px;text-align:center;
                       border-top:1px solid #334155;">
              <p style="margin:16px 0 4px;font-size:11px;color:#475569;">
                Skandia Monitor • Generado automáticamente a las 7:00 AM
              </p>
              <p style="margin:0;font-size:11px;color:#334155;">
                ${DASHBOARD_URL}
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * Construye el texto plano como fallback.
 */
function buildEmailText(data, variaciones, fecha, dashboardUrl) {
  const dv = varStyle(variaciones?.diaria);
  const mv = varStyle(variaciones?.mensual);
  const av = varStyle(variaciones?.anual);

  return `
╔══════════════════════════════════════════╗
  📊 SKANDIA MONITOR — ${fecha}
╚══════════════════════════════════════════╝

✅ Scrape completado exitosamente

SALDO TOTAL:    ${formatCOP(data.total)}
Capital:        ${formatCOP(data.capital)}
Rendimientos:   ${formatCOP(data.rendimientos)}

VARIACIONES:
  Hoy:      ${dv.emoji} ${dv.text}
  Mensual:  ${mv.emoji} ${mv.text}
  Anual:    ${av.emoji} ${av.text}

🔗 Dashboard: ${dashboardUrl}

──────────────────────────────────────────
Skandia Monitor • Automático 7:00 AM
`.trim();
}

/**
 * Envía el correo de resumen diario via Resend HTTP API.
 * Render free tier bloquea SMTP (puertos 25/465/587) — Resend usa HTTPS (443).
 * Si RESEND_API_KEY no está configurado, omite silenciosamente.
 */
async function sendDailySummary(data, variaciones, userId = 'sebastian') {
  const apiKey      = process.env.RESEND_API_KEY;
  const to          = process.env.NOTIFY_EMAIL || 'sebastiancanoarias@gmail.com';
  const dashboardUrl = getDashboardUrl(userId);

  if (!apiKey) {
    console.log('[MAIL] ⚠️  RESEND_API_KEY no configurado — omitiendo email');
    return { ok: false, reason: 'not_configured' };
  }

  const fecha = data.fecha || new Date().toISOString().split('T')[0];

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from:    'Skandia Monitor <onboarding@resend.dev>',
        to:      [to],
        subject: `📊 Skandia — ${fecha} · ${formatCOP(data.total)}`,
        text:    buildEmailText(data, variaciones, fecha, dashboardUrl),
        html:    buildEmailHtml(data, variaciones, fecha, dashboardUrl),
      }),
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.message || `HTTP ${response.status}`);
    }

    console.log(`[MAIL] ✅ Correo enviado a ${to} (id: ${result.id})`);
    return { ok: true, id: result.id };

  } catch (err) {
    console.error('[MAIL] ❌ Error enviando correo:', err.message);
    return { ok: false, error: err.message };
  }
}

module.exports = { sendDailySummary };
