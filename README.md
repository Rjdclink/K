# K — sports trading

K is a Neon hosted Kalshi sports trading dashboard. It discovers Kalshi Sports milestones periodically and targets a fresh live-data scan every three seconds while eligible live games are present and evaluates two strategies:

- **Whole game overs:** the verified current combined score is strictly above the market's greater-than total. Open over exposure across this app is capped at 80% of the account's current cash plus portfolio value; each order also budgets at most 80% of available cash. The cap uses the exchange's unsettled positions and recorded fills.
- **Late commanding leads:** a verified live timed game has fewer than seven minutes remaining in its final regulation segment, or is in the ninth inning for baseball. Hockey needs at least a two-goal lead in the third period, football at least a ten-point lead in the final quarter, and NBA, WNBA, college basketball and other basketball at least a five-point lead in the final quarter or half. Baseball needs at least a two-run lead in the ninth inning. A lead exactly at its sport's minimum budgets 20% of current Kalshi bankroll (available cash plus portfolio value); a larger lead budgets 30%. An order is capped by available cash, the quote's displayed liquidity, and the price ceiling. An unambiguous match to the YES winner contract is required. Games without a reliable score or clock cannot qualify. Other supported timed sports retain the prior 3.5× scoring-ratio gate, with 20% at that minimum and 30% above it.

The scanner discovers Sports milestones and also checks a matching whole-game TOTAL event ticker when Kalshi separates the total from the winner event. It reports games from any competition, including NBA, NHL, MLB, NFL and CFB. A contract is traded only when its score, timing, market terms and quote can be interpreted safely. It does not infer a winner or total from a game title alone. A lead does not guarantee a win, and an exceeded score does not make every similarly named contract a whole-game over.

## Deployment

Neon project: `floral-wave-57267243`; branch: `br-tiny-hill-b5aiqeg7`; function slug: `k`. Neon injects `DATABASE_URL` from that branch. Apply [schema.sql](schema.sql) once, bundle the function with `npm run build`, zip `dist/index.mjs` at the archive root, then deploy the zip to Neon Functions. The scheduled trigger `k-sports-scan` invokes `/tick` every fifteen minutes. An invocation runs repeated scans at a three-second target cadence while relevant live games are active; it stops when none are present. Slow API responses can extend an individual cycle beyond three seconds. Idle discovery can therefore lag by up to fifteen minutes. Neon free limits do not support uninterrupted three-second scanning around the clock.

Required private Neon Function environment variables:

| Name | Purpose |
| --- | --- |
| `DASHBOARD_PASSWORD` | Basic authentication password for the dashboard (`rjdc` username). |
| `KALSHI_API_KEY` | Kalshi API key ID. |
| `KALSHI_PRIVATE_KEY` | Full RSA PEM private key, with real newlines or escaped `\\n`. |
| `LIVE_TRADING` | `true` to allow real orders; otherwise scanner and dashboard remain read-only. |
| `MAX_YES_PRICE` | Optional price ceiling, default `0.98`. |
| `AI_API_KEY` | Optional Vireonix AI key for the redundant order recovery monitor; the A+ protocol omits Authorization if absent. |
| `AI_BASE_URL`, `AI_MODEL` | Optional Vireonix overrides; defaults match A+ (`https://vireonix.ai/v1/chat/completions`, `auto`). |

GitHub repository secrets are not readable after creation and are not automatically transferred to a Neon Function. Configure the two Kalshi values in Neon's private function environment. Never commit them to this public repository or expose them to the browser.

The dashboard is available at `https://br-tiny-hill-b5aiqeg7-k.compute.c-7.us-east-2.aws.neon.tech/`. Its balance and positions are read from Kalshi, not estimated from the local ledger. Filled open positions appear in the orders card; settled positions drop out of that card while Kalshi's current account balance reflects their settlement. Uncertain submissions and interrupted reservations are checked against Kalshi order history before a single idempotent recovery attempt with the same client order ID. Vireonix reviews missing submissions when configured; if it is unavailable, deterministic recovery remains active. Explicit exchange rejections and unfilled Fill or Kill orders are retained for review and do not cause blind repeat orders. Orders use Fill or Kill, a unique client ID, and a database uniqueness constraint.

## Local checks

Run `npm install && npm test && npm run build`. The app can be served locally with `npm run dev` when `DATABASE_URL` and `DASHBOARD_PASSWORD` are set. The test suite covers threshold strictness, delayed data, lead requirements and bankroll sizing. Before enabling live trading, verify Kalshi credentials against the balance endpoint and confirm actual market/live data field shapes in a read-only scan.
