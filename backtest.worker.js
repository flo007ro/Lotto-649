importScripts('prize-engine.js', 'prize-optimizer.js', 'backtester.js');

self.onmessage = ({ data: { type, payload } }) => {
    try {
        const { strategy, budget, seed } = payload;
        if (type === 'generate') {
            self.postMessage({ type: 'tickets', payload: PrizeOptimizer.generatePrizeTicketSet({ strategy, budget, seed }) });
            return;
        }
        if (type !== 'backtest') throw new Error('Unknown prize operation');
        const { draws, tickets } = payload;
        const eligible = Math.max(0, draws.filter(draw => PrizeEngine.normalizeDraw(draw)).length - 100);
        let completed = 0;
        const report = phase => self.postMessage({ type: 'progress', payload: { phase, completed, total: eligible * 2 } });
        const generator = phase => options => {
            const result = PrizeOptimizer.generatePrizeTicketSet(options);
            completed++;
            if (completed % 25 === 0 || completed === eligible || completed === eligible * 2) report(phase);
            return result;
        };
        const options = { draws, strategy, budget, seed, warmup: 100 };
        report('Historical strategy replay');
        const result = Backtester.runWalkForwardBacktest({ ...options, generateTickets: generator('Historical strategy replay') });
        report('Equal-budget Quick Pick replay');
        const baseline = Backtester.createQuickPickBaseline({ ...options, generateTickets: generator('Equal-budget Quick Pick replay') });
        // A recorded payout table is a disclosed scenario, never a historical substitute.
        const scenario = draws.map(draw => PrizeEngine.normalizeDraw(draw)).filter(draw => draw && draw.payoutComplete)
            .sort((a, b) => b.date.localeCompare(a.date))[0];
        let simulation = null;
        if (scenario && tickets) {
            report('Fair-draw scenario simulation');
            simulation = { ...Backtester.simulateFairDraws({ tickets, payoutTable: scenario.payouts, simulations: 10000, seed }), scenarioDate: scenario.date };
        }
        self.postMessage({ type: 'result', payload: { strategy: result, baseline, simulation } });
    } catch (error) {
        self.postMessage({ type: 'error', payload: { message: error.message } });
    }
};
