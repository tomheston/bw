// tradier.js
// Version: Synchronized with Python v4.5.9 — includes Evaluate Rotation override logic

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
  try {
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
    const last = closes.at(-1);
    const sma20 = average(closes.slice(-20));
    return Math.round((last / sma20) * 10000) / 100;
  } catch (err) {
    console.error('Error fetching VIX:', err.message);
    return null;
  }
}

async function getDrawdown(ticker) {
  try {
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
  } catch (err) {
    console.error(`Drawdown error for ${ticker}:`, err.message);
    return [ticker, 'ERROR', '-', '-', '-', 'Fetch Failed'];
  }
}

async function getMomentumOverride(ticker) {
  try {
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
  } catch (err) {
    console.error(`Momentum override failed for ${ticker}:`, err.message);
    return false;
  }
}

export async function run() {
  const vixPct = await getVixStatus();
  if (!vixPct) {
    console.error('Aborting due to VIX fetch failure');
    return;
  }

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
    } else if (status !== 'Fetch Failed') {
      eligible.push(tkr);
    }
  }

  return { vixPct, drawdowns, eligible };
}
