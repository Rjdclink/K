# K — sports trading

K is a Neon hosted Kalshi sports trading dashboard. It scans Kalshi Sports milestones and live game data every minute and evaluates two strategies:

- **Whole game overs:** the verified current combined score is strictly above the market's greater-than total. A qualifying trade budgets up to 80% of the current available cash.
- **Late commanding leads:** a verified live game has reached at least 75% of ordinary playing time, a sport-specific minimum lead, and an unambiguous match between the leading team and the YES winner contract. The budget rises with time and lead strength, to a maximum of 80%.

The scanner discovers every Sports milestone. It reports games from any competition, including NBA, NHL, MLB, NFL and CFB. A contract is traded only when its score, timing, market terms and quote can be interpreted safely. It does not infer a winner or total from a game title alone. A lead does not guarantee a win, and an exceeded score does not make every similarly named contract a whole-game over.

## Deployment

Neon project: `floral-wave-57267243`; branch: `br-tiny-hill-b5aiqeg7`; function slug: `k`. Neon injects `DATABASE_URL` from that branch. Apply [schema.sql](schema.sql) once, bundle the function with `npm run build`, zip `dist/index.mjs` at the archive root, then deploy the zip to Neon Functions. The scheduled trigger `k-sports-scan` invokes `/tick` every minute.

Required private Neon Function environment variables:

| Name | Purpose |
| --- | --- |
| `DASHBOARD_PASSWORD` | Basic authentication password for the dashboard (`admin` username). |
| `KALSHI_API_KEY` | Kalshi API key ID. |
| `KALSHI_PRIVATE_KEY` | Full RSA PEM private key, with real newlines or escaped `\\n`. |
| `LIVE_TRADING` | `true` to allow real orders; otherwise scanner and dashboard remain read-only. |
| `MAX_YES_PRICE` | Optional price ceiling, default `0.98`. |

GitHub repository secrets are not readable after creation and are not automatically transferred to a Neon Function. Configure the two Kalshi values in Neon's private function environment. Never commit them to this public repository or expose them to the browser.

The dashboard is available at `https://br-tiny-hill-b5aiqeg7-k.compute.c-7.us-east-2.aws.neon.tech/`. Its balance and positions are read from Kalshi, not estimated from the local ledger. Filled open positions appear in the orders card; settled positions drop out of that card while Kalshi's current account balance reflects their settlement. Failed or uncertain order attempts remain in the private database for review and are not retried automatically. Orders use Fill or Kill, a unique client ID, and a database uniqueness constraint.

## Local checks

Run `npm install && npm test && npm run build`. The app can be served locally with `npm run dev` when `DATABASE_URL` and `DASHBOARD_PASSWORD` are set. The test suite covers threshold strictness, delayed data, lead requirements and bankroll sizing. Before enabling live trading, verify Kalshi credentials against the balance endpoint and confirm actual market/live data field shapes in a read-only scan.
