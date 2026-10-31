'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const cheerio = require('cheerio');
const { normalizeDraw } = require('../prize-engine');

// A single result-page allowlist: never follow redirects or load assets.
const SOURCE_URL = 'https://loteries.lotoquebec.com/en/lotteries/lotto-6-49-resultats';
const DATA_PATH = path.join(__dirname, '../historical_data.json');
const STATUS_PATH = path.join(__dirname, '../data-status.json');
const CATEGORIES = ['6/6', '5/6+B', '5/6', '4/6', '3/6', '2/6+B', '2/6'];

function parseOfficialResult(html, sourceUrl) {
    if (sourceUrl !== SOURCE_URL || typeof html !== 'string') return null;
    const $ = cheerio.load(html);
    const result = $('.lqZoneResultatsDetailles.lotto-6-49');
    if (result.length !== 1) return null;
    const dates = result.find('#dateAffichee');
    const product = result.find('.lqZoneProduit.principal.lotto-6-49');
    const classic = product.find('.numeros.tirageClassique');
    if (dates.length !== 1 || product.length !== 1 || classic.length !== 1) return null;
    const numberNodes = classic.find('.num:not(.complementaire)');
    const bonusNodes = classic.find('.num.complementaire');
    if (numberNodes.length !== 6 || bonusNodes.length !== 1) return null;
    const parseNumber = node => /^\d{1,2}$/.test($(node).text().trim()) ? Number($(node).text().trim()) : NaN;
    const numbers = numberNodes.toArray().map(parseNumber);
    const bonus = parseNumber(bonusNodes[0]);

    // Scope to the Classic heading, never another game's similar categories.
    const details = product.find('.lqZoneDetailsStructureLots').filter((_, element) =>
        $(element).children('h4.titre').text().trim() === 'Detailed results for the Classic draw');
    if (details.length !== 1 || details.find('table').length !== 1) return null;
    const rows = details.find('tr.lqZoneCategorieLot').filter((_, element) => $(element).find('td').length > 0);
    if (rows.length !== CATEGORIES.length) return null;
    const payouts = {};
    for (const row of rows.toArray()) {
        const cells = $(row).children('td');
        if (cells.length !== 3 || $(row).find('td.description').length !== 1 || $(row).find('td.valeurLot').length !== 1) return null;
        const category = $(row).find('td.description').text().trim();
        const value = $(row).find('td.valeurLot').text().trim();
        if (!CATEGORIES.includes(category) || Object.hasOwn(payouts, category)) return null;
        if (category === '2/6') {
            if (value !== 'Free Play') return null;
            payouts[category] = 3;
        } else {
            // Reject pending values, malformed grouping, footnotes and approximations.
            if (!/^\$(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2}$/.test(value)) return null;
            payouts[category] = Number(value.slice(1).replaceAll(',', ''));
            if (!Number.isFinite(payouts[category]) || payouts[category] < 0) return null;
        }
    }
    return normalizeDraw({ date: dates.text().trim(), numbers, bonus, payouts, sourceUrl, importedAt: new Date().toISOString() });
}

function validateHistory(draws) {
    if (!Array.isArray(draws) || !draws.every(draw => normalizeDraw(draw))) {
        throw new Error('Local history is invalid; refusing to replace it.');
    }
    return draws;
}

function mergeOfficialDraw(existingDraws, officialDraw) {
    validateHistory(existingDraws);
    const candidate = normalizeDraw(officialDraw);
    if (!candidate) throw new Error('Invalid official draw.');
    const sameDate = existingDraws.filter(draw => draw.date === candidate.date);
    if (sameDate.length) {
        const conflict = sameDate.some(draw => {
            const prior = normalizeDraw(draw);
            return prior.bonus !== candidate.bonus || prior.numbers.some((number, index) => number !== candidate.numbers[index]) ||
                CATEGORIES.some(category => prior.payouts[category] !== null && candidate.payouts[category] !== null &&
                    prior.payouts[category] !== candidate.payouts[category]);
        });
        return { draws: existingDraws, changed: false, conflict };
    }
    // Scheduled updates import the latest result only, not unreviewed backfills.
    if (existingDraws.some(draw => draw.date > candidate.date)) {
        return { draws: existingDraws, changed: false, conflict: false, stale: true };
    }
    return { draws: [candidate, ...existingDraws], changed: true, conflict: false };
}

