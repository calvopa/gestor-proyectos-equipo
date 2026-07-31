const express = require('express');
const router = express.Router();
const path = require('path');
const { timingSafeEqual } = require('crypto');

function safeCompare(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  // run comparison unconditionally to avoid timing leaks on length mismatch
  const len = Math.max(ba.length, bb.length);
  const pa = Buffer.concat([ba, Buffer.alloc(len)]).slice(0, len);
  const pb = Buffer.concat([bb, Buffer.alloc(len)]).slice(0, len);
  return timingSafeEqual(pa, pb) && ba.length === bb.length;
}

router.get('/login', (req, res) => {
  if (req.session?.authenticated) return res.redirect('/');
  res.sendFile(path.join(__dirname, '../../public/login.html'));
});

router.post('/login', express.urlencoded({ extended: false }), (req, res) => {
  const { username, password } = req.body;
  const AUTH_USER = process.env.AUTH_USER;
  const AUTH_PASS = process.env.AUTH_PASS;

  if (!AUTH_USER || !AUTH_PASS) {
    console.error('[auth] AUTH_USER o AUTH_PASS no configurados en .env');
    return res.redirect('/login?error=config');
  }

  if (safeCompare(username, AUTH_USER) && safeCompare(password, AUTH_PASS)) {
    req.session.authenticated = true;
    req.session.save(() => res.redirect('/'));
  } else {
    res.redirect('/login?error=1');
  }
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

module.exports = router;
