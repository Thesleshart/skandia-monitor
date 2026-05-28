require('dotenv').config();
const { google } = require('googleapis');

const SPREADSHEET_ID = process.env.GOOGLE_SHEETS_ID;
const SHEET_NAME     = 'Skandia Monitor';

const HEADERS = [
  'Fecha', 'Capital', 'Rendimientos', 'Total', 'Cuenta Contingente',
  'Var. Diaria %', 'Var. Mensual %', 'Var. Anual %', 'Portafolio JSON',
];

function getAuth() {
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY no configurado en .env');
  }
  let credentials;
  try {
    credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
  } catch {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY no es JSON válido');
  }
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
}

async function getSheets() {
  return google.sheets({ version: 'v4', auth: getAuth() });
}

async function ensureSheet(sheets) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const exists = meta.data.sheets.some(s => s.properties.title === SHEET_NAME);

  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      resource: { requests: [{ addSheet: { properties: { title: SHEET_NAME } } }] },
    });
    // Escribir encabezados
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A1`,
      valueInputOption: 'RAW',
      resource: { values: [HEADERS] },
    });
    console.log('[GS] Hoja creada con encabezados');
  }
}

async function syncToGoogleSheets(data, variaciones) {
  if (!SPREADSHEET_ID) {
    console.log('[GS] GOOGLE_SHEETS_ID no configurado — sync omitido');
    return false;
  }

  try {
    const sheets = await getSheets();
    await ensureSheet(sheets);

    // Buscar si ya existe una fila con esta fecha
    const col = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A:A`,
    });
    const rows = col.data.values || [];
    const rowIndex = rows.findIndex(r => r[0] === data.fecha); // 0-based

    const rowData = [
      data.fecha,
      data.capital            ?? '',
      data.rendimientos       ?? '',
      data.total              ?? '',
      data.cuenta_contingente ?? '',
      variaciones?.diaria  != null ? +variaciones.diaria.toFixed(4)  : '',
      variaciones?.mensual != null ? +variaciones.mensual.toFixed(4) : '',
      variaciones?.anual   != null ? +variaciones.anual.toFixed(4)   : '',
      JSON.stringify(data.portafolio || []),
    ];

    if (rowIndex > 0) {
      // fila existente: actualizar (rowIndex es 0-based, Sheets es 1-based)
      const sheetRow = rowIndex + 1;
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SHEET_NAME}!A${sheetRow}`,
        valueInputOption: 'RAW',
        resource: { values: [rowData] },
      });
      console.log(`[GS] Fila ${sheetRow} actualizada (${data.fecha})`);
    } else {
      await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SHEET_NAME}!A:A`,
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        resource: { values: [rowData] },
      });
      console.log(`[GS] Fila nueva agregada (${data.fecha})`);
    }

    return true;
  } catch (err) {
    console.error('[GS] Error sync:', err.message);
    return false;
  }
}

module.exports = { syncToGoogleSheets };
