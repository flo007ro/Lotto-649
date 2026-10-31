const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { validateDecisionRequest, buildSystemOneRequest, parseSystemOneResponse, createJevHandler } = require('../jev-proxy');

function input() {
    return { objective: 'balanced', candidates: Object.fromEntries(['frequent', 'return', 'balanced'].map(mode =>
        [mode, { prizeRate: 12, breakEvenRate: 4, evaluatedDraws: 200, netReturn: null }])) };
}
function answer() {
    return { model: 'jev-latest', answers: {
        strategy: { type: 'choice', choice: 'balanced', confidence: 0.6, probabilities: { frequent: 0.1, return: 0.2, balanced: 0.7 } },
        quality: { type: 'score', score: 1.5, confidence: 0.4, probabilities: { 0: 0.1, 1: 0.3, 2: 0.6 }, legend: { 0: 'Weak', 1: 'Mixed', 2: 'Strong' } },
        evidence: { type: 'noul', noul: 0.8 }
    }, usage: { input_tokens: 120, output_tokens: 12 } };
}
const env = { JEV_ENABLED: 'true', JEV_ALLOWED_ORIGIN: 'https://example.github.io', TYPESAFE_API_KEY: 'test-only-placeholder' };
function response() {
    return { headers: {}, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, status(n) { this.statusCode = n; return this; },
        json(value) { this.body = value; return this; }, end() { return this; } };
}
async function invoke(handler, overrides = {}) {
    const res = response();
    await handler({ method: 'POST', headers: { origin: env.JEV_ALLOWED_ORIGIN }, body: input(), socket: { remoteAddress: '127.0.0.1' }, ...overrides }, res);
    return res;
}
function provider(models = [{ name: 'other' }, { name: 'jev-latest' }], payload = answer()) {
    const calls = [];
    const fetch = async (url, options) => {
        calls.push({ url, options });
        return { ok: true, json: async () => url.endsWith('/models') ? { models } : payload };
    };
    return { fetch, calls };
}

test('validation preserves bounded primitives and returns a detached normalized object', () => {
    const value = input();
    assert.deepEqual(validateDecisionRequest(value), value);
    assert.notEqual(validateDecisionRequest(value).candidates.frequent, value.candidates.frequent);
    value.candidates.return = { prizeRate: 100, breakEvenRate: 0, evaluatedDraws: 0, netReturn: -30.5 };
    assert.deepEqual(validateDecisionRequest(value), value);
});

test('validation rejects incomplete, extra, nested and illegal metrics', () => {
    for (const invalid of [null, [], {}, { ...input(), objective: 'unknown' }, { ...input(), extra: {} }]) {
        assert.throws(() => validateDecisionRequest(invalid), /invalid/i);
    }
    for (const [key, values] of Object.entries({ prizeRate: [-1, 101, NaN, Infinity, '12', null, {}], breakEvenRate: [-1, 101, NaN],
        evaluatedDraws: [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, '2'], netReturn: [Infinity, NaN, {}, '1'] })) {
        for (const value of values) {
            const invalid = input(); invalid.candidates.frequent[key] = value;
            assert.throws(() => validateDecisionRequest(invalid), /invalid/i);
        }
    }
    for (const change of [v => delete v.candidates.return, v => delete v.candidates.frequent.netReturn,
        v => { v.candidates.extra = {}; }, v => { v.candidates.frequent.extra = {}; }]) {
        const invalid = input(); change(invalid); assert.throws(() => validateDecisionRequest(invalid), /invalid/i);
    }
});

test('provider request has fixed typed questions and compact ordered rubric', () => {
    const request = buildSystemOneRequest(input(), 'jev-latest');
    assert.equal(request.model, 'jev-latest');
    assert.deepEqual(request.state.objective, 'balanced');
    assert.deepEqual(Object.keys(request.questions), ['strategy', 'quality', 'evidence']);
    assert.equal(request.questions.strategy.type, 'choice');
    assert.deepEqual(Object.keys(request.questions.strategy.criteria), ['frequent', 'return', 'balanced']);
    assert.equal(request.questions.quality.type, 'score');
    assert.equal(request.questions.quality.criteria.length, 3);
    assert.equal(request.questions.evidence.type, 'noul');
    assert.match(request.state.purpose, /not lottery odds/i);
});

test('parser returns only fixed safe fields from typed provider answers', () => {
    const payload = answer(); payload.secret = 'discard'; payload.usage.extra = 'discard';
    assert.deepEqual(parseSystemOneResponse(payload), { mode: 'balanced', confidence: 0.6, score: 1.5, assessment: 0.8,
        model: 'jev-latest', usage: { input_tokens: 120, output_tokens: 12 } });
});

test('parser rejects wrong types, missing fields and out-of-range answers', () => {
    for (const change of [v => { v.answers.strategy.type = 'score'; }, v => { v.answers.strategy.choice = 'other'; },
        v => { v.answers.strategy.confidence = 1.1; }, v => { v.answers.strategy.probabilities.frequent = -1; },
        v => { v.answers.quality.score = 2.1; }, v => { v.answers.quality.confidence = NaN; },
        v => { v.answers.evidence.type = 'boolean'; }, v => { v.answers.evidence.noul = '0.8'; },
        v => { v.answers.evidence.noul = -0.1; }, v => { v.usage.input_tokens = -1; },
        v => { delete v.answers.quality; }, v => { v.model = {}; }]) {
        const payload = answer(); change(payload); assert.throws(() => parseSystemOneResponse(payload), /provider/i);
    }
});

