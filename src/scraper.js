/**
 * scraper.js — Extrae datos de Skandia Colombia (Ahorro e Inversión).
 *
 * FLUJO COMPLETO:
 *  1. Login con espera Vaadin (#usuarioTf input)
 *  2. Cerrar popups SOLO si hay un modal real visible
 *  3. Cerrar panel IBM toolbar si se abrió accidentalmente
 *  4. Click tab "Ahorro e Inversión"
 *  5. Esperar texto "PENSIONES VOLUNTARIAS" en DOM
 *  6. Click "PENSIONES VOLUNTARIAS ›" para entrar al detalle
 *  7. Esperar texto "Capital" en DOM (confirma detalle cargado)
 *  8. Extraer Capital, Rendimientos, Saldo Total, Contingente, Portafolio
 */

require('dotenv').config();
const puppeteer = require('puppeteer');
const path = require('path');
const fs   = require('fs');

const DEBUG    = process.env.DEBUG === 'true';
const DATA_DIR = path.join(__dirname, '..', 'data');
const LOGIN_URL = process.env.SKANDIA_URL ||
  'https://cliente.skandia.com.co/wps/portal/clientes/LoginOM/';
const CLEAN_DASHBOARD = 'https://cliente.skandia.com.co/wps/myportal/clientes/dashboard';

fs.mkdirSync(DATA_DIR, { recursive: true });

// ── Helpers ─────────────────────────────────────────────────────

async function shot(page, name) {
  if (!DEBUG) return;
  const file = path.join(DATA_DIR, `${name}-${Date.now()}.png`);
  await page.screenshot({ path: file, fullPage: true }).catch(() => {});
  console.log(`[SCR] 📸 ${path.basename(file)}`);
}

async function saveHtml(page, label) {
  try {
    const content = await page.content();
    const file = path.join(DATA_DIR, `${label}-${Date.now()}.html`);
    fs.writeFileSync(file, content);
    console.log(`[SCR] HTML guardado: ${path.basename(file)}`);
  } catch (_) {}
}

async function findFirst(page, selectors) {
  for (const sel of selectors) {
    const el = await page.$(sel).catch(() => null);
    if (el) return el;
  }
  return null;
}

/**
 * Espera hasta que cierto texto aparezca en el cuerpo de la página.
 * Más confiable que esperar spinners porque verifica contenido real.
 */
async function waitForText(page, text, timeout = 20_000) {
  // Usa textContent (no innerText) para incluir elementos ocultos (display:none)
  // Skandia usa un acordeón Vaadin que pre-renderiza el contenido aunque esté cerrado
  return page.waitForFunction(
    (t) => document.body.textContent.toUpperCase().includes(t.toUpperCase()),
    { timeout },
    text
  ).catch(() => {
    console.warn(`[SCR] Timeout esperando texto: "${text}"`);
  });
}

/**
 * Cierra popups de Skandia SOLO si hay un modal Vaadin visible.
 * Popups conocidos:
 *   1. Marketing "Conoce nuestros productos..." → "No, gracias"
 *   2. Seguridad "CREA TUS PREGUNTAS..." → botón X de Vaadin
 *
 * IMPORTANTE: solo actúa cuando detecta un .v-window real visible.
 * Esto evita hacer clic accidental en elementos del portal IBM.
 */
