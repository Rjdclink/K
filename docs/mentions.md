# Mention entries

The scheduled Kalshi event, not the market's opening time or the viewer's local
clock, determines the transcript day. The scanner discovers open Mentions
series in bounded parallel batches across the full catalog on its first pass.
The date survey is persisted; same-day series are refreshed on later passes,
future-only series are rechecked on the next Eastern calendar day or when
Kalshi reports a series update, and empty series are rechecked after 15
minutes. The initial pass may take several minutes at the shared Kalshi read limit. The
catalog pass reads event dates first and fetches nested market details only
for events dated today in Eastern time. Known future mapped events get a
calendar check only until their scheduled day. It tracks future dated contracts, checks YES and
NO asks at or below $0.65, and skips unavailable transcripts immediately.
Available mapped events and their contracts are attempted from the lowest
qualifying ask upward. The dashboard shows Bankroll first, then Crypto,
Mentions, and Games found. The Mentions card displays per-pass coverage, asks,
deferred events, and checks.

The scanner reads the event's `settlement_sources` supplied with Kalshi's
contract rules and reports the named publisher URLs for today's events. A
source binding must match that exact URL; an AI lead or a search result cannot
replace the publisher named by the rules. The URL can be a webcast or events
listing and does not itself prove the spoken words.

An event can trade only after an exact official transcript is bound to that
rule source. The scanner independently fetches the publisher document and
checks its date, time, speakers, and text before three separate reads. No AI
source locator or review runs. A webcast without a readable caption or
transcript stays blocked. To bind a source explicitly, set
`MENTION_OFFICIAL_SOURCES` to a JSON array of event-specific descriptors. A
descriptor requires `eventTicker`, `ruleSourceUrl` (the exact Kalshi
`settlement_sources` URL), `eventDate` (`YYYY-MM-DD`), `timezone` (IANA),
`scheduledAt` (ISO instant), `url` (the actual official transcript page),
`subject` (the speaker criterion in `rules_primary`), `eventMarker`,
`dateMarker` (an unambiguous date printed by the source), `speakerMarker` or
`speakerMarkers`, and `segments` with exact `start` and `end` markers that
isolate qualifying spoken words. Use `contractTimeMarker` if Kalshi's event
does not provide a matching `strike_date`. The marker must appear in the
event title or market rules. The host named by Kalshi's rule source and
government `.gov` hosts are accepted. For a linked transcript on another
publisher host explicitly named in the rules, add the exact hostname to
`MENTION_OFFICIAL_HOSTS` as a comma-separated list. Redirects are rejected.
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

Ambiguous or unavailable external evidence cannot authorize a trade. The
function does not call Claude for source discovery or verification, regardless
of whether a key remains stored in its environment.

The first fetched transcript is persisted per market and side even when its
current ask is above $0.65. If that ask falls to $0.65 or less while the
same proof window remains valid, the checks continue without starting a new
timer. An order still requires the qualifying ask at both final market and
order-book checks. A second direct fetch at least 50 seconds after the first
and a third at least 30 seconds after the second must have the same source,
contract, event date, event start, and transcript hash. Changed text restarts
the window.
The final order path rechecks the actual Kalshi market, order book, current
event day, proof freshness, account balance, fees, and total open and pending
mention commitments. It uses a fill-or-kill order and never exceeds 15% of
the current bankroll including fees. If there is no verified source binding,
discovery still runs, but no mention orders can be submitted.

Schedule a separate Neon function trigger for `POST /mentions/tick` once per
minute. This keeps broad mention discovery out of the live sports `/tick`
request. On the event day, the same invocation rechecks mapped events
approximately every five seconds while the date survey is running;
the series catalog is fetched only once per invocation. The first successful
direct read starts the proof window, including when the ask is above
65 cents. Function start and source publication delays mean detection cannot
be guaranteed at the literal publication instant. A database lock prevents
overlapping mention passes.
