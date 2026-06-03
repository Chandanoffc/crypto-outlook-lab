// Fallback exchange info used by api/market.js when Binance fapi/v1/exchangeInfo
// is temporarily unavailable. An empty symbols array causes market.js to re-throw
// the original Binance error rather than silently serving stale data.
module.exports = { symbols: [] };
