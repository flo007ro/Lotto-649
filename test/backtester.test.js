const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { simulateFairDraws, runWalkForwardBacktest, createQuickPickBaseline } = require('../backtester');

const payouts = { '2/6+B': 5, '3/6': 10, '4/6': 75, '5/6': 1000, '5/6+B': 50000, '6/6': 5000000 };
const tickets = [[1, 2, 30, 31, 32, 33], [1, 2, 3, 20, 21, 22]];
function draw(day, complete = true) {
    return { date: `2026-01-${String(day).padStart(2, '0')}`, numbers: [1, 2, 3, 4, 5, 6], bonus: 7,
        ...(complete ? { payouts } : {}) };
}
const fixedGenerator = () => ({ tickets });

test('backtest keeps coverage but excludes incomplete records from every financial measure', () => {
    // The incomplete draw still has the selected ticket's $10 payout: the
    // whole draw must be excluded, not just tickets with unknown values.
    const incomplete = { ...draw(4), payouts: { ...payouts, '6/6': null } };
    const result = runWalkForwardBacktest({ draws: [draw(1), draw(2), draw(3), incomplete],
        strategy: 'balanced', budget: 6, warmup: 2, seed: 7, generateTickets: fixedGenerator });
    assert.equal(result.evaluatedDrawCount, 2);
    assert.equal(result.financialDrawCount, 1);
    assert.equal(result.incompletePayoutDrawCount, 1);
    assert.equal(result.ticketCount, 4);
    assert.equal(result.financialTicketCount, 2);
    assert.equal(result.freePlays, 2);
    assert.equal(result.cashWins, 2);
    assert.equal(result.prizeCount, 4);
    assert.equal(result.spending, 6);
    assert.equal(result.grossReturn, 13);
    assert.equal(result.netReturn, 7);
    assert.equal(result.cashWins10Plus, 1);
    assert.deepEqual(result.prizeRate, { numerator: 4, denominator: 4, percentage: 100, excludedDrawCount: 0 });
    assert.deepEqual(result.cashWin10PlusRate, { numerator: 1, denominator: 2, percentage: 50, excludedDrawCount: 1 });
    assert.deepEqual(result.breakEvenRate, { numerator: 1, denominator: 1, percentage: 100, excludedDrawCount: 1 });
    assert.deepEqual(result.dateRange, { start: '2026-01-03', end: '2026-01-04' });
    assert.equal(result.financialOutcomes.length, 1);
    assert.equal(result.financialOutcomes[0].netReturn, 7);
    assert.deepEqual(result.outcomeDistribution, { loss: 0, breakEven: 0, profit: 1, denominator: 1, excludedDrawCount: 1 });
});

test('backtest lookahead boundary sorts history and passes only strictly earlier records', () => {
    const calls = [];
    const draws = [draw(4), draw(1), draw(3), draw(2)];
    const before = structuredClone(draws);
    runWalkForwardBacktest({ draws, strategy: 'frequent', budget: 6, warmup: 2, seed: 7,
        generateTickets(options) { calls.push(options); return { tickets }; } });
    assert.deepEqual(calls.map(call => call.history.map(item => item.date)), [
        ['2026-01-01', '2026-01-02'], ['2026-01-01', '2026-01-02', '2026-01-03']
    ]);
    assert.deepEqual(Object.keys(calls[0]).sort(), ['budget', 'history', 'seed', 'strategy']);
    assert.deepEqual(draws, before);
    assert.throws(() => runWalkForwardBacktest({ draws: [draw(1), draw(1)], strategy: 'balanced', budget: 6 }), /duplicate/i);
});

test('backtest no complete payouts means unavailable financial results, never zero returns', () => {
    const result = runWalkForwardBacktest({ draws: [draw(1, false)], strategy: 'balanced', budget: 6,
        warmup: 0, seed: 2, generateTickets: fixedGenerator });
    for (const key of ['spending', 'grossReturn', 'netReturn']) assert.equal(result[key], null);
    assert.equal(result.prizeCount, 2);
    assert.equal(result.cashWins10Plus, 0);
    assert.deepEqual(result.breakEvenRate, { numerator: 0, denominator: 0, percentage: null, excludedDrawCount: 1 });
    assert.equal(result.cashWin10PlusRate.denominator, 0);
    assert.deepEqual(result.financialOutcomes, []);
});

test('backtest Free Play is exactly $3 and alone breaks even', () => {
    const result = runWalkForwardBacktest({ draws: [{ ...draw(1), payouts: { ...payouts, '2/6': 999 }, goldBall: 99999999 }],
        strategy: 'balanced', budget: 3, warmup: 0, seed: 7,
        generateTickets: () => ({ tickets: [tickets[0]] }) });
    assert.equal(result.grossReturn, 3);
    assert.equal(result.netReturn, 0);
    assert.equal(result.breakEvenRate.percentage, 100);
    assert.equal(result.outcomeDistribution.breakEven, 1);
});

