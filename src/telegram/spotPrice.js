// Live spot price + symbol catalog from SDM's WebSocket market data API.
//
// Two functions:
//   fetchSpot(symbol)            → mid of best bid/offer for one symbol
//   fetchAvailableSymbols()      → snapshot of all tradeable symbols
//
// Both connect → auth (HMAC-signed headers) → wait for `hello` → subscribe →
// take the first `initial: true` snapshot → cancel + close.
//
// Auth: HMAC-SHA256 over "GET\n<ApiTimestamp>\n<host>\n<path>", base64 url-safe,
// passed as the `ApiSign` header (per SDM API 2.0, Authentication section).
//
// Env: SDM_API_KEY, SDM_API_SECRET, SDM_API_HOST (default trade.sdm.co).

const crypto = require('crypto');
const WebSocket = require('ws');

const DEFAULT_HOST = 'trade.sdm.co';
const WS_PATH = '/ws/v1';
const TIMEOUT_MS = 10_000;

// ISO-8601 with microsecond resolution, e.g. 2026-04-28T20:30:45.123000Z.
function isoMicroseconds(d = new Date()) {
  return d.toISOString().replace('Z', '000Z');
}

function urlsafeBase64Hmac(secret, payload) {
  return crypto.createHmac('sha256', secret)
    .update(payload)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function buildAuthHeaders(host) {
  const apiKey = process.env.SDM_API_KEY;
  const apiSecret = process.env.SDM_API_SECRET;
  if (!apiKey || !apiSecret) throw new Error('SDM_API_KEY / SDM_API_SECRET not set');
  const ts = isoMicroseconds();
  const payload = ['GET', ts, host, WS_PATH].join('\n');
  return {
    ApiKey: apiKey,
    ApiSign: urlsafeBase64Hmac(apiSecret, payload),
    ApiTimestamp: ts,
  };
}

// Generic helper: open authed connection, run callback against incoming
// messages until callback returns a non-undefined "result", then resolve.
function withSession(onMessage, { sendOnHello } = {}) {
  const host = process.env.SDM_API_HOST || DEFAULT_HOST;
  const url = `wss://${host}${WS_PATH}`;
  const headers = buildAuthHeaders(host);

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { headers });
    let settled = false;
    const finish = (fn) => { if (!settled) { settled = true; fn(); } };

    const timer = setTimeout(() => {
      finish(() => { try { ws.terminate(); } catch (_) {} reject(new Error(`SDM timed out after ${TIMEOUT_MS}ms`)); });
    }, TIMEOUT_MS);

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (msg.type === 'hello' && sendOnHello) {
        try { ws.send(JSON.stringify(sendOnHello)); } catch (_) {}
        return;
      }
      let outcome;
      try { outcome = onMessage(msg, ws); } catch (e) {
        finish(() => { clearTimeout(timer); try { ws.close(); } catch (_) {} reject(e); });
        return;
      }
      if (outcome !== undefined) {
        finish(() => { clearTimeout(timer); try { ws.close(); } catch (_) {} resolve(outcome); });
      }
    });

    ws.on('error', (err) => {
      finish(() => { clearTimeout(timer); reject(new Error(`SDM ws error: ${err.message}`)); });
    });

    ws.on('close', (code, reason) => {
      finish(() => {
        clearTimeout(timer);
        const r = reason ? reason.toString() : '';
        reject(new Error(`SDM ws closed before result (code=${code}${r ? ', reason=' + r : ''})`));
      });
    });
  });
}

async function fetchSpot(symbol) {
  if (!symbol) throw new Error('symbol required');
  const reqid = (Date.now() % 2_000_000_000) + 1;
  const subscribe = {
    reqid, type: 'subscribe', tag: 'spot',
    streams: [{ name: 'MarketDataSnapshot', Symbol: symbol }],
    ts: isoMicroseconds(),
  };

  const result = await withSession((msg, ws) => {
    if (msg.type === 'error' || (msg.reqid === reqid && msg.error)) {
      throw new Error(`SDM error: ${msg.error || msg.message || JSON.stringify(msg)}`);
    }
    if (msg.type === 'MarketDataSnapshot' && msg.reqid === reqid) {
      const row = (msg.data || [])[0];
      const bid = row && row.Bids && row.Bids[0] && Number(row.Bids[0].Price);
      const offer = row && row.Offers && row.Offers[0] && Number(row.Offers[0].Price);
      if (!Number.isFinite(bid) || !Number.isFinite(offer) || bid <= 0 || offer <= 0) {
        throw new Error(`SDM snapshot missing bid/offer for ${symbol}`);
      }
      try { ws.send(JSON.stringify({ reqid, type: 'cancel' })); } catch (_) {}
      return { price: (bid + offer) / 2, bid, ask: offer, source: 'sdm', symbol, timestamp: Date.now() };
    }
  }, { sendOnHello: subscribe });

  return result;
}

async function fetchAvailableSymbols() {
  const reqid = (Date.now() % 2_000_000_000) + 1;
  const subscribe = {
    reqid, type: 'subscribe', tag: 'symbols',
    streams: [{ name: 'Security' }],
    ts: isoMicroseconds(),
  };

  const result = await withSession((msg, ws) => {
    if (msg.type === 'error' || (msg.reqid === reqid && msg.error)) {
      throw new Error(`SDM error: ${msg.error || msg.message || JSON.stringify(msg)}`);
    }
    if (msg.type === 'Security' && msg.reqid === reqid && msg.initial) {
      const data = Array.isArray(msg.data) ? msg.data : [];
      const symbols = data
        .filter(r => r && r.Symbol && (r.UpdateAction || 'Update') !== 'Remove')
        .map(r => ({
          symbol: String(r.Symbol),
          base: r.BaseCurrency ? String(r.BaseCurrency) : null,
          quote: r.QuoteCurrency ? String(r.QuoteCurrency) : null,
          productType: r.ProductType ? String(r.ProductType) : null,
        }));
      try { ws.send(JSON.stringify({ reqid, type: 'cancel' })); } catch (_) {}
      return { symbols, timestamp: Date.now() };
    }
  }, { sendOnHello: subscribe });

  return result;
}

// Display helper: SDM uses BASE-QUOTE, our quote summary template uses BASE/QUOTE.
function symbolToDisplayPair(symbol) {
  if (!symbol) return '';
  return String(symbol).replace('-', '/');
}
function displayPairToSymbol(pair) {
  if (!pair) return '';
  return String(pair).trim().toUpperCase().replace('/', '-');
}

module.exports = {
  fetchSpot,
  fetchAvailableSymbols,
  symbolToDisplayPair,
  displayPairToSymbol,
};
