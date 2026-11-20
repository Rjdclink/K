// These are the basketball leagues with a known, fixture-matchable ESPN
// scoreboard. Unknown international competitions remain ineligible.
export const INTERNATIONAL_BASKETBALL_NO_FEEDS=Object.freeze({
  NBL:'basketball/nbl',
  'Australia NBL':'basketball/nbl',
  FIBA:'basketball/fiba',
  'FIBA World Cup':'basketball/fiba',
  "Olympics Men's Basketball":'basketball/mens-olympics-basketball',
  "Olympics Women's Basketball":'basketball/womens-olympics-basketball'
});

const basketballFeeds=Object.freeze({
  NBA:'basketball/nba',
  WNBA:'basketball/wnba',
  NCAAB:'basketball/mens-college-basketball',
  NCAAW:'basketball/womens-college-basketball',
  ...INTERNATIONAL_BASKETBALL_NO_FEEDS
});

export const basketballTotalNoFeed=sport=>basketballFeeds[sport]||null;
export const basketballTotalNoSupported=sport=>Boolean(basketballTotalNoFeed(sport));
export const basketballNoOnlyInternational=sport=>
  Boolean(INTERNATIONAL_BASKETBALL_NO_FEEDS[sport]);