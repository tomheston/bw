import { URLSearchParams } from 'url'; // Node.js built-in module for URL parameters

// --- Config (on the serverless function side) ------------------------
const TRADIER_TOKEN = process.env.TRADIER_TOKEN; // Accessed from Vercel's env variables
const BASE_URL = 'https://api.tradier.com/v1';
const HEADERS = {
    'Authorization': `Bearer ${TRADIER_TOKEN}`,
    'Accept': 'application/json'
};

// Helper to make API requests
async function makeTradierRequest(endpoint, params) {
    if (!TRADIER_TOKEN) {
        throw new Error("Tradier token is not configured on the server.");
    }
    const url = `${BASE_URL}${endpoint}?${new URLSearchParams(params).toString()}`;
    const response = await fetch(url, { headers: HEADERS });
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Tradier API error: ${response.status} - ${response.statusText} - ${errorText}`);
    }
    const data = await response.json();
    await new Promise(resolve => setTimeout(resolve, 100));
    return data;
}

async function getVixStatus() {
    const endDate = new Date();
    const startDateVix = new Date();
    startDateVix.setDate(endDate.getDate() - 40);

    const params = {
        symbol: 'VIX',
        interval: 'daily',
        start: startDateVix.toISOString().split('T')[0],
        end: endDate.toISOString().split('T')[0]
    };
    const data = await makeTradierRequest('/markets/history', params);
    const days = data?.history?.day || [];
    const closes = days.map(d => d?.close).filter(c => c !== undefined && c !== null);

    if (closes.length < 20) return null;

    const last = closes[closes.length - 1];
    const sma20 = closes.slice(-20).reduce((sum, val) => sum + val, 0) / 20;
    return parseFloat(((last / sma20) * 100).toFixed(2));
}

async function getDrawdown(ticker) {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(endDate.getDate() - 84);

    const params = {
        symbol: ticker,
        interval: 'daily',
        start: startDate.toISOString().split('T')[0],
        end: endDate.toISOString().split('T')[0]
    };

    try {
        const data = await makeTradierRequest('/markets/history', params);
        const days = data?.history?.day || [];

        const closes = days.map(d => d?.close).filter(Boolean);
        const highs = days.map(d => d?.high).filter(Boolean);
        if (closes.length === 0 || highs.length < 5) return [ticker, 'ERROR', '-', '-', '-', 'No data'];

        const current = closes[closes.length - 1];
        const rawHigh = Math.max(...closes);

        const sma5Highs = [];
        for (let i = 4; i < highs.length; i++) {
            const avg = (highs[i - 4] + highs[i - 3] + highs[i - 2] + highs[i - 1] + highs[i]) / 5;
            sma5Highs.push(avg);
        }
        const smoothedHigh = sma5Highs.length >= 60 ? Math.max(...sma5Highs.slice(-60)) : Math.max(...sma5Highs);

        const drawdown = ((smoothedHigh - current) / smoothedHigh) * 100;
        let status = 'OTM';
        if (drawdown > 30) status = 'Evaluate Rotation';
        else if (drawdown >= 20) status = 'Deep ITM';
        else if (drawdown >= 10) status = 'Hybrid';

        return [ticker, parseFloat(current.toFixed(2)), parseFloat(rawHigh.toFixed(2)), parseFloat(smoothedHigh.toFixed(2)), `${drawdown.toFixed(2)}%`, status];
    } catch (e) {
        return [ticker, 'ERROR', '-', '-', '-', e.message];
    }
}

async function getMomentumOverride(ticker) {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(endDate.getDate() - 10);

    const params = {
        symbol: ticker,
        interval: 'daily',
        start: startDate.toISOString().split('T')[0],
        end: endDate.toISOString().split('T')[0]
    };

    const data = await makeTradierRequest('/markets/history', params);
    const days = data?.history?.day || [];

    const closes = days.map(d => d.close).filter(Boolean);
    const highs = days.map(d => d.high).filter(Boolean);
    if (closes.length < 1 || highs.length < 5) return false;
    const lastClose = closes[closes.length - 1];
    const avgHigh5 = highs.slice(-5).reduce((sum, h) => sum + h, 0) / 5;
    return lastClose > avgHigh5;
}

function parseCallRow(c, spot, tkr) {
    const bid = parseFloat(c.bid);
    const ask = parseFloat(c.ask);
    const strike = parseFloat(c.strike);
    if (bid === 0 && ask === 0) return null;

    const premium = (bid + ask) / 2;
    const cashYield = (premium / spot) * 100;
    const assignedGain = ((strike + premium - spot) / spot) * 100;
    const pctM = ((strike / spot - 1) * 100).toFixed(1) + '%';
    const bw = (spot - premium).toFixed(2);

    const works = ((strike > spot && cashYield >= 2) || (strike < spot && assignedGain >= 1.5)) ? 'Yes' : 'No';

    return [c.expiration_date, tkr, parseFloat(spot.toFixed(2)), strike, parseFloat(premium.toFixed(2)), pctM, parseFloat(bw), `${cashYield.toFixed(1)}%`, `${assignedGain.toFixed(1)}%`, works];
}

async function getTopCalls(tkr, exp, spot) {
    const data = await makeTradierRequest('/markets/options/chains', { symbol: tkr, expiration: exp });
    const calls = data?.options?.option?.filter(o => o.option_type === 'call') || [];

    const otm = calls.filter(c => parseFloat(c.strike) > spot).sort((a, b) => a.strike - b.strike).slice(0, 3);
    const itm = calls.filter(c => parseFloat(c.strike) < spot).sort((a, b) => Math.abs(a.strike - spot) - Math.abs(b.strike - spot)).slice(0, 3);

    return {
        otmRows: otm.map(c => parseCallRow(c, spot, tkr)).filter(Boolean),
        itmRows: itm.map(c => parseCallRow(c, spot, tkr)).filter(Boolean)
    };
}

function summarize(rows) {
    if (!rows.length) return rows;
    const yields = rows.map(r => parseFloat(r[7])).filter(x => !isNaN(x));
    const gains = rows.map(r => parseFloat(r[8])).filter(x => !isNaN(x));
    const avg = ((yields.reduce((a, b) => a + b, 0) + gains.reduce((a, b) => a + b, 0)) / (yields.length + gains.length)).toFixed(1);
    return [...rows, Array(rows[0].length).fill('---'), ['SUMMED AVG RETURN', `${avg}%`, ...Array(rows[0].length - 2).fill('')]];
}

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method Not Allowed' });

    const TICKERS = ['BITX', 'FAS', 'MSTX', 'PLTR', 'SMCI', 'SOXL', 'SPXL', 'TNA', 'TSLA'];

    try {
        const vixPct = await getVixStatus();
        if (vixPct === null) return res.status(500).json({ error: "VIX data unavailable – aborting BW scan" });

        let vixMessage = '';
        let haltBW = false, deepOnly = false;
        if (vixPct >= 150) { vixMessage = `VIX ${vixPct}% of SMA20 → BW HALT`; haltBW = true; }
        else if (vixPct >= 125) { vixMessage = `VIX ${vixPct}% of SMA20 → HIGH-VOL CAUTION`; deepOnly = true; }
        else { vixMessage = `VIX ${vixPct}% of SMA20 → Market conditions normal`; }

        if (haltBW) return res.status(200).json({ vixStatus: vixMessage, halt: true, drawdownTable: [], otm1: [], otm2: [], otm3: [], itm1: [], itm2: [], itm3: [] });

        const drawdownTable = [], statusMap = {};
        for (const tkr of TICKERS) {
            const row = await getDrawdown(tkr);
            drawdownTable.push(row);
            if (["OTM", "Hybrid", "Deep ITM"].includes(row[5])) statusMap[tkr] = row[5];
            else if (row[5] === "Evaluate Rotation") {
                const override = await getMomentumOverride(tkr);
                if (override && vixPct < 140) statusMap[tkr] = row[5];
            }
        }

        const otm1 = [], otm2 = [], otm3 = [], itm1 = [], itm2 = [], itm3 = [];
        for (const tkr of Object.keys(statusMap)) {
            const spot = await makeTradierRequest('/markets/quotes', { symbols: tkr }).then(r => parseFloat(r.quotes.quote.last));
            const exp = await makeTradierRequest('/markets/options/expirations', { symbol: tkr }).then(r => r.expirations.date.find(d => (new Date(d) - new Date()) / (1000 * 60 * 60 * 24) <= 7));
            if (!spot || !exp) continue;
            const { otmRows, itmRows } = await getTopCalls(tkr, exp, spot);
            if (!deepOnly && otmRows.length) { otm1.push(otmRows[0]); if (otmRows[1]) otm2.push(otmRows[1]); if (otmRows[2]) otm3.push(otmRows[2]); }
            if (itmRows.length) { itm1.push(itmRows[0]); if (itmRows[1]) itm2.push(itmRows[1]); if (itmRows[2]) itm3.push(itmRows[2]); }
        }

        res.status(200).json({
            vixStatus: vixMessage,
            halt: false,
            drawdownTable,
            otm1: summarize(otm1),
            otm2: summarize(otm2),
            otm3: summarize(otm3),
            itm1: summarize(itm1),
            itm2: summarize(itm2),
            itm3: summarize(itm3),
            headers: ['Expiration', 'Ticker', 'Spot', 'Strike', 'Premium', '%OTM/ITM', 'BW', 'Yield', 'Gain', 'Works'],
            runDate: new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }) + ' PT'
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}
