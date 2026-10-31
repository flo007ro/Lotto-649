# Jev Vercel Proxy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an optional, safe, server-only Jev strategy-assessment endpoint and dashboard control without changing any lottery mathematics.

**Architecture:** A CommonJS domain module validates compact strategy metrics, calls TypeSafe only after server-side configuration checks, and parses a fixed typed response. A thin Vercel adapter handles HTTP/CORS. GitHub Pages loads only a public endpoint URL and renders the returned decision as optional context beside existing backtest output.

**Tech Stack:** Node.js built-in test runner, Vercel Node serverless functions, browser JavaScript, TypeSafe System One REST API.

**Spec:** `docs/superpowers/specs/2026-10-31-jev-vercel-design.md`

## Global Constraints

- `TYPESAFE_API_KEY` is read only by Vercel server code and never committed, logged, returned, or referenced by browser code.
- `JEV_ENABLED` defaults to disabled; tests use mocked `fetch` and must make no provider calls.
- `POST /api/jev-decision` accepts only four fixed metrics for each of three candidates and the selected objective, with bounded rates and draw counts, finite or null net return, and a request-size cap.
- JEV compares supplied mathematical results; it does not calculate odds, select numbers, or promise profit.
- The browser continues working if JEV is absent, disabled, rate-limited, or errors.
- The GitHub Pages origin is the only browser origin granted CORS access.
- Jev confidence and assessment are visually and textually separate from lottery probabilities.

## Review Focus

- A browser-origin request with malformed metrics returns 400 before any provider request.
- A disabled deployment and a missing key return clear, non-sensitive 503 responses.
- A provider response with incorrect answer types or out-of-range numbers is rejected instead of displayed.
- The proxy rejects a non-POST method and a non-GitHub-Pages origin.
- The UI keeps historical comparison data visible after an unavailable Jev request.

### Task 1: Server-only Jev decision domain and Vercel adapter

**Files:**
- Create: `jev-proxy.js`
- Create: `api/jev-decision.js`
- Create: `test/jev-proxy.test.js`
- Create: `vercel.json`
- Modify: `package.json`

**Interfaces:**
- Produces `validateDecisionRequest(body)`, `buildSystemOneRequest(input, model)`, `parseSystemOneResponse(payload)`, and `createJevHandler(dependencies)` from `jev-proxy.js`.
- `api/jev-decision.js` exports the instantiated Vercel `(req, res)` handler.

- [ ] **Step 1: Write failing domain tests**

Cover valid normalized metrics; unknown objectives; missing candidate modes; non-finite/out-of-range rates; disabled configuration; model discovery; typed `choice`, `score`, and `noul` request construction; provider error; malformed typed provider response; and a no-key-in-response assertion.

- [ ] **Step 2: Run the new test file to verify it fails**

Run: `& 'C:\Program Files\nodejs\npm.cmd' test -- test/jev-proxy.test.js`
Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the minimal server domain and HTTP adapter**

Use provider model discovery and the fixed TypeSafe question schema. Require `JEV_ENABLED=true`, cap accepted body size, allow only the configured GitHub Pages origin, and use the injected `fetch` in tests. Add a fixed-window per-instance limiter and a documented production rate-limit caveat.

- [ ] **Step 4: Run focused then full tests**

Run: `& 'C:\Program Files\nodejs\npm.cmd' test -- test/jev-proxy.test.js`; then `& 'C:\Program Files\nodejs\npm.cmd' test`
Expected: all tests pass.

- [ ] **Step 5: Commit**

Commit message: `feat: add secure Jev decision proxy`

### Task 2: Optional decision card and public endpoint configuration

**Files:**
- Create: `jev-config.js`
- Create: `jev-client.js`
- Create: `test/jev-client.test.js`
- Modify: `index.html`
- Modify: `script.js`
- Modify: `backtest.worker.js`
- Modify: `style.css`
- Modify: `test/ui-copy.test.js`
- Modify: `README.md` or `readme.md`