test('backtest default warmup excludes 100 valid draws and counts malformed rows', () => {
    const draws = Array.from({ length: 102 }, (_, i) => ({ ...draw(1),
        date: new Date(Date.UTC(2025, 0, i + 1)).toISOString().slice(0, 10) }));
    draws.push({ date: 'bad' });
    const result = runWalkForwardBacktest({ draws, strategy: 'balanced', budget: 6, seed: 3, generateTickets: fixedGenerator });
    assert.equal(result.evaluatedDrawCount, 2);
    assert.equal(result.excludedWarmupDrawCount, 100);
    assert.equal(result.invalidDrawCount, 1);
    const empty = runWalkForwardBacktest({ draws: [], strategy: 'balanced', budget: 6 });
    assert.equal(empty.evaluatedDrawCount, 0);
    assert.deepEqual(empty.dateRange, { start: null, end: null });
    assert.equal(empty.prizeRate.percentage, null);
});

test('backtest and Quick Pick baseline are reproducible with equal ticket counts', () => {
    const options = { draws: [draw(1), draw(2), draw(3)], strategy: 'return', budget: 9, warmup: 1, seed: 71 };
    assert.deepEqual(runWalkForwardBacktest(options), runWalkForwardBacktest(options));
    const baseline = createQuickPickBaseline(options);
    assert.deepEqual(baseline, createQuickPickBaseline(options));
    assert.equal(baseline.ticketCount, 6);
    assert.equal(baseline.spending, 18);
    assert.equal(baseline.strategy, 'quick-pick');
    const calls = [];
    createQuickPickBaseline({ ...options, generateTickets(o) { calls.push(o); return { tickets: [...tickets, [10, 11, 12, 13, 14, 15]] }; } });
    assert.equal(calls.length, 2);
    assert.ok(calls.every(call => call.searchIterations === 0 && call.budget === 9));
});

test('simulation is seeded and uniformly samples fair Classic draws including a distinct bonus', () => {
    const options = { tickets: [[1, 2, 3, 4, 5, 6]], payoutTable: payouts, simulations: 40000, seed: 99 };
    const result = simulateFairDraws(options);
    assert.deepEqual(result, simulateFairDraws(options));
    // Sum C(6,k)*C(43,6-k)/C(49,6), k=2..6 = 0.151016.
    // C(6,2)*C(42,3)/C(49,6) = 0.012314 for 2 main + bonus.
    // Wide bounds avoid brittle stochastic tests.
    assert.ok(result.prizeRate.percentage > 14 && result.prizeRate.percentage < 16.2);
    assert.ok(result.categories['2/6+B'] > 380 && result.categories['2/6+B'] < 610);
    assert.equal(result.evaluatedDrawCount, 40000);
    assert.equal(result.financialDrawCount, 40000);
    assert.equal(result.spending, 120000);
    assert.equal(result.coverage.uniquePairs, 15);
    assert.equal(result.outcomeDistribution.denominator, 40000);
    assert.notDeepEqual(simulateFairDraws({ ...options, simulations: 10, seed: 1 }),
        simulateFairDraws({ ...options, simulations: 10, seed: 2 }));
});

test('simulation does not invent a payout table or count incomplete financial rates', () => {
    const result = simulateFairDraws({ tickets, simulations: 100, seed: 13 });
    assert.equal(result.financialDrawCount, 0);
    assert.equal(result.incompletePayoutDrawCount, 100);
    assert.equal(result.spending, null);
    assert.equal(result.grossReturn, null);
    assert.equal(result.breakEvenRate.percentage, null);
    assert.equal(result.cashWin10PlusRate.denominator, 0);
    assert.equal(result.prizeRate.denominator, 200);
});

test('backtest and simulation reject invalid options or generator output', () => {
    for (const simulations of [0, -1, 1.5, NaN]) {
        assert.throws(() => simulateFairDraws({ tickets, simulations, seed: 1 }), /simulations/i);
    }
    for (const badTickets of [[], null, [[1, 2, 3, 4, 5, 50]], Array(1)]) {
        assert.throws(() => simulateFairDraws({ tickets: badTickets, simulations: 1, seed: 1 }), /ticket/i);
    }
    for (const patch of [{ warmup: -1 }, { warmup: 1.2 }, { seed: NaN }, { strategy: 'bad' }, { budget: 4 }, { draws: null }]) {
        assert.throws(() => runWalkForwardBacktest({ draws: [draw(1)], strategy: 'balanced', budget: 6, ...patch }));
    }
    for (const bad of [[], [tickets[0]], [tickets[0], tickets[0]]]) {
        assert.throws(() => runWalkForwardBacktest({ draws: [draw(1)], strategy: 'balanced', budget: 6, warmup: 0,
            generateTickets: () => ({ tickets: bad }) }), /ticket/i);
    }
});

test('backtest browser global loads with dependencies and produces a simulation', () => {
    const context = vm.createContext({});
    for (const file of ['prize-engine', 'prize-optimizer', 'backtester']) {
        vm.runInContext(fs.readFileSync(require.resolve('../' + file), 'utf8'), context);
    }
    assert.equal(context.Backtester.simulateFairDraws({ tickets, payoutTable: payouts, simulations: 5, seed: 7 }).spending, 30);
});
