const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { normalizeDraw, classifyTicket, summarizeTickets } = require('../prize-engine');

const draw = {
    date: '2026-01-01', numbers: [1, 2, 3, 4, 5, 6], bonus: 7,
    payouts: { '2/6+B': 5, '3/6': 10, '4/6': 75, '5/6': 1000, '5/6+B': 50000, '6/6': 5000000 }
};

test('prize categories distinguish bonus outcomes and recorded cash values', () => {
    const cases = [
        [[1, 2, 30, 31, 32, 33], '2/6', 3, false, true],
        [[1, 2, 7, 30, 31, 32], '2/6+B', 5, true, false],
        [[1, 2, 3, 20, 21, 22], '3/6', 10, true, false],
        [[1, 2, 3, 4, 20, 21], '4/6', 75, true, false],
        [[1, 2, 3, 4, 5, 20], '5/6', 1000, true, false],
        [[1, 2, 3, 4, 5, 7], '5/6+B', 50000, true, false],
        [[1, 2, 3, 4, 5, 6], '6/6', 5000000, true, false],
        [[1, 7, 30, 31, 32, 33], 'none', 0, false, false],
        [[1, 2, 3, 7, 30, 31], '3/6', 10, true, false],
        [[1, 2, 3, 4, 7, 30], '4/6', 75, true, false]
    ];
    for (const [ticket, category, value, isCash, isFreePlay] of cases) {
        assert.deepEqual(classifyTicket(ticket, draw), { category, value, isCash, isFreePlay, payoutComplete: true });
    }
});

test('prize normalization preserves legacy records without inventing cash payouts', () => {
    const legacy = normalizeDraw({ date: draw.date, numbers: [6, 5, 4, 3, 2, 1], bonus: 7 });
    assert.deepEqual(legacy.numbers, [1, 2, 3, 4, 5, 6]);
    assert.equal(legacy.payoutComplete, false);
    assert.equal(legacy.payouts['3/6'], null);
    assert.equal(legacy.payouts['2/6+B'], null);
    assert.equal(legacy.payouts['2/6'], 3);
    assert.deepEqual(classifyTicket([1, 2, 3, 20, 21, 22], legacy), {
        category: '3/6', value: null, isCash: true, isFreePlay: false, payoutComplete: false
    });
    assert.equal(classifyTicket([1, 2, 30, 31, 32, 33], legacy).value, 3);
    assert.equal(normalizeDraw({ ...draw, payouts: { ...draw.payouts, '2/6': 999 } }).payouts['2/6'], 3);
});

test('prize normalization rejects malformed draws and dates', () => {
    const badDraws = [null, {}, { ...draw, numbers: [1, 1, 2, 3, 4, 5] },
        { ...draw, numbers: [1, 2, 3, 4, 5] }, { ...draw, numbers: [0, 2, 3, 4, 5, 6] },
        { ...draw, numbers: [1, 2, 3, 4, 5, 50] }, { ...draw, numbers: [1, 2, 3, 4, 5, '6'] },
        { ...draw, numbers: [1, 2, 3, 4, 5, ,] },
        { ...draw, bonus: 1 }, { ...draw, bonus: 50 }, { ...draw, bonus: 7.5 },
        { ...draw, date: '2026-02-30' }, { ...draw, date: 'invalid' }];
    for (const bad of badDraws) assert.equal(normalizeDraw(bad), null);
});

test('prize normalization copies metadata and converts invalid payouts to missing values', () => {
    const input = { ...draw, sourceUrl: 'https://example.com/results', importedAt: '2026-01-02T00:00:00Z',
        payouts: { ...draw.payouts, '3/6': '10', '4/6': -5, '5/6': Infinity, '6/6': 0 } };
    const normalized = normalizeDraw(input);
    assert.equal(normalized.sourceUrl, input.sourceUrl);
    assert.equal(normalized.importedAt, input.importedAt);
    assert.equal(normalized.payouts['3/6'], null);
    assert.equal(normalized.payouts['4/6'], null);
    assert.equal(normalized.payouts['5/6'], null);
    assert.equal(normalized.payouts['6/6'], 0);
    assert.equal(normalized.payoutComplete, false);
    normalized.numbers.push(49);
    normalized.payouts['2/6+B'] = 99;
    assert.deepEqual(input.numbers, [1, 2, 3, 4, 5, 6]);
    assert.equal(input.payouts['2/6+B'], 5);
});

test('prize classification rejects invalid tickets and draws', () => {
    for (const ticket of [null, [1, 1, 2, 3, 4, 5], [1, 2], [1, 2, 3, 4, 5, 50], [1, 2, 3, 4, 5, ,]]) {
        assert.throws(() => classifyTicket(ticket, draw), /ticket/i);
    }
    assert.throws(() => classifyTicket(draw.numbers, {}), /draw/i);
});

test('prize summary supports empty groups and rejects malformed groups', () => {
    const empty = summarizeTickets([], draw);
    assert.equal(empty.ticketCount, 0);
    assert.equal(empty.spending, 0);
    assert.equal(empty.grossReturn, 0);
    assert.equal(empty.netReturn, 0);
    assert.equal(empty.prizeCount, 0);
    assert.throws(() => summarizeTickets(null, draw), /tickets/i);
    assert.throws(() => summarizeTickets([], {}), /draw/i);
    assert.throws(() => summarizeTickets([[1, 1, 2, 3, 4, 5]], draw), /ticket/i);
});

test('prize summary values Free Plays and cash with independent counts', () => {
    const result = summarizeTickets([
        [1, 2, 30, 31, 32, 33], [1, 2, 7, 30, 31, 32],
        [1, 2, 3, 20, 21, 22], [10, 11, 12, 13, 14, 15]
    ], draw);
    assert.equal(result.ticketCount, 4);
    assert.equal(result.spending, 12);
    assert.equal(result.grossReturn, 18);
    assert.equal(result.netReturn, 6);
    assert.equal(result.freePlays, 1);
    assert.equal(result.cashWins, 2);
    assert.equal(result.cashWins10Plus, 1);
    assert.equal(result.prizeCount, 3);
    assert.equal(result.categories['2/6+B'], 1);
    assert.equal(result.categories.none, 1);
    assert.equal(result.breakEven, true);
    assert.equal(result.payoutComplete, true);
});

test('prize summary excludes incomplete draws even when selected tickets need no cash payout', () => {
    const legacy = { date: draw.date, numbers: draw.numbers, bonus: draw.bonus };
    const result = summarizeTickets([[1, 2, 30, 31, 32, 33]], legacy);
    assert.equal(result.freePlays, 1);
    assert.equal(result.prizeCount, 1);
    assert.equal(result.spending, 3);
    assert.equal(result.grossReturn, null);
    assert.equal(result.netReturn, null);
    assert.equal(result.breakEven, null);
    assert.equal(result.payoutComplete, false);
    assert.equal(result.results[0].value, 3);
    assert.equal(summarizeTickets([[1, 2, 30, 31, 32, 33]], draw).breakEven, true);
    assert.equal(summarizeTickets([[10, 11, 12, 13, 14, 15]], draw).breakEven, false);
});

test('prize engine exports a usable browser global without CommonJS', () => {
    const context = vm.createContext({});
    vm.runInContext(fs.readFileSync(require.resolve('../prize-engine'), 'utf8'), context);
    assert.equal(context.PrizeEngine.classifyTicket([1, 2, 30, 31, 32, 33], draw).value, 3);
});