**Interfaces:**
- Consumes the proxy response from Task 1 through `JevClient.requestDecision(endpoint, request, fetchImpl)`.
- Produces `window.JevClient` and a public `window.JEV_CONFIG` object with only `endpoint`.

- [ ] **Step 1: Write failing browser/client tests**

Test that missing endpoint produces an unavailable state without `fetch`, that the client extracts only the fixed backtest metrics, and that decision-card copy calls its confidence an assessment rather than lottery odds.

- [ ] **Step 2: Run focused tests to verify failure**

Run: `& 'C:\Program Files\nodejs\npm.cmd' test -- test/jev-client.test.js test/ui-copy.test.js`
Expected: FAIL because the client/config/card do not exist.

- [ ] **Step 3: Implement minimal config, client, card, and copy**

Run all three existing coverage strategies against the same chronological history before rendering the decision card, so the three candidate metric objects are real results rather than inferred or duplicated values. Render the decision card after the existing backtest comparison. It remains disabled until a public endpoint is configured and requests only when the visitor presses the explicit button. Preserve all existing dashboard output on error.

- [ ] **Step 4: Run focused then full tests**

Run: `& 'C:\Program Files\nodejs\npm.cmd' test -- test/jev-client.test.js test/ui-copy.test.js`; then `& 'C:\Program Files\nodejs\npm.cmd' test`
Expected: all tests pass.

- [ ] **Step 5: Commit**

Commit message: `feat: add optional Jev strategy assessment`

### Task 3: Deploy safely and document the environment configuration

**Files:**
- Modify: `README.md` or `readme.md`
- Modify: `docs/superpowers/specs/2026-10-31-jev-vercel-design.md`
- Modify: `.github/workflows/update-lotto-results.yml`

**Interfaces:**
- Uses the Vercel endpoint from Task 1 and public config from Task 2.

- [ ] **Step 1: Verify no tracked secret or client-side key reference exists**

Run: `rg -n "TYPESAFE_API_KEY|apikey_" -g '!node_modules' -g '!*.lock' .`
Expected: only server environment lookup and documentation variable names; no key value.

- [ ] **Step 2: Run the complete test suite and inspect production diff**

Run: `& 'C:\Program Files\nodejs\npm.cmd' test`; `git diff --check`; `git status --short`
Expected: tests green, no whitespace errors, intended files only.

- [ ] **Step 2a: Publish the key-free browser modules in the existing GitHub Pages allowlist**

Add `jev-config.js` and `jev-client.js` to the already explicit static-file copy list in `.github/workflows/update-lotto-results.yml`. The workflow must not copy server modules, tests, documentation, or any environment data into the public Pages artifact.

- [ ] **Step 3: Create Vercel project and encrypted environment values**

External deployment is a separate controller step after review. Use Vercel UI to import the repository with `JEV_ENABLED` unset or `false` (disabled by default). Set `TYPESAFE_API_KEY` only in Vercel's encrypted server environment and set `JEV_ALLOWED_ORIGIN=https://flo007ro.github.io`. Never enter the secret into a terminal, source file, or public browser configuration. No live provider or bulk calls are made by deployment. The local in-memory limiter is per warm instance; a durable shared rate limit is required before paid production scale.

- [ ] **Step 4: Update only `jev-config.js` with the deployed public endpoint and deploy GitHub Pages**

Commit message: `chore: configure deployed Jev proxy`

- [ ] **Step 5: Manually test only the health/error configuration path before enabling a paid call**

Expected: GitHub Pages displays an unavailable but usable decision card while the server is disabled. Validate only disabled POST and CORS/error paths without provider calls. Enable `JEV_ENABLED=true` only after deployment validation and appropriate rate-limit protection; live paid testing requires separate explicit authorization.

## Self-review

The plan covers all design requirements: server-only key, strict input/output validation, disabled default, optional UI, fixed provider schema, mocked tests, CORS, rate limiting, and deploy documentation. The dependency and interfaces flow from proxy to client to deployment. The five high-risk runtime cases are each explicitly owned by Task 1 or 2 tests.
