# Skandia Monitor

Monitor automatizado de pensiones voluntarias Skandia Colombia.  
Scraping diario → SQLite → Google Sheets → Dashboard web.

---

## Instalación local

```bash
cd skandia-monitor
npm install
```

## Configuración

1. El archivo `.env` ya tiene tus credenciales.  
2. Para Google Sheets (opcional), sigue la sección [Google Sheets](#google-sheets).

## Uso

```bash
# Arrancar servidor + cron (modo normal)
npm start

# Probar el scraper aislado (abre el browser visible si DEBUG=true)
npm run scrape

# Ejecutar el job completo ahora mismo
node src/scheduler.js --now

# Solo el API (sin cron)
npm run api
```

El dashboard estará en **http://localhost:3000**

---

## Calibrar los selectores del scraper

> Haz esto la primera vez — Skandia puede cambiar su HTML en cualquier momento.

1. Pon `DEBUG=true` en `.env`
2. Corre `npm run scrape`
3. El browser se abrirá visible y se guardarán screenshots en `/data/`
4. Si los datos salen `null`, abre `/data/html-snapshot-*.html` en el browser
5. Inspecciona los elementos de Capital, Rendimientos, etc.
6. Actualiza la sección `SELECTORS` en `src/scraper.js` con los selectores reales

---

## Google Sheets

### Crear service account

1. Ve a [console.cloud.google.com](https://console.cloud.google.com)
2. Crea un proyecto → Habilita **Google Sheets API**
3. IAM → Cuentas de servicio → Crear → rol "Editor"
4. Descarga el JSON de clave
5. Crea una hoja en Google Sheets y copia el ID de la URL
6. Comparte la hoja con el email del service account (editor)
7. En `.env`:
   ```
   GOOGLE_SHEETS_ID=tu_id_aqui
   GOOGLE_SERVICE_ACCOUNT_KEY={"type":"service_account",...}  # JSON en una línea
   ```

---

## API REST

| Endpoint | Descripción |
|---|---|
| `GET /` | Dashboard visual |
| `GET /api/latest` | Último registro + variaciones |
| `GET /api/history` | Histórico completo (acepta `?start=&end=&limit=`) |
| `GET /api/record/:fecha` | Registro por fecha `YYYY-MM-DD` |
| `GET /api/stats` | Estadísticas globales |
| `GET /api/export` | Descarga JSON completo |
| `POST /api/trigger` | Ejecutar job manualmente |

---

## Deploy en Render

### Requisitos
- Plan **Starter** ($7/mes) — necesario para disco persistente (SQLite)
- O plan gratuito si usas solo Google Sheets como almacenamiento

### Pasos

```bash
# 1. Subir a GitHub (sin .env)
git init && git add -A && git commit -m "init"
git remote add origin https://github.com/tu-usuario/skandia-monitor.git
git push -u origin main

# 2. En render.com → New → Web Service → conectar repo
# 3. Render detecta render.yaml automáticamente
# 4. En Settings > Environment, agregar las variables secretas:
#    SKANDIA_USER, SKANDIA_PASSWORD, ENCRYPTION_KEY,
#    GOOGLE_SHEETS_ID, GOOGLE_SERVICE_ACCOUNT_KEY
```

### Variable DB_PATH en Render

Agrega esta env var en Render para que SQLite use el disco persistente:
```
DB_PATH=/var/data/skandia.db
```

---

## Estructura

```
skandia-monitor/
├── src/
│   ├── scraper.js          # Puppeteer — extrae datos de Skandia
│   ├── database.js         # SQLite (better-sqlite3)
│   ├── googleSheets.js     # Sync a Google Sheets
│   ├── scheduler.js        # Entry point: cron + server
│   ├── api.js              # Express REST + dashboard HTML
│   └── utils/
│       ├── calculations.js # Variaciones diaria/mensual/anual
│       └── encryption.js   # AES-256-GCM para datos en DB
├── data/                   # skandia.db + screenshots de debug
├── .env                    # ⚠️ NO subir a git
├── .env.example
├── render.yaml
└── package.json
```
