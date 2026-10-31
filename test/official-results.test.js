const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const cheerio = require('cheerio');
const { parseOfficialResult, mergeOfficialDraw, runImport, fetchOfficialPage, SOURCE_URL } = require('../scripts/update-official-results');

const fixture = path.join(__dirname, 'fixtures/loto-quebec-valid-result.html');
const incompleteFixture = path.join(__dirname, 'fixtures/loto-quebec-incomplete-result.html');
const legacy = { date: '2025-08-09', numbers: [15, 17, 21, 22, 38, 45], bonus: 26, note: 'preserve' };
const now = '2026-10-31T06:00:00.000Z';
let html;
test.before(async () => { html = await fs.readFile(fixture, 'utf8'); });

function altered(change) {
    const $ = cheerio.load(html);
    change($);
    return $.html();
}

async function files(t, draws = [legacy]) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'lotto-import-'));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    const dataPath = path.join(directory, 'historical_data.json');
    const statusPath = path.join(directory, 'data-status.json');
    const data = JSON.stringify(draws);
    const status = { state: 'success', lastSuccessAt: '2025-08-10T06:00:00.000Z', latestDrawDate: '2025-08-09' };
    await fs.writeFile(dataPath, data);
    await fs.writeFile(statusPath, JSON.stringify(status));
    return { directory, dataPath, statusPath, data, status };
}

test('official parser extracts only Classic numbers and exact prize categories with provenance', () => {
    const draw = parseOfficialResult(html, SOURCE_URL);
    assert.equal(draw.date, '2026-10-28');
    assert.deepEqual(draw.numbers, [1, 10, 18, 21, 22, 49]);
    assert.equal(draw.bonus, 20);
    assert.deepEqual(draw.payouts, { '2/6': 3, '2/6+B': 5, '3/6': 10, '4/6': 60.8, '5/6': 1068.4, '5/6+B': 40711.4, '6/6': 5000000 });
    assert.equal(draw.payoutComplete, true);
    assert.equal(draw.sourceUrl, SOURCE_URL);
    assert.ok(Number.isFinite(Date.parse(draw.importedAt)));
});

test('official parser refuses incomplete or changed pages and untrusted source URLs', async () => {
    assert.equal(parseOfficialResult(await fs.readFile(incompleteFixture, 'utf8'), SOURCE_URL), null);
    assert.equal(parseOfficialResult('<h1>Service unavailable</h1>', SOURCE_URL), null);
    for (const url of ['https://evil.example/results', SOURCE_URL.replace('https:', 'http:'), SOURCE_URL + '?other=1']) {
        assert.equal(parseOfficialResult(html, url), null);
    }
});

for (const [description, mutate] of [
    ['five numbers', $ => $('.tirageClassique .num:not(.complementaire)').last().remove()],
    ['seven numbers', $ => $('.tirageClassique').prepend('<span class="num">02</span>')],
    ['repeated numbers', $ => $('.tirageClassique .num').first().text('10')],
    ['out-of-range number', $ => $('.tirageClassique .num').first().text('50')],
    ['noninteger number', $ => $('.tirageClassique .num').first().text('1.5')],
    ['mixed number text', $ => $('.tirageClassique .num').first().text('1 pending')],
    ['bonus duplicates main', $ => $('.tirageClassique .complementaire').text('10')],
    ['invalid calendar date', $ => $('#dateAffichee').text('2026-02-30')],
    ['ambiguous dates', $ => $('.lqZoneDate').append('<div id="dateAffichee">2026-10-24</div>')],
    ['unknown payout', $ => $('.principal .valeurLot').eq(1).text('Pending')],
    ['malformed amount', $ => $('.principal .valeurLot').eq(1).text('$5,00,000.00')],
    ['negative payout', $ => $('.principal .valeurLot').eq(1).text('-$5.00')],
    ['missing category', $ => $('.principal .lqZoneCategorieLot').eq(1).remove()],
    ['duplicate category', $ => $('.principal .description').eq(2).text('6/6')],
    ['changed free play', $ => $('.principal .lqZoneCategorieLot td.valeurLot').last().text('Unknown')],
    ['missing Classic heading', $ => $('.principal h4.titre').first().text('Other results')]
]) {
    test(`official parser rejects ${description}`, () => assert.equal(parseOfficialResult(altered(mutate), SOURCE_URL), null));
}

