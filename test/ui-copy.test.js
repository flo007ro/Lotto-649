const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.join(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

test('UI labels describe model output without prediction or confidence claims', () => {
    for (const name of ['index.html', 'script.js', 'advanced_ml_model.js']) {
        assert.doesNotMatch(read(name), /Use ML Predictions|Confidence:|Conf:|Using ML model for predictions|Number Probability Prediction/);
    }
    assert.match(read('index.html'), /does not predict future draws/);
    assert.match(read('index.html'), /Return analysis/);
    for (const id of ['useML', 'trainModelButton', 'generateMultipleButton', 'customStrategyContainer', 'saved-combinations']) {
        assert.match(read('index.html'), new RegExp(`id="${id}"`));
    }
});

test('dashboard renders unavailable financial fields while retaining counts and exclusions', () => {
    const nodes = {};
    const context = vm.createContext({ document: { addEventListener() {}, getElementById(id) { return nodes[id] ||= {}; } }, Intl, Date });
    vm.runInContext(read('script.js'), context);
    assert.equal(typeof context.renderBacktestDashboard, 'function');
    const Backtester = require('../backtester');
    const draws = Array.from({length: 102}, (_, i) => ({date: new Date(Date.UTC(2020, 0, i + 1)).toISOString().slice(0, 10), numbers: [1,2,3,4,5,6], bonus: 7}));
    const strategy = Backtester.runWalkForwardBacktest({ draws, budget: 3 });
    const baseline = Backtester.createQuickPickBaseline({ draws, budget: 3 });
    context.renderBacktestDashboard({ strategy, baseline, simulation: null });
    const html = nodes.backtestDashboard.innerHTML;
    assert.match(html, /Unavailable/);
    assert.doesNotMatch(html, /\$0\.00/);
    for (const label of ['Gross return', 'Net return', 'Free Plays', '$10+ cash rate', 'Break-even rate', 'Quick Pick', '2020-04-10', '100', 'Incomplete payouts']) assert.ok(html.includes(label), label);
});

test('worker preserves full history, 100-draw warmup, baseline population and progress', () => {
    assert.ok(fs.existsSync(path.join(root, 'backtest.worker.js')), 'backtest worker exists');
    const messages = [];
    const context = vm.createContext({ self: { postMessage: message => messages.push(message) } });
    context.importScripts = (...names) => names.forEach(name => vm.runInContext(read(name), context));
    vm.runInContext(read('backtest.worker.js'), context);
    const draws = Array.from({length: 103}, (_, i) => ({date: new Date(Date.UTC(2020, 0, i + 1)).toISOString().slice(0, 10), numbers: [1,2,3,4,5,6], bonus: 7}));
    context.self.onmessage({data: { type: 'backtest', payload: { draws, strategy: 'return', budget: 3, seed: 9 } }});
    const result = messages.find(m => m.type === 'result').payload;
    assert.equal(result.strategy.evaluatedDrawCount, 3);
    assert.equal(result.strategy.excludedWarmupDrawCount, 100);
    assert.equal(result.baseline.ticketCount, 3);
    assert.equal(result.baseline.dateRange.end, '2020-04-12');
    assert.equal(result.strategy.grossReturn, null);
    assert.equal(result.simulation, null);
    assert.ok(messages.filter(m => m.type === 'progress').length >= 2);
});

test('client refresh reads same-origin published snapshots and never backend scraper', () => {
    const source = read('script.js');
    assert.match(source, /fetch\('historical_data\.json'/);
    assert.match(source, /fetch\('data-status\.json'/);
    assert.doesNotMatch(source, /onrender\.com|API_BASE_URL/);
    assert.match(source, /new Worker\('backtest\.worker\.js'\)/);
    assert.doesNotMatch(source, /Backtester\.runWalkForwardBacktest/);
});

// Browser boundaries only: run the real app handlers with a failed network and controlled workers.
function appHarness() {
    const nodes = {}, workers = [];
    let ready;
    const node = id => nodes[id] ||= { style: {}, value: id === 'prizeBudget' ? '30' : '1', handlers: {},
        addEventListener(event, fn) { this.handlers[event] = fn; }, reportValidity() { return true; } };
    const context = vm.createContext({
        document: { addEventListener(_event, fn) { ready = fn; }, getElementById: node, querySelectorAll() { return []; }, querySelector() { return { value: 'balanced' }; } },
        localStorage: { getItem() { return null; } },
        Worker: class { constructor() { workers.push(this); } postMessage() {} terminate() {} },
        fetch: async () => ({ ok: false }), console: { error() {} }, setTimeout() {}, Intl, Date
    });
    vm.runInContext(read('script.js'), context);
    ready();
    return { nodes, workers };
}

test('failed initial snapshot load replaces loading status with unavailable', async () => {
    const { nodes } = appHarness();
    await new Promise(resolve => setImmediate(resolve));
    assert.match(nodes.dataStatus.innerHTML, /unavailable/);
    assert.match(nodes.notification.textContent, /Could not load/);
});

test('late worker events after cancellation cannot overwrite the cancelled state', () => {
    const { nodes, workers } = appHarness();
    nodes.generatePrizeTicketsButton.handlers.click();
    const worker = workers.at(-1);
    nodes.cancelBacktestButton.handlers.click();
    worker.onerror({ message: 'Late worker error' });
    assert.match(nodes.prizeProgress.textContent, /cancelled/);
    worker.onmessage({data: {type: 'progress', payload: {phase: 'Late progress', completed: 1, total: 5}}});
    assert.match(nodes.prizeProgress.textContent, /cancelled/);
});
