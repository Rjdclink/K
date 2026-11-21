import {externalNoScore} from './external_no_authority.mjs';
import {fetchIndependentMatchScore} from './independent_match_score.mjs';
import {soccerRegulationSeconds} from './strategy.mjs';
import {espnMatches} from './score_verification.mjs';
import {espnScoreboardUrls} from './espn_scoreboards.mjs';

// Whole-game soccer totals settle after regulation plus stoppage time;
// extra time, shootouts, halves, team totals and player totals are different contracts.
const lineFrom=(value,kind)=>{
  const text=String(value||'');
  const match=kind==='title'
    ?text.match(/^(?:Will over (\d+(?:\.\d+)?) goals be scored\?|Full Game: Over (\d+(?:\.\d+)?) goals scored)$/i)
    :text.match(/^Over (\d+(?:\.\d+)?) goals scored$/i);
  return match?Number(match[1]||match[2]):NaN;
};
const clockMinute=clock=>{
  const match=String(clock||'').trim().match(/^(\d{1,3})(?::([0-5]\d))?(?:\+(\d{1,2}))?['′]?$/);
  if(!match)return NaN;
  return Number(match[1])+Number(match[3]||0)+Number(match[2]||0)/60;
};
// The independent check is precisely the fixture and matching scores.
// Its countdown, period and publication status do not determine entry.
const currentExternal=(reading,game)=>Boolean(
  ['ESPN','FOX Sports','Sportradar'].includes(reading?.source)&&reading.eventId&&
  Boolean(externalNoScore(game,reading)));

export function soccerNoMarketSpec(game,market,{beforeWindow=false}={}){
  const seconds=soccerRegulationSeconds(game);
  if(game?.sport!=='Soccer'||!/^soccer_/.test(String(game.type||''))||
    !game.verifiedLive||!game.scoreKnown||!game.scoreConsistent||!game.periodConsistent||
    game.feedId!==game.id||!Number.isFinite(game.observedAt)||
    Date.now()<game.observedAt||Date.now()-game.observedAt>10000||
    game.period!==2||game.soccerExtraTime||game.soccerOvertime||game.clockRunning===false||
    !Number.isFinite(game.soccerMinute)||!Number.isFinite(seconds)||seconds<=0||
    (beforeWindow?seconds>660:seconds>=480)||
    !Number.isInteger(game.home)||game.home<0||!Number.isInteger(game.away)||game.away<0||
    !['active','open'].includes(market?.status)||
    market.result&&!['','not_determined'].includes(String(market.result)))return null;
  const [series,...suffix]=String(market.event_ticker||'').split('-');
  const [gameSeries,...gameSuffix]=String(game.mainEvent||'').split('-');
  if(!/^KX[A-Z0-9]+TOTAL$/.test(series)||/(?:TEAM|[1-4][HQPS]|HALF|PERIOD)TOTAL$/.test(series)||
    !/^KX[A-Z0-9]+GAME$/.test(gameSeries)||suffix.length===0||
    series!==gameSeries.slice(0,-4)+'TOTAL'||suffix.join('-')!==gameSuffix.join('-')||
    !['greater','greater_than'].includes(market.strike_type))return null;
  const line=Number(market.floor_strike);
  const title=lineFrom(market.title,'title'),subtitle=lineFrom(market.yes_sub_title,'subtitle');
  const rules=String(market.rules_primary||'');
  const ruleLine=Number(rules.match(/^If over (\d+(?:\.\d+)?) goals are scored in the /i)?.[1]);
  if(!Number.isFinite(line)||line!==title||line!==subtitle||line!==ruleLine||
    !/\bsoccer game originally scheduled\b/i.test(rules)||
    !/after 90 minutes plus stoppage time \(does not include extra time or penalties\), then the market resolves to Yes\./i.test(rules)||
    /\b(?:first half|second half|1st half|2nd half|team total|player total)\b/i.test(rules))return null;
  return {strategy:'no',period:'full_game',line,series};
}

export function soccerTotalNo(game,market,{beforeWindow=false,external=null}={}){
  const spec=soccerNoMarketSpec(game,market,{beforeWindow});
  if(!spec||external&&!currentExternal(external,game))return null;
  const score=external?externalNoScore(game,external):{home:game.home,away:game.away};
  if(!score)return null;
  const total=score.home+score.away;
  if(total>=4||spec.line-total<1.5)return null;
  return {...spec,total,reason:
    'Soccer full-game total NO over '+spec.line+'; '+total+
    ' goals scored, '+soccerRegulationSeconds(game)+'s to the 90-minute regulation clock'};
}

// Independent scoreboard verifies score, second-half status, exact fixture,
// and displayed elapsed match minute; the exchange supplies final-whistle countdown.
export function independentSoccerTotalNoReading(scoreboard,game,milestone,market){
  if(!soccerNoMarketSpec(game,market,{beforeWindow:true}))return null;
  const matches=espnMatches(scoreboard,game,milestone,{identityOnly:true});
  if(matches.length!==1)return null;
  const match=matches[0],event=scoreboard.events.find(e=>e.id===match.eventId);
  const status=event?.competitions?.[0]?.status||event?.status;
  const elapsedMinute=clockMinute(status?.displayClock);
  const reading={source:'ESPN',eventId:match.eventId,home:match.home,away:match.away,
    period:match.period,elapsedMinute,live:match.live};
  return currentExternal(reading,game)?reading:null;
}

export async function verifyIndependentSoccerTotalNo(game,milestone,market,{fetcher=fetch}={}){
  if(!soccerNoMarketSpec(game,market,{beforeWindow:true}))return null;
  const feed='soccer/all';
  if(!feed)return null;
  // ESPN first, retry only when unavailable, then FOX; no source clock check.
  return fetchIndependentMatchScore(game,milestone,{fetcher,espnFeed:feed,foxFeed:'soccer'});
}