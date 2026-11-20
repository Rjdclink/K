import {playerOverSpec,playerPropEarlyWindow} from './strategy.mjs';
import {espnMatches,foxMatches,foxPlayerStat,playerStatValue} from './score_verification.mjs';
import {espnRetryThenFox} from './source_fallback.mjs';
import {espnScoreboardUrls} from './espn_scoreboards.mjs';
import {sportsContractKey} from './entry_verification.mjs';

export const VARIABLE_CONFIRM_DELAY_MS=210000;
const groups={
  PASSYDS:{sports:['NFL','CFB'],feed:{NFL:'football/nfl',CFB:'football/college-football'},label:'passing yards'},
  RUSHYDS:{sports:['NFL','CFB'],feed:{NFL:'football/nfl',CFB:'football/college-football'},label:'rushing yards'},
  RECYDS:{sports:['NFL','CFB'],feed:{NFL:'football/nfl',CFB:'football/college-football'},label:'receiving yards'},
  PTS:{sports:['NBA','WNBA','NCAAB','NCAAW'],feed:{NBA:'basketball/nba',WNBA:'basketball/wnba',
    NCAAB:'basketball/mens-college-basketball',NCAAW:'basketball/womens-college-basketball'},label:'points'},
  PRA:{sports:['NBA','WNBA','NCAAB','NCAAW'],feed:{NBA:'basketball/nba',WNBA:'basketball/wnba',
    NCAAB:'basketball/mens-college-basketball',NCAAW:'basketball/womens-college-basketball'},label:'combined points, rebounds, and assists'},
  RBI:{sports:['MLB'],feed:{MLB:'baseball/mlb'},label:'runs batted in'}
};
const escapeRx=s=>String(s).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const parseSequence=play=>{
  const n=Number(play?.sequenceNumber);
  return Number.isSafeInteger(n)&&n>0&&play?.id?n:null;
};
const footballScrimmage=play=>!play?.isPenalty&&/^(?:rush|pass reception|pass incompletion|passing touchdown|pass interception(?: return)?|sack|qb kneel|qb spike|fumble|safety)$/i.test(String(play?.type?.text||''));
const gamePlay=(play,sport)=>sport==='football'?footballScrimmage(play):
  sport==='basketball'?Boolean(play?.type?.text)&&!/timeout|period|end of|jumpball/i.test(play.type.text):
  sport==='baseball'?Boolean(play?.atBatId)&&!/start inning|end inning|delay|review/i.test(String(play?.type?.text||'')):false;
const familyFor=game=>/football/.test(game?.type||'')?'football':
  /basketball/.test(game?.type||'')?'basketball':
  /baseball/.test(game?.type||'')?'baseball':null;

export function variablePlayerOverSpec(game,market,now=Date.now()){
  const player=playerOverSpec(game,market),rule=groups[player?.metric],family=familyFor(game);
  if(!player||!rule?.sports.includes(game.sport)||!family||!playerPropEarlyWindow(game)||
    !game.verifiedLive||!game.scoreKnown||!game.scoreConsistent||!game.periodConsistent||
    game.feedId!==game.id||!Number.isFinite(game.observedAt)||game.observedAt>now||
    now-game.observedAt>10000||!Number.isInteger(game.home)||!Number.isInteger(game.away)||
    !['active','open'].includes(market.status)||market.result&&!['','not_determined'].includes(String(market.result))||
    !['greater','greater_than'].includes(market.strike_type)||
    !String(market.ticker||'').startsWith(String(market.event_ticker||'')+'-')||
    player.value<=player.line||!Number.isInteger(player.value))return null;
  const n=Math.round(player.line+.5),metric=rule.label;
  const title=String(market.title||''),primary=String(market.rules_primary||'');
  if(!new RegExp('^'+escapeRx(player.name)+':\\s*'+n+'\\+\\s*'+escapeRx(metric)+'$','i').test(title)||
    !new RegExp('^If '+escapeRx(player.name)+' records '+n+'\\+ '+escapeRx(metric)+' in the .+ then the market resolves to Yes\\.$','i').test(primary))
    return null;
  return {strategy:'over',family,metric:player.metric,player,feed:rule.feed[game.sport],
    contractKey:sportsContractKey(game,market),fraction:.25,
    reason:player.name+' '+player.metric+' '+player.value+' independently verified after a later play and 3:30 hold'};
}

function summaryPlays(summary,game){
  const source=/football/.test(game.type)?
    [...(summary?.drives?.previous||[]),...(summary?.drives?.current?[summary.drives.current]:[])]
      .flatMap(d=>d?.plays||[]):summary?.plays;
  if(!Array.isArray(source)||!source.length)return null;
  const seen=new Map();
  for(const play of source){
    const seq=parseSequence(play);
    if(!seq)return null;
    if(seen.has(seq)&&seen.get(seq).id!==play.id)return null;
    seen.set(seq,play);
  }
  return [...seen.values()].sort((a,b)=>Number(a.sequenceNumber)-Number(b.sequenceNumber));
}

