import {espnMatches} from './score_verification.mjs';
import {espnScoreboardUrls} from './espn_scoreboards.mjs';

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
const validExternal=(external,game)=>{
  if(external?.source!=='ESPN'||external.period!==3||
    external.home!==game.home||external.away!==game.away||
    !Number.isFinite(external.seconds)||Math.abs(external.seconds-game.remainingSeconds)>10)return false;
  return true;
};

export function hockeyNoMarketSpec(game,market,{beforeWindow=false}={}){
  if(game?.sport!=='NHL'||!['hockey_match','hockey_game'].includes(game.type)||
    !game.verifiedLive||!game.scoreKnown||!game.scoreConsistent||!game.periodConsistent||
    game.feedId!==game.id||!Number.isFinite(game.observedAt)||Date.now()-game.observedAt>10000||
    game.period!==3||!Number.isFinite(game.remainingSeconds)||game.remainingSeconds<=0||
    (beforeWindow?game.remainingSeconds>135:game.remainingSeconds>=90)||
    !Number.isInteger(game.home)||!Number.isInteger(game.away)||game.home<0||game.away<0||
    !['active','open'].includes(market?.status)||
    market.result&&!['','not_determined'].includes(String(market.result)))return null;
  const series=String(market.event_ticker||'').split('-')[0];
  const period=series==='KXNHLTOTAL'?'full_game':series==='KXNHL3PTOTAL'?'third_period':null;
  if(!period||market.strike_type&&!['greater','greater_than'].includes(market.strike_type))return null;
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
  return {strategy:'no',period,line,series};
}

export function hockeyTotalNo(game,market,{beforeWindow=false,external=null}={}){
  const spec=hockeyNoMarketSpec(game,market,{beforeWindow});
  if(!spec)return null;
  if(external&&!validExternal(external,game))return null;
  let total=game.home+game.away;
  if(spec.period==='third_period'){
    const providerParts=validPeriods(game.periodScores);
    const externalParts=external?validPeriods(external.periods):null;
    if(external&&!externalParts)return null;
    if(providerParts){
      const providerTotals=sums(providerParts);
      if(providerTotals.home!==game.home||providerTotals.away!==game.away)return null;
    }
    if(externalParts){
      const independentTotals=sums(externalParts);
      if(independentTotals.home!==game.home||independentTotals.away!==game.away||
        providerParts&&providerParts.some((p,i)=>p.home!==externalParts[i].home||p.away!==externalParts[i].away))return null;
    }
    const parts=externalParts||providerParts;
    if(!parts)return null;
    total=parts[2].home+parts[2].away;
    if(external&&(!external.period3||
      external.period3.home!==parts[2].home||external.period3.away!==parts[2].away))return null;
  }
  if(spec.line-total<2.5)return null;
  return {...spec,total,reason:
    'NHL hockey total NO '+(spec.period==='third_period'?'third period':'full game')+
    ' over '+spec.line+'; '+total+' goals in selected period, '+game.remainingSeconds+'s left in P3'};
}

// Return a fully attributed, matched ESPN reading; no fallback to Kalshi-only
// period goals when an independent source cannot be matched and verified.
export function independentHockeyTotalNoReading(scoreboard,game,milestone,market){
  const spec=hockeyNoMarketSpec(game,market,{beforeWindow:true});
  if(!spec)return null;
  const matches=espnMatches(scoreboard,game,milestone);
  if(matches.length!==1)return null;
  const m=matches[0];
  if(!m.live||m.period!==3||m.home!==game.home||m.away!==game.away||
    !Number.isFinite(m.remainingSeconds)||Math.abs(m.remainingSeconds-game.remainingSeconds)>10)return null;
  const periods=validPeriods(m.periods);
  if(spec.period==='third_period'){
    if(!periods)return null;
    const total=sums(periods);
    if(total.home!==game.home||total.away!==game.away)return null;
    const direct=validPeriods(game.periodScores);
    if(direct&&direct.some((p,i)=>p.home!==periods[i].home||p.away!==periods[i].away))return null;
  }
  return {source:'ESPN',eventId:m.eventId,home:m.home,away:m.away,period:3,
    seconds:m.remainingSeconds,periods:periods||null,
    period3:periods?{home:periods[2].home,away:periods[2].away}:null};
}

export async function verifyIndependentHockeyTotalNo(game,milestone,market,{fetcher=fetch}={}){
  if(!hockeyNoMarketSpec(game,market,{beforeWindow:true}))return null;
  const start=Date.parse(milestone.start_date||'');
  if(!Number.isFinite(start))return null;
  const dates=[start,start-86400000].map(ms=>new Date(ms).toISOString().slice(0,10).replaceAll('-',''));
  for(const date of new Set(dates)){
    const results=await Promise.allSettled(espnScoreboardUrls('hockey/nhl',game,milestone,[date]).map(async url=>{
      const response=await fetcher(url,{signal:AbortSignal.timeout(6000)});
      return response.ok?espnMatches(await response.json(),game,milestone):[];
    }));
    const matches=[...new Map(results.filter(r=>r.status==='fulfilled').flatMap(r=>r.value)
      .map(item=>[JSON.stringify(item),item])).values()];
    // An identified disagreement must fail closed, not shop dates or sources.
    if(matches.length){
      if(matches.length!==1)return null;
      const m=matches[0];
      // Reuse the same structural checks without sending another request.
      if(!m.live||m.period!==3||m.home!==game.home||m.away!==game.away||
        !Number.isFinite(m.remainingSeconds)||Math.abs(m.remainingSeconds-game.remainingSeconds)>10)return null;
      const spec=hockeyNoMarketSpec(game,market,{beforeWindow:true});
      const periods=validPeriods(m.periods);
      if(spec.period==='third_period'){
        if(!periods)return null;
        const totals=sums(periods);
        if(totals.home!==game.home||totals.away!==game.away)return null;
        const direct=validPeriods(game.periodScores);
        if(direct&&direct.some((p,i)=>p.home!==periods[i].home||p.away!==periods[i].away))return null;
      }
      return {source:'ESPN',eventId:m.eventId,home:m.home,away:m.away,period:3,
        seconds:m.remainingSeconds,periods:periods||null,
        period3:periods?{home:periods[2].home,away:periods[2].away}:null};
    }
  }
  return null;
}