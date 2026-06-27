const express = require('express');
const router = express.Router();
const { runSync } = require('../services/clickup');
const { getDb } = require('../db');

router.post('/clickup', async (req, res) => {
  const result = await runSync();
  res.json(result);
});

router.get('/status', (req, res) => {
  const db = getDb();
  const lastSync = db.prepare("SELECT valor FROM settings WHERE clave='last_sync'").get();
  const token = db.prepare("SELECT valor FROM settings WHERE clave='clickup_token'").get()
    || (process.env.CLICKUP_TOKEN ? { valor: '***' } : null);

  res.json({
    configured: !!(token?.valor || process.env.CLICKUP_TOKEN),
    last_sync: lastSync?.valor || null,
    interval_min: parseInt(process.env.SYNC_INTERVAL_MIN || '30', 10)
  });
});

module.exports = router;