async function dismissPopups(page) {
  for (let round = 1; round <= 3; round++) {
    await new Promise(r => setTimeout(r, 1_500));

    // Primero verificar si hay un modal Vaadin visible
    const hasModal = await page.evaluate(() => {
      const modals = document.querySelectorAll(
        '.v-window, .v-window-wrap, .v-overlay'
      );
      return Array.from(modals).some(el => {
        const s = window.getComputedStyle(el);
        return s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0';
      });
    });

    if (!hasModal) {
      console.log(`[SCR] Ronda ${round}: sin modales Vaadin — no se hace clic`);
      continue;
    }

    const closed = await page.evaluate(() => {
      let count = 0;

      // Popup 1: Marketing → "No, gracias"
      const allBtns = Array.from(document.querySelectorAll('button, a, span'));
      for (const el of allBtns) {
        const t = el.textContent.trim().toLowerCase();
        if (t === 'no, gracias' || t === 'no gracias') {
          el.click(); count++; break;
        }
      }

      // Popup 2: Seguridad → botón X de ventana Vaadin
      const closeBox = document.querySelector(
        '.v-window-closebox, .v-window-header .v-window-closebox'
      );
      if (closeBox) { closeBox.click(); count++; }

      return count;
    });

    if (closed > 0) {
      console.log(`[SCR] ${closed} popup(s) cerrado(s) en ronda ${round}`);
      await shot(page, `popup-cerrado-ronda${round}`);
    } else {
      console.log(`[SCR] Ronda ${round}: modal visible pero no encontré botón`);
    }
  }
}

/**
 * Detecta y cierra el panel "Gestor del sitio" de IBM WebSphere Portal.
 * Este panel se abre accidentalmente cuando la URL contiene uri=toolbar.
 * Solución: navegar a la URL limpia del dashboard.
 */
async function closeIBMToolbar(page) {
  const currentUrl = page.url();
  const hasToolbar = currentUrl.includes('uri=toolbar') ||
    currentUrl.includes('toolbar%3A');

  const toolbarInDOM = await page.evaluate(() => {
    return !!document.querySelector('#wpsToolbar, [id*="wpsToolbar"], .wpToolbar');
  }).catch(() => false);

  if (hasToolbar || toolbarInDOM) {
    console.log('[SCR] ⚠️  IBM toolbar detectado — navegando a URL limpia...');
    await page.goto(CLEAN_DASHBOARD, { waitUntil: 'networkidle2', timeout: 30_000 });
    await new Promise(r => setTimeout(r, 2_000));
    await shot(page, 'toolbar-cerrado');
    console.log('[SCR] IBM toolbar cerrado, dashboard limpio cargado');
    return true;
  }
  return false;
}

async function launchBrowser() {
  const isProd = process.env.NODE_ENV === 'production';
  const args = [
    '--no-sandbox', '--disable-setuid-sandbox',
    '--disable-dev-shm-usage', '--disable-gpu',
    '--no-first-run', '--disable-extensions',
  ];
  const opts = {
    headless: isProd || !DEBUG,
    args,
    defaultViewport: { width: 1366, height: 900 },
    timeout: 60_000,
  };

  if (isProd) {
    // Auto-detectar Chrome instalado por Puppeteer en Render
    // La ruta exacta varía por versión: /opt/render/.cache/puppeteer/chrome/linux-XXXX/chrome-linux64/chrome
    const { execSync } = require('child_process');
    const searchPaths = [
      '/opt/render/.cache/puppeteer',
      '/opt/render/project/.cache/puppeteer',
      process.env.PUPPETEER_CACHE_DIR,
    ].filter(Boolean);

    let chromePath = null;

    // 1. Intentar con PUPPETEER_EXECUTABLE_PATH si no tiene glob
    const envPath = process.env.PUPPETEER_EXECUTABLE_PATH;
    if (envPath && !envPath.includes('*') && fs.existsSync(envPath)) {
      chromePath = envPath;
    }

    // 2. Auto-detectar con find en las rutas conocidas
    if (!chromePath) {
      for (const base of searchPaths) {
        try {
          const found = execSync(
            `find "${base}" -name "chrome" -type f 2>/dev/null | head -1`
          ).toString().trim();
          if (found && fs.existsSync(found)) {
            chromePath = found;
            break;
          }
        } catch (_) {}
      }
    }

    if (chromePath) {
      console.log(`[SCR] Chrome detectado: ${chromePath}`);
      opts.executablePath = chromePath;
    } else {
      console.warn('[SCR] ⚠️  No se encontró Chrome manualmente — dejando que Puppeteer lo resuelva');
    }
  }

  return puppeteer.launch(opts);
}

