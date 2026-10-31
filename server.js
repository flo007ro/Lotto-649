const express = require('express');
const cors = require('cors');
const fs = require('node:fs/promises');
const path = require('node:path');
const { normalizeDraw } = require('./prize-engine');

// Local development reads the same published files as static hosting. No scraping.
function createApp({
    dataPath = path.join(__dirname, 'historical_data.json'),
    statusPath = path.join(__dirname, 'data-status.json')
} = {}) {
    const app = express();
    app.use(cors());
    app.get('/api/results', async (_req, res) => {
        try {
            const data = JSON.parse(await fs.readFile(dataPath, 'utf8'));
            if (!Array.isArray(data)) throw new Error('Expected an array.');
            const draws = data.map(normalizeDraw);
            if (draws.some(draw => !draw)) throw new Error('Invalid draw in snapshot.');
            res.json(draws);
        } catch {
            res.status(500).json({ error: 'Failed to read a valid historical snapshot.' });
        }
    });
    app.get('/api/data-status', async (_req, res) => {
        try {
            const status = JSON.parse(await fs.readFile(statusPath, 'utf8'));
            if (!status || typeof status !== 'object' || Array.isArray(status)) throw new Error('Invalid status.');
            res.json(status);
        } catch {
            res.status(500).json({ error: 'Failed to read import status.' });
        }
    });
    return app;
}

if (require.main === module) {
    const port = process.env.PORT || 3000;
    createApp().listen(port, () => console.log(`Lotto local data API: http://localhost:${port}/api/results`));
}

module.exports = { createApp };
