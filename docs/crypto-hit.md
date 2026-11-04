# Crypto hit entries

The Crypto card appears below Bankroll and above Mentions. The independent
Crypto tick surveys open Crypto series whose titles suggest an above, below,
high, low, hit, touch, minimum, or maximum outcome. It accepts only markets
whose exact rules describe a qualifying minute on a named CF Benchmarks index,
with a known simple or 20% trimmed mean. Price-at-a-future-time contracts,
two-threshold races, unsupported settlement methods, missing index access,
partial minutes, repeated benchmark values, and uncertain data fail closed.

The first verification starts after all 60 per-second CF index values for a
qualifying minute are published. Two further uncached reads of the same minute
must match after at least 15 and then 20 seconds. A changed index value restarts
the sequence. The CF data comes from the authenticated Kalshi passthrough,
which forwards values unchanged from CF Benchmarks and requires the account's
CF data entitlement. An exchange quote or TradingView price is never evidence.
Only YES for a proven crossing can enter before the deadline. An open-window
NO cannot be proved by absence of a crossing.

Before a fill-or-kill buy, the system rechecks the market rules, open status,
close time, current executable ask and orderbook depth, cash, reserved fees,
filled-position profit floor, and a 15% aggregate crypto exposure cap including
pending attempts. A stale third check blocks entry. Once the market is closed,
the scanner cannot place a new order even if the benchmark later confirms it.

Schedule `POST /crypto/tick` as a separate once-per-minute Neon function
trigger. A single invocation surveys the catalog once and rechecks known
contracts approximately every five seconds until the next minute; this allows
the 15- and 20-second windows without surveying all series repeatedly.
Automatic entries require `CRYPTO_HIT_TRADING=true` in the running function.
Keep it unset during the first live CF entitlement and source-format check.
