# Lotto 6/49 Prize Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an honest, coverage-focused Lotto 6/49 ticket-group optimizer, official-data update pipeline, walk-forward backtester, and profitability dashboard to the existing GitHub Pages app.

**Architecture:** Keep the application as browser-side JavaScript, adding small CommonJS/browser-global domain modules for draw normalization, prize evaluation, coverage scoring, and backtesting. A scheduled GitHub Action runs a Node importer against Loto-Québec's official page and commits only validated new records; the browser consumes the published snapshot and never scrapes a third-party source directly.

**Tech Stack:** Vanilla JavaScript, Node.js built-in test runner, Express for local dataset serving, Axios/Cheerio for the official-page importer, GitHub Actions, Chart.js already loaded by the app.

**Spec:** `docs/superpowers/specs/2026-10-31-lotto-optimization-design.md`

## Global Constraints

- Preserve the existing number generator, strategy profiles, saved combinations, and analytical tools.
- Use Loto-Québec's official Lotto 6/49 results page as the only automatic-results authority.
- Use a $3 ticket cost; value a 2/6 Free Play as $3.
- Exclude Gold Ball outcomes from all strategy and profitability calculations.
- Show coverage measures and financial measures separately; do not claim prediction or increased expected profit for a fair draw.
- Do not use ML predictions in Prize Optimization; give retained ML controls the same no-prediction disclaimer and remove “confidence” copy.
- Budget is authoritative and ticket count is `floor(budget / 3)`.
- Default walk-forward backtests use all eligible history after a 100-draw warm-up.
- Payout-incomplete draws remain usable for coverage measures but must be excluded from dollar-return aggregates.
- Keep the static GitHub Pages deployment functional; failed imports must never replace valid bundled history.

## Review Focus

- Malformed, duplicate, or out-of-range official draw data must be rejected before it reaches the local snapshot. (Task 1 and Task 4.)
- A ticket budget below $3 or not divisible by $3 must never generate a misleading ticket count or spend total. (Task 2.)
- A missing historical payout must keep the coverage result but remove that draw from dollar-return totals. (Task 3.)
- A backtest must not include the target draw or later draws when building the ticket set for that target. (Task 3.)
- A changed or incomplete official-result page must cause a no-op update with a failure status, never a dataset rewrite. (Task 4.)

---

## File structure

- `prize-engine.js` — normalizes draw records, classifies a ticket's Classic prize category, and calculates cash/Free Play value.
- `prize-optimizer.js` — generates ticket groups and coverage metrics for the three user-selected strategies.
- `backtester.js` — reproducible fair-draw simulations, Quick Pick baseline, and chronological walk-forward aggregation.
- `scripts/update-official-results.js` — fetches/parses Loto-Québec's official result, validates it, and appends a single newer record plus status metadata.
- `data-status.json` — source, last checked/imported timestamp, and import status consumed by the browser; keeps `historical_data.json` backward-compatible as an array.
- `.github/workflows/update-lotto-results.yml` — scheduled/manual importer and conditional data commit.
- `index.html`, `style.css`, `script.js`, `optimizer.js`, `generation.worker.js` — existing UI and generator, extended without a framework rewrite.
- `test/*.test.js`, `test/fixtures/*` — deterministic Node unit tests and official-page fixtures.

### Task 1: Prize-domain model and test harness

**Files:**
- Create: `prize-engine.js`
- Create: `test/prize-engine.test.js`
- Modify: `package.json`

**Interfaces:**
- Produces: `normalizeDraw(draw) -> NormalizedDraw | null`, `classifyTicket(ticket, draw) -> { category, value, isCash, isFreePlay, payoutComplete }`, `summarizeTickets(tickets, draw) -> PrizeSummary`.
- Consumes: current and future entries in `historical_data.json`, including legacy `{ date, numbers, bonus }` entries.

- [ ] **Step 1: Write failing prize-engine tests**

```js
assert.equal(classifyTicket([1, 2, 3, 20, 21, 22], draw).category, '3/6');
assert.equal(classifyTicket([1, 2, 30, 31, 32, 33], draw).value, 3);
assert.equal(normalizeDraw({ date: '2026-01-01', numbers: [1, 1, 2, 3, 4, 5], bonus: 6 }), null);
```