export function laterPlayConfirmed(first,second,gameFamily){
  if(!first||!second||!first.eventId||first.eventId!==second.eventId||
    !Number.isSafeInteger(first.lastPlaySequence)||first.lastPlaySequence<=0||
    !Array.isArray(second.plays))return false;
  const plays=second.plays.filter(p=>parseSequence(p)>first.lastPlaySequence);
  return plays.some(p=>gamePlay(p,gameFamily));
}

export function variableProofValid(first,second,game,market,now=Date.now()){
  const initial=Number(first?.requestedAt),final=Number(second?.requestedAt);
  const player=playerOverSpec(game,market);
  const key=sportsContractKey(game,market);
  return Boolean(player&&first?.contractKey===key&&second?.contractKey===key&&
    first?.source&&first.source===second.source&&
    first?.eventId&&first.eventId===second.eventId&&
    first?.gameId===game.id&&second.gameId===game.id&&
    first.metric===player.metric&&second.metric===player.metric&&
    first.playerId===player.id&&second.playerId===player.id&&
    Number.isFinite(initial)&&Number.isFinite(final)&&initial>=0&&
    final-initial>=VARIABLE_CONFIRM_DELAY_MS&&final<=now&&now-final<=10000&&
    Number.isInteger(first.playerValue)&&first.playerValue>player.line&&
    Number.isInteger(second.playerValue)&&second.playerValue>=first.playerValue&&
    second.playerValue>=player.value&&second.playerValue>player.line&&
    laterPlayConfirmed(first,second,familyFor(game)));
}

// null means unavailable. false means a genuine, independently identified
// disagreement or ambiguity; in that case FOX may NEVER override ESPN.
export function independentVariableOverDecision(scoreboard,summary,game,milestone,market){
  const spec=variablePlayerOverSpec(game,market);
  if(!spec||!scoreboard)return null;
  const matches=espnMatches(scoreboard,game,milestone);
  if(matches.length===0)return null;
  if(matches.length!==1)return false;
  const matched=matches[0];
  if(!matched.eventId||!matched.live||!matched.clockOk||matched.period!==game.period||
    matched.home!==game.home||matched.away!==game.away||
    Number.isFinite(game.remainingSeconds)&&
      (!Number.isFinite(matched.remainingSeconds)||Math.abs(matched.remainingSeconds-game.remainingSeconds)>15))
    return false;
  if(!summary)return null;
  if(String(summary.header?.id)!==String(matched.eventId))return false;
  const value=playerStatValue(summary,spec.player);
  if(value===null)return null;
  if(value!==spec.player.value||value<=spec.player.line)return false;
  const plays=summaryPlays(summary,game);
  if(!plays)return null;
  return {source:'ESPN',eventId:String(matched.eventId),gameId:game.id,
    metric:spec.metric,playerId:spec.player.id,playerValue:value,
    contractKey:spec.contractKey,lastPlaySequence:Number(plays.at(-1).sequenceNumber),
    plays};
}

export function independentVariableOverReading(scoreboard,summary,game,milestone,market){
  const decision=independentVariableOverDecision(scoreboard,summary,game,milestone,market);
  return decision&&decision!==false?decision:null;
}

// For FOX, only explicit completed on-field plays can count. Narrative rows,
// score summaries, timeouts, reviews and lineup changes are not evidence.
function foxPlay(fox,game){
  const text=String(fox?.playDescription||'');
  const legal=/football/.test(game.type)?
    /(?:\bpass(?:es|ed)?\b|\brush(?:es|ed)?\b|\bran for\b|\bsacked\b|\bkneeled\b)/i.test(text):
    /basketball/.test(game.type)?
      /(?:\bmakes?\b|\bmisses?\b|\brebound\b|\bsteal\b|\bturnover\b|\bfoul\b|\bblocked\b)/i.test(text):
      /baseball/.test(game.type)?/(?:\bsingles?\b|\bdoubles?\b|\btriples?\b|\bhomers?\b|\bstrikes? out\b|\bgrounded\b|\bflied\b)/i.test(text):false;
  if(!legal||/(?:timeout|review|lineup change|penalty declined|end of period)/i.test(text))return null;
  const sequenceNumber=Number(fox?.id);
  if(!Number.isSafeInteger(sequenceNumber)||sequenceNumber<=0)return null;
  return {id:'fox-'+sequenceNumber,sequenceNumber:String(sequenceNumber),
    type:{text:/football/.test(game.type)?/\bpass/i.test(text)?'Pass Reception':/\bsacked\b/i.test(text)?'Sack':'Rush':
      /baseball/.test(game.type)?'At Bat':'Made Shot'},
    isPenalty:false,atBatId:/baseball/.test(game.type)?'fox-at-bat-'+sequenceNumber:undefined};
}
function foxPlayList(data,game){
  const groups=(data?.pbp?.sections||[]).flatMap(s=>s.groups||[]);
  const raw=groups.flatMap(g=>g.plays||[]);
  if(!raw.length)return null;
  const mapped=raw.map(play=>foxPlay(play,game)).filter(Boolean);
  if(!mapped.length)return null;
  const unique=new Map();
  for(const play of mapped){
    const n=Number(play.sequenceNumber);
    if(unique.has(n))return null;
    unique.set(n,play);
  }
  return [...unique.values()].sort((a,b)=>Number(a.sequenceNumber)-Number(b.sequenceNumber));
}

