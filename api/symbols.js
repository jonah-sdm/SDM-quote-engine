// Vercel handler: GET /api/symbols
// Returns the SDM tradeable-symbol catalog so the Web App can populate the
// pair dropdown. Cached in Upstash for 1h via session.js helpers; a CDN cache
// header gives us a 5-minute edge cache on top.

const { fetchAvailableSymbols } = require('../src/telegram/spotPrice');
const { getCachedSymbols, setCachedSymbols } = require('../src/telegram/session');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    let catalog = await getCachedSymbols().catch(() => null);
    if (!catalog || !Array.isArray(catalog.symbols) || !catalog.symbols.length) {
      catalog = await fetchAvailableSymbols();
      await setCachedSymbols(catalog).catch(() => {});
    }
    res.setHeader('Cache-Control', 'public, max-age=300');
    return res.status(200).json({ symbols: catalog.symbols });
  } catch (err) {
    console.error('symbols handler error:', err && err.stack || err);
    return res.status(500).json({ error: err.message || String(err) });
  }
};
