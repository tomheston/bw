// tradier.js
// Version: Synchronized with Python v4.5.9

import axios from 'axios';
import dayjs from 'dayjs';

const BASE = 'https://api.tradier.com/v1';
const HEADERS = {
  Authorization: `Bearer ${process.env.TRADIER_TOKEN}`,
  Accept: 'application/json',
};

const TICKERS = ['BITX', 'FAS', 'MSTX', 'PLTR', 'SOXL', 'SPXL', 'TNA'];
const VIX_SYMBOL = 'VIX';
const today = dayjs();
const startDate = today.subtract(12, 'week');

function average(arr) {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

async function getVixStatus() {
  const params = {
    symbol: VIX_SYMBOL,
    interval: 'daily',
    start: today.subtract(40, 'day').format('YYYY-MM-DD'),
    end: today.format('YYYY-MM-DD'),
  };
  const { data } = await axios.get(`${BASE}/markets/history`, {
    headers: HEADERS,
    params,
  });
  const closes = data?.history?.day?.map(d => d.close).filter(Boolean) || [];
  const last = closes[closes.length - 1];
  const sma20 = average(closes.slice(-20));
  return Math.round((last / sma20) * 10000) / 100;
}

async function getDrawdown(ticker) {
  const params = {
    symbol: ticker,
    interval: 'daily',
    start: startDate.format('YYYY-MM-DD'),
    end: today.format('YYYY-MM-DD'),
  };
  const { data } = await axios.get(`${BASE}/markets/history`, {
    headers: HEADERS,
    params,
  });
  const days = data?.history?.day || [];
  const closes = days.map(d => d.close).filter(Boolean);
  const highs = days.map(d => d.high).filter(Boolean);
  const current = closes.at(-1);
  const rawHigh = Math.max(...closes);
  const sma5Highs = highs.map((_, i, arr) =>
    i >= 4 ? average(arr.slice(i - 4, i + 1)) : null
  ).filter(Boolean);
  const smoothedHigh = sma5Highs.length >= 60 ? Math.max(...sma5Highs.slice(-60)) : Math.max(...sma5Highs);
  const dd = Math.round(((smoothedHigh - current) / smoothedHigh) * 10000) / 100;
  let status = 'OTM';
  if (dd > 30) status = 'Evaluate Rotation';
  else if (dd >= 20) status = 'Deep ITM';
  else if (dd >= 10) status = 'Hybrid';
  return [ticker, current, rawHigh, smoothedHigh, `${dd.toFixed(2)}%`, status];
}

async function getMomentumOverride(ticker) {
  const { data } = await axios.get(`${BASE}/markets/history`, {
    headers: HEADERS,
    params: {
      symbol: ticker,
      interval: 'daily',
      start: today.subtract(10, 'day').format('YYYY-MM-DD'),
      end: today.format('YYYY-MM-DD'),
    },
  });
  const days = data?.history?.day || [];
  const closes = days.map(d => d.close).filter(Boolean);
  const highs = days.map(d => d.high).filter(Boolean);
  if (closes.length < 1 || highs.length < 5) return false;
  const lastClose = closes.at(-1);
  const avgHigh5 = average(highs.slice(-5));
  return lastClose > avgHigh5;
}

async function getSpot(ticker) {
  const { data } = await axios.get(`${BASE}/markets/quotes`, {
    headers: HEADERS,
    params: { symbols: ticker },
  });
  const q = data.quotes.quote;
  return parseFloat(q.last);
}

async function getExp(ticker) {
  const { data } = await axios.get(`${BASE}/markets/options/expirations`, {
    headers: HEADERS,
    params: { symbol: ticker },
  });
  const dates = data.expirations.date;
  const next = dates.find(d => dayjs(d).diff(today, 'day') <= 7);
  return next;
}

function parseCall(c, spot, tkr) {
  const bid = parseFloat(c.bid);
  const ask = parseFloat(c.ask);
  const strike = parseFloat(c.strike);
  const premium = (bid + ask) / 2;
  const cashYield = premium / spot * 100;
  const assignedGain = ((strike + premium - spot) / spot) * 100;
  const pctMoneyness = ((strike / spot - 1) * 100).toFixed(1);
  const works = (strike > spot && cashYield >= 2.0) || (strike < spot && assignedGain >= 1.5) ? 'Yes' : 'No';
  return [c.expiration_date, tkr, +spot.toFixed(2), strike, +premium.toFixed(2), `${pctMoneyness}%`, +(spot - premium).toFixed(2), `${cashYield.toFixed(1)}%`, `${assignedGain.toFixed(1)}%`, works];
}

async function getOptions(tkr, exp, spot) {
  const { data } = await axios.get(`${BASE}/markets/options/chains`, {
    headers: HEADERS,
    params: { symbol: tkr, expiration: exp },
  });
  const calls = (data.options.option || []).filter(o => o.option_type === 'call');
  const otm = calls.filter(c => parseFloat(c.strike) > spot).slice(0, 3).map(c => parseCall(c, spot, tkr));
  const itm = calls.filter(c => parseFloat(c.strike) < spot).sort((a, b) => Math.abs(parseFloat(a.strike) - spot) - Math.abs(parseFloat(b.strike) - spot)).slice(0, 3).map(c => parseCall(c, spot, tkr));
  return { otm, itm };
}

export async function run() {
  const vixPct = await getVixStatus();
  console.log(`Drawdown Check\nRun Date (PT): ${dayjs().format('MM/DD/YYYY, hh:mm:ss A')} PT\n`);
  console.log(`VIX ${vixPct}% of SMA20 → ${vixPct >= 150 ? 'BW HALT. No new calls.' : vixPct >= 125 ? 'HIGH-VOL CAUTION (deep‑ITM only)' : 'Market conditions normal'}\n`);

  const drawdowns = await Promise.all(TICKERS.map(getDrawdown));
  drawdowns.forEach(dd => console.log(`${dd.join('\t')}`));

  const eligible = [];
  for (let dd of drawdowns) {
    const [tkr, , , , , status] = dd;
    if (status === 'Evaluate Rotation') {
      const momentum = await getMomentumOverride(tkr);
      if (momentum && vixPct < 140) eligible.push(tkr);
    } else {
      eligible.push(tkr);
    }
  }

  return eligible;
}
