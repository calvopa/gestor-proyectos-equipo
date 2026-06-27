const { runSync } = require('./clickup');

let timer = null;

function start() {
  const minutes = parseInt(process.env.SYNC_INTERVAL_MIN || '30', 10);
  if (!minutes || minutes <= 0) return;

  const ms = minutes * 60 * 1000;
  timer = setInterval(async () => {
    console.log('[scheduler] running ClickUp sync...');
    const result = await runSync();
    console.log('[scheduler] sync result:', JSON.stringify(result));
  }, ms);

  console.log(`[scheduler] auto-sync every ${minutes} min`);
}

function stop() {
  if (timer) { clearInterval(timer); timer = null; }
}

module.exports = { start, stop };
