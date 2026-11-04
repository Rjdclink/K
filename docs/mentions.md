# Mention entries

The scheduled Kalshi event, not the market's opening time or the viewer's local
clock, determines the transcript day. The scanner discovers open Mentions
series in rotating batches. Known future events get a calendar check only
until their scheduled day. It tracks future dated contracts, checks YES and
NO asks at or below $0.40, and skips unavailable transcripts immediately.

An event can trade only after an exact official transcript is mapped. Set
`MENTION_OFFICIAL_SOURCES` to a JSON array of event-specific descriptors. A
descriptor requires `eventTicker`, `eventDate` (`YYYY-MM-DD`), `timezone` (IANA),
`scheduledAt` (ISO instant), `url` (the actual official transcript page),
`subject` (the speaker criterion in `rules_primary`), `eventMarker`,
`dateMarker` (an unambiguous date printed by the source), `speakerMarker` or
`speakerMarkers`, and `segments` with exact `start` and `end` markers that
isolate qualifying spoken words. Use `contractTimeMarker` if Kalshi's event
does not provide a matching `strike_date`. The marker must appear in the
event title or market rules. For a corporate issuer's official transcript
host, add the exact hostname to `MENTION_OFFICIAL_HOSTS` as a comma-separated
list. Government `.gov` hosts are accepted by default. Redirects are rejected.
For a call whose transcript URL is not yet published, use `discoveryUrl` for
the issuer's event page and `linkText` for the exact transcript link instead
of `url`. The scanner checks that page on each pass, follows only one matching
link on an approved host, and skips the event until it exists.

For a NO entry, also supply `completeMarker`, `endedAt`, and
`noCoverageConfirmed:true` only after confirming that the selected segments
cover every speaker and portion of the event that can satisfy the contract.
Without complete coverage, the NO side stays blocked. A press release,
earnings presentation, captions, partial highlights, or a generic source
home page is not a qualifying transcript.

The first fetched transcript is persisted per market and side. A second direct
fetch at least 45 seconds later must have the same source, contract, event
date, event start, and transcript hash. Changed text restarts the window.
The final order path rechecks the actual Kalshi market, order book, current
event day, proof freshness, account balance, fees, and total open and pending
mention commitments. It uses a fill-or-kill order and never exceeds 15% of
the current bankroll including fees. If there is no source mapping, discovery
still runs, but no mention orders can be submitted.
