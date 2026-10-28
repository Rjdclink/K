// Only fetch event families used by the two entry strategies and comeback exits.
// The exchange remains authoritative: a guessed ticker is ignored unless an
// open event and its market are actually returned by Kalshi.
const supportedType=type=>/basketball|baseball|football|hockey|soccer|tennis/.test(String(type||'').toLowerCase()) &&
  !/esports|table_tennis/.test(String(type||'').toLowerCase());

export function eligibleForMarkets(game){return game?.verifiedLive && game.scoreKnown && supportedType(game.type)}

export function linkedEventTickers(milestone){
  const source=[...(milestone.related_event_tickers||[]),...(milestone.primary_event_tickers||[]),milestone.details?.main_game_event_ticker].filter(Boolean);
  const main=ticker=>{
    const series=String(ticker).split('-')[0].toUpperCase();
    if(!String(ticker).includes('-')||!/(?:TEAMTOTAL|TOTAL|GAME|MATCH)$/.test(series))return false;
    if(/(?:1H|2H|[1-4]Q|[1-3]P|[1-9]INNING|HALF|SET)(?:GAME|MATCH)$/.test(series))return false;
    return !series.endsWith('MATCH')||/tennis/.test(String(milestone.type||''));
  };
  // Kalshi links player props and other score markets directly to the game.
  // Keep those actual tickers; the strategy still rejects any metric it
  // cannot independently verify.
  const listed=source.filter(t=>String(t).includes('-') && (main(t) || /(?:PTS|REB|AST|3PT|PRA|STL|BLK)$/.test(String(t).split('-')[0])));
  const derived=listed.filter(ticker=>ticker.split('-')[0].endsWith('GAME')).flatMap(ticker=>{
    const [series,...rest]=ticker.split('-'),suffix=rest.join('-'),prefix=series.slice(0,-4);
    // These are only discovery candidates. The exchange must return an open
    // event and the contract-specific score check must still succeed.
    const family=String(milestone.type||'');
    const segments=/basketball/.test(family)?['1Q','2Q','3Q','4Q','1H','2H']:
      /hockey/.test(family)?['1P','2P','3P']:
      /football/.test(family)?['1Q','2Q','3Q','4Q','1H','2H']:
      /baseball/.test(family)?Array.from({length:9},(_,i)=>`${i+1}INNING`):[];
    return [`${prefix}TOTAL-${suffix}`,`${prefix}TEAMTOTAL-${suffix}`,
      ...segments.flatMap(part=>[`${prefix}${part}TOTAL-${suffix}`,`${prefix}${part}TEAMTOTAL-${suffix}`])];
  });
  return [...new Set([...listed,...derived])];
}

export function gameTimeLabel(game){
  if(/^(final|finished|complete|completed|closed|ended)$/.test(game?.status||''))return 'Final';
  const family=String(game?.type||'');
  if(/esports/.test(family)&&game.phase)return `${game.phase} · no live clock supplied`;
  if(/darts/.test(family))return `${game.phase?game.phase+' · ':''}no countdown clock`;
  if(/table_tennis/.test(family))return Number.isFinite(game.setNumber)?`Set ${game.setNumber} · no countdown clock`:'Set number unavailable';
  if(/baseball/.test(family))return Number.isFinite(game.period)?`Inning ${game.period}${Number.isFinite(game.outs)?` · ${game.outs} out(s)`:''}`:'Inning unavailable';
  if(/tennis/.test(family))return Number.isFinite(game.tennis?.firstGames)&&Number.isFinite(game.tennis?.secondGames)?`Set · ${game.tennis.firstGames}–${game.tennis.secondGames} games`:'Set score unavailable';
  if(/soccer/.test(family)&&Number.isFinite(game.matchRemainingSeconds)&&game.matchRemainingSeconds>=0)return `${String(Math.floor(game.matchRemainingSeconds/60)).padStart(2,'0')}:${String(game.matchRemainingSeconds%60).padStart(2,'0')} match time remaining`;
  if(/soccer/.test(family)&&Number.isFinite(game.soccerMinute))return `${game.soccerMinute}' elapsed`;
  if(Number.isFinite(game.remainingSeconds)){const segment=Number.isFinite(game.period)?/basketball/.test(family)?`${game.sport==='NCAAB'?'Half':'Quarter'} ${game.period}`:/football/.test(family)?`Quarter ${game.period}`:/hockey/.test(family)?`Period ${game.period}`:'' : '';const seconds=game.clockRunning===false?Math.floor(game.remainingSeconds):Math.ceil(game.remainingSeconds);return `${segment?segment+' · ':''}${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}${game.clockRunning===false?' paused':' remaining'}`}
  if(/cricket/.test(family)&&Number.isFinite(game.period))return `Innings ${game.period} · no countdown clock`;
  if(/table_tennis/.test(family))return 'No countdown clock';
  return 'Live clock unavailable';
}
export function storedClockSeconds(value,running=true){
  return Number.isFinite(value)?Math.max(0,running===false?Math.floor(value):Math.ceil(value)):null;
}
