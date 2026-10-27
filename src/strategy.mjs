const N = v => v === null || v === undefined || v === '' ? NaN : Number(v);
const pick = (obj, names) => names.map(k => obj?.[k]).find(v => Number.isFinite(N(v)));
export function sportName(m) {
  const s = `${m.details?.competition || ''} ${m.type || ''} ${m.title || ''}`.toLowerCase();
  if (/college.*football|cfb/.test(s)) return 'CFB';
  if (/college.*basketball|ncaab/.test(s)) return 'NCAAB';
  if (/wnba/.test(s)) return 'WNBA';
  if (/nba|pro basketball/.test(s)) return 'NBA';
  if (/nfl|pro football/.test(s)) return 'NFL';
  if (/mlb|pro baseball/.test(s)) return 'MLB';
  if (/nhl|pro hockey/.test(s)) return 'NHL';
  if (/soccer|football match/.test(s)) return 'Soccer';
  return m.details?.competition || m.type || 'Sports';
}
export function gameState(m, live) {
  const d = live?.details || {};
  const sport = sportName(m);
  const home = N(pick(d, ['home_score','homeScore','home_points','home_runs','home_goals']) ?? d.home?.score ?? d.home_team?.score);
  const away = N(pick(d, ['away_score','awayScore','away_points','away_runs','away_goals']) ?? d.away?.score ?? d.away_team?.score);
  const status = String(d.status || '').toLowerCase();
  const period = N(pick(d, ['period','period_number','quarter','current_period','inning','current_inning']) ?? d.game?.period);
  const periodText = String(d.period_display || d.period_name || d.clock?.period || d.inning_half || '').toLowerCase();
  const clock = String(d.clock?.display || d.clock || d.time_remaining || '').trim();
  const parts = clock.match(/^(\d{1,2}):(\d{2})$/);
  const clockFraction = parts ? Math.min(1, (Number(parts[1])*60+Number(parts[2])) / (sport==='NBA'||sport==='WNBA'||sport==='NCAAB'?720:900)) : NaN;
  let progress = NaN;
  if (['NFL','CFB','NBA','WNBA'].includes(sport) && Number.isFinite(period) && period>=1) progress = Math.min(0.99,(period-1 + (Number.isFinite(clockFraction)?1-clockFraction:0))/4);
  if (sport==='NCAAB' && Number.isFinite(period) && period>=1) progress = Math.min(0.99,(period-1 + (Number.isFinite(clockFraction)?1-clockFraction:0))/2);
  if (sport==='NHL' && Number.isFinite(period) && period>=1) progress = Math.min(0.99,(period-1 + (Number.isFinite(clockFraction)?1-clockFraction:0))/3);
  if (sport==='MLB' && Number.isFinite(period) && period>=1) progress = Math.min(0.99,(period-1 + (/bottom/.test(periodText)?0.5:0))/9);
  if (sport==='Soccer' && Number.isFinite(period) && period>=1) progress = Math.min(0.99,(period-1)/2);
  const verifiedLive = ['live','in_progress','in progress','playing','inprogress'].includes(status) && !d.live_data_delayed;
  return {id:m.id, title:m.title, sport, status, home, away, period, clock, progress, verifiedLive, scoreKnown:Number.isFinite(home)&&Number.isFinite(away), homeName:String(d.home_team?.name||d.home_team_name||d.home?.name||''), awayName:String(d.away_team?.name||d.away_team_name||d.away?.name||''), eventTickers:m.related_event_tickers||[]};
}
const wholeGame = s => !/1st|2nd|3rd|4th|first half|second half|quarter|period|inning|halftime|regulation only|first to score|team total|player|individual|series total/i.test(s);
export function overSignal(game, market) {
  if (!game.verifiedLive || !game.scoreKnown || market.status!=='active' && market.status!=='open') return null;
  const text = `${market.title||''} ${market.yes_sub_title||''} ${market.rules_primary||''}`;
  if (!wholeGame(text) || !/total (points|runs|goals|score)|combined (points|runs|goals|score)|combined score/i.test(text)) return null;
  if (market.strike_type && !['greater','greater_than'].includes(market.strike_type)) return null;
  const strike = N(market.floor_strike);
  if (!Number.isFinite(strike) || game.home+game.away <= strike) return null;
  return {strategy:'over', reason:`${game.home+game.away} scored; line ${strike} already passed`, fraction:0.8};
}
const norm = s => String(s||'').toLowerCase().replace(/[^a-z0-9]/g,'');
export function leadSignal(game, market) {
  if (!game.verifiedLive || !game.scoreKnown || !Number.isFinite(game.progress) || game.progress<0.75 || market.status!=='active' && market.status!=='open') return null;
  if (game.home===game.away || !game.homeName || !game.awayName) return null;
  const leader = game.home>game.away ? game.homeName : game.awayName;
  const trailer = game.home>game.away ? game.awayName : game.homeName;
  const description = `${market.title||''} ${market.yes_sub_title||''}`;
  if (!/win|winner|victory/i.test(description) || !norm(description).includes(norm(leader)) || norm(description).includes(norm(trailer))) return null;
  const margin = Math.abs(game.home-game.away);
  const relative = margin / Math.max(1,Math.min(game.home,game.away));
  const minMargin = ['NFL','CFB'].includes(game.sport)?17:['NBA','WNBA','NCAAB'].includes(game.sport)?15:['MLB','NHL','Soccer'].includes(game.sport)?3:Infinity;
  if (margin<minMargin || relative<0.35) return null;
  const fraction = Math.min(0.8,0.12+0.42*game.progress+0.18*Math.min(1,relative));
  return {strategy:'lead', reason:`${leader} leads ${game.home}–${game.away}; ${Math.round(game.progress*100)}% elapsed`, fraction};
}
export function orderSize(balanceCents, askDollars, askSize, fraction, cap=0.98) {
  const price = N(askDollars), size = N(askSize);
  if (!Number.isFinite(price) || price<=0 || price>cap || !Number.isFinite(size) || size<1 || !Number.isFinite(balanceCents) || balanceCents<100) return 0;
  const budget = Math.floor(balanceCents * fraction);
  return Math.max(0,Math.min(Math.floor(budget/(price*100)),Math.floor(size)));
}
