import {fetchIndependentMatchScore} from './independent_match_score.mjs';
import {espnMatches} from './score_verification.mjs';
import {espnScoreboardUrls} from './espn_scoreboards.mjs';

// NHL period-one and period-two NO markets settle on goals scored in that
// period alone. Never substitute the full-game combined score for period goals.
const periodLabels={1:'1st',2:'2nd'};
const lineFrom=(value,period,kind)=>{
  const text=String(value||'').trim();
  const match=kind==='title'?
    text.match(new RegExp('^'+periodLabels[period]+' Period: Over (\\d+(?:\\.\\d+)?) goals scored$','i')):
    text.match(/^Over (\d+(?:\.\d+)?) goals(?: scored)?$/i);
  return match?Number(match[1]):NaN;
};
const periodParts=(raw,period)=>{
  if(!Array.isArray(raw)||raw.length<period)return null;
  const selected=[];
  for(let n=1;n<=period;n++){
    const found=raw.filter(p=>p.number===n);
    if(found.length!==1)return null;
    const p=found[0];
    if(!Number.isInteger(p.home)||p.home<0||!Number.isInteger(p.away)||p.away<0)return null;
    selected.push(p);
  }
  // Scores recorded in a future period would make this a contradictory feed.
  if(raw.some(p=>Number.isInteger(p.number)&&p.number>period&&
    (p.home!==0||p.away!==0)))return null;
  return selected;
};
const totals=parts=>({home:parts.reduce((s,p)=>s+p.home,0),
  away:parts.reduce((s,p)=>s+p.away,0)});
const agrees=(game,parts)=>{
  const full=totals(parts);
  if(full.home!==game.home||full.away!==game.away)return false;
  if(game.periodScores?.length){
    const direct=periodParts(game.periodScores,game.period);
    if(!direct||direct.some((p,i)=>p.home!==parts[i].home||p.away!==parts[i].away))
      return false;
  }
  return true;
};
const validExternal=(external,game,period)=>{
  if(!['ESPN','FOX Sports'].includes(external?.source)||!external.eventId||
    external.home!==game.home||external.away!==game.away)return null;
  const provider=periodParts(game.periodScores,period);
  const source=Array.isArray(external.periods)&&external.periods.length?
    periodParts(external.periods,period):null;
  if(Array.isArray(external.periods)&&external.periods.length&&!source)return null;
  if(source&&!agrees(game,source))return null;
  if(source&&provider&&provider.some((p,i)=>p.home!==source[i].home||p.away!==source[i].away))return null;
  const parts=source||provider;
  if(!parts||!agrees(game,parts))return null;
  if(external.currentPeriod&&(
    external.currentPeriod.home!==parts[period-1].home||
    external.currentPeriod.away!==parts[period-1].away))return null;
  return parts;
};

export function hockeyEarlyNoMarketSpec(game,market,{beforeWindow=false}={}){
  const period=game?.period,remaining=game?.remainingSeconds;
  if(game?.sport!=='NHL'||!['hockey_match','hockey_game'].includes(game.type)||
    ![1,2].includes(period)||!game.verifiedLive||!game.scoreKnown||
    !game.scoreConsistent||!game.periodConsistent||game.feedId!==game.id||
    !Number.isFinite(game.observedAt)||game.observedAt>Date.now()||
    Date.now()-game.observedAt>10000||!Number.isFinite(remaining)||remaining<=0||
    (beforeWindow?remaining>240:remaining>=210)||
    !Number.isInteger(game.home)||game.home<0||!Number.isInteger(game.away)||game.away<0||
    !['active','open'].includes(market?.status)||
    market.result&&!['','not_determined'].includes(String(market.result)))return null;
  const [series,...suffix]=String(market.event_ticker||'').split('-');
  const [main,...mainSuffix]=String(game.mainEvent||'').split('-');
  if(series!==`KXNHL${period}PTOTAL`||main!=='KXNHLGAME'||!suffix.length||
    suffix.join('-')!==mainSuffix.join('-')||
    !['greater','greater_than'].includes(market.strike_type))return null;
  const line=Number(market.floor_strike),
    title=lineFrom(market.title,period,'title'),
    subtitle=lineFrom(market.yes_sub_title,period,'subtitle');
  const rules=String(market.rules_primary||'');
  const numeric=rules.match(/^If the teams collectively score more than (\d+(?:\.\d+)?) goals in the /i);
  if(!Number.isFinite(line)||line!==title||line!==subtitle||!numeric||
    line!==Number(numeric[1])||
    !new RegExp('\\bin the '+periodLabels[period]+' Period of the .+ NHL game originally scheduled .+ then the market resolves to Yes\\.$','i').test(rules)||
    /\b(?:team total|extra time|overtime|shootout)\b/i.test(rules))return null;
  return {strategy:'no',period:period===1?'first_period':'second_period',periodNumber:period,line};
}

export function hockeyEarlyPeriodNo(game,market,{beforeWindow=false,external=null}={}){
  const spec=hockeyEarlyNoMarketSpec(game,market,{beforeWindow});
  if(!spec)return null;
  const parts=external?validExternal(external,game,spec.periodNumber):
    periodParts(game.periodScores,spec.periodNumber);
  if(!parts||!agrees(game,parts))return null;
  const periodTotal=parts[spec.periodNumber-1].home+parts[spec.periodNumber-1].away;
  if(spec.line-periodTotal<1.5)return null;
  return {...spec,total:periodTotal,reason:
    'NHL hockey total NO '+(spec.periodNumber===1?'first period':'second period')+
    ' over '+spec.line+'; '+periodTotal+' period goals, '+
    game.remainingSeconds+'s remaining in P'+spec.periodNumber};
}

export function independentEarlyHockeyNoReading(scoreboard,game,milestone,market){
  const spec=hockeyEarlyNoMarketSpec(game,market,{beforeWindow:true});
  if(!spec)return null;
  const matches=espnMatches(scoreboard,game,milestone);
  if(matches.length!==1)return null;
  const match=matches[0],period=spec.periodNumber;
  if(!match.eventId||match.home!==game.home||match.away!==game.away)return null;
  const parts=periodParts(match.periods,period)||periodParts(game.periodScores,period);
  if(!parts||!agrees(game,parts))return null;
  if(match.periods?.length&&(!periodParts(match.periods,period)||
    !agrees(game,periodParts(match.periods,period))))return null;
  return {source:'ESPN',eventId:match.eventId,home:match.home,away:match.away,
    period,seconds:match.remainingSeconds,live:true,
    periods:parts,currentPeriod:{home:parts[period-1].home,away:parts[period-1].away}};
}

export async function verifyIndependentEarlyHockeyNo(game,milestone,market,{fetcher=fetch}={}){
  if(!hockeyEarlyNoMarketSpec(game,market,{beforeWindow:true}))return null;
  const feed='hockey/nhl';
  if(!feed)return null;
  // ESPN first, retry only when unavailable, then FOX; no source clock check.
  return fetchIndependentMatchScore(game,milestone,{fetcher,espnFeed:feed,foxFeed:'nhl'});
}