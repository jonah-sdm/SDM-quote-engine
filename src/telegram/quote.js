// Quote math + summary formatting for the Telegram /quote bot.
// Pair convention: "BASE/QUOTE" — rate is the price of 1 BASE expressed in QUOTE.
// Buy  = client buys BASE, deposits QUOTE  → dealtRate worsens upward, purchased = deposit / dealtRate
// Sell = client sells BASE, deposits BASE  → dealtRate worsens downward, purchased = deposit * dealtRate

function parsePair(pair) {
  const [base, quote] = String(pair).split('/').map(s => s.trim().toUpperCase());
  if (!base || !quote) throw new Error(`Bad pair: ${pair}`);
  return { base, quote };
}

function computeQuote({ side, pair, deposit, fee, spot }) {
  const { base, quote } = parsePair(pair);
  const dep = Number(deposit);
  const f = Number(fee);
  const sp = Number(spot);
  if (!Number.isFinite(dep) || dep <= 0) throw new Error('deposit must be a positive number');
  if (!Number.isFinite(f)) throw new Error('fee must be a number');
  if (!Number.isFinite(sp) || sp <= 0) throw new Error('spot must be a positive number');

  const dealtRate = side === 'sell' ? sp * (1 - f / 100) : sp * (1 + f / 100);
  if (dealtRate <= 0) throw new Error('dealt rate is non-positive — check fee');

  let depositCcy, purchasedCcy, ccyPurchased;
  if (side === 'buy') {
    depositCcy = quote;
    purchasedCcy = base;
    ccyPurchased = dep / dealtRate;
  } else {
    depositCcy = base;
    purchasedCcy = quote;
    ccyPurchased = dep * dealtRate;
  }

  return { dealtRate, ccyPurchased, depositCcy, purchasedCcy, baseCcy: base, quoteCcy: quote };
}

function formatAmount(n) {
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatRate(n) {
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: 5, maximumFractionDigits: 5 });
}

function formatDate(d = new Date()) {
  const day = String(d.getDate()).padStart(2, '0');
  const month = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()];
  const year = String(d.getFullYear()).slice(-2);
  return `${day}-${month}-${year}`;
}

// Telegram MarkdownV1 — single asterisks for bold.
function formatQuoteSummary({ client, pair, side, deposit, fee, spot, date }) {
  const { dealtRate, ccyPurchased, depositCcy, purchasedCcy } = computeQuote({ side, pair, deposit, fee, spot });
  const lines = [
    '*Trade Summary*',
    `Client: ${client}`,
    `Date: ${formatDate(date instanceof Date ? date : (date ? new Date(date) : new Date()))}`,
    `CCY Deposited: ${formatAmount(deposit)} ${depositCcy}`,
    `Spot Price: ${formatRate(spot)} ${pair}`,
    `Dealt Rate: ${formatRate(dealtRate)} ${pair}`,
    `CCY Purchased: ${formatAmount(ccyPurchased)} ${purchasedCcy}`,
  ];
  return lines.join('\n');
}

module.exports = { computeQuote, formatQuoteSummary, formatAmount, formatRate, formatDate, parsePair };
