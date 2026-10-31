// Only fetch event families used by the two entry strategies and comeback exits.
// The exchange remains authoritative: a guessed ticker is ignored unless an
// open event and its market are actually returned by Kalshi.
import { cricketOneInningsFormat } from './strategy.mjs';
const supportedType=type=>/basketball|baseball|football|hockey|soccer|tennis|golf|handball|rugby|lacrosse|volleyball|darts/.test(String(type||'').toLowerCase());

export async function mapBatches(items,limit,task){
  const results=new Array(items.length);let next=0;
  await Promise.all(Array.from({length:Math.min(items.length,Math.max(1,Math.floor(limit)))},async()=>{
    while(next<items.length){const i=next++;results[i]=await task(items[i],i)}
  }));
  return results;
}

export function eligibleForMarkets(game){return game?.verifiedLive && game.scoreKnown &&
  (supportedType(game.type)||game.type==='cricket_match'&&(cricketOneInningsFormat(game.competition)||game.cricket?.innings===4)||
    game.type==='esports_match'&&['eSoccer','eBasketball'].includes(game.sport)&&game.esportsPeriodsValid)}

export async function discoverCurrentMilestones(get,now=Date.now()){
  const cutoff=now+3600000,min=new Date(now-7*86400000).toISOString();
  const finished=m=>{
    const status=String(m.details?.status||'').trim().toLowerCase();
    return /^(?:final|finished|completed|closed|ended|event closed|match complete)(?:\b|$)/.test(status)&&
      Date.parse(m.start_date||'')<now-2*3600000;
  };
  const categories=await Promise.all(['Sports','Esports'].map(async category=>{
    const found=[],seen=new Set();let cursor='';
    for(;;){
      const query=new URLSearchParams({category,limit:'500',minimum_start_date:min});
      if(cursor)query.set('cursor',cursor);
      const response=await get('/milestones?'+query),page=response.milestones||[];
      found.push(...page.filter(m=>m.id&&!finished(m)&&Date.parse(m.start_date||'')<cutoff&&
        (!m.end_date||Date.parse(m.end_date)>now-36*3600000||
          /^(?:live|inprogress|in_progress|playing)$/.test(String(m.details?.status||'').toLowerCase()))));
      // Kalshi lists milestones in start-date order. The next page of an
      // entirely future page cannot contain a game that is live now.
      if(!response.cursor||page.length&&page.every(m=>Date.parse(m.start_date||'')>=cutoff))break;
      if(seen.has(response.cursor)||!page.length)throw Error(`${category} milestone pagination did not advance`);
      seen.add(response.cursor);cursor=response.cursor;
    }
    return found;
  }));
  return [...new Map(categories.flat().map(m=>[m.id,m])).values()];
}

  // Kalshi discovery includes older, still-open milestones that have no live
  // score. Avoid fetching live data for a day of inactive games on every scan.
// Retain every recently observed live game and long-running tournament
// formats even when they began earlier. Some old Kalshi milestones still say
// "live" after their scores stopped updating, so that flag alone is unsafe.
export function scanMilestones(milestones,recentLiveIds=new Set(),now=Date.now()){
  return milestones.filter(m=>{
    const started=Date.parse(m.start_date||'');
    return recentLiveIds.has(m.id)||
      /golf|cricket/.test(String(m.type||''))||!Number.isFinite(started)||started>=now-8*3600000;
  });
}

