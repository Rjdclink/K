import {externalNoScore} from './external_no_authority.mjs';
import {verifyFreshEspnSoccerNo,independentlyVerifiedSoccerGame} from './soccer_espn_no.mjs';
import {soccerRegulationSeconds} from './strategy.mjs';
import {espnMatches} from './score_verification.mjs';
import {espnScoreboardUrls} from './espn_scoreboards.mjs';
import {goalNoWindow} from './goal_no_windows.mjs';

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
// Independent fixture, score, and match time determine whether the exact
// Kalshi contract has enough goal cushion within its regulation window.
const currentExternal=(reading,game)=>Boolean(
  ['ESPN','FOX Sports','BBC Sport'].includes(reading?.source)&&reading.eventId&&
  Boolean(externalNoScore(game,reading)));

// Kalshi full-game totals include regulation stoppage, but not the separate
// extra-time phases. Require an explicitly advancing 90+ live match clock.
export function soccerStoppageNoWindow(game){
 return Boolean(game?.sport==='Soccer'&&/^soccer_/.test(String(game.type||''))&&
   game.verifiedLive&&game.period===2&&game.clockRunning===true&&
   !game.soccerExtraTime&&!game.soccerOvertime&&
   Number.isFinite(game.soccerMinute)&&game.soccerMinute>90&&
   game.matchRemainingSeconds===0);
}
export function soccerNoMarketSpec(game,market,{beforeWindow=false}={}){
  const seconds=soccerRegulationSeconds(game),stoppage=soccerStoppageNoWindow(game);
  if(game?.sport!=='Soccer'||!/^soccer_/.test(String(game.type||''))||
    !game.verifiedLive||!game.scoreKnown||!game.scoreConsistent||!game.periodConsistent||
    game.feedId!==game.id||!Number.isFinite(game.observedAt)||
    Date.now()<game.observedAt||Date.now()-game.observedAt>10000||
    game.period!==2||game.soccerExtraTime||game.soccerOvertime||game.clockRunning===false||
    !Number.isFinite(game.soccerMinute)||!Number.isFinite(seconds)||
    (!stoppage&&(seconds<=0||seconds>960))||
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
  const window=goalNoWindow(game,market,game.home+game.away);
  if(beforeWindow){
    if(window?.stoppageOnly?stoppage||seconds>window.firstSeconds:
      !stoppage&&seconds>(window?.firstSeconds??660))return null;
  }else if(window?.stoppageOnly?!stoppage:
    !stoppage&&seconds>=(window?.entrySeconds??300))return null;
  return {strategy:'no',period:'full_game',line,series};
}

export function soccerTotalNo(game,market,{beforeWindow=false,external=null}={}){
  const verified=external?independentlyVerifiedSoccerGame(game,external):null;
  const score=external?externalNoScore(game,external):{home:game.home,away:game.away};
  if(!score||external&&!currentExternal(external,game))return null;
  const sourceGame=verified||{...game,home:score.home,away:score.away};
  const spec=soccerNoMarketSpec(sourceGame,market,{beforeWindow});
  if(!spec)return null;
  const total=score.home+score.away;
  if(total>=5)return null;
  // A full 2.5-goal cushion uses eight minutes through four goals.
  // The 1.5-goal window enters only in confirmed live stoppage AFTER 90.
  const window=goalNoWindow(sourceGame,market,total);
  const required=window?.entrySeconds===900?0.5:
    window?.entrySeconds===480?spec.line===2.5&&total===1?1.5:2.5:
    window?.stoppageOnly?1.5:soccerStoppageNoWindow(sourceGame)?1.5:total>=4?3.5:2.5;
  if(spec.line-total<required)return null;
  return {...spec,total,reason:
    'Soccer full-game total NO over '+spec.line+'; '+total+
    ' goals scored, '+(soccerStoppageNoWindow(sourceGame)?
      'live regulation stoppage at '+sourceGame.soccerMinute+' minutes':
      soccerRegulationSeconds(sourceGame)+'s to the 90-minute regulation clock')};
}

// Independent scoreboard reports fixture, live status, scores and elapsed
// minute. The strict two-request validator establishes freshness before use.
export function independentSoccerTotalNoReading(scoreboard,game,milestone,market){
  if(!soccerNoMarketSpec(game,market,{beforeWindow:true})&&
    !soccerNoMarketSpec(game,market))return null;
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
  if(!soccerNoMarketSpec(game,market,{beforeWindow:true})&&
    !soccerNoMarketSpec(game,market))return null;
  // ESPN first; if the exact fixture is absent, require a live matched BBC Sport score.
  return verifyFreshEspnSoccerNo(game,milestone,{fetcher});
}
