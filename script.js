document.addEventListener('DOMContentLoaded', async () => {
    const loadingDiv = document.getElementById('loading');
    const errorDiv = document.getElementById('error');
    const resultsDiv = document.getElementById('results');

    // Function to generate tables - DEFINED HERE FOR PROPER SCOPE.
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

            // Highlight rows where the "Works" column (last index) is 'Yes'
            const shouldHighlight = !isSummaryRow && !isSeparatorRow && row[row.length - 1] === 'Yes';
            const rowClass = shouldHighlight ? 'works-yes-row' : '';

            if (isSeparatorRow) {
                tableHtml += `<tr class="separator-row"><td colspan="${headers.length}"></td></tr>`;
            } else if (isSummaryRow) {
                tableHtml += `<tr class="summary-row">`;
                tableHtml += `<td>${row[0]}</td>`;
                tableHtml += `<td colspan="${headers.length - 1}">${row[1]}</td>`;
                tableHtml += `</tr>`;
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

        let htmlContent = `
            <p><strong>Run Date (PT):</strong> ${data.runDate}</p>
            <p><strong>${data.vixStatus}</strong></p>
        `;

        // Drawdown Table (updated to match Python fields)
        htmlContent += createTableHtml(
            "BW Ticker Drawdown Check",
            data.drawdownTable,
            ["Ticker", "Current", "RawHigh", "12W SMA-High", "Drawdown%", "Status"]
        );

        // OTM and ITM Tables
        htmlContent += createTableHtml("Closest OTM", data.otm1, data.headers);
        htmlContent += createTableHtml("2nd Closest OTM", data.otm2, data.headers);
        htmlContent += createTableHtml("3rd Closest OTM", data.otm3, data.headers);
        htmlContent += createTableHtml("Closest ITM", data.itm1, data.headers);
        htmlContent += createTableHtml("2nd Closest ITM", data.itm2, data.headers);
        htmlContent += createTableHtml("3rd Closest ITM", data.itm3, data.headers);

        resultsDiv.innerHTML = htmlContent;

    } catch (error) {
        loadingDiv.style.display = 'none';
        errorDiv.style.display = 'block';
        errorDiv.textContent = `Error fetching data: ${error.message}. Please check console for details.`;
        console.error('Frontend Error:', error);
    }
});
