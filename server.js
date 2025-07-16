const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const puppeteer = require('puppeteer');

const app = express();
const PORT = 3000;
const DATA_FILE_PATH = path.join(__dirname, 'historical_data.json');

app.use(cors());

// --- Data Validation and Cleaning Function (Updated to include bonus) ---
function validateAndCleanData(draws) {
    if (!Array.isArray(draws)) {
        console.error("[Data Validation] The provided data is not an array.");
        return [];
    }
    return draws.filter((draw, index) => {
        const isValid = draw && typeof draw.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(draw.date) && 
                        Array.isArray(draw.numbers) && draw.numbers.length === 6 && 
                        draw.numbers.every(num => typeof num === 'number' && num >= 1 && num <= 49) &&
                        typeof draw.bonus === 'number' && draw.bonus >= 1 && draw.bonus <= 49;
        if (!isValid) console.warn(`[Data Validation] Invalid draw at index ${index}. Skipping.`, draw);
        return isValid;
    });
}

// --- Web Scraper Function (Updated parsing to correctly extract numbers and bonus) ---
async function fetchLatestDraws() {
    try {
        console.log("[Scraper] Attempting to fetch latest results from national-lottery.com...");
        
        const browser = await puppeteer.launch({ headless: true });
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
        await page.goto('https://www.national-lottery.com/canada-6-49/results/history', { waitUntil: 'networkidle2' });
        
        // Wait for the table to appear (basic table, no class)
        await page.waitForSelector('table', { timeout: 10000 }).catch(() => console.warn("[Scraper] Table selector not found; site structure may have changed."));
        
        const html = await page.content();
        const $ = cheerio.load(html);
        const newDraws = [];

        // Parse each row in the table, skipping header
        $('table tr').slice(1).each((i, row) => {
            const dateTd = $(row).find('td').eq(0);
            let dateString = dateTd.text().trim().replace(/^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday) /, ''); // Remove day name, e.g., "July 12 2025"
            
            const resultsTd = $(row).find('td').eq(1);
            const numbersText = resultsTd.text();
            const allNumbers = numbersText.match(/\d+/g)?.map(Number) || [];

            let numbers = [];
            let bonus = null;
            if (allNumbers.length === 7) {
                numbers = allNumbers.slice(0, 6);
                bonus = allNumbers[6];
            }

            if (dateString && numbers.length === 6 && bonus !== null) {
                const drawDate = new Date(dateString);
                if (!isNaN(drawDate.getTime())) {
                    const formattedDate = drawDate.toISOString().split('T')[0];
                    newDraws.push({ date: formattedDate, numbers, bonus });
                }
            }
        });
        
        await browser.close();
        
        console.log(`[Scraper] Found ${newDraws.length} recent draws from website.`);
        return newDraws;

    } catch (error) {
        console.error("[Scraper] CRITICAL ERROR scraping website:", error.message);
        return [];
    }
}

// --- Main API Endpoint (Updated references to include bonus) ---
app.get('/api/results', async (req, res) => {
    fs.readFile(DATA_FILE_PATH, 'utf8', async (err, fileData) => {
        if (err) {
            console.error("Error reading historical data file:", err);
            return res.status(500).json({ error: 'Failed to read historical data.' });
        }
        
        try {
            const cleanedFileData = fileData.replace(/:\s*0(\d)/g, ': $1');
            let parsedData = JSON.parse(cleanedFileData);
            let localDraws = validateAndCleanData(parsedData);

            const scrapedDraws = await fetchLatestDraws();

            if (scrapedDraws.length > 0) {
                const drawsToAdd = scrapedDraws.filter(scrapedDraw => {
                    return !localDraws.some(local => local.date === scrapedDraw.date);
                });

                if (drawsToAdd.length > 0) {
                    console.log(`[Data Sync] SUCCESS: Adding ${drawsToAdd.length} new draw(s) to the dataset.`);
                    localDraws = [...drawsToAdd, ...localDraws];
                    localDraws.sort((a, b) => new Date(b.date) - new Date(a.date));
                    fs.writeFile(DATA_FILE_PATH, JSON.stringify(localDraws, null, 2), 'utf8', (writeErr) => {
                        if (writeErr) console.error("[Data Sync] Error writing updated data to file:", writeErr);
                        else console.log("[Data Sync] Successfully updated historical_data.json with new results.");
                    });
                } else {
                    console.log("[Data Sync] Data is already up-to-date.");
                }
            } else {
                console.warn("[Data Sync] WARNING: Web scraper returned 0 results. The website structure may have changed. Please verify selectors.");
            }
            
            res.json(localDraws);

        } catch (parseErr) {
            console.error("Error parsing local JSON data:", parseErr);
            return res.status(500).json({ error: 'Failed to parse historical data.' });
        }
    });
});

// Start the server (Unchanged)
app.listen(PORT, () => {
    console.log(`✅ Lotto data server running at http://localhost:${PORT}`);
    console.log(`📊 API endpoint available at http://localhost:${PORT}/api/results`);
});