Include category coverage for 2/6, 2/6+B, 3/6, 4/6, 5/6, 5/6+B, and 6/6; include missing payout behavior and the $3 Free Play rule.

- [ ] **Step 2: Run the targeted test to verify it fails**

Run: `node --test test/prize-engine.test.js`

Expected: FAIL because `prize-engine.js` does not exist.

- [ ] **Step 3: Implement the browser/global and CommonJS-compatible `prize-engine.js` interface**

Validate six distinct main numbers and a distinct 1–49 bonus. Preserve legacy records by normalizing absent payouts to `null`; attach new importer metadata without requiring a bulk rewrite of historical data.

- [ ] **Step 4: Add the Node test command and run the test**

Run: `npm test -- --test-name-pattern="prize"`

Expected: PASS.

- [ ] **Step 5: Commit the tested domain model**

```bash
git add package.json prize-engine.js test/prize-engine.test.js
git commit -m "feat: add Lotto prize evaluation domain model"
```

### Task 2: Coverage-based ticket-group generator

**Files:**
- Create: `prize-optimizer.js`
- Create: `test/prize-optimizer.test.js`
- Modify: `index.html`
- Modify: `style.css`

**Interfaces:**
- Consumes: `normalizeDraw` from `prize-engine.js` and options `{ strategy: 'frequent' | 'return' | 'balanced', budget, seed?, searchIterations? }`.
- Produces: `ticketCountFromBudget(budget) -> number`, `calculateCoverageMetrics(tickets) -> CoverageMetrics`, `generatePrizeTicketSet(options) -> { tickets, coverage, strategy, ticketCount }`.

- [ ] **Step 1: Write failing ticket-group tests**

```js
assert.equal(ticketCountFromBudget(30), 10);
assert.throws(() => ticketCountFromBudget(2));
assert.deepEqual(generatePrizeTicketSet({ strategy: 'balanced', budget: 30, seed: 42 }).tickets,
                 generatePrizeTicketSet({ strategy: 'balanced', budget: 30, seed: 42 }).tickets);
```

Assert each ticket has six unique 1–49 numbers, group tickets are unique, Frequent Wins has no worse pair/triplet overlap than the seeded random candidate baseline, and invalid strategy/budget errors are explicit.

- [ ] **Step 2: Run the targeted test to verify it fails**

Run: `node --test test/prize-optimizer.test.js`

Expected: FAIL because `prize-optimizer.js` does not exist.

- [ ] **Step 3: Implement `prize-optimizer.js`**

Use an injected seeded RNG for reproducibility. Generate candidate groups, quantify unique/duplicate pairs and triplets, select by the named coverage objective, and return the metrics used to choose it. Maximum Return and Balanced may use coverage as a tie-breaker but must not report a different mathematical expected profit as a result of chosen numbers.

- [ ] **Step 4: Add the guided Prize Optimization markup and styles**

Add the approved three-card selector, numeric budget input, read-only ticket count, strategy explanation, and no-prediction notice. Keep it separate from the existing generator controls and use accessible radio semantics.

- [ ] **Step 5: Run focused tests and verify the static markup**

Run: `npm test -- --test-name-pattern="ticket|coverage"`

Expected: PASS.

Manually verify at narrow and desktop widths that only one strategy can be selected and a $30 budget displays ten tickets.

- [ ] **Step 6: Commit the generator and selector**

```bash
git add prize-optimizer.js test/prize-optimizer.test.js index.html style.css
git commit -m "feat: add prize strategy ticket-set generator"
```

### Task 3: Fair simulation and walk-forward backtester

**Files:**
- Create: `backtester.js`
- Create: `test/backtester.test.js`

**Interfaces:**
- Consumes: `generatePrizeTicketSet`, `summarizeTickets`, and chronological normalized draws.
- Produces: `simulateFairDraws({ tickets, payoutTable, simulations, seed }) -> SimulationSummary`, `runWalkForwardBacktest({ draws, strategy, budget, warmup: 100, seed }) -> BacktestSummary`, `createQuickPickBaseline(options) -> BacktestSummary`.

- [ ] **Step 1: Write failing backtester tests**

```js
const result = runWalkForwardBacktest({ draws, strategy: 'balanced', budget: 6, warmup: 2, seed: 7 });
assert.equal(result.evaluatedDrawCount, draws.length - 2);
assert.equal(result.financialDrawCount, 1);
assert.equal(result.incompletePayoutDrawCount, 1);
```

