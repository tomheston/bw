document.addEventListener('DOMContentLoaded', async () => {
    const loadingDiv = document.getElementById('loading');
    const errorDiv = document.getElementById('error');
    const resultsDiv = document.getElementById('results');

    try {
        // Make a request to your Vercel serverless function
        // In development, this might be http://localhost:3000/api/tradier
        // In production, Vercel handles the path automatically
        const response = await fetch('/api/tradier'); // This path maps to your api/tradier.js function

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || `HTTP error! Status: ${response.status}`);
        }

        const data = await response.json();

        loadingDiv.style.display = 'none'; // Hide loading message

        if (data.halt) {
            resultsDiv.innerHTML = `<p class="error">${data.vixStatus}</p>`;
            return;
        }

        let htmlContent = `
            <p><strong>${data.vixStatus}</strong></p>
            <p><strong>Run Date (PT):</strong> ${data.runDate}</p>
            <p><strong>Capital allocation:</strong> equal weight</p>
        `;

        // Function to generate tables
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

                if (isSeparatorRow) {
                    tableHtml += `<tr class="separator-row"><td colspan="${headers.length}"></td></tr>`;
                } else if (isSummaryRow) {
                    tableHtml += `<tr class="summary-row">`;
                    tableHtml += `<td>${row[0]}</td>`; // "SUMMED AVG RETURN"
                    tableHtml += `<td colspan="<span class="math-inline">\{headers\.length \- 1\}"\></span>{row[1]}</td>`; // The average value
                    tableHtml += `</tr>`;
                } else {
                    tableHtml += `<tr>`;
                    row.forEach(cell => {
                        tableHtml += `<td>${cell}</td>`;
                    });
                    tableHtml += `</tr>`;
                }
            });
            tableHtml += `</tbody></table>`;
            return tableHtml;
        }

        // Add Drawdown Table
        htmlContent += createTableHtml(
            "== BW Ticker Drawdown Check ==",
            data.drawdownTable,
            ["Ticker", "Current", "12W High", "Drawdown %", "Status"]
        );

        // Add OTM and ITM Tables
        htmlContent += createTableHtml("== Closest OTM ==", data.otm1, data.headers);
        htmlContent += createTableHtml("== 2nd Closest OTM ==", data.otm2, data.headers);
        htmlContent += createTableHtml("== 3rd Closest OTM ==", data.otm3, data.headers);
        htmlContent += createTableHtml("== Closest ITM ==", data.itm1, data.headers);
        htmlContent += createTableHtml("== 2nd Closest ITM ==", data.itm2, data.headers);
        htmlContent += createTableHtml("== 3rd Closest ITM ==", data.itm3, data.headers);

        resultsDiv.innerHTML = htmlContent;

    } catch (error) {
        loadingDiv.style.display = 'none';
        errorDiv.style.display = 'block';
        errorDiv.textContent = `Error fetching data: ${error.message}. Please check console for details.`;
        console.error('Frontend Error:', error);
    }
});
