(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory(require('./prize-engine'), require('./prize-optimizer'));
    } else root.Backtester = factory(root.PrizeEngine, root.PrizeOptimizer);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (prizeEngine, optimizer) {
    'use strict';

    if (!prizeEngine || !optimizer) throw new Error('Backtester requires PrizeEngine and PrizeOptimizer');
    const CATEGORIES = ['none', '2/6', '2/6+B', '3/6', '4/6', '5/6', '5/6+B', '6/6'];
    const STRATEGIES = ['frequent', 'return', 'balanced'];

    function rate(numerator, denominator, excludedDrawCount) {
        return { numerator, denominator, percentage: denominator ? numerator / denominator * 100 : null, excludedDrawCount };
    }

    function accumulator() {
        return {
            evaluatedDrawCount: 0, financialDrawCount: 0, incompletePayoutDrawCount: 0,
            ticketCount: 0, financialTicketCount: 0, freePlays: 0, cashWins: 0, prizeCount: 0,
            cashWins10Plus: 0, spending: 0, grossReturn: 0, netReturn: 0,
            categories: Object.fromEntries(CATEGORIES.map(category => [category, 0])),
            financialOutcomes: [], outcomeDistribution: { loss: 0, breakEven: 0, profit: 0 }
        };
    }

    function addOutcome(total, outcome, date = null) {
        total.evaluatedDrawCount++;
        for (const key of ['ticketCount', 'freePlays', 'cashWins', 'prizeCount']) total[key] += outcome[key];
        for (const category of CATEGORIES) total.categories[category] += outcome.categories[category];
        if (!outcome.payoutComplete) {
            total.incompletePayoutDrawCount++;
            return;
        }
        total.financialDrawCount++;
        total.financialTicketCount += outcome.ticketCount;
        for (const key of ['spending', 'grossReturn', 'netReturn', 'cashWins10Plus']) total[key] += outcome[key];
        const bucket = outcome.netReturn < 0 ? 'loss' : outcome.netReturn > 0 ? 'profit' : 'breakEven';
        total.outcomeDistribution[bucket]++;
        total.financialOutcomes.push({ date, spending: outcome.spending, grossReturn: outcome.grossReturn, netReturn: outcome.netReturn });
    }

    function finish(total) {
        const excluded = total.incompletePayoutDrawCount;
        total.prizeRate = rate(total.prizeCount, total.ticketCount, 0);
        total.cashWin10PlusRate = rate(total.cashWins10Plus, total.financialTicketCount, excluded);
        total.breakEvenRate = rate(total.outcomeDistribution.breakEven + total.outcomeDistribution.profit,
            total.financialDrawCount, excluded);
        total.outcomeDistribution.denominator = total.financialDrawCount;
        total.outcomeDistribution.excludedDrawCount = excluded;
        if (!total.financialDrawCount) {
            total.spending = null;
            total.grossReturn = null;
            total.netReturn = null;
        }
        return total;
    }

    function validateTickets(tickets, expectedCount) {
        if (!Array.isArray(tickets) || !tickets.length || (expectedCount !== undefined && tickets.length !== expectedCount)) {
            throw new TypeError('Invalid tickets: expected a nonempty group matching the budget');
        }
        const coverage = optimizer.calculateCoverageMetrics(tickets);
        if (expectedCount !== undefined && new Set(tickets.map(ticket => ticket.slice().sort((a, b) => a - b).join(','))).size !== tickets.length) {
            throw new TypeError('Invalid tickets: generated tickets must be distinct');
        }
        return coverage;
    }

    // Partial Fisher-Yates: six uniform selections without replacement plus one
    // uniform bonus from the remaining 43 balls. No historical data is consulted.
    function fairDraw(rng, payoutTable) {
        const balls = Array.from({ length: 49 }, (_, i) => i + 1);
        for (let i = 0; i < 7; i++) {
            const j = i + Math.floor(rng() * (49 - i));
            [balls[i], balls[j]] = [balls[j], balls[i]];
        }
        return { date: '2000-01-01', numbers: balls.slice(0, 6), bonus: balls[6], payouts: payoutTable };
    }

    /**
     * Measured distributions under a caller-supplied payout scenario, never an
     * estimate of a number-selection advantage. Missing cash values invalidate
     * all dollar aggregates. Free Play is always $3; Gold Ball is excluded.
     */
    function simulateFairDraws({ tickets, payoutTable, simulations = 10000, seed = 1 } = {}) {
        if (!Number.isSafeInteger(simulations) || simulations <= 0) {
            throw new RangeError('Invalid simulations: expected a positive safe integer');
        }
        const coverage = validateTickets(tickets);
        const rng = optimizer.createSeededRng(seed);
        const total = accumulator();
        for (let i = 0; i < simulations; i++) {
            addOutcome(total, prizeEngine.summarizeTickets(tickets, fairDraw(rng, payoutTable)));
        }
        return { ...finish(total), kind: 'simulation', seed, simulations, coverage,
            ticketsPerDraw: tickets.length, payoutBasis: 'supplied-scenario' };
    }

    function chronologicalDraws(draws) {
        if (!Array.isArray(draws)) throw new TypeError('Invalid draws: expected an array');
        const valid = [];
        let invalidDrawCount = 0;
        for (const source of draws) {
            const draw = prizeEngine.normalizeDraw(source);
            if (!draw) { invalidDrawCount++; continue; }
            // Only canonical draw fields enter generation history; arbitrary
            // source metadata cannot smuggle future records into a strategy.
            valid.push(Object.freeze({ date: draw.date, numbers: Object.freeze(draw.numbers), bonus: draw.bonus,
                payouts: Object.freeze(draw.payouts), payoutComplete: draw.payoutComplete,
                sourceUrl: draw.sourceUrl, importedAt: draw.importedAt }));
        }
        valid.sort((a, b) => a.date.localeCompare(b.date));
        for (let i = 1; i < valid.length; i++) {
            if (valid[i].date === valid[i - 1].date) throw new RangeError('Duplicate draw dates are not allowed');
        }
        return { valid, invalidDrawCount };
    }

    function walkForward({ draws, strategy = 'balanced', budget, warmup = 100, seed = 1,
        generateTickets = optimizer.generatePrizeTicketSet } = {}, quickPick = false) {
        if (!STRATEGIES.includes(strategy)) throw new RangeError('Invalid strategy');
        const ticketsPerDraw = optimizer.ticketCountFromBudget(budget);
        if (!Number.isSafeInteger(warmup) || warmup < 0) throw new RangeError('Invalid warmup: expected a nonnegative safe integer');
        if (typeof generateTickets !== 'function') throw new TypeError('Invalid ticket generator');
        const rng = optimizer.createSeededRng(seed);
        const { valid, invalidDrawCount } = chronologicalDraws(draws);
        const total = accumulator();
        const excludedWarmupDrawCount = Math.min(warmup, valid.length);
        for (let i = excludedWarmupDrawCount; i < valid.length; i++) {
            const options = { strategy: quickPick ? 'balanced' : strategy, budget,
                seed: Math.floor(rng() * 4294967296), history: valid.slice(0, i) };
            if (quickPick) options.searchIterations = 0;
            const group = generateTickets(options);
            validateTickets(group && group.tickets, ticketsPerDraw);
            addOutcome(total, prizeEngine.summarizeTickets(group.tickets, valid[i]), valid[i].date);
        }
        return { ...finish(total), kind: 'backtest', strategy: quickPick ? 'quick-pick' : strategy,
            seed, budget, warmup, ticketsPerDraw, inputDrawCount: draws.length, validDrawCount: valid.length,
            invalidDrawCount, excludedWarmupDrawCount,
            dateRange: { start: valid[excludedWarmupDrawCount]?.date ?? null,
                end: total.evaluatedDrawCount ? valid[valid.length - 1].date : null } };
    }

    /**
     * Rebuild tickets before each target using only history strictly before it.
     * The default generator uses coverage only and ignores history. Injected
     * generateTickets receives {strategy, budget, seed, history}; history records
     * are immutable snapshots. All financial denominators use complete draws.
     */
    function runWalkForwardBacktest(options) { return walkForward(options); }

    /** Same draw range, seed schedule, budget, and evaluator; no coverage search. */
    function createQuickPickBaseline(options) { return walkForward(options, true); }

    return { simulateFairDraws, runWalkForwardBacktest, createQuickPickBaseline };
});