Use a spy/stub generator to assert a target draw is generated only from `draws.slice(0, targetIndex)`. Assert a fixed seed produces identical simulation/baseline summaries and that Free Plays contribute $3.

- [ ] **Step 2: Run the targeted test to verify it fails**

Run: `node --test test/backtester.test.js`

Expected: FAIL because `backtester.js` does not exist.

- [ ] **Step 3: Implement reproducible simulation and chronological aggregation**

Simulate uniform fair six-number draws; use actual historical records only for backtesting. Keep coverage totals available for every valid draw, but calculate dollar aggregates only for complete payout records. Return denominators and excluded-draw counts alongside every percentage.

- [ ] **Step 4: Run focused tests**

Run: `npm test -- --test-name-pattern="backtest|simulation|lookahead"`

Expected: PASS.

- [ ] **Step 5: Commit the backtesting engine**

```bash
git add backtester.js test/backtester.test.js
git commit -m "feat: add reproducible prize backtesting"
```

### Task 4: Official Loto-Québec importer and scheduled data publishing

**Files:**
- Create: `scripts/update-official-results.js`
- Create: `test/official-results.test.js`
- Create: `test/fixtures/loto-quebec-valid-result.html`
- Create: `test/fixtures/loto-quebec-incomplete-result.html`
- Create: `.github/workflows/update-lotto-results.yml`
- Create: `data-status.json`
- Modify: `historical_data.json`
- Modify: `server.js`
- Modify: `package.json`

**Interfaces:**
- Produces: `parseOfficialResult(html, sourceUrl) -> OfficialDraw | null`, `mergeOfficialDraw(existingDraws, officialDraw) -> { draws, changed }`, and CLI command `node scripts/update-official-results.js`.
- Consumes: Loto-Québec result-page HTML, existing `historical_data.json`, and `data-status.json`.

- [ ] **Step 1: Write failing parser/merge tests using saved official-page fixtures**

```js
assert.deepEqual(parseOfficialResult(validHtml, sourceUrl).numbers, [1, 10, 18, 21, 22, 49]);
assert.equal(mergeOfficialDraw(existing, conflictingSameDate).changed, false);
assert.equal(parseOfficialResult(incompleteHtml, sourceUrl), null);
```

Cover malformed six-number lists, repeated/out-of-range numbers, absent bonus, invalid payout text, an already-known matching draw, and a conflicting same-date draw.

- [ ] **Step 2: Run the targeted test to verify it fails**

Run: `node --test test/official-results.test.js`

Expected: FAIL because the importer does not exist.

- [ ] **Step 3: Implement the official importer and non-destructive merge**

Fetch only the official Loto-Québec page. Parse main numbers, bonus, and published Classic payout categories when present; record `sourceUrl` and `importedAt`. Write temporary files and atomically replace data/status files only after full validation. Preserve all existing rows and refuse same-date conflicts.

- [ ] **Step 4: Convert `server.js` into a local static-data API only**

Remove the national-lottery scraper and Puppeteer update side effect. `GET /api/results` serves the validated local snapshot and `GET /api/data-status` serves import metadata for local development.

- [ ] **Step 5: Add the GitHub Actions workflow and scripts**

Run at 06:00 UTC Thursday and Sunday plus `workflow_dispatch`; install dependencies, run importer, execute all tests, and commit only changed data/status files using scoped `contents: write` permission. Add `test` and `update:data` package scripts.

- [ ] **Step 6: Run importer/parser tests and a dry run against fixtures**

Run: `npm test -- --test-name-pattern="official|parser|merge"`

Expected: PASS.

Run: `node scripts/update-official-results.js --fixture test/fixtures/loto-quebec-valid-result.html --dry-run`

Expected: reports a validated candidate without changing `historical_data.json`.

- [ ] **Step 7: Commit the update pipeline**

```bash
git add scripts/update-official-results.js test/official-results.test.js test/fixtures .github/workflows/update-lotto-results.yml data-status.json historical_data.json server.js package.json
git commit -m "feat: publish validated official Lotto results"
```

### Task 5: Dashboard integration and honest existing-model copy

