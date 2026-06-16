require('dotenv').config();
const express = require('express');
const path = require('path');

const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ──
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// CORS (permissive for MVP — lock down in prod)
app.use((_req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, Content-Type, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
  next();
});

// ── Route loader (skips missing files gracefully) ──
function mount(routePath, filePath) {
  try {
    app.use(routePath, require(filePath));
    console.log(`  ✓ ${routePath}`);
  } catch (err) {
    if (err.code === 'MODULE_NOT_FOUND') {
      console.log(`  ○ ${routePath} (pending — file not yet created)`);
    } else {
      console.error(`  ✗ ${routePath} — ${err.message}`);
    }
  }
}

console.log('Mounting routes:');
mount('/api/auth',        './routes/auth');
mount('/api/consults',    './routes/consults');
mount('/api/specialists', './routes/specialists');
mount('/api/documents',   './routes/documents');
mount('/api/billing',     './routes/billing');
mount('/api/admin',       './routes/admin');
mount('/api/notes',       './routes/notes');

// ── Health check ──
app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    app: 'Curbside MVP',
    time: new Date().toISOString(),
    routes_loaded: true
  });
});

// ── SPA fallback (serves index.html for non-API routes) ──
app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: 'API route not found' });
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Global error handler ──
app.use((err, _req, res, _next) => {
  console.error('[ERROR]', err.message);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error'
  });
});

// ── Start (wait for DB) ──
db.ready.then(() => {
  app.listen(PORT, () => {
    console.log(`\n🏥 Curbside MVP running → http://localhost:${PORT}\n`);
  });
}).catch(err => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});

module.exports = app;
