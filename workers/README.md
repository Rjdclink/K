# Supplemental helpers for the existing Neon system

This version follows the user's clarified supplement-only scope. There is no
scanner handoff, replacement database, alternate trading engine, or hosting
account migration. The earlier standalone-worker design is not activated.

The helper assists one existing Neon task: reading and preparing the public
Sports/Esports milestone catalogue. It adapts the Antenna/Beam concepts of
ordered light work, bounded heavier jobs, measured capacity and task priority.
It never receives Neon credentials, Kalshi keys, positions or user data.

Neon requests the prepared catalogue, validates its shape and age, and writes
it through the existing Neon database cache. Live scores, exact contracts,
external verification, cash, fees, order checks and execution remain in the
existing Neon code. The helper's catalogue is not independent verification.
It has no order endpoint and cannot place or sell a trade.

The original direct catalogue request remains available. Configuration defaults
to disabled. If a helper is absent, expired, slow, invalid or unavailable, Neon
uses its existing direct discovery code. This is an optional supporting component.

## Run and package

`npm run worker:helper` starts the public-data helper. It requires Node 20 or
newer, accepts the provider's `PORT` or `SERVER_PORT`, and exposes:

- `/health`: non-sensitive helper status and measured task counters.
- `/catalog`: complete Sports/Esports public milestone discovery, cached for at
  most 60 seconds. Refreshes are coalesced and rate-limited locally, without
  repeated Neon database quota reservations for catalogue requests.
- `/latency`: seven public exchange-status timings from that host. These do not
  establish a reduction in latency from Neon or improved order-fill speed.

Bundle `workers/supplement.mjs` with esbuild for Node into `server.mjs`. A deploy
package needs only that public bundle and a package.json whose start script is
`node server.mjs`. No private environment, repository history or account keys
are included. `src/catalog_helper_config.mjs` stores only a public helper URL and
its documented expiry, never an account secret.

## Current deployment status

No supplemental host is connected. The attempted no-signup deployment was
blocked by automatic approval review. The package contains no credentials or
private trading data; deployment must still satisfy the platform's approval
checks. The public-source package can be reviewed before any permitted retry.

The no-signup hosts examined provide temporary free deployments (24–72 hours),
not verified permanent free hosting. An expired helper must not interrupt the
existing Neon system. Do not invent an expiry or claim that a temporary URL
will stay available indefinitely.

## Measurement

The existing `Sports discovery` log gains a `source` value of `direct` or
`supplement`. Compare actual `elapsedMs` values after a helper is connected.
Report the scope as catalogue loading/preparation, not exchange order latency.
Seven status requests from another host alone cannot establish a millisecond
reduction against Neon. No bill reduction has been measured; actual provider
usage, including added coordination and network work, must be checked.
