// Only fetch event families used by the two entry strategies and comeback exits.
// The exchange remains authoritative: a guessed ticker is ignored unless an
// open event and its market are actually returned by Kalshi.
import { cfbLeadApproaching, basketballLeadProfile } from './strategy.mjs';
import {allowsNewEntry} from './entry_exclusions.mjs';
// Only hockey, soccer and football remain within automated scanning.
// Historical basketball positions, settlements and user-directed account actions
// remain accessible separately. When type is missing, only those three leagues
// may pass; unknown leagues never authorize a new automated scan.
export function isScannerExcludedSport(item){
  const type=String(item?.type||item?.sport_family||'').toLowerCase().replaceAll('-','_');
  if(type)return !/^(?:hockey|soccer|football)_/.test(type);
  const league=String(item?.sport||item?.details?.league||'').trim().toUpperCase();
  return !/^(?:NHL|SOCCER|NFL|CFB|NCAAF|NCAAFB)$/.test(league);
}
// Only families with implemented, currently enabled entries belong in scans.
export function supportedScannerSport(item){
  if(isScannerExcludedSport(item))return false;
  const type=String(item?.type||'').toLowerCase();
  if(!/^(?:football|hockey|soccer)_/.test(type))return false;
  if(/esports/i.test(`${type} ${item?.sport||''} ${item?.details?.league||''}`))return false;
  return true;
}

// The discovery worker must keep the tracked live set AND admit new fixtures
// from its persisted catalog. A nonempty live set is not a substitute for
// current discovery; otherwise new games can starve until every old one ends.
export function mergeScannerMilestones(knownLive=[],catalog=[]){
  const ordered=[...(Array.isArray(knownLive)?knownLive:[]),
    ...(Array.isArray(catalog)?catalog:[])].filter(m=>m?.id&&supportedScannerSport(m));
  return [...new Map(ordered.map(m=>[m.id,m])).values()];
}

export async function mapBatches(items,limit,task){
  const results=new Array(items.length);let next=0;
  await Promise.all(Array.from({length:Math.min(items.length,Math.max(1,Math.floor(limit)))},async()=>{
    while(next<items.length){const i=next++;results[i]=await task(items[i],i)}
  }));
  return results;
}

export const internationalBasketball=game=>/basketball/.test(String(game?.type||''))&&
  !['NBA','WNBA','NCAAB','NCAAW'].includes(game?.sport);
export function eligibleForMarkets(game){return game?.verifiedLive && supportedScannerSport(game) && !internationalBasketball(game)}

