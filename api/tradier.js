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
    console.log(`Fetching from: ${url}`); // For debugging in Vercel logs
    const response = await fetch(url, { headers: HEADERS });
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Tradier API error: ${response.status} - ${response.statusText} - ${errorText}`);
    }
    const data = await response.json();
    await new Promise(resolve => setTimeout(resolve, 100)); // Simulate time.sleep(0.1)
    return data;
}

// Python's get_vix_status translated
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

    if (closes.length < 20) {
        console.warn("Not enough VIX data points.");
        return null;
    }

    const last = closes[closes.length - 1];
    const sma20 = closes.slice(-20).reduce((sum, val) => sum + val, 0) / 20;
    return parseFloat(((last / sma20) * 100).toFixed(2));
}

// Python's get_drawdown translated
async function getDrawdown(ticker) {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(endDate.getDate() - 12 * 7); // 12 weeks

    const params = {
        symbol: ticker,
        interval: 'daily',
        start: startDate.toISOString().split('T')[0],
        end: endDate.toISOString().split('T')[0]
    };
    try {
        const data = await makeTradierRequest('/markets/history', params);
        if (!data || !data.history || !data.history.day) {
            return [ticker, 'ERROR', '-', '-', 'No data'];
        }
        const closes = data.history.day.map(d => ({ price: d.close, date: d.date }))
                             .filter(d => d.price !== undefined && d.price !== null);

        if (closes.length === 0) {
            return [ticker, 'ERROR', '-', '-', 'No prices'];
        }

        const currentPrice = closes[closes.length - 1].price;
        const highPrice = Math.max(...closes.map(d => d.price));
        const drawdown = parseFloat((((highPrice - currentPrice) / highPrice) * 100).toFixed(2));

        let status;
        if (drawdown > 30) {
            status = 'Stop Calls';
        } else if (drawdown >= 20) {
            status = 'Deep ITM';
        } else if (drawdown >= 10) {
            status = 'Hybrid';
        } else {
            status = 'OTM';
        }
        return [ticker, parseFloat(currentPrice.toFixed(2)), parseFloat(highPrice.toFixed(2)), `${drawdown.toFixed(2)}%`, status];
    } catch (error) {
        console.error(`Error getting drawdown for ${ticker}:`, error);
        return [ticker, 'ERROR', '-', '-', error.message];
    }
}

// Python's get_spot translated
async function getSpot(tkr) {
    const data = await makeTradierRequest('/markets/quotes', { symbols: tkr });
    const quote = data?.quotes?.quote;
    if (Array.isArray(quote)) {
        return parseFloat(quote[0]?.last);
    } else if (quote && typeof quote === 'object') {
        return parseFloat(quote?.last);
    }
    return null;
}

// Python's get_exp translated
async function getExp(tkr) {
    const data = await makeTradierRequest('/markets/options/expirations', { symbol: tkr });
    const dates = data?.expirations?.date || [];
    const today = new Date();
    today.setHours(0, 0, 0, 0); // Normalize to start of day

    for (const d of dates) {
        const dt = new Date(d);
        dt.setHours(0, 0, 0, 0); // Normalize to start of day
        const diffDays = (dt.getTime() - today.getTime()) / (1000 * 60 * 60 * 24);
        if (diffDays >= 0 && diffDays <= 7) {
            return d;
        }
    }
    return null;
}

// Python's parse_call_row translated
function parseCallRow(c, spot, tkr) {
    const bid = parseFloat(c.bid);
    const ask = parseFloat(c.ask);
    const strike = parseFloat(c.strike);

    if (bid === 0 && ask === 0) {
        return null;
    }

    const premium = (bid + ask) / 2;
    const cashYield = (premium / spot) * 100;
    const assignedGain = ((strike + premium - spot) / spot) * 100;
    const bw = spot - premium;
    const pctMoneyness = ((strike / spot) - 1) * 100;
    const pctMStr = `${pctMoneyness.toFixed(1)}%`;

    const meets = (
        (strike > spot && cashYield >= 2.0) ||
        (strike < spot && assignedGain >= 1.5)
    ) ? 'Yes' : 'No';

    return [
        c.expiration_date, tkr, parseFloat(spot.toFixed(2)), strike,
        parseFloat(premium.toFixed(2)), pctMStr, parseFloat(bw.toFixed(2)),
        `${cashYield.toFixed(1)}%`, `${assignedGain.toFixed(1)}%`, meets
    ];
}

// Python's get_top_calls translated
async function getTopCalls(tkr, exp, spot) {
    const data = await makeTradierRequest('/markets/options/chains', { symbol: tkr, expiration: exp });
    const options = data?.options?.option || [];
    const calls = options.filter(o => o.option_type === 'call');

    const otm = calls.filter(c => parseFloat(c.strike) > spot)
                     .sort((a, b) => parseFloat(a.strike) - parseFloat(b.strike))
                     .slice(0, 3);
    const itm = calls.filter(c => parseFloat(c.strike) < spot)
                     .sort((a, b) => Math.abs(parseFloat(a.strike) - spot) - Math.abs(parseFloat(b.strike) - spot))
                     .slice(0, 3);

    const otmRows = otm.map(c => parseCallRow(c, spot, tkr)).filter(row => row !== null);
    const itmRows = itm.map(c => parseCallRow(c, spot, tkr)).filter(row => row !== null);

    return { otmRows, itmRows };
}

function addSummaryAndAverage(table) {
    if (!table || table.length === 0) {
        return table;
    }
    const cashYields = table.map(r => parseFloat(r[7].replace('%', ''))).filter(val => !isNaN(val));
    const assignedGains = table.map(r => parseFloat(r[8].replace('%', ''))).filter(val => !isNaN(val));

    if (cashYields.length === 0 || assignedGains.length === 0) {
        return table;
    }

    const avgCash = cashYields.reduce((sum, val) => sum + val, 0) / cashYields.length;
    const avgGain = assignedGains.reduce((sum, val) => sum + val, 0) / assignedGains.length;
    const summed = (avgCash + avgGain) / 2;

    // Create a separator row (adjust based on number of columns)
    const separator = Array(table[0].length).fill('---');
    const summaryRow = ['SUMMED AVG RETURN', `${summed.toFixed(1)}%`].concat(Array(table[0].length - 2).fill(''));

    return [...table, separator, summaryRow];
}

// This is the main handler for your Vercel serverless function
export default async function handler(req, res) {
    // Set CORS headers for security and to allow your HTML page to access this function
    res.setHeader('Access-Control-Allow-Origin', '*'); // Adjust to your frontend domain in production
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Handle preflight requests
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    // --- Original Python Config ---
    const TICKERS = ['BITX', 'MSTX', 'PLTR', 'SOXL', 'SPXL'];

    try {
        // --- VIX circuit-breaker (run FIRST) ------------------------
        const vixPct = await getVixStatus();
        if (vixPct === null) {
            return res.status(500).json({ error: "VIX data unavailable – aborting BW scan" });
        }

        let vixMessage;
        let haltBW = false;
        let deepITMOnly = false;

        if (vixPct >= 150) {
            vixMessage = `VIX ${vixPct.toFixed(2)}% of SMA20 → BW HALT. Park proceeds in VAULT. No new calls.`;
            haltBW = true;
        } else if (vixPct >= 125) {
            vixMessage = `VIX ${vixPct.toFixed(2)}% of SMA20 → HIGH-VOL CAUTION (deep-ITM only)`;
            deepITMOnly = true;
        } else {
            vixMessage = `VIX ${vixPct.toFixed(2)}% of SMA20 → Market conditions normal`;
        }

        if (haltBW) {
            return res.status(200).json({
                vixStatus: vixMessage,
                halt: true,
                drawdownTable: [],
                otm1: [], otm2: [], otm3: [],
                itm1: [], itm2: [], itm3: []
            });
        }

        // --- Main BW scan ------------------------------------------
        const drawdownTable = [];
        const statusMap = {};
        for (const ticker of TICKERS) {
            const dd = await getDrawdown(ticker);
            drawdownTable.push(dd);
            if (['OTM', 'Hybrid', 'Deep ITM'].includes(dd[4])) {
                statusMap[dd[0]] = dd[4];
            }
        }
        const eligibleTickers = Object.keys(statusMap);

        const otm_1 = [], otm_2 = [], otm_3 = [];
        const itm_1 = [], itm_2 = [], itm_3 = [];

        for (const tkr of eligibleTickers) {
            const spot = await getSpot(tkr);
            const exp = await getExp(tkr);

            if (spot === null || exp === null) {
                console.warn(`Skipping ${tkr}: Spot or expiration data unavailable.`);
                continue;
            }

            const { otmRows, itmRows } = await getTopCalls(tkr, exp, spot);

            // Apply caution-zone filter (only deep-ITM in caution zone)
            if (!deepITMOnly && otmRows.length > 0) { // If not in caution zone, include OTM
                otm_1.push(otmRows[0]);
                if (otmRows.length > 1) otm_2.push(otmRows[1]);
                if (otmRows.length > 2) otm_3.push(otmRows[2]);
            }

            // Always include ITM if available
            if (itmRows.length > 0) {
                itm_1.push(itmRows[0]);
                if (itmRows.length > 1) itm_2.push(itmRows[1]);
                if (itmRows.length > 2) itm_3.push(itmRows[2]);
            }
        }

        const headers = ['Expiration', 'Ticker', 'Spot', 'Strike', 'Premium', '%OTM/ITM', 'BW', 'Yield', 'Gain', 'Works'];

        // Prepare data for the frontend
        const responseData = {
            vixStatus: vixMessage,
            halt: haltBW,
            drawdownTable: drawdownTable,
            otm1: addSummaryAndAverage(otm_1),
            otm2: addSummaryAndAverage(otm_2),
            otm3: addSummaryAndAverage(otm_3),
            itm1: addSummaryAndAverage(itm_1),
            itm2: addSummaryAndAverage(itm_2),
            itm3: addSummaryAndAverage(itm_3),
            headers: headers,
            runDate: new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ' PT'
        };

        res.status(200).json(responseData);

    } catch (error) {
        console.error('API Handler Error:', error);
        res.status(500).json({ error: error.message || 'An unknown error occurred on the server.' });
    }
}
