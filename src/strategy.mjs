const N = v => v === null || v === undefined || v === '' ? NaN : Number(v);
const pick = (obj, names) => names.map(k => obj?.[k]).find(v => Number.isFinite(N(v)));
export function sportName(m) {
  const s = `${m.details?.competition || ''} ${m.details?.league || ''} ${m.type || ''}`.toLowerCase();
  if (/college.*football|cfb/.test(s)) return 'CFB';
  if (/college.*basketball|ncaab|ncaam|ncaaw/.test(s)) return 'NCAAB';
  if (/wnba/.test(s)) return 'WNBA';
  if (/nba|pro basketball/.test(s)) return 'NBA';
  if (/nfl|pro football/.test(s)) return 'NFL';
  if (/mlb|pro baseball/.test(s)) return 'MLB';
  if (/nhl|pro hockey/.test(s)) return 'NHL';
  if (/soccer|football match/.test(s)) return 'Soccer';
  if (/basketball/.test(s)) return m.details?.league || 'Basketball';
  if (/baseball/.test(s)) return m.details?.league || 'Baseball';
  if (/hockey/.test(s)) return m.details?.league || 'Hockey';
  if (/football/.test(s)) return m.details?.league || 'Football';
  return m.details?.league || m.details?.competition || m.type || 'Sports';
}
export function gameState(m, live) {
  const d = live?.details || {};
  const sport = sportName(m);
  const home = N(pick(d, ['home_score','homeScore','home_points','home_runs','home_goals']) ?? d.home?.score ?? d.home_team?.score);
  const away = N(pick(d, ['away_score','awayScore','away_points','away_runs','away_goals']) ?? d.away?.score ?? d.away_team?.score);
  const status = String(d.status || '').toLowerCase();
  const period = N(pick(d, ['period','period_number','quarter','current_period','inning','current_inning']) ?? d.game?.period);
  const periodText = String(d.period_display || d.period_name || d.clock?.period || d.inning_half || '').toLowerCase();
  const clock = String(d.period_remaining_time || d.clock?.display || d.clock || d.time_remaining || '').trim();
  const parts = clock.match(/^(\d{1,2}):(\d{2})$/);
  const remainingSeconds=parts?Number(parts[1])*60+Number(parts[2]):NaN;
  const family=String(m.type||'').toLowerCase();
  const segmentSeconds=/hockey/.test(family)||sport==='NCAAB'?1200:/basketball/.test(family)?sport==='WNBA'?600:720:900;
  const clockFraction = parts ? Math.min(1, (Number(parts[1])*60+Number(parts[2])) / segmentSeconds) : NaN;
  let progress = NaN;
  if ((['NFL','CFB','NBA','WNBA'].includes(sport)||/football_game|basketball_game/.test(family)) && Number.isFinite(period) && period>=1) progress = Math.min(0.99,(period-1 + (Number.isFinite(clockFraction)?1-clockFraction:0))/4);
  if (sport==='NCAAB' && Number.isFinite(period) && period>=1) progress = Math.min(0.99,(period-1 + (Number.isFinite(clockFraction)?1-clockFraction:0))/2);
  if ((sport==='NHL'||/hockey_match/.test(family)) && Number.isFinite(period) && period>=1) progress = Math.min(0.99,(period-1 + (Number.isFinite(clockFraction)?1-clockFraction:0))/3);
  if ((sport==='MLB'||/baseball_game/.test(family)) && Number.isFinite(period) && period>=1) progress = Math.min(0.99,(period-1 + (/bottom/.test(periodText)?0.5:0))/9);
  if (sport==='Soccer' && Number.isFinite(period) && period>=1) progress = Math.min(0.99,(period-1)/2);
  const updated=N(d.last_updated_ts);const fresh=!Number.isFinite(updated) || Math.abs(Date.now()-updated*1000)<120000;
  const verifiedLive = ['live','in_progress','in progress','playing','inprogress'].includes(status) && !d.live_data_delayed && fresh;
  const names=String(m.title||'').split(/\s+at\s+/i);
  const homeUnits=home,awayUnits=away;
  const unit=/baseball/.test(family)?'runs':/hockey|soccer/.test(family)?'goals':'points';
  return {id:m.id, title:m.title, sport, type:family, status, home, away, homeUnits, awayUnits, unit, period, clock, remainingSeconds, inningHalf:N(d.inning_half), outs:N(d.outs), progress, verifiedLive, scoreKnown:Number.isFinite(home)&&Number.isFinite(away), homeName:String(d.home_team?.name||d.home_team_name||d.home?.name||(names.length===2?names[1]:'')), awayName:String(d.away_team?.name||d.away_team_name||d.away?.name||(names.length===2?names[0]:'')),homeTeamId:m.details?.home_team_id,awayTeamId:m.details?.away_team_id,eventTickers:m.related_event_tickers||[]};
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
  const basketball=/basketball/.test(game.type);
  const football=/football/.test(game.type);
  const hockey=/hockey/.test(game.type);
  const segments=/baseball/.test(game.type)?9:/hockey/.test(game.type)?3:/soccer/.test(game.type)?2:basketball&&game.sport==='NCAAB'?2:/basketball|football/.test(game.type)?4:Infinity;
  const baseball=/baseball/.test(game.type);
  const finalTime=baseball?game.period===9:game.period===segments && Number.isFinite(game.remainingSeconds) && game.remainingSeconds>0 && game.remainingSeconds<420;
  if (!game.verifiedLive || !game.scoreKnown || !finalTime || market.status!=='active' && market.status!=='open') return null;
  const h=game.homeUnits,a=game.awayUnits;
  if (!Number.isFinite(h)||!Number.isFinite(a)) return null;
  const margin=Math.abs(h-a),trailerScore=Math.min(h,a);
  const minimumRatio=football?12/7:hockey?3:3.5;
  if (basketball ? margin<5 : hockey ? Math.max(h,a)<3 || (trailerScore>0 && Math.max(h,a)<3*trailerScore) : trailerScore<=0||Math.max(h,a)<minimumRatio*trailerScore) return null;
  const leader = h>a ? game.homeName : game.awayName;
  const trailer = h>a ? game.awayName : game.homeName;
  const description = `${market.title||''} ${market.yes_sub_title||''}`;
  const teamId=Object.entries(market.custom_strike||{}).find(([k,v])=>/_team$/.test(k)&&typeof v==='string')?.[1];
  const expectedId=h>a?game.homeTeamId:game.awayTeamId;
  const identityMatches=teamId&&expectedId?teamId===expectedId:Boolean(leader&&trailer&&norm(description).includes(norm(leader))&&!norm(description).includes(norm(trailer)));
  if (!/win|winner|victory/i.test(description) || !identityMatches) return null;
  const ratio=trailerScore>0?Math.max(h,a)/trailerScore:Infinity;
  const phase=baseball?(game.inningHalf===2&&game.outs>=2?2:game.inningHalf===2||game.outs>=2?1:0):(game.remainingSeconds<120?2:game.remainingSeconds<300?1:0);
  const [low,high]=[[0.15,0.30],[0.30,0.55],[0.55,0.80]][phase];
  const strength=basketball?(margin-5)/15:football?(ratio-12/7)/1.5:hockey?(ratio-3)/2:(ratio-3.5)/2.5;
  const fraction=Math.round((low+(high-low)*Math.min(1,strength))*100)/100;
  return {strategy:'lead', reason:`${leader||market.yes_sub_title} leads ${h}–${a} ${game.unit} (${basketball?margin+' point lead':Number.isFinite(ratio)?Math.round((ratio-1)*100)+'% advantage':'shutout'}); ${baseball?'9th inning':game.clock+' remaining'}`, fraction};
}
export function orderSize(balanceCents, askDollars, askSize, fraction, cap=0.98) {
  const price = N(askDollars), size = N(askSize);
  if (!Number.isFinite(price) || price<=0 || price>cap || !Number.isFinite(size) || size<1 || !Number.isFinite(balanceCents) || balanceCents<100) return 0;
  const budget = Math.floor(balanceCents * fraction);
  return Math.max(0,Math.min(Math.floor(budget/(price*100)),Math.floor(size)));
}
export function overBudget(balanceCents, portfolioValueCents, openOverExposureCents) {
  const cash=N(balanceCents), value=N(portfolioValueCents), exposure=N(openOverExposureCents);
  if (![cash,value,exposure].every(Number.isFinite) || Math.min(cash,value,exposure)<0) return 0;
  return Math.max(0,Math.floor((cash+value)*0.8)-Math.ceil(exposure));
}
