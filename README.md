# K — sports trading

K is a Neon hosted Kalshi sports trading dashboard. It discovers Kalshi Sports milestones periodically and targets a fresh live-data scan every three seconds while eligible live games are present and evaluates two strategies:

- **Whole game overs:** the verified current combined score is strictly above the market's greater-than total. Open over exposure across this app is capped at 80% of the account's current cash plus portfolio value; each order also budgets at most 80% of available cash. The cap uses the exchange's unsettled positions and recorded fills.
- **Late commanding leads:** a verified live timed game has fewer than seven minutes remaining in its final regulation segment, or is in the ninth inning for baseball. Hockey needs at least a two-goal lead in the third period, football at least a ten-point lead in the final quarter, and NBA, WNBA, college basketball and other basketball at least a five-point lead in the final quarter or half. Baseball needs at least a two-run lead in the ninth inning. Soccer begins at 83:00 in the second half, including stoppage time, with a two-goal minimum; its contract must settle on the result after 90 minutes plus stoppage time, excluding extra time and penalties. Tennis requires a 5–3 or better lead in the set that could clinch the match, with one set already won in best-of-three or two in best-of-five; 5–3 budgets 20%, while 5–2 or wider budgets 30%. The tennis feed must identify the server and point score, and the opponent must not have a game point. A lead exactly at its sport's minimum budgets 20% of current Kalshi bankroll (available cash plus portfolio value); a larger lead budgets 30%. An order is capped by available cash on the market's exchange shard, the quote's displayed liquidity, and the price ceiling. An unambiguous match to the YES game or match winner contract is required; spread and set-winner markets are excluded. Games without a reliable score or clock cannot qualify.

The scanner discovers Sports milestones and also checks a matching whole-game TOTAL event ticker when Kalshi separates the total from the winner event. It reports games from any competition, including NBA, NHL, MLB, NFL and CFB. A contract is traded only when its score, timing, market terms and quote can be interpreted safely. It does not infer a winner or total from a game title alone. A lead does not guarantee a win, and an exceeded score does not make every similarly named contract a whole-game over.

## Deployment

Neon project: `floral-wave-57267243`; branch: `br-tiny-hill-b5aiqeg7`; function slug: `k`. Neon injects `DATABASE_URL` from that branch. Apply [schema.sql](schema.sql) once, bundle the function with `npm run build`, zip `dist/index.mjs` at the archive root, then deploy the zip to Neon Functions. The scheduled trigger `k-sports-scan` invokes `/tick` every minute. An invocation runs repeated scans at a three-second target cadence while relevant live games are active; it stops when none are present. Slow API responses can extend an individual cycle beyond three seconds. Idle discovery can therefore lag by up to one minute. Neon free limits do not support uninterrupted three-second scanning around the clock.

Required private Neon Function environment variables:

| Name | Purpose |
| --- | --- |
| `DASHBOARD_PASSWORD` | Basic authentication password for the dashboard (`rjdc` username). |
| `KALSHI_API_KEY` | Kalshi API key ID. |
| `KALSHI_PRIVATE_KEY` | Kalshi private key as RSA PEM, Ed25519 PEM, or base64-encoded PKCS#8 DER. PEM accepts real newlines or escaped `\\n`. |
| `LIVE_TRADING` | `true` to allow real orders; otherwise scanner and dashboard remain read-only. |
| `MAX_YES_PRICE` | Optional price ceiling, default `1.00`. |
| `FEE_MULTIPLIER_RESERVE` | Optional affordability buffer, default twice the standard Kalshi taker fee estimate. |
| `AI_API_KEY` | Optional Vireonix AI key for the redundant order recovery monitor; the A+ protocol omits Authorization if absent. |
| `AI_BASE_URL`, `AI_MODEL` | Optional Vireonix overrides; defaults match A+ (`https://vireonix.ai/v1/chat/completions`, `auto`). |

GitHub repository secrets are not readable after creation and are not automatically transferred to a Neon Function. Existing readable GitHub variables can be securely copied during a Neon deployment; the values must not be committed. Never commit them to this public repository or expose them to the browser.

The dashboard is available at `https://br-tiny-hill-b5aiqeg7-k.compute.c-7.us-east-2.aws.neon.tech/`. Its bankroll card shows Kalshi available cash plus portfolio value, with both components shown separately. The balance and positions are fetched independently so a positions failure cannot blank a valid balance; neither is estimated from the local ledger. Filled open positions appear in the orders card; settled positions drop out of that card while Kalshi's current account balance reflects their settlement. Uncertain submissions and interrupted reservations are checked against Kalshi order history before a single idempotent recovery attempt with the same client order ID. Vireonix reviews missing submissions when configured; if it is unavailable, deterministic recovery remains active. Explicit exchange rejections remain visible in the attempt record; a rejected order is retried only after a relevant quote or available-balance change. An Immediate or Cancel order with no fill can be attempted again on a later scan while the signal still qualifies. Earlier attempt details are retained in `attempt_history`. Orders use a unique client ID and a database uniqueness constraint. A preflight sizes each order within available cash and its allocation, including a conservative fee estimate. When the cash is on a different Kalshi exchange shard, the app requests an idempotent internal transfer, records it in `funding_transfers`, and waits for actual destination cash before attempting the order. Transfers do not move funds outside the Kalshi account. Kalshi can still reject or leave an order unfilled if its quote, liquidity, fee schedule or account state changes.

## Local checks

Run `npm install && npm test && npm run build`. The app can be served locally with `npm run dev` when `DATABASE_URL` and `DASHBOARD_PASSWORD` are set. The test suite covers threshold strictness, delayed data, lead requirements and bankroll sizing. Before enabling live trading, verify Kalshi credentials against the balance endpoint and confirm actual market/live data field shapes in a read-only scan.
