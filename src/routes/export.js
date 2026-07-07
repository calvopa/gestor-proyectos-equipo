const express = require('express');
const router  = express.Router();
const { getDb } = require('../db');

// POST /api/export/sheets — proxy hacia el Apps Script webhook
router.post('/sheets', async (req, res) => {
  const db  = getDb();
  const row = db.prepare("SELECT valor FROM settings WHERE clave='sheets_webhook_url'").get();
  const url = row?.valor;

  if (!url) {
    return res.status(400).json({ error: 'sheets_webhook_url no configurada en Ajustes' });
  }

  try {
    const response = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(req.body),
    });
    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: `Error contactando webhook: ${err.message}` });
  }
});

module.exports = router;
