document.addEventListener('DOMContentLoaded', async () => {
    const loadingDiv = document.getElementById('loading');
    const errorDiv = document.getElementById('error');
    const resultsDiv = document.getElementById('results');

    // Generic function to generate tables
    function createTableHtml(title, tableData, headers) {
        if (!tableData || tableData.length === 0) {
            return `<h2>${title}</h2><p>No data available.</p>`;
        }

        let tableHtml = `<h2>${title}</h2><table><thead><tr>`;
        headers.forEach(header => {
            tableHtml += `<th>${header}</th>`;
        });
        tableHtml += `</tr></thead><tbody>`;

        tableData.forEach(row => {
            const isSummaryRow = row[0] === 'SUMMED AVG RETURN';
            const isSeparatorRow = row[0] && row[0].startsWith('---');
            const shouldHighlight = !isSummaryRow && !isSeparatorRow && row[row.length - 1] === 'Yes';
            const rowClass = shouldHighlight ? 'works-yes-row' : '';

            if (isSeparatorRow) {
                tableHtml += `<tr class="separator-row"><td colspan="${headers.length}"></td></tr>`;
            } else if (isSummaryRow) {
                tableHtml += `<tr class="summary-row"><td>${row[0]}</td><td colspan="${headers.length - 1}">${row[1]}</td></tr>`;
            } else {
                tableHtml += `<tr class="${rowClass}">`;
                row.forEach(cell => {
                    tableHtml += `<td>${cell}</td>`;
                });
                tableHtml += `</tr>`;
            }
        });

        tableHtml += `</tbody></table>`;
        return tableHtml;
    }

    try {
        const response = await fetch('/api/tradier');
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || `HTTP error! Status: ${response.status}`);
        }

        const data = await response.json();
        loadingDiv.style.display = 'none';

        if (data.halt) {
            resultsDiv.innerHTML = `<p class="error">${data.vixStatus}</p>`;
            return;
        }

        // Build Run Info
        let htmlContent = `
            <p><strong>Run Date (PT):</strong> ${data.runDate}</p>
            <p><strong>${data.vixStatus}</strong></p>
        `;

        // Transform drawdownTable to include smoothed high if needed
        const transformedDrawdown = data.drawdownTable.map(row => {
            // row: [Ticker, Current, RawHigh, Drawdown%, Status]
            const [tkr, currStr, rawHighStr, drawdownStr, status] = row;
            const curr = parseFloat(currStr);
            const ddPct = parseFloat(drawdownStr.replace('%', '')) / 100;
            // Calculate smoothed high = curr / (1 - dd)
            const smoothed = (curr / (1 - ddPct)).toFixed(2);
            return [tkr, currStr, rawHighStr, smoothed, drawdownStr, status];
        });

        // Drawdown Table with RawHigh, Smoothed High, Drawdown, Status
        htmlContent += createTableHtml(
            'BW Ticker Drawdown Check',
            transformedDrawdown,
            ['Ticker', 'Current', 'RawHigh', '12W SMA-High', 'Drawdown%', 'Status']
        );

        // Option tables headers
        const optHeaders = ['Expiration','Ticker','Spot','Strike','Premium','%OTM/ITM','BW','Yield','Gain','Works'];
        htmlContent += createTableHtml('Closest OTM', data.otm1, optHeaders);
        htmlContent += createTableHtml('2nd Closest OTM', data.otm2, optHeaders);
        htmlContent += createTableHtml('3rd Closest OTM', data.otm3, optHeaders);
        htmlContent += createTableHtml('Closest ITM', data.itm1, optHeaders);
        htmlContent += createTableHtml('2nd Closest ITM', data.itm2, optHeaders);
        htmlContent += createTableHtml('3rd Closest ITM', data.itm3, optHeaders);

        resultsDiv.innerHTML = htmlContent;

    } catch (error) {
        loadingDiv.style.display = 'none';
        errorDiv.style.display = 'block';
        errorDiv.textContent = `Error fetching data: ${error.message}. Please check console for details.`;
        console.error('Frontend Error:', error);
    }
});