export async function discoverCurrentMilestones(get,now=Date.now(),lookbackMs=7*86400000){
  const cutoff=now+3600000,min=new Date(now-lookbackMs).toISOString();
  const finished=m=>{
    const status=String(m.details?.status||'').trim().toLowerCase();
    return /^(?:final|finished|completed|closed|ended|event closed|match complete)(?:\b|$)/.test(status)&&
      Date.parse(m.start_date||'')<now-2*3600000;
  };
  const categories=await Promise.all(['Sports'].map(async category=>{
    const found=[],seen=new Set();let cursor='';
    for(;;){
      const query=new URLSearchParams({category,limit:'500',minimum_start_date:min});
      if(cursor)query.set('cursor',cursor);
      const response=await get('/milestones?'+query),page=response.milestones||[];
      found.push(...page.filter(m=>m.id&&supportedScannerSport(m)&&!finished(m)&&Date.parse(m.start_date||'')<cutoff&&
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

export async function refreshDiscovery(get,previous,now=Date.now()){
  const fullAt=Date.parse(previous?.full_discovered_at||'');
  const full=!Array.isArray(previous?.milestones)||!Number.isFinite(fullAt)||now-fullAt>=15*60000;
  const found=await discoverCurrentMilestones(get,now,full?7*86400000:8*3600000);
  // Refresh retained events while excluding disabled sports even when the
  // existing cached catalog still contains them.
  const retained=full?[]:previous.milestones.filter(m=>supportedScannerSport(m)&&Date.parse(m.start_date||'')<now-8*3600000);
  return {milestones:[...new Map([...retained,...found].map(m=>[m.id,m])).values()],
    full_discovered_at:full?new Date(now).toISOString():previous.full_discovered_at};
}

// Kalshi discovery includes older, still-open milestones that have no live
// score. Avoid fetching live data for hours of inactive games on every scan.
// Retain every recently observed live game and long-running tournament
// formats even when they began earlier. Some old Kalshi milestones still say
// "live" after their scores stopped updating, so that flag alone is unsafe.
export function scanMilestones(milestones,recentLiveIds=new Set(),now=Date.now()){
  return milestones.filter(m=>{
    const started=Date.parse(m.start_date||'');
    return supportedScannerSport(m)&&(recentLiveIds.has(m.id)||
      !Number.isFinite(started)||started>=now-8*3600000);
  });
}

// A market can cross an over line at any time, so early games still receive a
// rotating check. Give the frequent market pass to games near a winner window,
// games with a recent signal, and games with a held position needing exits.
export function nearEntryPhase(game){
  if(isScannerExcludedSport(game))return false;
  const type=String(game?.type||''),period=Number(game?.period),seconds=Number(game?.remainingSeconds);
  if(/football/.test(type))return game.sport==='CFB'?
    cfbLeadApproaching(game)||[2,4].includes(period)&&seconds>=0&&seconds<=420:period>=4&&seconds>=0&&seconds<=480;
  if(/basketball/.test(type)){
    const profile=basketballLeadProfile(game);
    const pro=['NBA','WNBA'].includes(game.sport);
    const college=['NCAAB','NCAAW'].includes(game.sport);
    const firstHalf=game.sport==='NCAAB'?1:2;
    const fullGame=game.sport==='NCAAB'?2:4;
    // Start priority checks minutes ahead of the first ESPN preflight, not
    // only when a period/quarter is nearly over. This also allows a paused
    // clock to finish a full 60 seconds of real-time verification.
    return Number.isFinite(seconds)&&seconds>0&&(
      pro&&period>=1&&period<=3&&seconds<=360||
      college&&period===firstHalf&&seconds<=480||
      college&&period===fullGame&&seconds<=600||
      pro&&period===4&&seconds<=480||
      Boolean(profile)&&period>=profile.period&&seconds<=profile.tiers[0][1]+90);
  }
  if(/hockey/.test(type)){
    const margin=Number.isFinite(game.homeUnits)&&Number.isFinite(game.awayUnits)?
      Math.abs(game.homeUnits-game.awayUnits):0;
    return (period===1||period===2)&&seconds>0&&seconds<=360||
      period>=3&&seconds>=0&&seconds<=900||
      period===3&&seconds>0&&(margin>=4&&seconds<=1200||margin>=3&&seconds<=960);
  }
  if(/soccer/.test(type))return period===1&&!game.soccerExtraTime&&
    Number.isFinite(game.soccerMinute)&&game.soccerMinute>=38&&game.soccerMinute<45||
    period===2&&!game.soccerExtraTime&&Number.isFinite(game.soccerMinute)&&
    (game.soccerMinute<90&&
      (game.soccerMinute>=75||game.soccerMinute>=45&&
       Number.isFinite(game.homeUnits)&&Number.isFinite(game.awayUnits)&&
       Math.abs(game.homeUnits-game.awayUnits)>=3)||
     game.soccerMinute>90&&game.verifiedLive===true&&game.clockRunning===true);
  if(/baseball/.test(type))return period>=9||period===8&&game.inningHalf===2&&game.outs>=1;
  if(/rugby|handball|lacrosse/.test(type)){
    const final=/lacrosse/.test(type)?4:2,buffer=/rugby/.test(type)?300:600;
    return period===final&&seconds>=0&&seconds<=buffer||
      !/rugby/.test(type)&&period===final-1&&seconds>=0&&seconds<=60;
  }
  if(/tennis/.test(type))return Boolean(game.tennis)&&
    (game.tennis.firstSets>=Math.floor(game.tennis.bestOf/2)||
      game.tennis.secondSets>=Math.floor(game.tennis.bestOf/2));
  // Clock-free sports and unfamiliar formats remain on the frequent pass.
  return true;
}
// Time until the first verification / impending entry threshold, expressed in
// seconds. Once a live market is inside its verification window, it outranks
// approaching games. Unknown clocks get no timing priority (never guessed).
export function marketEntryProximity(game){
  if(isScannerExcludedSport(game))return Infinity;
  const type=String(game?.type||''),period=Number(game?.period);
  let remaining=Number(game?.remainingSeconds),target=NaN;
  const margin=Number.isFinite(game?.homeUnits)&&Number.isFinite(game?.awayUnits)?
    Math.abs(game.homeUnits-game.awayUnits):0;
  if(/soccer/.test(type)){
    if(game.soccerExtraTime||!Number.isFinite(game.soccerMinute))return Infinity;
    // 90+ live regulation stoppage is urgent; zero alone never qualifies.
    if(period===2&&game.soccerMinute>90&&game.verifiedLive&&game.clockRunning===true)
      return -20000;
    if(period===1){remaining=(45-game.soccerMinute)*60;target=360;}
    else if(period===2){remaining=(90-game.soccerMinute)*60;target=margin>=5?1500:margin>=4?1200:margin>=3?900:660;}
    else return Infinity;
  }else if(/hockey/.test(type)){
    if([1,2].includes(period))target=360;
    else if(period===3)target=margin>=4?1200:margin>=3?900:margin>=2?360:420;
  }else if(/basketball/.test(type)){
    if(['NBA','WNBA'].includes(game.sport)){
      if([1,2,3].includes(period))target=150;
      else if(period===4)target=270;
    }else if(['NCAAB','NCAAW'].includes(game.sport)){
      const first=game.sport==='NCAAB'?1:2,final=game.sport==='NCAAB'?2:4;
      if(period===first)target=150;
      else if(period===final)target=game.sport==='NCAAB'?margin>=14?270:240:margin>=14?270:120;
    }
  }else if(/football/.test(type)&&period===4){
    target=450;
  }
  if(!Number.isFinite(remaining)||remaining<=0||!Number.isFinite(target))return Infinity;
  return remaining<=target?-10000+remaining:remaining-target;
}

export function prioritizeMarketGames(games,{signaledIds=new Set(),heldIds=new Set(),cycle=Math.floor(Date.now()/60000),lowBudget=12}={}){
  const urgent=[],early=[];
  for(const game of games){
    if(isScannerExcludedSport(game.milestone)||isScannerExcludedSport(game.state))continue;
    const id=game.milestone.id;
    (heldIds.has(id)||signaledIds.has(id)||game.watchable||nearEntryPhase(game.state)?urgent:early).push(game);
  }
  const order=(a,b)=>marketEntryProximity(a.state)-marketEntryProximity(b.state);
  urgent.sort(order);early.sort(order);
  const available=Math.max(0,Math.floor(lowBudget));
  if(available===0||early.length===0)return urgent;
  if(early.length<=available)return [...urgent,...early];
  // Preserve discovery fairness: most slots go to near-threshold games; the
  // remainder rotate across all other live markets instead of starving them.
  if(available===1&&cycle%4===3)return [...urgent,early[Math.floor(cycle/4)%early.length]];
  const priorityCount=available===1?1:Math.max(1,Math.floor(available*.7));
  const selected=early.slice(0,priorityCount),rotating=early.slice(priorityCount);
  const rotatingCount=available-selected.length;
  if(rotatingCount&&rotating.length){
    const start=((Math.floor(cycle)*rotatingCount)%rotating.length+rotating.length)%rotating.length;
    for(let i=0;i<Math.min(rotatingCount,rotating.length);i++)selected.push(rotating[(start+i)%rotating.length]);
  }
  return [...urgent,...selected];
}

export function readyOverTickets(rows,limit=12,activeTickers=new Set()){
  return rows.flatMap(({milestone,signals})=>isScannerExcludedSport(milestone)?[]:(signals||[])
    .filter(signal=>signal.strategy==='over'&&allowsNewEntry(milestone,{ticker:signal.ticker})&&
      (activeTickers.has(signal.ticker)||/^(?:Awaiting score verification|Waiting for first external check|First external check passed; waiting for paired checks|External score matched)/.test(signal.execution||''))&&
      signal.ticker&&Number(signal.ask)>0&&Number(signal.ask)<1&&Number(signal.ask_size)>0)
    .map(signal=>({milestone,signal}))).slice(0,limit);
}
export function prioritizeReadyOverTickets(tickets,windows,limit=12,cycle=Math.floor(Date.now()/60000)){
  const seen=new Map(windows.map(w=>[w.market_ticker,Number(w.last_seen)]));
  const active=tickets.filter(t=>seen.has(t.signal.ticker)).sort((a,b)=>seen.get(a.signal.ticker)-seen.get(b.signal.ticker));
  const other=tickets.filter(t=>!seen.has(t.signal.ticker)),offset=other.length?cycle*limit%other.length:0;
  return [...active,...other.slice(offset),...other.slice(0,offset)].slice(0,limit);
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
    const segments=/soccer/.test(family)?['1H']:
      /basketball/.test(family)?['1Q','2Q','3Q','4Q','1H','2H']:
      /hockey/.test(family)?['1P','2P','3P']:
      /football/.test(family)?['1Q','2Q','3Q','4Q','1H','2H']:
      /baseball/.test(family)?Array.from({length:9},(_,i)=>`${i+1}INNING`):[];
    return [`${totalPrefix}TOTAL-${suffix}`,`${totalPrefix}TEAMTOTAL-${suffix}`,
      ...segments.flatMap(part=>[`${prefix}${part}TOTAL-${suffix}`,`${prefix}${part}TEAMTOTAL-${suffix}`])];
  });
  return [...new Set([...listed,...derived])];
}

export function playerPropEntryClosed(game){
  const type=String(game?.type||''),period=game?.period,seconds=game?.remainingSeconds;
  if(/soccer/.test(type))return Number.isFinite(game.soccerMinute)&&game.soccerMinute>80||
    Number.isFinite(game.matchRemainingSeconds)&&game.matchRemainingSeconds<600;
  if(/baseball/.test(type))return Number.isInteger(period)&&period>7;
  const last=/basketball/.test(type)?game.sport==='NCAAB'?2:4:
    /hockey/.test(type)?3:/football|lacrosse/.test(type)?4:
    /rugby|handball/.test(type)?2:null;
  return last!==null&&Number.isInteger(period)&&period>=last&&Number.isFinite(seconds)&&seconds<600;
}

export function entryEventTickers(milestone,game){
  if(isScannerExcludedSport(milestone)||isScannerExcludedSport(game))return [];
  // Linked historical player markets remain discoverable for account history,
  // but no player-stat event enters active scanner market fetches.
  const tickers=linkedEventTickers(milestone).filter(ticker=>allowsNewEntry(game,{ticker}));
  if(!playerPropEntryClosed(game))return tickers;
  return tickers.filter(ticker=>{
    const series=String(ticker).split('-')[0];
    if(!/(?:PTS|REB|AST|3PT|PRA|STL|BLK|GOALS|SAVES|SOG|HITS|RBI|HR|RUSHYDS|PASSYDS|RECYDS|RRYDS|RECPROT|PASSATT|PASSCOMP|PASSINT|PASSTDS)(?:PROT)?$/.test(series))return true;
    return ['NFL','CFB'].includes(game?.sport)&&game.period>=3&&/(?:RUSHYDS|RECYDS)$/.test(series);
  });
}

export function winnerEventTickers(milestone){
  if(isScannerExcludedSport(milestone))return [];
  return linkedEventTickers(milestone).filter(ticker=>/GAME$/.test(String(ticker).split('-')[0]));
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
  if(/table_tennis/.test(family))return Number.isFinite(game.setNumber)?`Set ${game.setNumber}`:'Set number unavailable';
  if(/baseball/.test(family))return Number.isFinite(game.period)?`Inning ${game.period}${Number.isFinite(game.outs)?` · ${game.outs} out(s)`:''}`:'Inning unavailable';
  if(/tennis/.test(family))return Number.isFinite(game.tennis?.firstGames)&&Number.isFinite(game.tennis?.secondGames)?`Set · ${game.tennis.firstGames}–${game.tennis.secondGames} games`:'Set score unavailable';
  if(/soccer/.test(family)&&Number.isFinite(game.matchRemainingSeconds)&&game.matchRemainingSeconds>=0)return `${String(Math.floor(game.matchRemainingSeconds/60)).padStart(2,'0')}:${String(game.matchRemainingSeconds%60).padStart(2,'0')} match time remaining`;
  if(/soccer/.test(family)&&Number.isFinite(game.soccerMinute))return `${game.soccerMinute}' elapsed`;
  if(Number.isFinite(game.remainingSeconds)){const segment=Number.isFinite(game.period)?/basketball/.test(family)?`${game.sport==='NCAAB'?'Half':'Quarter'} ${game.period}`:/football/.test(family)?`Quarter ${game.period}`:/hockey/.test(family)?`Period ${game.period}`:'' : '';const seconds=game.clockRunning===false?Math.floor(game.remainingSeconds):Math.ceil(game.remainingSeconds);return `${segment?segment+' · ':''}${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}${game.clockRunning===false?' paused':' remaining'}`}
  if(/cricket/.test(family))return Number.isFinite(game.period)?`Innings ${game.period}`:'Innings unavailable';
  return 'Live clock unavailable';
}
export function storedClockSeconds(value,running=true){
  return Number.isFinite(value)?Math.max(0,running===false?Math.floor(value):Math.ceil(value)):null;
}