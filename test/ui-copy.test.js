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
    assert.deepEqual(Object.keys(result.candidates).sort(), ['balanced', 'frequent', 'return']);
    for (const mode of ['frequent', 'return', 'balanced']) {
        assert.equal(result.candidates[mode].strategy, mode);
        assert.equal(result.candidates[mode].evaluatedDrawCount, 3);
        assert.equal(result.candidates[mode].dateRange.end, result.baseline.dateRange.end);
        const expected = require('../backtester').runWalkForwardBacktest({ draws, strategy: mode, budget: 3, seed: 9, warmup: 100 });
        assert.deepEqual(JSON.parse(JSON.stringify(result.candidates[mode])), expected);
    }
    assert.equal(result.candidates.return, result.strategy);
    assert.ok(messages.some(m => m.type === 'progress' && m.payload.total === 12));
    assert.ok(messages.some(m => m.type === 'progress' && /comparison pass/.test(m.payload.phase)));
    assert.ok(messages.filter(m => m.type === 'progress').length >= 2);
});

test('optional Jev card explains metrics and configuration without winning claims', () => {
    const html = read('index.html');
    assert.match(html, /id="jevDecisionCard"/);
    assert.match(html, /supplied historical\/mathematical metrics/);
    assert.match(html, /id="requestJevDecisionButton"[^>]*disabled/);
    assert.match(html, /Assessment confidence/);
    assert.match(read('jev-config.js'), /endpoint:\s*''/);
    for (const name of ['jev-config.js', 'jev-client.js', 'script.js', 'index.html']) assert.doesNotMatch(read(name), /TYPESAFE_API_KEY/);
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
function appHarness(globals = {}) {
    const nodes = {}, workers = [];
    let ready;
    const node = id => nodes[id] ||= { style: {}, value: id === 'prizeBudget' ? '30' : '1', handlers: {},
        addEventListener(event, fn) { this.handlers[event] = fn; }, reportValidity() { return true; } };
    const context = vm.createContext({
        document: { addEventListener(_event, fn) { ready = fn; }, getElementById: node, querySelectorAll() { return []; }, querySelector() { return { value: 'balanced' }; } },
        localStorage: { getItem() { return null; } },
        Worker: class { constructor() { workers.push(this); } postMessage() {} terminate() {} },
        fetch: async () => ({ ok: false }), console: { error() {} }, setTimeout() {}, Intl, Date, ...globals
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

test('Jev requests require a click and failure preserves the mathematical dashboard', async () => {
    const client = require('../jev-client');
    let calls = 0;
    const { nodes, workers } = appHarness({ JEV_CONFIG: { endpoint: 'https://example.com/api' }, JevClient: {
        ...client, async requestDecision(_endpoint, request) { calls++; assert.equal(request.objective, 'balanced'); return { available: false, message: 'Jev assessment unavailable.' }; }
    } });
    assert.equal(nodes.requestJevDecisionButton.disabled, true);
    nodes.generatePrizeTicketsButton.handlers.click();
    const worker = workers.at(-1);
    const Backtester = require('../backtester');
    const candidates = Object.fromEntries(['frequent','return','balanced'].map(strategy => [strategy, Backtester.runWalkForwardBacktest({ draws: [], strategy, budget: 3 })]));
    worker.onmessage({ data: { type: 'result', payload: { strategy: candidates.balanced, candidates, baseline: Backtester.createQuickPickBaseline({ draws: [], budget: 3 }), simulation: null } } });
    assert.equal(calls, 0);
    assert.equal(nodes.requestJevDecisionButton.disabled, false);
    const html = nodes.backtestDashboard.innerHTML;
    await nodes.requestJevDecisionButton.handlers.click();
    assert.equal(calls, 1);
    assert.equal(nodes.backtestDashboard.innerHTML, html);
    assert.match(nodes.jevStatus.textContent, /unavailable/);
});

test('late Jev response cannot restore assessment after settings invalidate it', async () => {
    const client = require('../jev-client');
    let complete;
    const { nodes, workers } = appHarness({ JEV_CONFIG: { endpoint: 'https://example.com/api' }, JevClient: {
        ...client, requestDecision() { return new Promise(resolve => { complete = resolve; }); }
    } });
    nodes.generatePrizeTicketsButton.handlers.click();
    const Backtester = require('../backtester');
    const candidates = Object.fromEntries(['frequent','return','balanced'].map(strategy => [strategy, Backtester.runWalkForwardBacktest({ draws: [], strategy, budget: 3 })]));
    workers.at(-1).onmessage({ data: { type: 'result', payload: { strategy: candidates.balanced, candidates, baseline: Backtester.createQuickPickBaseline({ draws: [], budget: 3 }), simulation: null } } });
    const pending = nodes.requestJevDecisionButton.handlers.click();
    nodes.generatePrizeTicketsButton.handlers.click();
    complete({ mode: 'balanced', confidence: 0.9, score: 1, assessment: 0.7, model: 'jev-latest', usage: { input_tokens: null, output_tokens: null } });
    await pending;
    assert.equal(nodes.jevDecisionResult.innerHTML, '');
    assert.equal(nodes.requestJevDecisionButton.disabled, true);
    assert.match(nodes.jevStatus.textContent, /Complete a full-history/);
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