**Files:**
- Modify: `index.html`
- Modify: `script.js`
- Modify: `style.css`
- Modify: `advanced_ml_model.js`
- Modify: `generation.worker.js`
- Create: `test/ui-copy.test.js`
- Modify: `README.md`

**Interfaces:**
- Consumes: browser globals from the three new domain modules and `/api/data-status` locally or `data-status.json` on GitHub Pages.
- Produces: `renderPrizeOptimization(result)`, `renderBacktestDashboard(summary)`, and `renderDataStatus(status)` in `script.js`.

- [ ] **Step 1: Write failing UI-copy and result-format tests**

```js
assert.doesNotMatch(readFile('index.html'), /Use ML Predictions|Confidence:/);
assert.match(readFile('index.html'), /does not predict future draws/i);
assert.match(readFile('script.js'), /incompletePayoutDrawCount/);
```

Add a rendering-data test that ensures coverage, gross return, net return, Free Plays, $10+ cash rate, break-even rate, Quick Pick baseline, date range, and excluded counts have independent display fields.

- [ ] **Step 2: Run the targeted test to verify it fails**

Run: `node --test test/ui-copy.test.js`

Expected: FAIL against existing prediction/confidence wording.

- [ ] **Step 3: Wire the strategy flow and dashboard in `script.js`**

Load published data status on initialization, derive ticket count from budget, invoke group generation/backtesting without the ML output, and render all denominators/exclusion labels. Refresh should reload the published snapshot and identify the latest GitHub Action import; it must not scrape an alternative site.

- [ ] **Step 4: Update existing ML and multi-set copy**

Replace `Confidence` with a non-predictive descriptive label, revise the ML toggle/training messages, and add the no-prediction disclaimer without deleting the existing model controls. Keep worker payloads compatible with retained legacy generation.

- [ ] **Step 5: Add responsive dashboard styles and README documentation**

Use readable tables/cards/charts for ticket set, coverage metrics, financial outcomes, and baseline comparison. Document the source, update schedule, Free Play valuation, Gold Ball exclusion, incomplete-payout behavior, static-hosting limitation, and responsible-use disclaimer.

- [ ] **Step 6: Run the complete test suite and manual browser checks**

Run: `npm test`

Expected: PASS.

Manually verify the three strategies, $30-to-ten-ticket derivation, a locally served data-status display, an incomplete-payout backtest label, the Quick Pick comparison, dark mode, and narrow-screen layout.

- [ ] **Step 7: Commit the user-facing integration**

```bash
git add index.html style.css script.js advanced_ml_model.js generation.worker.js test/ui-copy.test.js README.md
git commit -m "feat: add prize optimization dashboard"
```

### Task 6: Final verification and deployment-readiness check

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: all completed modules, tests, workflow, and browser UI.
- Produces: documented local run/test/update commands and deployment caveats.

- [ ] **Step 1: Verify all static references and test commands**

Run: `npm test`

Expected: PASS with every test file executed.

Run: `node scripts/update-official-results.js --fixture test/fixtures/loto-quebec-valid-result.html --dry-run`

Expected: validated dry-run report and no modified data files.

- [ ] **Step 2: Verify the production-page asset loading locally**

Run: `npm start`

Expected: Express starts and both `/api/results` and `/api/data-status` return valid JSON.

Open the app and verify browser console has no missing-script errors and the Prize Optimization flow completes with fixture-compatible data.

- [ ] **Step 3: Document verification results and commit**

```bash
git add README.md
git commit -m "docs: document prize optimizer verification"
```

## Self-review

- **Spec coverage:** Tasks 1–4 implement the data, prize, coverage, simulation, baseline, no-lookahead, source, and static-hosting rules; Task 5 implements all required user-visible controls, distinctions, disclaimers, and metrics; Task 6 verifies the delivered system.
- **Step scan:** Each task starts with a narrow failing test, names exact production interfaces, and ends with an explicit command and commit.
- **Type consistency:** `NormalizedDraw`, `PrizeSummary`, strategy string literals, ticket budget, warm-up, and data-status contracts are defined once and consumed by the downstream tasks.
- **Review focus:** Validation, invalid budget, incomplete payouts, lookahead, and source-page regressions are each pinned by named tests in their owning task.
- **Proportion:** The plan records integration decisions and test proof without prescribing internal loop bodies or UI markup line-for-line.


