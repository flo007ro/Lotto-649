# Lotto 6/49 prize-optimization upgrade

## Intent

Extend the existing client-side Lotto 6/49 optimizer with a transparent ticket-group coverage optimizer, official historical result imports, walk-forward backtesting, and a profitability dashboard. The product must make a strict distinction between distributing coverage across a group of tickets and increasing expected profit or predicting future draws; it must never claim the latter.

## Goals

- Preserve the existing number generator, strategy profiles, saved combinations, and analytical tools.
- Add a dedicated Prize Optimization flow where the player chooses one of three selectable strategies before generating ticket groups:
  - **Frequent Wins:** minimize duplicate pairs/triplets within the group to spread coverage of smaller outcomes (especially 2/6 and 3/6).
  - **Maximum Return:** rank generated groups by simulated financial outcomes: gross return, net return, and break-even occurrence.
  - **Balanced:** show both coverage and return measures, without conflating them. This is the default experiment.
- Store local historical results including draw date, six Classic numbers, bonus number, prize categories/payouts when published, official source URL, and import timestamp.
- Use a scheduled GitHub Actions job to read Loto-Québec's public official Lotto 6/49 results page, validate a newer record, and commit it to the bundled dataset. On app open, show the current verified dataset's update status; a manual refresh reloads the published dataset rather than bypassing static-hosting restrictions.
- Backtest each strategy with a chronological walk-forward replay. A ticket group evaluated for a historical draw may use only results dated before that draw.
- Compare each strategy with equal-ticket-count random Quick Pick baselines and report the comparison clearly.
- Show spending, gross prize value, net return, Free Plays, prize rate, $10-or-more cash-win rate, break-even rate, and outcome distributions.

## Scope and measurement rules

- A $3 ticket cost is used for each play.
- A 2/6 Free Play has a $3 value for return and break-even totals.
- The separate Gold Ball result is excluded from coverage and profitability analysis because Classic-number selection does not influence it.
- Use recorded draw-specific prize payouts for variable Classic categories when available. Mark a financial result incomplete when a historical draw lacks needed payout data rather than estimating a value.
- The dashboard must display coverage metrics separately from financial metrics. It must state that a fair draw's expected profit is not increased by selecting different Classic numbers; group optimization can only redistribute coverage/outcomes among the tickets.
- Historical number frequencies can be displayed as descriptive information, but never used to promise prediction accuracy or future advantage.
- The Prize Optimization flow must not use the existing ML predictions or labels. The existing ML controls must carry the same no-prediction disclaimer and replace "confidence" copy with a descriptive model-output label.
- Ticket budget is authoritative; ticket count is `floor(budget / 3)` and is displayed as read-only in the Prize Optimization flow.
- Maximum Return uses a reproducible fair-draw simulation and recorded historical payouts for backtests. It reports return distributions and break-even frequency; it must not claim a higher expected profit for any valid ticket group.
- The default backtest spans all eligible records after a 100-draw warm-up; the dashboard exposes the evaluated date range and number of excluded warm-up/incomplete-payout draws.

## UX

- Add a separate Prize Optimization entry point without removing the existing Number Generator.
- The initial screen uses three guided strategy cards, with Balanced preselected. It includes ticket budget, ticket count, and a description of the selected objective.
- Results identify the selected strategy and display the strategy's coverage objective, generated tickets, exact/simulated results, and the Quick Pick baseline.
- The update control visibly identifies Loto-Québec as the official source, distinguishes check/import/error states, and asks for confirmation before adding a new draw.
- The profitability dashboard labels incomplete records/ranges and excludes them from dollar-return aggregates while keeping non-financial coverage results available.

## Existing application context

The public GitHub Pages app is a plain JavaScript project. Its repository contains `index.html`, `style.css`, `script.js`, `optimizer.js`, `generation.worker.js`, `advanced_ml_model.js`, `server.js`, `historical_data.json`, and `package.json`. The running site already exposes multiple-set generation, a data-refresh control, historical draw count, wheeling, frequency/pattern/affinity tools, and an ML model. New work should integrate with those files rather than rebuild the application.

## Non-goals

- Do not guarantee prizes, profitability, or number prediction.
- Do not imply that ML, hot/cold numbers, overdue numbers, or past results make a future number more likely to be drawn.
- Do not purchase tickets, transmit user data, or require a paid service.
- Do not include the Gold Ball or unrelated add-on games in the first release.

## Implementation assumptions owned by the builder

- Keep implementation dependency-light and compatible with static GitHub Pages hosting.
- Import/update failures are non-destructive and preserve the existing local dataset.
- Exact coverage tie-breakers, simulation count, and dashboard chart presentation are engineering choices, provided that their definitions are visible in the app and reproducible from the stored data.
- If browser cross-origin restrictions prevent direct client-side reading of the official page, build a safe local/importable update path and document the limitation rather than bypassing browser protections.


