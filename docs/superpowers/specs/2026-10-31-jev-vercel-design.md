# Jev Decision Proxy Design

## Intent

Add an optional Jev-assisted strategy decision layer to the static Lotto 6/49 site. It may compare the already computed outcomes of Frequent Wins, Maximum Return, and Balanced; it must never generate lottery probabilities, select lottery numbers, or alter the existing mathematical/backtest result.

The user selected a Vercel serverless proxy and asked to proceed to deployment. The application remains useful when the proxy is absent, disabled, rate-limited, or unavailable.

## Scope

- A Vercel Node serverless endpoint at `POST /api/jev-decision`.
- Server-only TypeSafe authentication using `TYPESAFE_API_KEY`.
- Strict request/response validation with fixed, bounded strategy metrics.
- A small dashboard card after a completed backtest, with an explicit optional request button.
- A public, key-free proxy URL configuration file. GitHub Pages never contains the secret.
- An in-memory per-instance request limiter plus a hard opt-in enable switch and request-size limits. The deployment guide documents the additional durable rate-limit configuration required before enabling paid use at scale.

## Non-goals

- No new lottery probability calculation, ranking of lottery numbers, or profitability promise.
- No automatic calls, batch requests, or calls during tests.
- No key in source, browser code, local `.env` files, commit history, UI, or logs.
- No claim that Jev confidence is a lottery winning probability.

## Chosen approach

The Vercel function owns all provider contact. It first rejects unsupported origins, methods, disabled deployments, oversized/invalid bodies, and rate-limit violations. It resolves the account model via `GET /v1/models`, then submits one compact `POST /v1/systemone` request with fixed `choice`, `score`, and `noul` questions about the client-supplied mathematical metrics. Only a narrowly parsed response is returned.

This is preferable to a browser API call because the static GitHub Pages client cannot safeguard a provider key. It is preferable to using Jev in the optimizer because TypeSafe recommendations are labels over supplied mathematical results, not a source of odds.

## Interfaces

`POST /api/jev-decision` accepts only:

```json
{
  "objective": "frequent|return|balanced",
  "candidates": {
    "frequent": { "prizeRate": 0, "breakEvenRate": 0, "netReturn": 0, "evaluatedDraws": 0 },
    "return": { "prizeRate": 0, "breakEvenRate": 0, "netReturn": 0, "evaluatedDraws": 0 },
    "balanced": { "prizeRate": 0, "breakEvenRate": 0, "netReturn": 0, "evaluatedDraws": 0 }
  }
}
```

Rates are percentages in `[0,100]`; evaluated draws are non-negative safe integers; net return may be `null` if payout data is incomplete. A rate without a denominator is sent as zero. The browser derives each candidate from completed strategy replays and never sends raw history, ticket numbers, free text, or user identifiers.

Responses include a chosen mode, bounded Jev confidence/score/assessment, the provider model, and `usage`; the browser labels all Jev fields as decision confidence or assessment, never as draw odds.

## Deployment

Deploy the same repository to Vercel using the checked-in `vercel.json`. JEV is disabled by default: leave `JEV_ENABLED` unset or `false` while validating the disabled endpoint and CORS/error paths. `TYPESAFE_API_KEY` is Vercel server-only and belongs only in Vercel's encrypted server environment. Set `JEV_ALLOWED_ORIGIN=https://flo007ro.github.io`, with no path or trailing slash. A public `jev-config.js` contains only the final HTTPS endpoint URL, never credentials.

The local in-memory limiter is per warm instance, not a global quota. A durable shared rate limit is required before paid production scale. Enable `JEV_ENABLED=true` only after deployment validation and the appropriate rate-limit protection. No live provider or bulk calls are made by deployment; live paid validation requires separate explicit authorization.

The GitHub Pages workflow copies only its explicit public static allowlist, including `jev-config.js` and `jev-client.js`. It must never publish `api/`, `jev-proxy.js`, tests, docs, environment data, or credentials. Vercel builds the two browser scripts as public static assets and `api/jev-decision.js` as a server function; `jev-proxy.js` remains a server dependency and is not a static output entry.

## Verification

Node tests use mocked `fetch`, exercise all rejected inputs and TypeSafe response parsing, and prove the key is only read from server process environment. Browser copy tests assert that the UI distinguishes a Jev decision from mathematical probability and that the disabled state does not block existing backtests.
