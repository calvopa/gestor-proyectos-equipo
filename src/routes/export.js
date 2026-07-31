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

  // Prevenir SSRF: solo se permiten URLs externas con HTTPS
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') {
      return res.status(400).json({ error: 'sheets_webhook_url debe usar HTTPS' });
    }
  } catch {
    return res.status(400).json({ error: 'sheets_webhook_url no es una URL válida' });
  }

  try {
    const bodyStr = JSON.stringify(req.body);
    const projectCount = req.body?.projects?.length ?? 'n/a';
    console.log(`[export/sheets] type=${req.body?.type || (req.body?.week_start ? 'semana' : 'unknown')} projects=${projectCount} payload=${bodyStr.length}b`);

    const response = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    bodyStr,
    });
    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
    console.log(`[export/sheets] response: ${text.slice(0, 200)}`);
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: `Error contactando webhook: ${err.message}` });
  }
});

module.exports = router;
