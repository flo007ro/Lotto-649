(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory(require('./prize-engine'));
    else root.PrizeOptimizer = factory(root.PrizeEngine);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (prizeEngine) {
    'use strict';

    if (!prizeEngine || typeof prizeEngine.normalizeDraw !== 'function') {
        throw new Error('PrizeOptimizer requires PrizeEngine');
    }

    const TICKET_COST = 3;
    const POSSIBLE_TICKETS = 13983816; // 49 choose 6.
    const STRATEGIES = ['frequent', 'return', 'balanced'];

    function ticketCountFromBudget(budget) {
        if (!Number.isSafeInteger(budget) || budget <= 0 || budget % TICKET_COST !== 0 ||
            budget / TICKET_COST > POSSIBLE_TICKETS) {
            throw new RangeError('Invalid budget: use a positive integer multiple of $3 within the unique-ticket limit');
        }
        return Math.floor(budget / TICKET_COST);
    }

    /** Mulberry32: integer seeds produce the same sequence in browsers and Node. */
    function createSeededRng(seed) {
        if (!Number.isSafeInteger(seed)) throw new TypeError('Invalid seed: expected a safe integer');
        let state = seed >>> 0;
        return function () {
            state = (state + 0x6D2B79F5) >>> 0;
            let value = state;
            value = Math.imul(value ^ value >>> 15, value | 1);
            value ^= value + Math.imul(value ^ value >>> 7, value | 61);
            return ((value ^ value >>> 14) >>> 0) / 4294967296;
        };
    }

    function normalizeTicket(ticket) {
        // Reuse the domain validator with a synthetic date and an unused bonus;
        // no historical draw, payout data, or model affects candidate selection.
        const bonus = Array.isArray(ticket) ? Array.from({ length: 49 }, (_, i) => i + 1)
            .find(number => !ticket.includes(number)) : undefined;
        const normalized = prizeEngine.normalizeDraw({ date: '2000-01-01', numbers: ticket, bonus });
        if (!normalized) throw new TypeError('Invalid ticket: expected six distinct integers from 1 to 49');
        return normalized.numbers;
    }

    /**
     * Duplicate counts mean total subset occurrences minus distinct subsets,
     * not the number of ticket-to-ticket collisions. A six-number ticket has
     * 15 pairs and 20 triplets. These are coverage counts, never win estimates.
     */
    function calculateCoverageMetrics(tickets) {
        if (!Array.isArray(tickets)) throw new TypeError('Invalid tickets: expected an array');
        const pairs = new Set();
        const triplets = new Set();
        const numbers = new Set();
        for (const ticket of tickets) {
            const sorted = normalizeTicket(ticket);
            for (let i = 0; i < 6; i++) {
                numbers.add(sorted[i]);
                for (let j = i + 1; j < 6; j++) {
                    pairs.add(sorted[i] + ',' + sorted[j]);
                    for (let k = j + 1; k < 6; k++) {
                        triplets.add(sorted[i] + ',' + sorted[j] + ',' + sorted[k]);
                    }
                }
            }
        }
        const totalPairs = tickets.length * 15;
        const totalTriplets = tickets.length * 20;
        return {
            totalPairs, uniquePairs: pairs.size, duplicatePairs: totalPairs - pairs.size,
            totalTriplets, uniqueTriplets: triplets.size, duplicateTriplets: totalTriplets - triplets.size,
            uniqueNumbers: numbers.size
        };
    }

    function randomTicket(rng) {
        const pool = Array.from({ length: 49 }, (_, i) => i + 1);
        for (let i = 0; i < 6; i++) {
            const j = i + Math.floor(rng() * (49 - i));
            [pool[i], pool[j]] = [pool[j], pool[i]];
        }
        return pool.slice(0, 6).sort((a, b) => a - b);
    }

    function randomGroup(ticketCount, rng) {
        const seen = new Set();
        const tickets = [];
        while (tickets.length < ticketCount) {
            const ticket = randomTicket(rng);
            const key = ticket.join(',');
            if (!seen.has(key)) {
                seen.add(key);
                tickets.push(ticket);
            }
        }
        return { tickets, coverage: calculateCoverageMetrics(tickets) };
    }

    function improvesCoverage(candidate, current, strategy) {
        const pairGain = current.duplicatePairs - candidate.duplicatePairs;
        const tripletGain = current.duplicateTriplets - candidate.duplicateTriplets;
        if (strategy === 'frequent') {
            // Preserve the baseline guarantee for BOTH overlap measures.
            return pairGain >= 0 && tripletGain >= 0 && pairGain + tripletGain > 0;
        }
        if (strategy === 'return') {
            // Triplet-first coverage proxy only; financial ranking is performed
            // separately by reproducible simulation/backtesting, never here.
            return tripletGain > 0 || (tripletGain === 0 && pairGain > 0);
        }
        // Equal weight to pair and triplet coverage fractions: /15 and /20.
        const gain = 4 * pairGain + 3 * tripletGain;
        return gain > 0 || (gain === 0 && pairGain > 0);
    }

    /**
     * Select among seeded random candidate groups (baseline + searchIterations).
     * searchIterations=0 exposes the identical random baseline for comparisons.
     * All three modes select coverage proxies; no financial results or different
     * expected profit are implied by the generated numbers. No ML is used.
     */
    function generatePrizeTicketSet(options) {
        if (!options || typeof options !== 'object' || Array.isArray(options)) {
            throw new TypeError('Invalid options: expected strategy and budget');
        }
        const { strategy, budget, seed = Date.now(), searchIterations = 64 } = options;
        if (!STRATEGIES.includes(strategy)) throw new RangeError('Invalid strategy: use frequent, return, or balanced');
        const ticketCount = ticketCountFromBudget(budget);
        if (!Number.isSafeInteger(searchIterations) || searchIterations < 0) {
            throw new RangeError('Invalid searchIterations: expected a nonnegative safe integer');
        }
        const rng = createSeededRng(seed);
        let best = randomGroup(ticketCount, rng);
        for (let i = 0; i < searchIterations; i++) {
            const candidate = randomGroup(ticketCount, rng);
            if (improvesCoverage(candidate.coverage, best.coverage, strategy)) best = candidate;
        }
        return { tickets: best.tickets, coverage: best.coverage, strategy, ticketCount };
    }

    return { ticketCountFromBudget, calculateCoverageMetrics, generatePrizeTicketSet, createSeededRng };
});
