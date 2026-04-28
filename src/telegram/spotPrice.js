// Live spot price lookup via Kraken's public ticker. No API key required.
// Kraken uses its own asset codes (e.g. ZGBP, ZUSD, USDT). For USDT-quoted-in-fiat
// pairs we use Kraken's "USDTGBP" / "USDTUSD" / "USDTEUR" altnames.

const KRAKEN_TICKER = 'https://api.kraken.com/0/public/Ticker';

const PAIR_TO_KRAKEN = {
  'USDT/GBP': 'USDTGBP',
  'USDT/USD': 'USDTUSD',
  'USDT/EUR': 'USDTEUR',
};

const SUPPORTED_PAIRS = Object.keys(PAIR_TO_KRAKEN);

async function fetchSpot(pair) {
  const symbol = PAIR_TO_KRAKEN[pair];
  if (!symbol) throw new Error(`Unsupported pair: ${pair}`);

  const url = `${KRAKEN_TICKER}?pair=${symbol}`;
  const r = await fetch(url, { headers: { 'accept': 'application/json' } });
  if (!r.ok) throw new Error(`Kraken HTTP ${r.status}`);
  const data = await r.json();
  if (data.error && data.error.length) throw new Error(`Kraken: ${data.error.join('; ')}`);

  // Kraken returns { result: { <PairKey>: { c: [last, vol], a: [ask, ...], b: [bid, ...] } } }
  const result = data.result || {};
  const keys = Object.keys(result);
  if (!keys.length) throw new Error('Kraken returned no result');
  const ticker = result[keys[0]];
  const lastStr = ticker && ticker.c && ticker.c[0];
  const price = Number(lastStr);
  if (!Number.isFinite(price) || price <= 0) throw new Error(`Bad price from Kraken: ${lastStr}`);

  return { price, source: 'kraken', timestamp: Date.now() };
}

module.exports = { fetchSpot, SUPPORTED_PAIRS, PAIR_TO_KRAKEN };
