# ESPN and Sportradar verification check — 2026-11-02

20 completed games listed on Kalshi (10 NFL, 10 NBA) were matched by league, opponents and scheduled start. All 20 final scores and final statuses agreed. Scores below are away–home. This is agreement between feeds, not an independent accuracy benchmark or measurement of live update latency. It does not rank player-stat accuracy. Two candidate NFL fixtures were excluded when the comparison script could not resolve their team-code aliases; NBA fixtures filled those slots.

| Kalshi event | Game | ESPN | Sportradar | Result |
|---|---|---|---|---|
| KXNFLGAME-26NOV01BALBUF | Baltimore Ravens at Buffalo Bills | 10-36 | 10-36 | Match |
| KXNFLGAME-26NOV01TENCIN | Tennessee Titans at Cincinnati Bengals | 36-43 | 36-43 | Match |
| KXNFLGAME-26NOV01ARIDAL | Arizona Cardinals at Dallas Cowboys | 33-30 | 33-30 | Match |
| KXNFLGAME-26NOV01MINDET | Minnesota Vikings at Detroit Lions | 15-19 | 15-19 | Match |
| KXNFLGAME-26NOV01LVNYJ | Las Vegas Raiders at New York Jets | 38-33 | 38-33 | Match |
| KXNFLGAME-26NOV01CLEPIT | Cleveland Browns at Pittsburgh Steelers | 6-27 | 6-27 | Match |
| KXNFLGAME-26NOV01ATLTB | Atlanta Falcons at Tampa Bay Buccaneers | 0-16 | 0-16 | Match |
| KXNFLGAME-26NOV01KCDEN | Kansas City Chiefs at Denver Broncos | 24-28 | 24-28 | Match |
| KXNFLGAME-26NOV01NEMIA | New England Patriots at Miami Dolphins | 24-19 | 24-19 | Match |
| KXNFLGAME-26NOV01PHIWAS | Philadelphia Eagles at Washington Commanders | 10-27 | 10-27 | Match |
| KXNBAGAME-26NOV01BOSORL | Boston Celtics at Orlando Magic | 108-97 | 108-97 | Match |
| KXNBAGAME-26NOV01BKNIND | Brooklyn Nets at Indiana Pacers | 98-90 | 98-90 | Match |
| KXNBAGAME-26NOV01LACGSW | LA Clippers at Golden State Warriors | 112-124 | 112-124 | Match |
| KXNBAGAME-26NOV01TORLAL | Toronto Raptors at Los Angeles Lakers | 125-131 | 125-131 | Match |
| KXNBAGAME-26OCT31PORUTA | Portland Trail Blazers at Utah Jazz | 112-90 | 112-90 | Match |
| KXNBAGAME-26OCT31PHICHA | Philadelphia 76ers at Charlotte Hornets | 109-104 | 109-104 | Match |
| KXNBAGAME-26OCT31ATLNOP | Atlanta Hawks at New Orleans Pelicans | 99-121 | 99-121 | Match |
| KXNBAGAME-26OCT31SACMEM | Sacramento Kings at Memphis Grizzlies | 105-136 | 105-136 | Match |
| KXNBAGAME-26OCT31CLEMIL | Cleveland Cavaliers at Milwaukee Bucks | 136-111 | 136-111 | Match |
| KXNBAGAME-26OCT31MINSAS | Minnesota Timberwolves at San Antonio Spurs | 111-121 | 111-121 | Match |

## Reproducible sources

- Kalshi: `GET https://external-api.kalshi.com/trade-api/v2/events?series_ticker=KXNBAGAME&limit=100` and `KXNFLGAME`.
- ESPN: `https://site.api.espn.com/apis/site/v2/sports/{basketball/nba|football/nfl}/scoreboard?dates=YYYYMMDD&limit=500` (NFL November 1; NBA October 31 and November 1, 2026).
- Sportradar NBA: `/nba/trial/v8/en/games/2026/{10/31|11/01}/schedule.json`. NFL: `/nfl/official/trial/v7/en/games/current_week/schedule.json` (2026 regular season week 8). Authentication uses the backend `x-api-key` header.

## Integration findings

The original authentication failure was caused by an application with no active product subscriptions. The same key returned HTTP 200 after trial activation. Twenty-two products were activated, including NFL, NBA, WNBA, NCAA football/basketball/hockey, MLB, NHL, global team sports, soccer, tennis, table tennis, golf, rugby, handball, volleyball, darts and cricket. Access probes returned HTTP 200 from each product after correcting the product-specific routes (notably `tabletennis`, `rugby-union`, and the tour segment in Golf).

Trials end December 2, 2026. Each shows a 1,000-request quota and 1 request/second. This is fallback capacity, not sufficient for unrestricted continuous polling. Rate limits, expired trials, unavailable fixtures and unimplemented player-stat fields fail closed. No corresponding lacrosse or virtual eSoccer/eBasketball product was found in the available 52-product catalog.

ESPN remains primary. No ESPN URL is retried within a decision. Sportradar starts immediately after an unavailable ESPN result, including while the existing parallel NBA check is pending. An actual ESPN or official-NBA contradiction remains a veto. Lower-ranked existing sources remain available only when higher-ranked sources are unavailable.
