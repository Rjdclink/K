# Live clock and sports scan repair — November 4, 2026

## Production evidence

The sports trigger was enabled and scans were completing without a recorded
scan error. At 19:19 UTC the status row reported 1,590 catalog milestones,
61 live games checked and five signals. Those counts represent different
stages, not 1,590 executable markets.

Kalshi's public live feed for milestone
`7dea4ef8-09a5-590b-941b-68cb31a3a0bb` (Arkansas–Pine Bluff at Tarleton)
returned `status: inprogress`, period 4, score 47–66, and
`period_remaining_time: End of 4th Quarter`. The numeric parser correctly
refused to use that text as an entry countdown, but the dashboard discarded
the useful phase and displayed “Live clock unavailable.” The feed later
changed to `closed`; the dashboard snapshot still said `live`.

Other completed games also remained live in the snapshot table. BC Vienna
at Nitra and Galatasaray at Legia had current closed feed responses but old
market-scan timestamps. Their recent score timestamps had continued updating.

A separate public API sample covered 581 milestones started within the
preceding eight hours and returned 577 feeds. Most were already complete,
closed, ended or cancelled. Parsing the sample at the time of inspection
identified 59 verified live games, of which 42 met the existing sport/score
eligibility filters. This is a bounded sample, not the entire Kalshi catalog.

## Causes and repair

1. The main scanner filtered out completed and stale games before persisting
   their latest status. It now publishes observations for tracked games before
   narrowing the executable universe, clears their old signals when inactive
   or final, and leaves missing feed responses unclassified.
2. Dashboard refresh and warm-start selection used `scanned_at` (the market
   check timestamp) to decide whether a score was recent. Deferred-market
   games aged out despite current score observations. These selectors now
   also use `score_observed_at`. Refresh retains the full milestone metadata.
3. Three snapshot writers used different ordering rules. Some accepted an
   older response simply because its countdown was lower, rejected legitimate
   upward clock corrections, or lost pause transitions. They now share one
   PostgreSQL writer ordered by score observation time. Market/quote freshness
   remains separate; unchanged clocks do not restart countdown extrapolation.
4. Known end-of-period text is preserved as a phase label. Missing numeric
   time remains nonnumeric and cannot qualify a clock-dependent trade.

The repair is based on `feat/crypto-hit-entry`, whose revision and feature
configuration matched the deployment inspected, rather than the older `main`.
It also preserves the concurrent evidence-review fix in `f5eafb5`. It does not change entry thresholds, allocations,
independent verification, enabled trading categories or credentials.

## Verification

The Node test suite includes an embedded PostgreSQL regression exercising
the actual writer and dashboard refresh SQL: current scores with a two-hour-old
market scan, clock correction, late responses, pause transitions, terminal
updates and stale attempts to resurrect a completed game. Parser regressions
cover the observed end-of-quarter payload and missing clock data. The Neon
split bundle is built separately from the test-only PostgreSQL dependency.

Kalshi documents that live-data status is more current than milestone status,
but cached live feeds can still be stale and some providers never set the
delay flag: https://docs.kalshi.com/api-reference/live-data/get-live-data.
The existing source-freshness and independent verification gates remain.