// ── SCRAPER PRINCIPAL ────────────────────────────────────────────

async function scrapeSkandiaData() {
  let browser;
  try {
    console.log(`[SCR] Iniciando (${new Date().toISOString()})...`);
    browser = await launchBrowser();
    const page = await browser.newPage();

    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    );
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'es-CO,es;q=0.9' });

    // ── 1. NAVEGAR AL LOGIN ──────────────────────────────────────
    console.log('[SCR] 1/5 Navegando al portal Skandia...');
    await page.goto(LOGIN_URL, { waitUntil: 'networkidle2', timeout: 60_000 });
    await shot(page, '01-login-page');

    // ── 2. LOGIN ─────────────────────────────────────────────────
    console.log('[SCR] 2/5 Esperando formulario Vaadin y entrando credenciales...');

    // Vaadin inyecta los <input> en el DOM con JS — esperar explícitamente
    await page.waitForSelector(
      '#usuarioTf input, #usuarioTf, input[type="text"]',
      { timeout: 25_000 }
    ).catch(() => null);

    const userField = await findFirst(page, [
      '#usuarioTf input',        // Vaadin: Skandia real
      '#usuarioTf',
      'input[name="j_username"]',
      'input[name="username"]',  'input[id="username"]',
      'input[placeholder*="usuario" i]',
      'input[placeholder*="cédula" i]',
      'form input[type="text"]:first-of-type',
      'input[type="text"]',
    ]);

    if (!userField) {
      await shot(page, 'ERROR-no-campo-usuario');
      await saveHtml(page, 'ERROR-login-html');
      throw new Error(
        `❌ No encontré el campo de usuario.\n   URL: ${page.url()}\n` +
        '   Revisa ERROR-login-html-*.html en /data/'
      );
    }

    await userField.click({ clickCount: 3 });
    await userField.type(process.env.SKANDIA_USER, { delay: 80 });

    await page.waitForSelector(
      '#passTfl input, #passTfl, input[type="password"]',
      { timeout: 10_000 }
    ).catch(() => null);

    const pwField = await findFirst(page, [
      '#passTfl input',          // Vaadin: Skandia real
      '#passTfl',
      'input[name="j_password"]',
      'input[type="password"]',
      'input[name="clave"]',
    ]);

    if (!pwField) {
      await shot(page, 'ERROR-no-clave');
      throw new Error('❌ No encontré el campo de contraseña.');
    }

    await pwField.click({ clickCount: 3 });
    await pwField.type(process.env.SKANDIA_PASSWORD, { delay: 80 });
    await shot(page, '02-credenciales-listas');

    const submitBtn = await findFirst(page, [
      '.v-button-primary',
      '[class*="v-button"][class*="primary"]',
      'input[type="submit"]',
      'button[type="submit"]',
      'form button',
    ]);

    if (submitBtn) await submitBtn.click();
    else await pwField.press('Enter');

    // ── 3. ESPERAR DASHBOARD ─────────────────────────────────────
    console.log('[SCR] 3/5 Esperando dashboard post-login...');

    await Promise.race([
      page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30_000 }),
      new Promise(r => setTimeout(r, 10_000)),
    ]).catch(() => {});

    await shot(page, '03-post-login');

    const errorMsg = await page.$eval(
      '.error, .alert-danger, [class*="error-msg"]',
      el => el.textContent.trim()
    ).catch(() => null);
    if (errorMsg && errorMsg.length > 3) {
      throw new Error(`❌ Error de autenticación: "${errorMsg}"`);
    }
    console.log(`[SCR] ✅ Login OK — URL: ${page.url()}`);

    // ── 3b. CERRAR POPUPS (solo si hay modal real) ───────────────
    console.log('[SCR] Verificando popups post-login...');
    await dismissPopups(page);
    await shot(page, '03b-sin-popups');

    // ── 3c. CERRAR IBM TOOLBAR si se abrió ───────────────────────
    await closeIBMToolbar(page);

    // ── 4. NAVEGAR A AHORRO E INVERSIÓN ──────────────────────────
    console.log('[SCR] 4/5 Navegando a Ahorro e Inversión...');

    // Esperar 3s a que el dashboard cargue sus tabs completamente
    await new Promise(r => setTimeout(r, 3_000));
    await shot(page, '04-dashboard-con-tabs');

    // Click en tab "Ahorro e Inversión" con JS
    // IMPORTANTE: usar texto corto (<40 chars) para evitar capturar scripts
    const tabClicked = await page.evaluate(() => {
      const all = Array.from(document.querySelectorAll(
        'li, a, div, span, td, th, button'  // solo elementos de UI, no scripts
      ));
      const tab = all.find(el => {
        const t = el.textContent.trim();
        // El texto del tab debe ser exactamente el label (< 40 chars)
        return t.length < 40 &&
               t.includes('Ahorro') && t.includes('nversi') &&
               el.children.length <= 2;
      });
      if (tab) { tab.click(); return tab.textContent.trim().slice(0, 50); }
      return null;
    });
    if (tabClicked) console.log(`[SCR] Tab clickeada: "${tabClicked}"`);
    else console.warn('[SCR] ⚠️  Tab "Ahorro e Inversión" no encontrada');

    // Esperar carga del contenido del tab y cerrar cualquier popup que aparezca
    await new Promise(r => setTimeout(r, 3_000));
    console.log('[SCR] Verificando popups post-tab...');
    await dismissPopups(page);

    // ── 5. ESPERAR LISTA DE CONTRATOS ────────────────────────────
    console.log('[SCR] Esperando lista de contratos...');
    await waitForText(page, 'PENSIONES VOLUNTARIAS', 25_000);
    await new Promise(r => setTimeout(r, 1_500));
    await shot(page, '05-lista-contratos');

    // ── 6. ENTRAR AL DETALLE DE PENSIONES VOLUNTARIAS ────────────
    console.log('[SCR] Entrando al detalle de Pensiones Voluntarias...');

    const enteredDetail = await page.evaluate(() => {
      const allEls = Array.from(document.querySelectorAll('*'));

      // Buscar primero un <a> o elemento con role=button o cursor pointer
      // que contenga EXACTAMENTE "Pensiones Voluntarias" (sin "Plus")
      const clickable = allEls.find(el => {
        const t = el.textContent.trim().toUpperCase();
        const tag = el.tagName.toLowerCase();
        const isLink = tag === 'a' || tag === 'button' || tag === 'tr' ||
                       el.getAttribute('role') === 'button' ||
                       el.getAttribute('onclick') ||
                       (window.getComputedStyle(el).cursor === 'pointer');
        return isLink && t.includes('PENSIONES VOLUNTARIAS') &&
               !t.includes('PLUS') && el.children.length <= 5;
      });

      if (clickable) {
        clickable.scrollIntoView({ block: 'center' });
        clickable.click();
        return `clickable:"${clickable.textContent.trim().slice(0, 60)}"`;
      }

      // Fallback: elemento con menor número de hijos
      const matches = allEls.filter(el => {
        const t = el.textContent.trim().toUpperCase();
        return t.includes('PENSIONES VOLUNTARIAS') && !t.includes('PLUS') &&
               el.children.length <= 5;
      });
      matches.sort((a, b) => a.children.length - b.children.length);

      if (matches.length > 0) {
        const target = matches[0];
        target.scrollIntoView({ block: 'center' });
        target.click();
        return `fallback:"${target.textContent.trim().slice(0, 60)}"`;
      }
      return null;
    });

    if (enteredDetail) {
      console.log(`[SCR] ✅ Click en ${enteredDetail}`);
    } else {
      console.warn('[SCR] ⚠️  No encontré "PENSIONES VOLUNTARIAS" — intentando continuar');
    }

    // Esperar carga y cerrar popup si aparece al entrar al detalle
    await new Promise(r => setTimeout(r, 3_000));
    console.log('[SCR] Verificando popups post-detalle...');
    await dismissPopups(page);

    // ── 7. ESPERAR PANTALLA DE DETALLE ───────────────────────────
    console.log('[SCR] Esperando pantalla de detalle (Capital + Rendimientos)...');
    await waitForText(page, 'Capital', 25_000);
    await waitForText(page, 'Rendimientos', 10_000);
    await new Promise(r => setTimeout(r, 2_000)); // esperar hidratación completa
    await shot(page, '06-detalle-listo');

    // Guardar HTML para análisis del DOM (solo en DEBUG)
    if (DEBUG) await saveHtml(page, 'DEBUG-extraction-page');

    // ── 8. EXTRAER DATOS ─────────────────────────────────────────
    console.log('[SCR] 5/5 Extrayendo datos...');

    const rawData = await page.evaluate(() => {

      function parseNum(text) {
        if (!text) return null;
        let s = String(text).replace(/[^0-9,.-]/g, '');
        // Formato colombiano: puntos como miles, coma como decimal → 3.829.379,60
        if (/\d{1,3}(\.\d{3})+,\d{2}$/.test(s)) {
          s = s.replace(/\./g, '').replace(',', '.');
        } else {
          // Formato americano: comas como miles, punto como decimal → 3,829,379.60
          s = s.replace(/,/g, '');
        }
        const n = parseFloat(s);
        return isNaN(n) ? null : n;
      }

      // Busca el VALOR numérico que está inmediatamente vinculado a un label
      function findValueForLabel(labelText) {
        // Buscar elementos que sean exactamente ese label (hojas del DOM)
        const allEls = Array.from(document.querySelectorAll('*'));
        const labels = allEls.filter(el =>
          el.children.length === 0 &&
          el.textContent.trim().toLowerCase() === labelText.toLowerCase()
        );

        for (const label of labels) {
          // Estrategia 1: hermano siguiente directo
          const sib = label.nextElementSibling;
          if (sib) {
            const n = parseNum(sib.textContent);
            if (n && n > 1000) return n; // filtrar números pequeños (%, etc)
          }
          // Estrategia 2: padre → hermano siguiente del padre
          const parentSib = label.parentElement?.nextElementSibling;
          if (parentSib) {
            const n = parseNum(parentSib.textContent);
            if (n && n > 1000) return n;
          }
          // Estrategia 3: buscar en el contenedor completo del círculo
          // (subiendo 2-3 niveles y buscando el número más grande)
          let ancestor = label.parentElement;
          for (let i = 0; i < 3; i++) {
            if (!ancestor) break;
            const nums = Array.from(ancestor.querySelectorAll('*'))
              .filter(el => el.children.length === 0)
              .map(el => parseNum(el.textContent))
              .filter(n => n && n > 100_000); // Capital/Rendimientos son > $100.000
            if (nums.length > 0) return Math.max(...nums);
            ancestor = ancestor.parentElement;
          }
        }
        return null;
      }

      const capital      = findValueForLabel('Capital');
      const rendimientos = findValueForLabel('Rendimientos');

      // Saldo Total: buscar texto "Saldo Total" o calcular Capital+Rendimientos
      let saldoTotal = findValueForLabel('Saldo Total');
      if (!saldoTotal && capital && rendimientos) {
        saldoTotal = capital + rendimientos;
      }

      // ── CUENTA CONTINGENTE ──────────────────────────────────────
      // El elemento tiene clase .textoCuentaContingente y está dentro del acordeón
      // (puede estar en display:none, pero querySelectorAll lo encuentra igual)
      let cuentaContingente = null;
      const ccEl = document.querySelector('.textoCuentaContingente');
      if (ccEl) {
        // Texto: "Cuenta Contingente: $0.00"
        const ccMatch = ccEl.textContent.match(/\$\s*([\d.,]+)/);
        if (ccMatch) cuentaContingente = parseNum(ccMatch[1]);
        else cuentaContingente = 0; // si no hay número, asumir $0
      }

      // ── PORTAFOLIO ───────────────────────────────────────────────
      // Tabla Vaadin específica: #idTablaComposicionPensiones
      // - Usa <td> como encabezados (no <th>) → querySelectorAll('th') falla
      // - Las filas están en .v-table-table tbody (pueden tener height:0 si está cerrado)
      // - El nombre del fondo está en .v-label-undef-w dentro del primer <td>
      // - El saldo está en .v-table-cell-wrapper dentro del segundo <td>
      const portafolio = [];
      const portafolioTable = document.querySelector(
        '#idTablaComposicionPensiones .v-table-table'
      );
      if (portafolioTable) {
        for (const row of portafolioTable.querySelectorAll('tbody tr')) {
          const tds = row.querySelectorAll('td');
          if (tds.length < 2) continue;

          // Nombre: el .v-label sin hijos (hoja del DOM) dentro del primer td
          const nameEl = Array.from(tds[0].querySelectorAll('.v-label'))
            .find(el => el.children.length === 0 && el.textContent.trim().length > 3);
          // Saldo: el .v-table-cell-wrapper del último td
          const saldoWrapper = tds[tds.length - 1].querySelector('.v-table-cell-wrapper');

          if (!nameEl || !saldoWrapper) continue;
          const nombre = nameEl.textContent.trim();
          const saldo  = parseNum(saldoWrapper.textContent);

          if (!nombre || !saldo || saldo < 100 || nombre.toUpperCase() === 'TOTAL') continue;
          portafolio.push({ nombre, saldo, porcentaje: null });
        }
      }

      // Fallback: si no encontramos el ID específico, buscar en cualquier tabla Vaadin
      if (portafolio.length === 0) {
        const allVaadin = document.querySelectorAll(
          '[id*="Composicion"] .v-table-table, [id*="composicion"] .v-table-table, ' +
          '[id*="Portafolio"] .v-table-table, [id*="portafolio"] .v-table-table'
        );
        for (const t of allVaadin) {
          for (const row of t.querySelectorAll('tbody tr')) {
            const tds = row.querySelectorAll('td');
            if (tds.length < 2) continue;
            const nameEl = Array.from(tds[0].querySelectorAll('.v-label'))
              .find(el => el.children.length === 0 && el.textContent.trim().length > 3);
            const saldoWrapper = tds[tds.length - 1].querySelector('.v-table-cell-wrapper');
            if (!nameEl || !saldoWrapper) continue;
            const nombre = nameEl.textContent.trim();
            const saldo  = parseNum(saldoWrapper.textContent);
            if (nombre && saldo && saldo > 100) {
              portafolio.push({ nombre, saldo, porcentaje: null });
            }
          }
          if (portafolio.length > 0) break;
        }
      }

      // ── PORCENTAJES DEL GRÁFICO DONUT ────────────────────────────
      // Los porcentajes están en <tspan> dentro del SVG del gráfico #idChartPensiones
      const pctEls = Array.from(
        document.querySelectorAll('#idChartPensiones tspan')
      )
        .map(t => t.textContent.trim())
        .filter(t => /^\d{1,3}[.,]\d{2}%$/.test(t))
        .map(t => parseNum(t.replace('%', '')));

      if (pctEls.length === portafolio.length && portafolio.length > 0) {
        portafolio.forEach((item, i) => { item.porcentaje = pctEls[i]; });
      } else if (saldoTotal && portafolio.length > 0) {
        portafolio.forEach(item => {
          item.porcentaje = +(item.saldo / saldoTotal * 100).toFixed(2);
        });
      }

      // ── FECHA OFICIAL DE SKANDIA ─────────────────────────────────
      // Skandia muestra: "Saldos actualizados al 31 de mayo de 2026"
      // Usamos esa fecha en vez de la fecha de ejecución para evitar
      // guardar el balance del día anterior con la fecha de hoy.
      const bodyText = document.body.textContent || '';
      const dateMatch = bodyText.match(
        /Saldos actualizados al\s+(\d{1,2})\s+de\s+(\w+)\s+de\s+(\d{4})/i
      );
      const skandiaDateRaw = dateMatch ? dateMatch[0] : null;

      return {
        capital, rendimientos, saldoTotal, cuentaContingente, portafolio,
        skandiaDateRaw,
        _debug: { url: location.href, bodySnippet: document.body.innerText.slice(0, 500) },
      };
    });

    await shot(page, '07-extraccion-hecha');

    // ── Parsear fecha oficial de Skandia ("31 de mayo de 2026" → "2026-05-31") ──
    function parseSkandiaDate(raw) {
      if (!raw) return null;
      const MESES = {
        enero: '01', febrero: '02', marzo: '03', abril: '04',
        mayo: '05', junio: '06', julio: '07', agosto: '08',
        septiembre: '09', octubre: '10', noviembre: '11', diciembre: '12',
      };
      const m = raw.match(/(\d{1,2})\s+de\s+(\w+)\s+de\s+(\d{4})/i);
      if (!m) return null;
      const month = MESES[m[2].toLowerCase()];
      if (!month) return null;
      return `${m[3]}-${month}-${m[1].padStart(2, '0')}`;
    }

    const skandiaFecha = parseSkandiaDate(rawData.skandiaDateRaw);
    const fechaFallback = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });

    const result = {
      fecha: skandiaFecha || fechaFallback,
      capital:            rawData.capital,
      rendimientos:       rawData.rendimientos,
      total:              rawData.saldoTotal,
      portafolio:         rawData.portafolio,
      cuenta_contingente: rawData.cuentaContingente,
      timestamp:          new Date().toISOString(),
    };

    console.log('[SCR] ✅ Datos extraídos:');
    console.log(`       Fecha Skandia: ${skandiaFecha ? skandiaFecha + ' (oficial Skandia)' : 'no encontrada → usando ' + fechaFallback}`);
    console.log(`       Capital:      ${result.capital      != null ? '$'+result.capital.toLocaleString('es-CO')      : 'NO ENCONTRADO'}`);
    console.log(`       Rendimientos: ${result.rendimientos != null ? '$'+result.rendimientos.toLocaleString('es-CO') : 'NO ENCONTRADO'}`);
    console.log(`       Saldo Total:  ${result.total        != null ? '$'+result.total.toLocaleString('es-CO')        : 'NO ENCONTRADO'}`);
    console.log(`       Contingente:  ${result.cuenta_contingente != null ? '$'+result.cuenta_contingente : 'NO ENCONTRADO'}`);
    console.log(`       Portafolio:   ${result.portafolio.length} fondos`);
    result.portafolio.forEach(f =>
      console.log(`         • ${f.nombre}: $${f.saldo?.toLocaleString('es-CO')} (${f.porcentaje}%)`)
    );

    if (!result.total && !result.capital) {
      console.warn('\n[SCR] ⚠️  ATENCIÓN: datos principales vacíos');
      console.warn('           Debug:', JSON.stringify(rawData._debug));
      await saveHtml(page, 'DEBUG-datos-vacios');
    }

    return result;

  } catch (err) {
    console.error('[SCR] ❌ Error:', err.message);
    throw err;
  } finally {
    if (browser) await browser.close();
  }
}

module.exports = { scrapeSkandiaData };

if (require.main === module) {
  scrapeSkandiaData()
    .then(d => { console.log('\n=== RESULTADO FINAL ===\n', JSON.stringify(d, null, 2)); process.exit(0); })
    .catch(e => { console.error(e.message); process.exit(1); });
}
