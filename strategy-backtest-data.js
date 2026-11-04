// Historical strategy comparison runner
// Uses only closed Binance candles and records baseline vs filtered metrics.
// Detailed implementation is intentionally isolated from the live paper trader.
'use strict';
const https = require('https');
const fs = require('fs');
function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {headers:{'user-agent':'VCrypto-backtest'}}, response => {
      let body = '';
      response.on('data', chunk => body += chunk);
      response.on('end', () => {
        if (response.statusCode !== 200) return reject(new Error('HTTP ' + response.statusCode));
        try { resolve(JSON.parse(body)); } catch (error) { reject(error); }
      });
    }).on('error', reject);
  });
}
async function main() {
  const symbols = ['ETH','BNB','SOL','XRP','ADA','DOGE','AVAX','LINK','DOT','LTC'];
  const results = {createdAt:new Date().toISOString(), note:'Raw closed-candle data collection only; no performance claims.', intervals:{}};
  for (const interval of ['1h','4h']) {
    const rows = [];
    for (const symbol of symbols) {
      const url = 'https://data-api.binance.vision/api/v3/klines?symbol=' + symbol + 'USDT&interval=' + interval + '&limit=1000';
      try {
        const raw = await get(url);
        rows.push({symbol, interval, candles:raw.slice(0,-1).map(k=>({t:+k[0],o:+k[1],h:+k[2],l:+k[3],c:+k[4],v:+k[5]}))});
      } catch (error) { rows.push({symbol, interval, error:error.message}); }
    }
    results.intervals[interval] = rows;
  }
  fs.writeFileSync('strategy-backtest-data.json', JSON.stringify(results));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
