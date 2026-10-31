'use strict';

const MODES = ['frequent', 'return', 'balanced'];
const BODY_LIMIT = 8192;
const WINDOW_MS = 60000;
const REQUEST_LIMIT = 5;
const PROVIDER = 'https://api.typesafe.ai/v1';
// Allow small provider serialization differences without accepting conflicting answers.
const ANSWER_TOLERANCE = 0.0001;

function object(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function exactKeys(value, keys) {
    return object(value) && Reflect.ownKeys(value).length === keys.length
        && keys.every(key => Object.hasOwn(value, key) && Object.getOwnPropertyDescriptor(value, key).get === undefined);
}

function bounded(value, min, max) {
    return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

function count(value) {
    return Number.isSafeInteger(value) && value >= 0;
}

function validModel(value) {
    return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(value);
}

function validateDecisionRequest(body) {
    const invalid = () => { throw new Error('Invalid decision request.'); };
    if (!exactKeys(body, ['objective', 'candidates']) || !MODES.includes(body.objective)
        || !exactKeys(body.candidates, MODES)) invalid();
    const candidates = {};
    for (const mode of MODES) {
        const metric = body.candidates[mode];
        if (!exactKeys(metric, ['prizeRate', 'breakEvenRate', 'evaluatedDraws', 'netReturn'])
            || !bounded(metric.prizeRate, 0, 100) || !bounded(metric.breakEvenRate, 0, 100)
            || !count(metric.evaluatedDraws)
            || !(metric.netReturn === null || (typeof metric.netReturn === 'number' && Number.isFinite(metric.netReturn)))) invalid();
        candidates[mode] = { prizeRate: metric.prizeRate, breakEvenRate: metric.breakEvenRate,
            evaluatedDraws: metric.evaluatedDraws, netReturn: metric.netReturn };
    }
    return { objective: body.objective, candidates };
}

function buildSystemOneRequest(input, model) {
    const normalized = validateDecisionRequest(input);
    if (!validModel(model)) throw new Error('Invalid provider model.');
    return {
        model,
        state: { purpose: 'Compare supplied historical strategy metrics, not lottery odds. Do not predict draws, select numbers, or promise profit.',
            ...normalized },
        questions: {
            strategy: { type: 'choice', instructions: 'Choose the candidate best aligned with the objective using only supplied metrics. Frequent prioritizes prizeRate; return prioritizes netReturn then breakEvenRate; balanced weighs all three. Null return is unknown, not zero. Historical results do not establish future performance.',
                criteria: { frequent: 'Frequent Wins candidate', return: 'Maximum Return candidate', balanced: 'Balanced candidate' } },
            quality: { type: 'score', instructions: 'Assess how clearly the supplied metrics support comparing these strategies for the objective. This is decision evidence quality, not a winning probability.',
                criteria: ['Weak: missing return data, no evaluated draws, or no meaningful distinction.',
                    'Mixed: some usable historical evidence with limitations or tradeoffs.',
                    'Strong: complete historical metrics and a clear objective-aligned distinction.'] },
            evidence: { type: 'noul', instructions: 'Do the supplied historical metrics provide a meaningful basis for distinguishing the strategies for this objective? This assessment is not the chance of a lottery prize or future profit.' }
        }
    };
}

function providerInvalid() {
    const error = new Error('Invalid provider response.');
    error.code = 'PROVIDER_INVALID_RESPONSE';
    return error;
}

function distribution(value, keys) {
    return exactKeys(value, keys) && keys.every(key => bounded(value[key], 0, 1))
        && Math.abs(keys.reduce((sum, key) => sum + value[key], 0) - 1) <= 0.01;
}

function parseSystemOneResponse(payload) {
    if (!object(payload) || !validModel(payload.model) || !object(payload.answers)) throw providerInvalid();
    const { strategy, quality, evidence } = payload.answers;
    if (!object(strategy) || strategy.type !== 'choice' || !MODES.includes(strategy.choice)
        || !bounded(strategy.confidence, 0, 1) || !distribution(strategy.probabilities, MODES)
        || !object(quality) || quality.type !== 'score' || !bounded(quality.score, 0, 2)
        || !bounded(quality.confidence, 0, 1) || !distribution(quality.probabilities, ['0', '1', '2'])
        || !object(evidence) || evidence.type !== 'noul' || !bounded(evidence.noul, 0, 1)) throw providerInvalid();
    const highestProbability = Math.max(...MODES.map(mode => strategy.probabilities[mode]));
    const expectedScore = quality.probabilities['1'] + 2 * quality.probabilities['2'];
    if (highestProbability - strategy.probabilities[strategy.choice] > ANSWER_TOLERANCE
        || Math.abs(quality.score - expectedScore) > ANSWER_TOLERANCE) throw providerInvalid();
    if (payload.usage !== undefined && payload.usage !== null && !object(payload.usage)) throw providerInvalid();
    const usage = {};
    for (const name of ['input_tokens', 'output_tokens']) {
        const value = payload.usage?.[name];
        if (value !== undefined && value !== null && !count(value)) throw providerInvalid();
        usage[name] = value ?? null;
    }
    return { mode: strategy.choice, confidence: strategy.confidence, score: quality.score,
        assessment: evidence.noul, model: payload.model, usage };
}

async function readBody(req) {
    const length = req.headers?.['content-length'];
    if (length !== undefined && (!/^\d+$/.test(String(length)) || Number(length) > BODY_LIMIT)) {
        const error = new Error('Body too large.'); error.code = 'BODY_TOO_LARGE'; throw error;
    }
    let body = req.body;
    const alreadyParsed = object(body);
    if (body === undefined && req[Symbol.asyncIterator]) {
        const chunks = []; let bytes = 0;
        for await (const chunk of req) {
            const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            bytes += buffer.length;
            if (bytes > BODY_LIMIT) { const error = new Error('Body too large.'); error.code = 'BODY_TOO_LARGE'; throw error; }
            chunks.push(buffer);
        }
        body = Buffer.concat(chunks).toString('utf8');
    }
    if (Buffer.isBuffer(body)) body = body.toString('utf8');
    if (typeof body === 'string') {
        if (Buffer.byteLength(body) > BODY_LIMIT) { const error = new Error('Body too large.'); error.code = 'BODY_TOO_LARGE'; throw error; }
        body = JSON.parse(body);
    }
    // Validate before serializing to exclude accessors, toJSON, cycles and untrusted nested content.
    const normalized = validateDecisionRequest(body);
    // Parsed JSON has lost whitespace and its original byte count. Trust a bounded
    // HTTP Content-Length only; chunked or lengthless parsed bodies fail closed.
    if (alreadyParsed && (length === undefined || req.headers?.['transfer-encoding'] !== undefined)) {
        const error = new Error('Original body size is unknown.'); error.code = 'BODY_TOO_LARGE'; throw error;
    }
    if (Buffer.byteLength(JSON.stringify(normalized)) > BODY_LIMIT) {
        const error = new Error('Body too large.'); error.code = 'BODY_TOO_LARGE'; throw error;
    }
    return normalized;
}

function createJevHandler(dependencies = {}) {
    const env = dependencies.env || process.env;
    const fetchImpl = dependencies.fetch || globalThis.fetch;
    const clock = dependencies.clock || Date.now;
    // Per warm Vercel instance only: deploy a durable shared limiter before paid use at scale.
    const windows = new Map();
    return async function jevDecision(req, res) {
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Vary', 'Origin');
        const fail = (status, code, message) => res.status(status).json({ error: { code, message } });
        const origin = req.headers?.origin;
        if (origin !== undefined) {
            let configured = false;
            try {
                const allowed = new URL(env.JEV_ALLOWED_ORIGIN);
                configured = ['https:', 'http:'].includes(allowed.protocol) && allowed.origin === env.JEV_ALLOWED_ORIGIN;
            } catch { /* Missing or invalid origin configuration fails closed for browsers. */ }
            if (!configured || origin !== env.JEV_ALLOWED_ORIGIN) return fail(403, 'ORIGIN_NOT_ALLOWED', 'Browser origin is not allowed.');
            res.setHeader('Access-Control-Allow-Origin', origin);
        }
        // No-Origin server requests get no CORS grant. Origin is not authentication.
        if (req.method === 'OPTIONS' && origin !== undefined) {
            const requested = req.headers?.['access-control-request-method'];
            if (requested && requested !== 'POST') return fail(405, 'METHOD_NOT_ALLOWED', 'Use POST for decisions.');
            const headers = req.headers?.['access-control-request-headers'];
            if (headers && (typeof headers !== 'string' || headers.split(',').some(header => header.trim().toLowerCase() !== 'content-type'))) {
                return fail(403, 'ORIGIN_NOT_ALLOWED', 'Preflight headers are not allowed.');
            }
            res.setHeader('Access-Control-Allow-Methods', 'POST');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
            return res.status(204).end();
        }
        if (req.method !== 'POST') {
            res.setHeader('Allow', 'POST');
            return fail(405, 'METHOD_NOT_ALLOWED', 'Use POST for decisions.');
        }
        if (env.JEV_ENABLED !== 'true') return fail(503, 'JEV_DISABLED', 'Jev assessment is disabled.');
        let input;
        try { input = await readBody(req); } catch (error) {
            return error.code === 'BODY_TOO_LARGE'
                ? fail(413, 'BODY_TOO_LARGE', 'Request body exceeds the size limit.')
                : fail(400, 'INVALID_REQUEST', 'Provide an objective and valid metrics for all three strategies.');
        }
        const key = env.TYPESAFE_API_KEY;
        if (typeof key !== 'string' || !key.trim()) return fail(503, 'MISSING_API_KEY', 'Jev assessment is not configured.');
        const now = clock();
        for (const [ip, window] of windows) if (now >= window.reset) windows.delete(ip);
        // Vercel overwrites x-real-ip at its edge. Ignore client-controlled forwarding chains.
        const ip = env.VERCEL === '1' && typeof req.headers?.['x-real-ip'] === 'string'
            ? req.headers['x-real-ip'] : req.socket?.remoteAddress || 'unknown';
        let window = windows.get(ip);
        if (!window) {
            // Bound memory even if an instance receives many distinct IPs in one window.
            if (windows.size >= 10000) { res.setHeader('Retry-After', '60'); return fail(429, 'RATE_LIMITED', 'Too many assessment requests. Try again later.'); }
            window = { count: 0, reset: now + WINDOW_MS }; windows.set(ip, window);
        }
        if (window.count >= REQUEST_LIMIT) {
            res.setHeader('Retry-After', String(Math.max(1, Math.ceil((window.reset - now) / 1000))));
            return fail(429, 'RATE_LIMITED', 'Too many assessment requests. Try again later.');
        }
        window.count++;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 20000);
        try {
            const options = { headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, signal: controller.signal, redirect: 'error' };
            const catalog = await fetchImpl(`${PROVIDER}/models`, { ...options, method: 'GET' });
            if (!catalog.ok) throw new Error('Provider failure.');
            const listing = await catalog.json();
            if (!object(listing) || !Array.isArray(listing.models) || listing.models.length === 0
                || !listing.models.every(entry => object(entry) && validModel(entry.name))) throw providerInvalid();
            const model = listing.models.find(entry => entry.name === 'jev-latest')?.name || listing.models[0].name;
            const response = await fetchImpl(`${PROVIDER}/systemone`, { ...options, method: 'POST', body: JSON.stringify(buildSystemOneRequest(input, model)) });
            if (!response.ok) throw new Error('Provider failure.');
            let payload;
            try { payload = await response.json(); } catch { throw providerInvalid(); }
            const result = parseSystemOneResponse(payload);
            if (JSON.stringify(result).includes(key)) throw providerInvalid();
            return res.status(200).json(result);
        } catch (error) {
            return error.code === 'PROVIDER_INVALID_RESPONSE'
                ? fail(502, 'PROVIDER_INVALID_RESPONSE', 'Jev returned an invalid assessment.')
                : fail(502, 'PROVIDER_FAILURE', 'Jev assessment is temporarily unavailable.');
        } finally { clearTimeout(timeout); }
    };
}

module.exports = { validateDecisionRequest, buildSystemOneRequest, parseSystemOneResponse, createJevHandler };
