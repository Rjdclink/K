# Mention entries

The scheduled Kalshi event, not the market's opening time or the viewer's local
clock, determines the transcript day. The scanner discovers open Mentions
series in rotating batches (48 per minute, including the 12 most recently
updated; a 465-series catalog is covered within 13 passes). Known future
mapped events get a calendar check only
until their scheduled day. It tracks future dated contracts, checks YES and
NO asks at or below $0.40, and skips unavailable transcripts immediately.
Available mapped events and their contracts are attempted from the lowest
qualifying ask upward. The dashboard shows Bankroll first, then a separate
Mentions card above Games found with per-pass coverage, asks, deferred events,
and checks.

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
For search-based URL discovery, provide `searchQuery` instead of `url` and set
`MENTION_BRAVE_SEARCH_KEY` in the function environment. The scanner searches
only on the scheduled event day, considers at most five official or explicitly
approved host pages, and requires exactly one page to pass the same event,
date, speaker, and segment checks. Search snippets never count as transcript
evidence. Google's Custom Search JSON API is closed to new customers, so
this optional search route uses the supported Brave Search API. Search is
only a way to find the publisher's page; it cannot create missing transcripts.

For a NO entry, also supply `completeMarker`, `endedAt`, and
`noCoverageConfirmed:true` only after confirming that the selected segments
cover every speaker and portion of the event that can satisfy the contract.
Without complete coverage, the NO side stays blocked. A press release,
earnings presentation, captions, partial highlights, or a generic source
home page is not a qualifying transcript.

Each mapping requires checking the publisher's actual transcript, event date,
broadcast time, and every qualifying speaker segment. Kalshi's settlement
source may be a webcast rather than a transcript. For example, Wendy's
November 5, 2026 investor page currently advertises a webcast, not a
published official transcript; it cannot be mapped until one appears. If a
publisher never posts an official transcript, the event remains blocked.
The registry cannot promise coverage merely because Kalshi lists a market.

When `ANTHROPIC_API_KEY` is present in the running Neon function, ambiguous
external evidence can be summarized by Vireonix and reviewed by Claude Haiku.
Only public, bounded discrepancy details are sent; Kalshi credentials and
account data are not. A model result cannot establish a missing transcript,
resolve conflicting official pages into an order, or bypass the direct source
and final contract checks. Routine clean reads make no model request.
GitHub repository and environment secrets are not automatically injected into
Neon function deployments; the same key must be set in the function's own
environment before this path can be exercised live.

The first fetched transcript is persisted per market and side even when its
current ask is above $0.40. If that ask falls to $0.40 or less while the
same proof window remains valid, the next direct read can complete the
45-second pair without starting a new timer. An order still requires the
qualifying ask at both final market and order-book checks. A second direct
fetch at least 45 seconds later must have the same source, contract, event
date, event start, and transcript hash. Changed text restarts the window.
The final order path rechecks the actual Kalshi market, order book, current
event day, proof freshness, account balance, fees, and total open and pending
mention commitments. It uses a fill-or-kill order and never exceeds 15% of
the current bankroll including fees. If there is no source mapping, discovery
still runs, but no mention orders can be submitted.

Schedule a separate Neon function trigger for `POST /mentions/tick` once per
minute. This keeps broad mention discovery out of the live sports `/tick`
request. On the event day after the scheduled start, the same invocation
rechecks mapped events approximately every five seconds until the next minute;
the broad catalog is fetched and surveyed only once. The first successful
direct read starts the 45-second proof window, including when the ask is above
40 cents. Function start and source publication delays mean detection cannot
be guaranteed at the literal publication instant. A database lock prevents
overlapping mention passes.