async function fetchOfficialPage(fetchImpl = fetch) {
    const response = await fetchImpl(SOURCE_URL, {
        redirect: 'error', signal: AbortSignal.timeout(30000), headers: { Accept: 'text/html' }
    });
    if (!response.ok) throw new Error(`Official page returned HTTP ${response.status}.`);
    if (!/^text\/html(?:;|$)/i.test(response.headers.get('content-type') || '')) {
        throw new Error('Official page did not return HTML.');
    }
    return response.text();
}

async function atomicWrite(file, value) {
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
        await fs.writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
        await fs.rename(temporary, file);
    } finally {
        await fs.rm(temporary, { force: true });
    }
}

async function runImport({ dataPath = DATA_PATH, statusPath = STATUS_PATH, html,
    fetchPage = fetchOfficialPage, now = new Date().toISOString(), dryRun = false } = {}) {
    let previous = {};
    let latestDrawDate = null;
    try {
        try {
            const savedStatus = JSON.parse(await fs.readFile(statusPath, 'utf8'));
            if (!savedStatus || typeof savedStatus !== 'object' || Array.isArray(savedStatus)) throw new Error('Invalid status file.');
            previous = savedStatus;
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
        }
        const existing = validateHistory(JSON.parse(await fs.readFile(dataPath, 'utf8')));
        latestDrawDate = existing.reduce((latest, draw) => !latest || draw.date > latest ? draw.date : latest, null);
        const candidate = parseOfficialResult(html === undefined ? await fetchPage() : html, SOURCE_URL);
        if (!candidate) throw new Error('Official page is incomplete or its format changed; history was preserved.');
        candidate.importedAt = now;
        const merged = mergeOfficialDraw(existing, candidate);
        if (merged.conflict) throw new Error(`Official result conflicts with existing draw ${candidate.date}; history was preserved.`);
        if (merged.stale) throw new Error(`Official result ${candidate.date} is older than local history; history was preserved.`);
        const status = {
            ...previous, state: 'success', sourceUrl: SOURCE_URL, lastAttemptAt: now, lastSuccessAt: now,
            lastImportedAt: merged.changed ? now : previous.lastImportedAt ?? null,
            latestDrawDate: merged.changed ? candidate.date : latestDrawDate,
            message: merged.changed ? `Imported official draw ${candidate.date}.` : 'Published history already contains this draw.'
        };
        if (!dryRun) {
            // Publish status first: a status-write failure must not change history.
            // A data-write failure is caught below and replaces this with error status.
            await atomicWrite(statusPath, status);
            if (merged.changed) await atomicWrite(dataPath, merged.draws);
        }
        return { ok: true, changed: merged.changed, candidate, status, dryRun };
    } catch (error) {
        const status = {
            ...previous, state: 'error', sourceUrl: SOURCE_URL, lastAttemptAt: now,
            lastSuccessAt: previous.lastSuccessAt ?? null, lastImportedAt: previous.lastImportedAt ?? null,
            latestDrawDate: latestDrawDate ?? previous.latestDrawDate ?? null, message: error.message
        };
        if (!dryRun) await atomicWrite(statusPath, status);
        return { ok: false, changed: false, status, dryRun };
    }
}

async function main(args) {
    let fixture;
    let dryRun = false;
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--dry-run') dryRun = true;
        else if (args[i] === '--fixture' && args[i + 1] && !args[i + 1].startsWith('--')) fixture = args[++i];
        else throw new Error(`Unknown or incomplete argument: ${args[i]}`);
    }
    if (!dryRun && (process.env.GITHUB_ACTIONS !== 'true' || fixture)) {
        throw new Error('Only GitHub Actions may publish live results. Use --dry-run for local or fixture validation.');
    }
    const result = await runImport({ dryRun, html: fixture ? await fs.readFile(fixture, 'utf8') : undefined });
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
}

if (require.main === module) main(process.argv.slice(2)).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
});

module.exports = { SOURCE_URL, parseOfficialResult, mergeOfficialDraw, fetchOfficialPage, runImport };
