const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { ticketCountFromBudget, calculateCoverageMetrics, generatePrizeTicketSet } = require('../prize-optimizer');

test('ticket budget determines exact spending and rejects partial tickets', () => {
    assert.equal(ticketCountFromBudget(3), 1);
    assert.equal(ticketCountFromBudget(30), 10);
    for (const budget of [0, -3, 2, 4, 30.5, '30', null, NaN, Infinity, Number.MAX_SAFE_INTEGER]) {
        assert.throws(() => ticketCountFromBudget(budget), /budget/i);
    }
    assert.throws(() => ticketCountFromBudget(13983817 * 3), /budget/i);
});

test('coverage counts unique subsets and repeated occurrences without mutating tickets', () => {
    const tickets = [[6, 5, 4, 3, 2, 1], [1, 2, 3, 7, 8, 9]];
    const original = structuredClone(tickets);
    assert.deepEqual(calculateCoverageMetrics(tickets), {
        totalPairs: 30, uniquePairs: 27, duplicatePairs: 3,
        totalTriplets: 40, uniqueTriplets: 39, duplicateTriplets: 1,
        uniqueNumbers: 9
    });
    assert.deepEqual(tickets, original);
    assert.deepEqual(calculateCoverageMetrics([]), {
        totalPairs: 0, uniquePairs: 0, duplicatePairs: 0,
        totalTriplets: 0, uniqueTriplets: 0, duplicateTriplets: 0,
        uniqueNumbers: 0
    });
    assert.equal(calculateCoverageMetrics([tickets[0], tickets[0], tickets[0]]).duplicatePairs, 30);
});

test('coverage rejects malformed ticket groups including sparse arrays', () => {
    for (const tickets of [null, {}, [null], [[1, 2, 3, 4, 5]], [[1, 1, 2, 3, 4, 5]],
        [[0, 1, 2, 3, 4, 5]], [[1, 2, 3, 4, 5, 50]], [[1, 2, 3, 4, 5, 6.5]],
        [Array(6)], Array(1)]) {
        assert.throws(() => calculateCoverageMetrics(tickets), /ticket/i);
    }
});

test('ticket groups are reproducible, valid and unique for each coverage strategy', () => {
    for (const strategy of ['frequent', 'return', 'balanced']) {
        const options = { strategy, budget: 90, seed: 42, searchIterations: 12 };
        const result = generatePrizeTicketSet(options);
        assert.deepEqual(result, generatePrizeTicketSet(options));
        assert.equal(result.strategy, strategy);
        assert.equal(result.ticketCount, 30);
        assert.equal(result.tickets.length, 30);
        assert.equal(new Set(result.tickets.map(ticket => ticket.join(','))).size, 30);
        for (const ticket of result.tickets) {
            assert.equal(ticket.length, 6);
            assert.equal(new Set(ticket).size, 6);
            assert.ok(ticket.every(n => Number.isInteger(n) && n >= 1 && n <= 49));
            assert.deepEqual(ticket, ticket.slice().sort((a, b) => a - b));
        }
        assert.deepEqual(result.coverage, calculateCoverageMetrics(result.tickets));
        assert.equal(Object.hasOwn(result, 'grossReturn'), false);
    }
    assert.notDeepEqual(generatePrizeTicketSet({ strategy: 'balanced', budget: 30, seed: 42 }).tickets,
        generatePrizeTicketSet({ strategy: 'balanced', budget: 30, seed: 43 }).tickets);
});

test('Frequent Wins never worsens pair or triplet overlap from its seeded random ticket baseline', () => {
    for (const seed of [0, 1, 42, 12345]) {
        const options = { strategy: 'frequent', budget: 90, seed };
        const baseline = generatePrizeTicketSet({ ...options, searchIterations: 0 });
        const optimized = generatePrizeTicketSet({ ...options, searchIterations: 24 });
        assert.ok(optimized.coverage.duplicatePairs <= baseline.coverage.duplicatePairs);
        assert.ok(optimized.coverage.duplicateTriplets <= baseline.coverage.duplicateTriplets);
    }
});

test('ticket generation reports invalid options explicitly', () => {
    for (const options of [undefined, null, {}, { strategy: 'ml', budget: 30 },
        { strategy: 'balanced', budget: 4 }, { strategy: 'balanced', budget: '30' },
        { strategy: 'balanced', budget: 30, seed: NaN },
        { strategy: 'balanced', budget: 30, seed: '42' },
        { strategy: 'balanced', budget: 30, searchIterations: -1 },
        { strategy: 'balanced', budget: 30, searchIterations: 1.5 }]) {
        assert.throws(() => generatePrizeTicketSet(options), /options|strategy|budget|seed|searchIterations/i);
    }
});

test('coverage optimizer loads as a browser global with PrizeEngine', () => {
    const context = vm.createContext({});
    vm.runInContext(fs.readFileSync(require.resolve('../prize-engine'), 'utf8'), context);
    vm.runInContext(fs.readFileSync(require.resolve('../prize-optimizer'), 'utf8'), context);
    assert.equal(context.PrizeOptimizer.ticketCountFromBudget(30), 10);
    assert.equal(context.PrizeOptimizer.generatePrizeTicketSet({ strategy: 'balanced', budget: 3, seed: 0 }).tickets.length, 1);
});