test('official merge preserves legacy records and does not mutate its input', () => {
    const existing = [legacy];
    const candidate = parseOfficialResult(html, SOURCE_URL);
    const result = mergeOfficialDraw(existing, candidate);
    assert.equal(result.changed, true);
    assert.deepEqual(result.draws, [candidate, legacy]);
    assert.deepEqual(existing, [legacy]);
    assert.equal(Object.hasOwn(result.draws[1], 'payouts'), false);
});

test('official merge is idempotent and never enriches or replaces a same-date row', () => {
    const candidate = parseOfficialResult(html, SOURCE_URL);
    const prior = { date: candidate.date, numbers: [...candidate.numbers].reverse(), bonus: candidate.bonus };
    const existing = [prior, legacy];
    const result = mergeOfficialDraw(existing, candidate);
    assert.equal(result.changed, false);
    assert.deepEqual(result.draws, existing);
    assert.equal(result.conflict, false);
    const conflict = mergeOfficialDraw(existing, { ...candidate, bonus: 30 });
    assert.equal(conflict.changed, false);
    assert.equal(conflict.conflict, true);
    assert.deepEqual(conflict.draws, existing);
});

test('official merge rejects invalid history and only appends newer draws', () => {
    const candidate = parseOfficialResult(html, SOURCE_URL);
    assert.throws(() => mergeOfficialDraw([{ ...legacy, bonus: 15 }], candidate));
    assert.throws(() => mergeOfficialDraw([legacy], { ...candidate, numbers: [1, 2] }));
    assert.equal(mergeOfficialDraw([{ ...legacy, date: '2026-10-31' }], candidate).changed, false);
});

test('official merge flags conflicting recorded payouts without overwriting them', () => {
    const candidate = parseOfficialResult(html, SOURCE_URL);
    const previous = { ...candidate, payouts: { ...candidate.payouts, '4/6': 99 } };
    const merged = mergeOfficialDraw([previous], candidate);
    assert.equal(merged.changed, false);
    assert.equal(merged.conflict, true);
    assert.deepEqual(merged.draws, [previous]);
});

test('official importer records a failure for malformed status without changing history', async t => {
    const local = await files(t);
    await fs.writeFile(local.statusPath, 'null');
    const result = await runImport({ ...local, html, now });
    assert.equal(result.ok, false);
    assert.equal(await fs.readFile(local.dataPath, 'utf8'), local.data);
    assert.equal(JSON.parse(await fs.readFile(local.statusPath, 'utf8')).state, 'error');
});

test('official importer writes validated data atomically and preserves prior rows', async t => {
    const local = await files(t);
    const result = await runImport({ ...local, html, now });
    assert.equal(result.changed, true);
    const draws = JSON.parse(await fs.readFile(local.dataPath, 'utf8'));
    assert.equal(draws[0].importedAt, now);
    assert.deepEqual(draws[1], legacy);
    const status = JSON.parse(await fs.readFile(local.statusPath, 'utf8'));
    assert.equal(status.state, 'success');
    assert.equal(status.lastSuccessAt, now);
    assert.equal(status.lastImportedAt, now);
    assert.equal(status.latestDrawDate, '2026-10-28');
    assert.deepEqual((await fs.readdir(local.directory)).sort(), ['data-status.json', 'historical_data.json']);
});

test('official importer preserves history if status publication fails', async t => {
    const local = await files(t);
    const rename = fs.rename;
    t.mock.method(fs, 'rename', async (source, destination) => {
        if (destination === local.statusPath) throw new Error('Status publication unavailable');
        return rename(source, destination);
    });
    await assert.rejects(runImport({ ...local, html, now }), /Status publication unavailable/);
    assert.equal(await fs.readFile(local.dataPath, 'utf8'), local.data);
    assert.deepEqual((await fs.readdir(local.directory)).sort(), ['data-status.json', 'historical_data.json']);
});

