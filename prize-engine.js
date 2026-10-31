(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.PrizeEngine = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const TICKET_COST = 3;
    const CASH_CATEGORIES = ['2/6+B', '3/6', '4/6', '5/6', '5/6+B', '6/6'];

    function validNumbers(numbers) {
        return Array.isArray(numbers) && numbers.length === 6 &&
            Array.from(numbers).every(number => Number.isInteger(number) && number >= 1 && number <= 49) &&
            new Set(numbers).size === 6;
    }

    /**
     * Normalize legacy and imported records without mutating them.
     * payouts maps Classic category labels to nonnegative dollar amounts or null.
     * Only 2/6 has an assumed value: a $3 Free Play. Gold Ball is never evaluated.
     * A draw is financially complete only when every cash category is recorded.
     */
    function normalizeDraw(draw) {
        if (!draw || !validNumbers(draw.numbers) || !Number.isInteger(draw.bonus) ||
            draw.bonus < 1 || draw.bonus > 49 || draw.numbers.includes(draw.bonus)) return null;
        if (typeof draw.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(draw.date)) return null;
        const timestamp = Date.parse(draw.date + 'T00:00:00Z');
        if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== draw.date) return null;

        const payouts = { '2/6': TICKET_COST };
        for (const category of CASH_CATEGORIES) {
            const value = draw.payouts && Object.hasOwn(draw.payouts, category) ? draw.payouts[category] : null;
            payouts[category] = typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
        }
        return {
            ...draw,
            numbers: draw.numbers.slice().sort((a, b) => a - b),
            payouts,
            sourceUrl: draw.sourceUrl ?? null,
            importedAt: draw.importedAt ?? null,
            payoutComplete: CASH_CATEGORIES.every(category => payouts[category] !== null)
        };
    }

    function classifyNormalizedTicket(ticket, draw) {
        if (!validNumbers(ticket)) throw new TypeError('Invalid ticket: expected six distinct integers from 1 to 49');
        const matches = ticket.filter(number => draw.numbers.includes(number)).length;
        const bonus = ticket.includes(draw.bonus);
        let category = 'none';
        if (matches === 6) category = '6/6';
        else if (matches === 5) category = bonus ? '5/6+B' : '5/6';
        else if (matches === 4) category = '4/6';
        else if (matches === 3) category = '3/6';
        else if (matches === 2) category = bonus ? '2/6+B' : '2/6';
        const value = category === 'none' ? 0 : draw.payouts[category];
        return {
            category,
            value,
            isCash: CASH_CATEGORIES.includes(category),
            isFreePlay: category === '2/6',
            // Individual known results remain available even for an incomplete draw.
            payoutComplete: value !== null
        };
    }

    function classifyTicket(ticket, draw) {
        const normalized = normalizeDraw(draw);
        if (!normalized) throw new TypeError('Invalid draw');
        return classifyNormalizedTicket(ticket, normalized);
    }

    /**
     * Coverage counts survive missing payouts. Whole-draw dollar aggregates are
     * null unless all cash categories are recorded, even if these tickets lose.
     * cashWins10Plus counts known payouts only; use only complete draws for rates.
     * results retains each ticket's known value (including $3 Free Plays).
     */
    function summarizeTickets(tickets, draw) {
        if (!Array.isArray(tickets)) throw new TypeError('Invalid tickets: expected an array');
        const normalized = normalizeDraw(draw);
        if (!normalized) throw new TypeError('Invalid draw');
        const results = tickets.map(ticket => classifyNormalizedTicket(ticket, normalized));
        const categories = { none: 0, '2/6': 0 };
        for (const category of CASH_CATEGORIES) categories[category] = 0;
        for (const result of results) categories[result.category]++;
        const spending = tickets.length * TICKET_COST;
        const payoutComplete = normalized.payoutComplete;
        const grossReturn = payoutComplete ? results.reduce((sum, result) => sum + result.value, 0) : null;
        return {
            ticketCount: tickets.length,
            spending,
            grossReturn,
            netReturn: payoutComplete ? grossReturn - spending : null,
            freePlays: results.filter(result => result.isFreePlay).length,
            cashWins: results.filter(result => result.isCash).length,
            cashWins10Plus: results.filter(result => result.isCash && result.value !== null && result.value >= 10).length,
            prizeCount: results.filter(result => result.category !== 'none').length,
            categories,
            payoutComplete,
            breakEven: payoutComplete ? grossReturn >= spending : null,
            results
        };
    }

    return { normalizeDraw, classifyTicket, summarizeTickets };
});