export function independentFoxVariableOverDecision(scoreboard,data,game,milestone,market){
  const spec=variablePlayerOverSpec(game,market);
  if(!spec||!scoreboard)return null;
  const matches=foxMatches(scoreboard,game,milestone);
  if(matches.length===0)return null;
  if(matches.length!==1)return false;
  const match=matches[0];
  if(!match.eventId||!match.live||!match.clockOk||
    !Number.isFinite(match.period)||match.period!==game.period||
    match.home!==game.home||match.away!==game.away||
    Number.isFinite(game.remainingSeconds)&&
      (!Number.isFinite(match.remainingSeconds)||Math.abs(match.remainingSeconds-game.remainingSeconds)>15))return false;
  if(!data)return null;
  if(String(data.header?.id)!==String(match.eventId))return false;
  const value=foxPlayerStat(data,spec.player,match.eventId);
  if(value===null)return null;
  if(value!==spec.player.value||value<=spec.player.line)return false;
  const plays=foxPlayList(data,game);
  if(!plays)return null;
  return {source:'FOX Sports',eventId:String(match.eventId),gameId:game.id,
    metric:spec.metric,playerId:spec.player.id,playerValue:value,
    contractKey:spec.contractKey,lastPlaySequence:Number(plays.at(-1).sequenceNumber),plays};
}

// The gate is called fresh at each checkpoint: ESPN, ESPN only upon
// unavailability, then FOX only upon repeated unavailability. No cache reuse.
export async function verifyIndependentVariableOver(game,milestone,market,{fetcher=fetch}={}){
  const spec=variablePlayerOverSpec(game,market);
  if(!spec)return null;
  const start=Date.parse(milestone?.start_date||'');
  if(!Number.isFinite(start))return null;
  const dates=[start,start-86400000,start+86400000]
    .map(t=>new Date(t).toISOString().slice(0,10).replaceAll('-',''));
  const request=async url=>{
    const r=await fetcher(url,{signal:AbortSignal.timeout(6500),cache:'no-store'});
    if(!r.ok)throw Error('Source unavailable');
    return r.json();
  };
  const espn=async()=>{
    for(const day of new Set(dates)){
      const results=await Promise.allSettled(espnScoreboardUrls(spec.feed,game,milestone,[day]).map(request));
      const data=results.filter(r=>r.status==='fulfilled').map(r=>r.value);
      const matches=data.flatMap(board=>espnMatches(board,game,milestone));
      if(!matches.length)continue;
      if(matches.length!==1)return false;
      const selected=matches[0];
      if(!selected.eventId||!selected.live||!selected.clockOk||selected.period!==game.period||
        selected.home!==game.home||selected.away!==game.away)return false;
      let summary;
      try{summary=await request('https://site.api.espn.com/apis/site/v2/sports/'+spec.feed+
        '/summary?event='+encodeURIComponent(selected.eventId))}catch{return null}
      const decision=independentVariableOverDecision(
        data.find(board=>espnMatches(board,game,milestone).some(m=>m.eventId===selected.eventId)),
        summary,game,milestone,market);
      return decision;
    }
    return null;
  };
  const foxFeeds={NBA:'nba',WNBA:'wnba',NFL:'nfl',CFB:'cfb',MLB:'mlb',NCAAB:'cbk'};
  const fox=async()=>{
    const feed=foxFeeds[game.sport];
    if(!feed)return null;
    const base='https://api.foxsports.com/bifrost/v1/'+feed;
    const query='apikey=jE7yBJVRNAwdDesMgTzTXUUSx1It41Fq&api-version=1.1';
    let segments=dates;
    if(feed==='nfl'||feed==='cfb'){
      let selection;
      try{selection=await request(base+'/league/scores?'+query)}catch{return null}
      const id=String(selection?.currentSelectionId||'');
      if(!/^\d{4}-\d{1,2}-\d$/.test(id))return null;
      segments=[id];
    }
    for(const day of new Set(segments)){
      let board;
      try{board=await request(base+'/league/scores-segment/'+day+'?'+query+
        (feed==='cbk'||feed==='cfb'?'&groupId=-4':''))}catch{continue}
      const matches=foxMatches(board,game,milestone);
      if(!matches.length)continue;
      if(matches.length!==1)return false;
      const selected=matches[0];
      if(!selected.eventId||!selected.live||!selected.clockOk||
        selected.home!==game.home||selected.away!==game.away||selected.period!==game.period)return false;
      let data;
      try{data=await request(base+'/event/'+encodeURIComponent(selected.eventId)+'/data?'+query)}catch{return null}
      return independentFoxVariableOverDecision(board,data,game,milestone,market);
    }
    return null;
  };
  const requestedAt=Date.now();
  const decision=await espnRetryThenFox({espn,fox});
  return decision&&decision!==false?{...decision,requestedAt}:null;
}