// Verify a Telegram Web App `initData` string against the bot token.
// Telegram Web Apps spec: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
//
//   secret_key   = HMAC_SHA256(key="WebAppData", message=BOT_TOKEN)
//   data_check   = sorted(key=value) joined by "\n", excluding `hash`
//   expected_hash = HMAC_SHA256(key=secret_key, message=data_check)  (hex)
//   ok = expected_hash == provided_hash

const crypto = require('crypto');

const MAX_AGE_SECONDS = 60 * 60; // 1 hour — reject older auth_date to limit replay window

function validateInitData(initDataStr, botToken) {
  if (!initDataStr || !botToken) return { ok: false, reason: 'missing_inputs' };

  const params = new URLSearchParams(initDataStr);
  const hash = params.get('hash');
  if (!hash) return { ok: false, reason: 'missing_hash' };
  params.delete('hash');

  const pairs = [];
  for (const [k, v] of params.entries()) pairs.push([k, v]);
  pairs.sort((a, b) => a[0].localeCompare(b[0]));
  const dataCheckString = pairs.map(([k, v]) => `${k}=${v}`).join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const computed = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  if (computed !== hash) return { ok: false, reason: 'bad_hash' };

  const authDate = Number(params.get('auth_date'));
  if (!Number.isFinite(authDate)) return { ok: false, reason: 'bad_auth_date' };
  const ageSec = (Date.now() / 1000) - authDate;
  if (ageSec > MAX_AGE_SECONDS) return { ok: false, reason: 'expired' };

  let user = null;
  const userStr = params.get('user');
  if (userStr) {
    try { user = JSON.parse(userStr); } catch (_) {}
  }

  return { ok: true, user, authDate };
}

module.exports = { validateInitData };