export function linkedEventTickers(milestone){
  if(milestone.type==='golf_tournament')return [milestone.details?.main_game_event_ticker].filter(Boolean);
  const source=[...(milestone.related_event_tickers||[]),...(milestone.primary_event_tickers||[]),...(milestone.events||[]),milestone.details?.main_game_event_ticker].filter(Boolean);
  const main=ticker=>{
    const series=String(ticker).split('-')[0].toUpperCase();
    if(!String(ticker).includes('-')||!/(?:TEAMTOTAL|TOTAL|GAME|MATCH)$/.test(series))return false;
    if(/(?:1H|2H|[1-4]Q|[1-3]P|[1-9]INNING|HALF|SET)(?:GAME|MATCH)$/.test(series))return false;
    return !series.endsWith('MATCH')||/tennis|darts|volleyball|handball|rugby|lacrosse|esports|cricket/.test(String(milestone.type||''));
  };
  // Kalshi links player props and other score markets directly to the game.
  // Keep those actual tickers; the strategy still rejects any metric it
  // cannot independently verify.
  const listed=source.filter(t=>String(t).includes('-') && (main(t) || /(?:PTS|REB|AST|3PT|PRA|STL|BLK|GOALS|SAVES|SOG|HITS|RBI|HR|RUSHYDS|PASSYDS|RECYDS|RRYDS|RECPROT|PASSATT|PASSCOMP|PASSINT|PASSTDS|GTOTAL)(?:PROT)?$/.test(String(t).split('-')[0])));
  const derived=listed.filter(ticker=>/(?:GAME|MATCH)$/.test(ticker.split('-')[0])&&
    (ticker.split('-')[0].endsWith('GAME')||/esports|cricket/.test(String(milestone.type||'')))).flatMap(ticker=>{
    const [series,...rest]=ticker.split('-'),suffix=rest.join('-'),prefix=series.slice(0,-4);
    const totalPrefix=series.endsWith('MATCH')?series.slice(0,-5):prefix;
    // These are only discovery candidates. The exchange must return an open
    // event and the contract-specific score check must still succeed.
    const family=String(milestone.type||'');
    const segments=/basketball/.test(family)?['1Q','2Q','3Q','4Q','1H','2H']:
      /hockey/.test(family)?['1P','2P','3P']:
      /football/.test(family)?['1Q','2Q','3Q','4Q','1H','2H']:
      /baseball/.test(family)?Array.from({length:9},(_,i)=>`${i+1}INNING`):[];
    return [`${totalPrefix}TOTAL-${suffix}`,`${totalPrefix}TEAMTOTAL-${suffix}`,
      ...segments.flatMap(part=>[`${prefix}${part}TOTAL-${suffix}`,`${prefix}${part}TEAMTOTAL-${suffix}`])];
  });
  return [...new Set([...listed,...derived])];
}

export function gameTimeLabel(game){
  if(/^(final|finished|complete|completed|closed|ended)$/.test(game?.status||''))return 'Final';
  const family=String(game?.type||'');
  if(/golf/.test(family)){
    const holes=game.golf?.board?.map(p=>p.current_round_thru).filter(Number.isInteger)||[];
    return Number.isInteger(game.period)&&holes.length?`Round ${game.period} · ${Math.min(...holes)}–${Math.max(...holes)} holes completed`:
      Number.isInteger(game.period)?`Round ${game.period} · hole progress unavailable`:'Round progress unavailable';
  }
  if(/esports/.test(family))return `${game.phase?game.phase+' · ':''}${game.esportsPeriodsValid?'score periods verified':'period scores unavailable'}`;
  if(/darts/.test(family))return `${game.phase?game.phase+' · ':''}no countdown clock`;
  if(/table_tennis/.test(family))return Number.isFinite(game.setNumber)?`Set ${game.setNumber} · no countdown clock`:'Set number unavailable';
  if(/baseball/.test(family))return Number.isFinite(game.period)?`Inning ${game.period}${Number.isFinite(game.outs)?` · ${game.outs} out(s)`:''}`:'Inning unavailable';
  if(/tennis/.test(family))return Number.isFinite(game.tennis?.firstGames)&&Number.isFinite(game.tennis?.secondGames)?`Set · ${game.tennis.firstGames}–${game.tennis.secondGames} games`:'Set score unavailable';
  if(/soccer/.test(family)&&Number.isFinite(game.matchRemainingSeconds)&&game.matchRemainingSeconds>=0)return `${String(Math.floor(game.matchRemainingSeconds/60)).padStart(2,'0')}:${String(game.matchRemainingSeconds%60).padStart(2,'0')} match time remaining`;
  if(/soccer/.test(family)&&Number.isFinite(game.soccerMinute))return `${game.soccerMinute}' elapsed`;
  if(Number.isFinite(game.remainingSeconds)){const segment=Number.isFinite(game.period)?/basketball/.test(family)?`${['NCAAB','NCAAW'].includes(game.sport)?'Half':'Quarter'} ${game.period}`:/football/.test(family)?`Quarter ${game.period}`:/hockey/.test(family)?`Period ${game.period}`:'' : '';const seconds=game.clockRunning===false?Math.floor(game.remainingSeconds):Math.ceil(game.remainingSeconds);return `${segment?segment+' · ':''}${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}${game.clockRunning===false?' paused':' remaining'}`}
  if(/cricket/.test(family))return Number.isFinite(game.period)?`Innings ${game.period}`:'Innings unavailable';
  if(/table_tennis/.test(family))return 'No countdown clock';
  return 'Live clock unavailable';
}
export function storedClockSeconds(value,running=true){
  return Number.isFinite(value)?Math.max(0,running===false?Math.floor(value):Math.ceil(value)):null;
}

