// Live spot price via SDM's WebSocket market data API.
//
// Flow per /quote: connect → auth (HMAC-signed headers) → wait for `hello` →
// subscribe to MarketDataSnapshot for the requested symbol → take the first
// snapshot → mid = (bestBid + bestOffer) / 2 → cancel + close.
//
// Auth is HMAC-SHA256 over "GET\n<ApiTimestamp>\n<host>\n<path>", base64 url-safe,
// passed as the `ApiSign` header (per SDM API 2.0 doc, Authentication section).
//
// Env: SDM_API_KEY, SDM_API_SECRET, SDM_API_HOST (default trade.sdm.co — set to
// trade-sandbox.sdm.co for sandbox).

const crypto = require('crypto');
const WebSocket = require('ws');

const DEFAULT_HOST = 'trade.sdm.co';
const WS_PATH = '/ws/v1';
const TIMEOUT_MS = 10_000;

// Display pair (BASE/QUOTE) → SDM symbol (BASE-QUOTE).
// Extend this map as more pairs are needed.
const PAIR_TO_SDM = {
  'USDT/GBP': 'USDT-GBP',
  'USDT/USD': 'USDT-USD',
  'USDT/EUR': 'USDT-EUR',
  'BTC/USD':  'BTC-USD',
  'ETH/USD':  'ETH-USD',
};

const SUPPORTED_PAIRS = Object.keys(PAIR_TO_SDM);

// ISO-8601 with microsecond resolution, e.g. 2026-04-28T20:30:45.123000Z.
// JS Date gives ms precision (.SSSZ); pad to .SSS000Z to match SDM's format.
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

async function fetchSpot(pair) {
  const symbol = PAIR_TO_SDM[pair];
  if (!symbol) throw new Error(`Unsupported pair: ${pair}`);

  const host = process.env.SDM_API_HOST || DEFAULT_HOST;
  const url = `wss://${host}${WS_PATH}`;
  const headers = buildAuthHeaders(host);
  const reqid = (Date.now() % 2_000_000_000) + 1; // non-zero, fits in int

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { headers });
    let settled = false;
    const finish = (fn) => { if (!settled) { settled = true; fn(); } };

    const timer = setTimeout(() => {
      finish(() => {
        try { ws.terminate(); } catch (_) {}
        reject(new Error(`SDM spot fetch timed out after ${TIMEOUT_MS}ms`));
      });
    }, TIMEOUT_MS);

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }

      if (msg.type === 'hello') {
        ws.send(JSON.stringify({
          reqid,
          type: 'subscribe',
          tag: 'spot',
          streams: [{ name: 'MarketDataSnapshot', Symbol: symbol }],
          ts: isoMicroseconds(),
        }));
        return;
      }

      if (msg.type === 'MarketDataSnapshot' && msg.reqid === reqid) {
        const row = (msg.data || [])[0];
        const bid = row && row.Bids && row.Bids[0] && Number(row.Bids[0].Price);
        const offer = row && row.Offers && row.Offers[0] && Number(row.Offers[0].Price);
        if (!Number.isFinite(bid) || !Number.isFinite(offer) || bid <= 0 || offer <= 0) {
          finish(() => {
            clearTimeout(timer);
            try { ws.close(); } catch (_) {}
            reject(new Error(`SDM snapshot missing bid/offer for ${symbol}`));
          });
          return;
        }
        const mid = (bid + offer) / 2;
        finish(() => {
          clearTimeout(timer);
          try { ws.send(JSON.stringify({ reqid, type: 'cancel' })); } catch (_) {}
          try { ws.close(); } catch (_) {}
          resolve({ price: mid, bid, ask: offer, source: 'sdm', symbol, timestamp: Date.now() });
        });
        return;
      }

      // Surface error responses from SDM keyed to this request
      if (msg.type === 'error' || (msg.reqid === reqid && msg.error)) {
        finish(() => {
          clearTimeout(timer);
          try { ws.close(); } catch (_) {}
          reject(new Error(`SDM error: ${msg.error || msg.message || JSON.stringify(msg)}`));
        });
      }
    });

    ws.on('error', (err) => {
      finish(() => {
        clearTimeout(timer);
        reject(new Error(`SDM ws error: ${err.message}`));
      });
    });

    ws.on('close', (code, reason) => {
      finish(() => {
        clearTimeout(timer);
        const r = reason ? reason.toString() : '';
        reject(new Error(`SDM ws closed before snapshot (code=${code}${r ? ', reason=' + r : ''})`));
      });
    });
  });
}

module.exports = { fetchSpot, SUPPORTED_PAIRS, PAIR_TO_SDM };
