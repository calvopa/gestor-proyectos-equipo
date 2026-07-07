const express = require('express');
const router = express.Router();
const { getDb } = require('../db');

const PUBLIC_KEYS = ['clickup_token', 'clickup_team_id', 'clickup_mapping_level', 'last_sync', 'sheets_webhook_url'];

router.get('/', (req, res) => {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM settings').all();
  const result = {};
  for (const { clave, valor } of rows) {
    // Mask token in response
    result[clave] = clave === 'clickup_token' && valor ? '***' : valor;
  }
  // Also expose env-level token presence
  if (!result.clickup_token && process.env.CLICKUP_TOKEN) result.clickup_token = '***';
  if (!result.clickup_team_id && process.env.CLICKUP_TEAM_ID) result.clickup_team_id = process.env.CLICKUP_TEAM_ID;
  res.json(result);
});

router.put('/', (req, res) => {
  const db = getDb();
  const allowed = ['clickup_token', 'clickup_team_id', 'clickup_mapping_level', 'sheets_webhook_url'];
  const upsert = db.prepare('INSERT OR REPLACE INTO settings (clave, valor) VALUES (?, ?)');

  db.transaction(() => {
    for (const [k, v] of Object.entries(req.body)) {
      if (!allowed.includes(k)) continue;
      upsert.run(k, v);
    }
  })();

  res.json({ ok: true });
});

module.exports = router;
