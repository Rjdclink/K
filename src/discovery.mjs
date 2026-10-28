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
    if(/(?:1H|2H|[1-4]Q|[1-3]P|[1-9]INNING|HALF|SET)(?:TEAMTOTAL|TOTAL|GAME|MATCH)$/.test(series))return false;
    return !series.endsWith('MATCH')||/tennis/.test(String(milestone.type||''));
  };
  const listed=source.filter(main);
  const derived=listed.filter(ticker=>ticker.split('-')[0].endsWith('GAME')).flatMap(ticker=>{
    const [series,...rest]=ticker.split('-'),suffix=rest.join('-'),prefix=series.slice(0,-4);
    return [`${prefix}TOTAL-${suffix}`,`${prefix}TEAMTOTAL-${suffix}`];
  });
  return [...new Set([...listed,...derived])];
}

export function gameTimeLabel(game){
  if(/^(final|finished|complete|completed|closed|ended)$/.test(game?.status||''))return 'Final';
  const family=String(game?.type||'');
  if(/table_tennis/.test(family))return Number.isFinite(game.setNumber)?`Set ${game.setNumber} · no countdown clock`:'Set number unavailable';
  if(/baseball/.test(family))return Number.isFinite(game.period)?`Inning ${game.period}${Number.isFinite(game.outs)?` · ${game.outs} out(s)`:''}`:'Inning unavailable';
  if(/tennis/.test(family))return Number.isFinite(game.tennis?.firstGames)&&Number.isFinite(game.tennis?.secondGames)?`Set · ${game.tennis.firstGames}–${game.tennis.secondGames} games`:'Set score unavailable';
  if(/soccer/.test(family)&&Number.isFinite(game.matchRemainingSeconds)&&game.matchRemainingSeconds>=0)return `${String(Math.floor(game.matchRemainingSeconds/60)).padStart(2,'0')}:${String(game.matchRemainingSeconds%60).padStart(2,'0')} match time remaining`;
  if(/soccer/.test(family)&&Number.isFinite(game.soccerMinute))return `${game.soccerMinute}' elapsed`;
  if(Number.isFinite(game.remainingSeconds))return `${String(Math.floor(game.remainingSeconds/60)).padStart(2,'0')}:${String(game.remainingSeconds%60).padStart(2,'0')} remaining`;
  if(/cricket/.test(family)&&Number.isFinite(game.period))return `Innings ${game.period} · no countdown clock`;
  if(/darts|table_tennis/.test(family))return 'No countdown clock';
  return 'Live clock unavailable';
}
