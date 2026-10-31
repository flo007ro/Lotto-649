(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.JevClient = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';
    const modes = ['frequent', 'return', 'balanced'];
    const finite = value => typeof value === 'number' && Number.isFinite(value);
    const rate = value => finite(value) && value >= 0 && value <= 100;
    const count = value => Number.isSafeInteger(value) && value >= 0;
    const keys = (value, expected) => value && typeof value === 'object' && !Array.isArray(value)
        && Reflect.ownKeys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key)
            && Object.getOwnPropertyDescriptor(value, key).get === undefined);
    const unavailable = () => ({ available: false, message: 'Jev assessment unavailable. Historical results remain available.' });

    function validateRequest(request) {
        if (!keys(request, ['objective', 'candidates']) || !modes.includes(request.objective) || !keys(request.candidates, modes)) throw new Error('Invalid metrics');
        const candidates = {};
        for (const mode of modes) {
            const value = request.candidates[mode];
            if (!keys(value, ['prizeRate', 'breakEvenRate', 'netReturn', 'evaluatedDraws'])
                || !rate(value.prizeRate) || !rate(value.breakEvenRate) || !count(value.evaluatedDraws)
                || !(value.netReturn === null || finite(value.netReturn))) throw new Error('Invalid metrics');
            candidates[mode] = { prizeRate: value.prizeRate, breakEvenRate: value.breakEvenRate, netReturn: value.netReturn, evaluatedDraws: value.evaluatedDraws };
        }
        return { objective: request.objective, candidates };
    }
    function buildRequest(objective, summaries) {
        const candidates = {};
        for (const mode of modes) {
            const summary = summaries[mode];
            candidates[mode] = {
                prizeRate: summary.prizeRate.denominator === 0 ? 0 : summary.prizeRate.percentage,
                breakEvenRate: summary.breakEvenRate.denominator === 0 ? 0 : summary.breakEvenRate.percentage,
                netReturn: summary.netReturn ?? null, evaluatedDraws: summary.evaluatedDrawCount
            };
        }
        return validateRequest({ objective, candidates });
    }
    function isEndpointConfigured(endpoint) {
        try {
            if (typeof endpoint !== 'string' || !endpoint.trim()) return false;
            const url = new URL(endpoint);
            return url.protocol === 'https:' && !url.username && !url.password && !url.hash;
        } catch { return false; }
    }
    async function requestDecision(endpoint, request, fetchImpl = globalThis.fetch) {
        if (!isEndpointConfigured(endpoint)) return unavailable();
        let timer;
        try {
            const body = JSON.stringify(validateRequest(request));
            if (body.length > 4096) return unavailable();
            const controller = new AbortController();
            timer = setTimeout(() => controller.abort(), 25000);
            const response = await fetchImpl(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' },
                body, credentials: 'omit', redirect: 'error', signal: controller.signal });
            if (!response.ok) return unavailable();
            const data = await response.json();
            if (!data || !modes.includes(data.mode) || !rate(data.confidence * 100) || !finite(data.confidence)
                || !finite(data.assessment) || !rate(data.assessment * 100) || !finite(data.score) || data.score < 0 || data.score > 2
                || typeof data.model !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(data.model)
                || !data.usage || !['input_tokens','output_tokens'].every(key => data.usage[key] === null || count(data.usage[key]))) return unavailable();
            return { mode: data.mode, confidence: data.confidence, score: data.score, assessment: data.assessment,
                model: data.model, usage: { input_tokens: data.usage.input_tokens, output_tokens: data.usage.output_tokens } };
        } catch { return unavailable(); }
        finally { clearTimeout(timer); }
    }
    return { buildRequest, requestDecision, isEndpointConfigured };
});