test('disabled, missing key, origin, method and invalid body are rejected before fetch', async () => {
    const fetch = async () => { assert.fail('must not call provider'); };
    for (const [configuration, request, status, code] of [
        [{ ...env, JEV_ENABLED: undefined }, {}, 503, 'JEV_DISABLED'],
        [{ ...env, TYPESAFE_API_KEY: undefined }, {}, 503, 'MISSING_API_KEY'],
        [env, { headers: { origin: 'https://attacker.example' } }, 403, 'ORIGIN_NOT_ALLOWED'],
        [{ ...env, JEV_ALLOWED_ORIGIN: undefined }, {}, 403, 'ORIGIN_NOT_ALLOWED'],
        [env, { method: 'GET' }, 405, 'METHOD_NOT_ALLOWED'],
        [env, { body: { ...input(), extra: {} } }, 400, 'INVALID_REQUEST'],
        [env, { body: '{' }, 400, 'INVALID_REQUEST'],
        [env, { body: ' '.repeat(8193) }, 413, 'BODY_TOO_LARGE'],
        [env, { headers: { origin: env.JEV_ALLOWED_ORIGIN, 'content-length': '8193' } }, 413, 'BODY_TOO_LARGE']
    ]) {
        const result = await invoke(createJevHandler({ env: configuration, fetch }), request);
        assert.equal(result.statusCode, status); assert.equal(result.body.error.code, code);
        assert.ok(!JSON.stringify(result.body).includes(env.TYPESAFE_API_KEY));
        assert.equal(result.headers['cache-control'], 'no-store');
    }
});

test('only configured browser origins receive CORS and valid preflight makes no provider call', async () => {
    const handler = createJevHandler({ env, fetch: async () => assert.fail('no provider') });
    const result = await invoke(handler, { method: 'OPTIONS', headers: { origin: env.JEV_ALLOWED_ORIGIN, 'access-control-request-method': 'POST' } });
    assert.equal(result.statusCode, 204);
    assert.equal(result.headers['access-control-allow-origin'], env.JEV_ALLOWED_ORIGIN);
    assert.equal(result.headers['access-control-allow-methods'], 'POST');
    const rejected = await invoke(handler, { method: 'OPTIONS', headers: { origin: 'null' } });
    assert.equal(rejected.statusCode, 403); assert.equal(rejected.headers['access-control-allow-origin'], undefined);
});

test('model discovery authenticates and prefers jev-latest with first model fallback', async () => {
    for (const [models, selected] of [[[{ name: 'other' }, { name: 'jev-latest' }], 'jev-latest'], [[{ name: 'other' }], 'other']]) {
        const stub = provider(models);
        const result = await invoke(createJevHandler({ env, fetch: stub.fetch }));
        assert.equal(result.statusCode, 200);
        assert.equal(stub.calls.length, 2);
        assert.equal(stub.calls[0].url, 'https://api.typesafe.ai/v1/models');
        assert.equal(stub.calls[0].options.method, 'GET');
        assert.equal(stub.calls[0].options.headers.Authorization, `Bearer ${env.TYPESAFE_API_KEY}`);
        assert.equal(stub.calls[1].url, 'https://api.typesafe.ai/v1/systemone');
        assert.equal(stub.calls[1].options.method, 'POST');
        assert.equal(JSON.parse(stub.calls[1].options.body).model, selected);
        assert.equal(stub.calls[1].options.redirect, 'error');
        assert.equal(result.body.mode, 'balanced');
        assert.ok(!JSON.stringify(result.body).includes(env.TYPESAFE_API_KEY));
    }
});

test('provider transport, HTTP, discovery and malformed answers become non-sensitive errors', async () => {
    for (const fetch of [async () => { throw new Error(env.TYPESAFE_API_KEY); }, async () => ({ ok: false }),
        provider([]).fetch, provider([{ name: 'jev-latest' }], {}).fetch]) {
        const result = await invoke(createJevHandler({ env, fetch }));
        assert.equal(result.statusCode, 502);
        assert.match(result.body.error.code, /^PROVIDER_(FAILURE|INVALID_RESPONSE)$/);
        assert.ok(!JSON.stringify(result.body).includes(env.TYPESAFE_API_KEY));
    }
});

test('fixed window limiter blocks the sixth request per IP and resets with injected clock', async () => {
    let now = 0;
    const stub = provider(); const handler = createJevHandler({ env, fetch: stub.fetch, clock: () => now });
    for (let i = 0; i < 5; i++) assert.equal((await invoke(handler)).statusCode, 200);
    const blocked = await invoke(handler, { headers: { origin: env.JEV_ALLOWED_ORIGIN, 'x-forwarded-for': 'spoofed' } });
    assert.equal(blocked.statusCode, 429); assert.equal(blocked.body.error.code, 'RATE_LIMITED');
    assert.equal(blocked.headers['retry-after'], '60'); assert.equal(stub.calls.length, 10);
    assert.equal((await invoke(handler, { socket: { remoteAddress: '127.0.0.2' } })).statusCode, 200);
    now = 60000; assert.equal((await invoke(handler)).statusCode, 200);
});

test('raw request stream is capped and no-Origin requests never receive CORS', async () => {
    const stub = provider(); const handler = createJevHandler({ env, fetch: stub.fetch });
    const req = Readable.from([JSON.stringify(input())]); Object.assign(req, { method: 'POST', headers: {}, socket: { remoteAddress: '127.0.0.1' } });
    const result = response(); await handler(req, result);
    assert.equal(result.statusCode, 200); assert.equal(result.headers['access-control-allow-origin'], undefined);
    const tooBig = Readable.from([' '.repeat(8193)]); Object.assign(tooBig, { method: 'POST', headers: {}, socket: {} });
    const rejected = response(); await handler(tooBig, rejected); assert.equal(rejected.statusCode, 413);
});
