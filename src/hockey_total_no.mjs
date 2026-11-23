import {externalNoScore,externalNoPeriods} from './external_no_authority.mjs';
import {verifyFreshEspnHockeyNo,independentlyVerifiedHockeyGame} from './hockey_espn_no.mjs';
import {espnMatches} from './score_verification.mjs';
import {goalNoWindow} from './goal_no_windows.mjs';

// Kalshi lists game-wide NHL goals separately from goals scored in period 3.
// Never substitute the cumulative score for a third-period total.
const goalsLine=raw=>{
  const m=String(raw||'').match(/^(?:(?:Full Game|3rd Period):\s*)?Over\s+(\d+(?:\.\d+)?)\s+goals(?:\s+scored)?\b/i);
  return m?Number(m[1]):NaN;
};
const validPeriods=periods=>{
  if(!Array.isArray(periods))return null;
  const byNumber=[1,2,3].map(n=>periods.find(p=>p.number===n));
  if(byNumber.some(p=>!p||!Number.isInteger(p.home)||!Number.isInteger(p.away)||p.home<0||p.away<0))
    return null;
  return byNumber;
};
const sums=periods=>({
  home:periods.reduce((n,p)=>n+p.home,0),
  away:periods.reduce((n,p)=>n+p.away,0)
});
const validExternal=(external,game)=>['ESPN','NHL'].includes(external?.source)&&
  Boolean(externalNoScore(game,external));

export function hockeyNoMarketSpec(game,market,{beforeWindow=false}={}){
  if(game?.sport!=='NHL'||!['hockey_match','hockey_game'].includes(game.type)||
    !game.verifiedLive||!game.scoreKnown||!game.scoreConsistent||!game.periodConsistent||
    game.feedId!==game.id||game.clockRunning===false||!Number.isFinite(game.observedAt)||
    game.observedAt>Date.now()||Date.now()-game.observedAt>10000||
    ![3,4].includes(game.period)||!Number.isFinite(game.remainingSeconds)||game.remainingSeconds<=0||
    game.remainingSeconds>960||
    !Number.isInteger(game.home)||!Number.isInteger(game.away)||game.home<0||game.away<0||
    !['active','open'].includes(market?.status)||
    market.result&&!['','not_determined'].includes(String(market.result)))return null;
  const series=String(market.event_ticker||'').split('-')[0];
  const period=series==='KXNHLTOTAL'?'full_game':series==='KXNHL3PTOTAL'?'third_period':null;
  if(!period||game.period===4&&period!=='full_game'||
    market.strike_type&&!['greater','greater_than'].includes(market.strike_type))return null;
  const title=String(market.title||''),subtitle=String(market.yes_sub_title||'');
  if(period==='third_period'?!/^3rd Period:\s*Over\s+/i.test(title):
    !/^(?:Full Game:\s*)?Over\s+/i.test(title)||/^3rd Period:/i.test(title))return null;
  const line=Number(market.floor_strike),shown=goalsLine(title),secondary=subtitle?goalsLine(subtitle):shown;
  const rules=String(market.rules_primary||''),goals=rules.match(/\bteams collectively score more than\s+(\d+(?:\.\d+)?)\s+goals\b/i);
  const thirdInRules=/\b(?:3rd|third)\s+period\b/i.test(rules);
  if(!Number.isFinite(line)||line!==shown||line!==secondary||!goals||
    line!==Number(goals[1])||!/NHL\s+game\b/i.test(rules)||
    thirdInRules!==(period==='third_period')||
    (period==='full_game'&&/\b(?:first|second|1st|2nd|3rd|third)\s+period\b|team total|regulation only/i.test(rules)))return null;
  const window=goalNoWindow(game,market,game.home+game.away,{period});
  if(game.remainingSeconds>(beforeWindow?window?.firstSeconds??420:Infinity)||
    !beforeWindow&&game.remainingSeconds>=(window?.entrySeconds??300))return null;
  return {strategy:'no',period,line,series};
}

export function hockeyTotalNo(game,market,{beforeWindow=false,external=null}={}){
  const verified=external?independentlyVerifiedHockeyGame(game,external):null;
  const independent=external?externalNoScore(game,external):null;
  if(external&&(!validExternal(external,game)||!independent))return null;
  const sourceGame=verified||(independent?{...game,home:independent.home,away:independent.away}:game);
  const spec=hockeyNoMarketSpec(sourceGame,market,{beforeWindow});
  if(!spec)return null;
  let total=independent?independent.home+independent.away:game.home+game.away;
  if(total>=5)return null;
  if(spec.period==='third_period'){
    const providerParts=validPeriods(game.periodScores);
    const externalParts=external?externalNoPeriods(game,external,3):null;
    if(external&&!externalParts)return null;
    if(!external&&providerParts){
      const providerTotals=sums(providerParts);
      if(providerTotals.home!==game.home||providerTotals.away!==game.away)return null;
    }
    // Independent period attribution supersedes contradictory Kalshi splits.
    // It must still reconcile to the external cumulative score.
    const parts=externalParts||providerParts;
    if(!parts)return null;
    total=parts[2].home+parts[2].away;
    if(external?.period3&&(
      external.period3.home!==parts[2].home||external.period3.away!==parts[2].away))return null;
  }
  // Full-game 2.5 cushions use eight minutes through four total goals.
  // Full-game 1.5 cushions use the final minute, including live overtime.
  const window=goalNoWindow(sourceGame,market,independent?independent.home+independent.away:game.home+game.away,
    {period:spec.period});
  const minimumCushion=(window?.entrySeconds===900||spec.line===2.5&&total===2)?0.5:
    window?.entrySeconds===480?2.5:
    window?.entrySeconds===60?1.5:spec.period==='full_game'&&game.period===4?1.5:
    total>=4?3.5:2.5;
  if(spec.line-total<minimumCushion)return null;
  return {...spec,total,reason:
    'NHL hockey total NO '+(spec.period==='third_period'?'third period':'full game')+
    ' over '+spec.line+'; '+total+' goals in selected period, '+game.remainingSeconds+
    's left in P'+game.period};
}

// Return a fully attributed, matched ESPN reading; no fallback to Kalshi-only
// period goals when an independent source cannot be matched and verified.
export function independentHockeyTotalNoReading(scoreboard,game,milestone,market){
  const spec=hockeyNoMarketSpec(game,market,{beforeWindow:true});
  if(!spec)return null;
  const matches=espnMatches(scoreboard,game,milestone,{identityOnly:true});
  if(matches.length!==1)return null;
  const m=matches[0];
  if(!m.eventId||!externalNoScore(game,{...m,source:'ESPN'}))return null;
  const periods=validPeriods(m.periods);
  if(spec.period==='third_period'){
    if(!periods)return null;
    const sourceTotals=sums(periods);
    if(sourceTotals.home!==m.home||sourceTotals.away!==m.away)return null;
  }
  return {source:'ESPN',eventId:m.eventId,home:m.home,away:m.away,period:game.period,
    seconds:m.remainingSeconds,periods:periods||null,
    period3:periods?{home:periods[2].home,away:periods[2].away}:null};
}

export async function verifyIndependentHockeyTotalNo(game,milestone,market,{fetcher=fetch}={}){
  if(!hockeyNoMarketSpec(game,market,{beforeWindow:true}))return null;
  // ESPN alone verifies the live fixture, scoring and period time.
  return verifyFreshEspnHockeyNo(game,milestone,{fetcher});
}
