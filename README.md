# Ultimate Lotto 6/49 Quebec Optimizer

A client-side Lotto 6/49 Classic ticket-group coverage tool with historical comparisons and descriptive statistics. Selecting different Classic numbers does not increase expected profit in a fair draw. Neither the coverage search nor the optional ML model predicts future draws; Gold Ball is excluded.

---

## Core Features

*   **Published Official Data:** A scheduled/manual GitHub Action validates newer Classic results from the official source and publishes history/status JSON. Browser refresh and the optional local API read these snapshots only. Failed imports leave both published files unchanged.
*   **Genetic Algorithm for Number Generation:** Instead of simple random selection, the application uses a genetic algorithm to "evolve" populations of number sets over many generations to find combinations with the highest statistical "fitness."
*   **Descriptive ML Model Output:** The optional TensorFlow.js LSTM can train on historical draws. Its output and heuristic scores are not calibrated winning probabilities, confidence estimates, or evidence of future advantage. Existing training, download, upload, and saved-combination controls remain available.
*   **Legacy Strategy Profiles:** Users can select from multiple generation strategies:
    *   **Balanced:** A mix of all statistical factors.
    *   **Aggressive:** Prioritizes "hot" and "overdue" numbers.
    *   **Conservative:** Strictly adheres to the most common statistical patterns.
    *   **Experimental:** Favors "cold" numbers and less common patterns.
*   **Full User Customization:** A dedicated "Custom" strategy panel allows users to set hard constraints, such as sum ranges, and to force the inclusion or exclusion of specific numbers.
*   **Interactive Data Visualization:** The "Statistical Analysis" dashboard uses Chart.js to provide rich, interactive charts for Number Frequencies, Sum Distribution, Odd/Even splits, and High/Low splits.
*   **Complete User Workflow:** Users can generate single or multiple sets, save their favorite combinations to `localStorage`, check them against the latest official results, and delete them individually or all at once.

---

## Tech Stack

*   **Frontend:**
    *   HTML5, CSS3, JavaScript (ES6+)
    *   **Chart.js:** For interactive data visualization.
    *   **TensorFlow.js:** For building and running the client-side ML model.
    *   **Web Workers:** Separate workers run legacy generation and prize generation/full-history comparisons while the page remains responsive.
*   **Backend:**
    *   **Node.js:** JavaScript runtime environment.
    *   **Express.js:** Optional read-only local snapshot API.
    *   **Axios:** Used only by the official-results importer.
    *   **Cheerio:** Strict Classic result parsing in the importer.
    *   **CORS:** To handle cross-origin requests from the frontend.

---

## How to Run This Project

Use Node.js and npm. Install the locked dependencies and run the Node test suite:

```sh
npm ci
npm test
```

Serve this directory with an HTTP static server (for example `python -m http.server 8080`), then open `http://localhost:8080`. Do not open index.html through `file://`: fetch and workers require HTTP. Static GitHub Pages hosting uses the same files without a backend. Chart.js and TensorFlow.js load from their existing CDNs; core prize calculations run locally without those libraries. `npm start` optionally starts the read-only data API on port 3000; it does not serve the frontend or scrape results.

## Prize Optimization and comparison

Choose Frequent Wins, Return analysis (the Maximum Return strategy), or Balanced. Balanced is the default. Enter a positive budget divisible by $3 and an integer seed; ticket count is read-only. Generate a group to see exact pair/triplet coverage and tickets. The strategies redistribute coverage, not expected profit. Return analysis searches by triplet/pair coverage and compares measured outcomes; it does not rank numbers by a monetary advantage.

Run full-history comparison to rebuild a ticket group for each chronological draw after a 100-valid-draw warmup. The worker retains the entire eligible range and runs an equal-budget, equal-date Quick Pick baseline without coverage search. Seed, evaluated dates, invalid/warmup exclusions, and incomplete payout exclusions appear separately. Changing settings invalidates old results; calculation can be cancelled. A $30 replay of the bundled history can take tens of seconds or longer depending on the device and budget.

Coverage of the displayed group is separate from historical results of the strategy. Prize counts and Free Plays cover all evaluated tickets. Dollar totals, $10+ cash rates, break-even rates, and outcome distributions use complete payout records only. Each Free Play counts as $3. Break-even rate includes zero or positive net return; the distribution's middle bucket is exactly zero. Rates show their numerator and denominator. With no complete records, financial metrics say **Unavailable**, never $0.

When a complete recorded payout table exists, the worker also runs 10,000 seeded independent fair draws for the generated group using the latest complete table as a fixed, dated scenario. This scenario is not a forecast and never fills missing historical payouts. The bundled legacy history currently has no complete payout tables, so this financial simulation is unavailable.

## Official publication

The `Publish official Lotto results` GitHub Action is the automatic publishing path. It runs after scheduled draws and can be dispatched manually. Parsing, validation, tests, and safe merge must succeed before publishing; no browser-side confirmation is needed because refresh only reads already-published snapshots. A failure keeps the verified snapshot and timestamps, allowing the browser to flag stale data after four days without a successful published check. Consult workflow logs for unpublished failure diagnostics.

Validate the parser locally without writing either published file:

```sh
node scripts/update-official-results.js --fixture test/fixtures/loto-quebec-valid-result.html --dry-run
```

No API key or paid service is required. Jev integration is outside this phase.
