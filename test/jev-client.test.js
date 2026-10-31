const test = require('node:test');
const assert = require('node:assert/strict');
const JevClient = require('../jev-client');
const summary = (count = 4) => ({ prizeRate: { percentage: 25, denominator: 4 }, breakEvenRate: { percentage: null, denominator: 0 }, netReturn: null, evaluatedDrawCount: count, tickets: [[1,2,3,4,5,6]], date: 'private' });
const request = () => JevClient.buildRequest('balanced', { frequent: summary(), return: summary(5), balanced: summary(6) });
const decision = { mode: 'balanced', confidence: 0.8, score: 1.5, assessment: 0.6, model: 'jev-latest', usage: { input_tokens: 10, output_tokens: 20 } };

test('extracts only four fixed numeric metrics for each real candidate', () => {
    const result = request();
    assert.deepEqual(result, { objective: 'balanced', candidates: Object.fromEntries(['frequent','return','balanced'].map((mode, i) => [mode, { prizeRate: 25, breakEvenRate: 0, netReturn: null, evaluatedDraws: i + 4 }])) });
    assert.throws(() => JevClient.buildRequest('balanced', { balanced: summary() }));
});
test('missing or unsafe endpoints remain unavailable without fetch', async () => {
    for (const endpoint of ['', 'http://example.com/api', '/api/jev-decision', 'https://user:pass@example.com', 'javascript:alert(1)']) {
        const result = await JevClient.requestDecision(endpoint, request(), () => { assert.fail('must not fetch'); });
        assert.equal(result.available, false);
    }
});
test('posts bounded metrics and returns the parsed success', async () => {
    const result = await JevClient.requestDecision('https://example.com/api/jev-decision', request(), async (url, options) => {
        assert.equal(url, 'https://example.com/api/jev-decision');
        assert.equal(options.method, 'POST');
        assert.equal(options.headers['Content-Type'], 'application/json');
        assert.deepEqual(JSON.parse(options.body), request());
        assert.equal(options.credentials, 'omit');
        return { ok: true, json: async () => decision };
    });
    assert.deepEqual(result, decision);
    await JevClient.requestDecision('https://example.com/api', { ...request(), secret: 'exclude' }, () => assert.fail('invalid request'));
});
test('network, throttling, disabled, malformed and unsafe responses become unavailable', async () => {
    for (const fetchImpl of [async () => { throw new Error('private'); }, async () => ({ ok: false, json: async () => ({ error: { message: 'private' } }) }), async () => ({ ok: true, json: async () => ({ ...decision, confidence: 5 }) }), async () => ({ ok: true, json: async () => { throw new Error('bad JSON'); } })]) {
        const result = await JevClient.requestDecision('https://example.com/api', request(), fetchImpl);
        assert.equal(result.available, false);
        assert.doesNotMatch(JSON.stringify(result), /private|bad JSON/);
    }
});
