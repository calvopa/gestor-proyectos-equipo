const TOKEN   = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

function escapeHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

async function apiCall(method, body) {
  if (!TOKEN) return null;
  const res = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Telegram ${method} ${res.status}: ${await res.text()}`);
  return res.json();
}

async function sendMessage(text, chat_id) {
  if (!TOKEN || (!chat_id && !CHAT_ID)) return;
  return apiCall('sendMessage', { chat_id: chat_id || CHAT_ID, text, parse_mode: 'HTML' });
}

async function getUpdates(offset) {
  if (!TOKEN) return [];
  const data = await apiCall('getUpdates', { offset, timeout: 20, allowed_updates: ['message'] });
  return data?.result || [];
}

module.exports = { sendMessage, getUpdates, escapeHtml };