test('official importer records an error and preserves history if data publication fails', async t => {
    const local = await files(t);
    const rename = fs.rename;
    t.mock.method(fs, 'rename', async (source, destination) => {
        if (destination === local.dataPath) throw new Error('Data publication unavailable');
        return rename(source, destination);
    });
    const result = await runImport({ ...local, html, now });
    assert.equal(result.ok, false);
    assert.equal(await fs.readFile(local.dataPath, 'utf8'), local.data);
    const status = JSON.parse(await fs.readFile(local.statusPath, 'utf8'));
    assert.equal(status.state, 'error');
    assert.equal(status.lastSuccessAt, local.status.lastSuccessAt);
    assert.equal(status.latestDrawDate, legacy.date);
    assert.deepEqual((await fs.readdir(local.directory)).sort(), ['data-status.json', 'historical_data.json']);
});

test('official importer failures preserve history bytes and retain last success in failure status', async t => {
    for (const options of [
        { html: await fs.readFile(incompleteFixture, 'utf8') },
        { fetchPage: async () => { throw new Error('network unavailable'); } },
        { html: altered($ => $('#dateAffichee').text(legacy.date)) }
    ]) {
        const local = await files(t);
        const result = await runImport({ ...local, ...options, now });
        assert.equal(result.ok, false);
        assert.equal(await fs.readFile(local.dataPath, 'utf8'), local.data);
        const status = JSON.parse(await fs.readFile(local.statusPath, 'utf8'));
        assert.equal(status.state, 'error');
        assert.equal(status.lastSuccessAt, local.status.lastSuccessAt);
        assert.equal(status.lastAttemptAt, now);
        assert.equal(status.latestDrawDate, legacy.date);
    }
});

test('official importer dry run validates without writing data or status', async t => {
    const local = await files(t);
    const result = await runImport({ ...local, html, now, dryRun: true });
    assert.equal(result.candidate.date, '2026-10-28');
    assert.equal(await fs.readFile(local.dataPath, 'utf8'), local.data);
    assert.deepEqual(JSON.parse(await fs.readFile(local.statusPath, 'utf8')), local.status);
});

test('official fetch refuses redirects and non-HTML responses without following another source', async () => {
    for (const response of [
        { ok: false, status: 302 },
        { ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json' }) }
    ]) {
        await assert.rejects(fetchOfficialPage(async (url, options) => {
            assert.equal(url, SOURCE_URL);
            assert.equal(options.redirect, 'error');
            return response;
        }));
    }
});

test('official CLI permits fixture dry runs but refuses local publishing', () => {
    const script = path.join(__dirname, '../scripts/update-official-results.js');
    const dry = spawnSync(process.execPath, [script, '--fixture', fixture, '--dry-run'], { encoding: 'utf8' });
    assert.equal(dry.status, 0, dry.stderr);
    assert.match(dry.stdout, /2026-10-28/);
    const publish = spawnSync(process.execPath, [script], { encoding: 'utf8', env: { ...process.env, GITHUB_ACTIONS: 'false' } });
    assert.equal(publish.status, 1);
    assert.match(publish.stderr, /GitHub Actions/);
});

test('official local API serves validated snapshots/status and never changes files', async t => {
    const local = await files(t);
    const { createApp } = require('../server');
    const server = createApp(local).listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    const base = `http://127.0.0.1:${server.address().port}`;
    assert.equal((await (await fetch(base + '/api/results')).json())[0].date, legacy.date);
    assert.deepEqual(await (await fetch(base + '/api/data-status')).json(), local.status);
    assert.equal(await fs.readFile(local.dataPath, 'utf8'), local.data);
    await fs.writeFile(local.dataPath, '[{"date":"bad"}]');
    assert.equal((await fetch(base + '/api/results')).status, 500);
});
