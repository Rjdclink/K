import {fetchIndependentMatchScore} from './independent_match_score.mjs';
import {basketballTotalNoFeed} from './basketball_no_leagues.mjs';
import {espnMatches} from './score_verification.mjs';
import {espnScoreboardUrls} from './espn_scoreboards.mjs';
import {collegeFootballTotalNo,collegeBasketballTotalNo} from './no_strategy.mjs';

const qualifies=(game,market)=>['CFB','NFL'].includes(game.sport)?collegeFootballTotalNo(game,market,{beforeWindow:true}):
  collegeBasketballTotalNo(game,market,{beforeWindow:true});

export function independentCollegeTotalNoReading(scoreboard,game,milestone,market){
  if(!qualifies(game,market))return false;
  const matches=espnMatches(scoreboard,game,milestone);
  return collegeTotalNoReading(matches,game);
}
function collegeTotalNoReading(matches,game){
  if(matches.length!==1)return false;
  const reading=matches[0];
  if(!reading.eventId||reading.home!==game.home||reading.away!==game.away)return false;
  return {source:'ESPN',eventId:reading.eventId,home:reading.home,away:reading.away,
    period:reading.period,seconds:reading.remainingSeconds};
}

export async function verifyIndependentCollegeTotalNo(game,milestone,market,{fetcher=fetch}={}){
  if(!qualifies(game,market))return null;
  const feed=game.sport==='CFB'?'football/college-football':game.sport==='NFL'?'football/nfl':basketballTotalNoFeed(game.sport);
  if(!feed)return null;
  // ESPN first, retry only when unavailable, then FOX; no source clock check.
  return fetchIndependentMatchScore(game,milestone,{fetcher,espnFeed:feed,foxFeed:game.sport==='CFB'?'cfb':game.sport==='NFL'?'nfl':game.sport==='NCAAB'?'cbk':null});
}