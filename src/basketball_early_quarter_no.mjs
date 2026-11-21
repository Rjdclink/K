import {externalNoScore,externalNoPeriods} from './external_no_authority.mjs';
import {fetchIndependentMatchScore} from './independent_match_score.mjs';
import {espnMatches} from './score_verification.mjs';
import {espnScoreboardUrls} from './espn_scoreboards.mjs';

const labels={1:'1st',2:'2nd',3:'3rd'};
const feeds={NBA:'basketball/nba',WNBA:'basketball/wnba'};
const currentParts=(all,quarter)=>{
  if(!Array.isArray(all))return null;
  const out=[];
  for(let n=1;n<=quarter;n++){
    const arr=all.filter(p=>p.number===n);
    if(arr.length!==1)return null;
    const part=arr[0];
    if(!Number.isInteger(part.home)||part.home<0||
      !Number.isInteger(part.away)||part.away<0)return null;
    out.push(part);
  }
  if(all.some(p=>p.number>quarter&&(p.home!==0||p.away!==0)))return null;
  return out;
};
const periodGoals=parts=>({home:parts.reduce((sum,p)=>sum+p.home,0),
  away:parts.reduce((sum,p)=>sum+p.away,0)});
const agrees=(game,parts)=>{
  const full=periodGoals(parts);
  if(full.home!==game.home||full.away!==game.away)return false;
  if(game.periodScores?.length){
    const provider=currentParts(game.periodScores,game.period);
    if(!provider||provider.some((p,i)=>p.home!==parts[i].home||p.away!==parts[i].away))
      return false;
  }
  return true;
};
const displayed=(text,quarter,kind)=>{
  const match=String(text||'').trim().match(kind==='title'?
    new RegExp('^'+labels[quarter]+' Quarter: Over (\\d+(?:\\.\\d+)?) points scored$','i'):
    /^Over (\d+(?:\.\d+)?) points$/i);
  return match?Number(match[1]):NaN;
};
export function basketballEarlyQuarterNoSpec(game,market,{beforeWindow=false}={}){
  const quarter=game?.period,seconds=game?.remainingSeconds;
  if(!feeds[game?.sport]||game.type!=='basketball_game'||![1,2,3].includes(quarter)||
    !game.verifiedLive||!game.scoreKnown||!game.scoreConsistent||!game.periodConsistent||
    game.feedId!==game.id||!Number.isFinite(game.observedAt)||game.observedAt>Date.now()||
    Date.now()-game.observedAt>10000||!Number.isFinite(seconds)||seconds<=0||
    (beforeWindow?seconds>150:seconds>=90)||
    !Number.isInteger(game.home)||game.home<0||
    !Number.isInteger(game.away)||game.away<0||
    !['active','open'].includes(market?.status)||
    market.result&&!['','not_determined'].includes(String(market.result)))return null;
  const [series,...suffix]=String(market.event_ticker||'').split('-'),
    [main,...mainSuffix]=String(game.mainEvent||'').split('-');
  if(series!==`KX${game.sport}${quarter}QTOTAL`||
    main!==`KX${game.sport}GAME`||!suffix.length||
    suffix.join('-')!==mainSuffix.join('-')||
    !['greater','greater_than'].includes(market.strike_type))return null;
  const line=Number(market.floor_strike),
    title=displayed(market.title,quarter,'title'),
    subtitle=displayed(market.yes_sub_title,quarter,'subtitle');
  const rules=String(market.rules_primary||'');
  const lineFromRules=rules.match(
    /^If (?:over|the teams in the game collectively score more than) (\d+(?:\.\d+)?) (?:total )?points (?:are scored )?in the /i);
  if(!Number.isFinite(line)||line!==title||line!==subtitle||!lineFromRules||
    line!==Number(lineFromRules[1])||
    !new RegExp('\\bin the '+labels[quarter]+' quarter of the .+ Pro Basketball game originally scheduled .+ then the market resolves to Yes\\.$','i').test(rules)||
    /\b(?:team total|first half|second half|extra time|overtime)\b/i.test(rules))return null;
  return {strategy:'no',period:labels[quarter].toLowerCase()+'_quarter',
    quarter,line};
}
export function basketballEarlyQuarterNo(game,market,{beforeWindow=false,external=null}={}){
  const spec=basketballEarlyQuarterNoSpec(game,market,{beforeWindow});
  if(!spec)return null;
  if(external&&(!['ESPN','FOX Sports'].includes(external.source)||
    !externalNoScore(game,external)))return null;
  const provider=currentParts(game.periodScores,game.period);
  const independent=external?externalNoPeriods(game,external,game.period):null;
  if(external&&!independent)return null;
  const parts=external?independent:provider;
  if(!parts||!external&&!agrees(game,parts))return null;
  if(external?.currentQuarter&&(
    external.currentQuarter.home!==parts[spec.quarter-1].home||
    external.currentQuarter.away!==parts[spec.quarter-1].away))return null;
  const scored=parts[spec.quarter-1].home+parts[spec.quarter-1].away;
  if(spec.line-scored<12)return null;
  return {...spec,total:scored,reason:
    'Basketball early-quarter NO ('+game.sport+' Q'+spec.quarter+') over '+spec.line+
    '; '+scored+' points in selected quarter, '+game.remainingSeconds+
    's to quarter end'};
}
export function independentBasketballEarlyQuarterNoReading(board,game,milestone,market){
  const spec=basketballEarlyQuarterNoSpec(game,market,{beforeWindow:true});
  if(!spec)return null;
  const matches=espnMatches(board,game,milestone,{identityOnly:true});
  if(matches.length!==1)return null;
  const m=matches[0];
  if(!m.eventId||m.home!==game.home||m.away!==game.away)return null;
  const parts=currentParts(m.periods,game.period)||currentParts(game.periodScores,game.period);
  if(!parts||!agrees(game,parts))return null;
  if(m.periods?.length&&(!currentParts(m.periods,game.period)||
    !agrees(game,currentParts(m.periods,game.period))))return null;
  return {source:'ESPN',eventId:m.eventId,home:m.home,away:m.away,
    quarter:game.period,seconds:m.remainingSeconds,live:true,parts,
    currentQuarter:{home:parts[game.period-1].home,away:parts[game.period-1].away}};
}
export async function verifyIndependentBasketballEarlyQuarterNo(game,milestone,market,{fetcher=fetch}={}){
  if(!basketballEarlyQuarterNoSpec(game,market,{beforeWindow:true}))return null;
  const feed=feeds[game.sport];
  if(!feed)return null;
  // ESPN first, retry only when unavailable, then FOX; no source clock check.
  return fetchIndependentMatchScore(game,milestone,{fetcher,espnFeed:feed,foxFeed:game.sport==='NBA'?'nba':'wnba'});
}