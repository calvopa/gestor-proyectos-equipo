require('dotenv').config();
const express = require('express');
const path = require('path');
const { getDb } = require('./db');
const { seed } = require('./seed');
const scheduler = require('./services/scheduler');
const { sessionMiddleware, requireAuth } = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '5mb' }));
app.use(sessionMiddleware);

// Rutas públicas (sin auth)
app.use('/auth', require('./routes/auth'));
app.get('/login', (req, res) => res.redirect('/auth/login'));
app.get('/health', (req, res) => res.json({ ok: true }));
app.use(express.static(path.join(__dirname, '..', 'public')));

// A partir de aquí todo requiere autenticación
app.use(requireAuth);

app.use('/api/projects/:projectId/assignments', require('./routes/assignments'));
app.use('/api/projects', require('./routes/projects'));
app.use('/api/resources', require('./routes/resources'));
app.use('/api/time', require('./routes/time'));
app.use('/api/sync', require('./routes/sync'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/alerts', require('./routes/alerts'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/semana',    require('./routes/semana'));
app.use('/api/export',   require('./routes/export'));
app.use('/api/sofia',    require('./routes/sofia'));
app.use('/api/sprints',  require('./routes/sprints'));

// SPA fallback (solo usuarios autenticados llegan aquí)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message });
});

getDb(); // init + migrations
seed();
scheduler.start();

app.listen(PORT, () => {
  console.log(`[gestor] running on port ${PORT}`);
  const token = process.env.CLICKUP_TOKEN;
  if (!token) {
    console.log('[gestor] ClickUp token not set — running in standalone mode');
  }
});
