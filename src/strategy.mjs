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
  if (/tennis|\batp\b|\bwta\b/.test(s)) return 'Tennis';
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
  const tennis=/tennis/.test(String(m.type||''));
  const one=tennis?d.competitor1_round_scores?.at(-1):null,two=tennis?d.competitor2_round_scores?.at(-1):null;
  const firstIsHome=d.competitor1_is_home!==false;
  const home = N(tennis?(firstIsHome?one?.score:two?.score):pick(d, ['home_score','homeScore','home_points','home_runs','home_goals','home_same_game_score']) ?? d.home?.score ?? d.home_team?.score);
  const away = N(tennis?(firstIsHome?two?.score:one?.score):pick(d, ['away_score','awayScore','away_points','away_runs','away_goals','away_same_game_score']) ?? d.away?.score ?? d.away_team?.score);
  const status = String(d.status || '').toLowerCase();
  const half=String(d.half||'').toLowerCase();
  const period = N(pick(d, ['period','period_number','quarter','current_period','inning','current_inning']) ?? d.game?.period ?? (/^(?:2nd|second)$/.test(half)?2:/^(?:1st|first)$/.test(half)?1:undefined));
  const periodText = String(d.period_display || d.period_name || d.clock?.period || d.inning_half || '').toLowerCase();
  const clock = String(d.period_remaining_time || d.clock?.display || d.clock || d.time_remaining || '').trim();
  const parts = clock.match(/^(\d{1,2}):(\d{2})$/);
  const remainingSeconds=parts?Number(parts[1])*60+Number(parts[2]):NaN;
  const soccerTime=String(d.time??d.minute??'').trim();
  const minuteMatch=soccerTime.match(/^(\d{1,3})(?::(\d{2}))?(?:\+(\d{1,2}))?['′]?$/);
  const soccerMinute=minuteMatch?Number(minuteMatch[1])+Number(minuteMatch[3]||0)+Number(minuteMatch[2]||0)/60:NaN;
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
  const unit=/baseball/.test(family)?'runs':/hockey|soccer/.test(family)?'goals':tennis?'games':'points';
  const tennisData=tennis?{bestOf:N(m.details?.best_of),firstId:m.details?.first_competitor_id,secondId:m.details?.second_competitor_id,firstGames:N(one?.score),secondGames:N(two?.score),firstSets:N(d.competitor1_overall_score),secondSets:N(d.competitor2_overall_score),firstPoints:N(d.competitor1_current_round_score),secondPoints:N(d.competitor2_current_round_score),firstRound:one?.outcome,secondRound:two?.outcome,server:String(d.server||''),advantage:String(d.advantage||''),mainEvent:m.details?.main_game_event_ticker}:null;
  return {id:m.id, title:m.title, sport, type:family, status, home, away, homeUnits, awayUnits, unit, period, clock, remainingSeconds, soccerMinute, soccerHalf:half, tennis:tennisData, inningHalf:N(d.inning_half), outs:N(d.outs), progress, verifiedLive, scoreKnown:Number.isFinite(home)&&Number.isFinite(away), homeName:String(d.home_team?.name||d.home_team_name||d.home?.name||(names.length===2?names[1]:'')), awayName:String(d.away_team?.name||d.away_team_name||d.away?.name||(names.length===2?names[0]:'')),homeTeamId:m.details?.home_team_id,awayTeamId:m.details?.away_team_id,eventTickers:m.related_event_tickers||[]};
}
const wholeGame = s => !/1st|2nd|3rd|4th|first half|second half|quarter|period|inning|halftime|regulation only|first to score|team total|player|individual|series total/i.test(s);
export function overSignal(game, market) {
  if (!game.verifiedLive || !game.scoreKnown || game.home+game.away<=0 || market.status!=='active' && market.status!=='open') return null;
  const text = `${market.title||''} ${market.yes_sub_title||''} ${market.rules_primary||''}`;
  if (!wholeGame(text) || !/total (points|runs|goals|score)|combined (points|runs|goals|score)|combined score|\bover\s+\d+(?:\.\d+)?\s+(?:points|runs|goals)\s+scored\b/i.test(text)) return null;
  if (market.strike_type && !['greater','greater_than'].includes(market.strike_type)) return null;
  const strike = N(market.floor_strike);
  if (!Number.isFinite(strike) || strike<0 || game.home+game.away <= strike) return null;
  return {strategy:'over', reason:`${game.home+game.away} scored; line ${strike} already passed`, fraction:0.8};
}
const norm = s => String(s||'').toLowerCase().replace(/[^a-z0-9]/g,'');
export function leadSignal(game, market) {
  const basketball=/basketball/.test(game.type);
  const football=/football/.test(game.type);
  const hockey=/hockey/.test(game.type);
  const soccer=/soccer/.test(game.type);
  const segments=/baseball/.test(game.type)?9:/hockey/.test(game.type)?3:/soccer/.test(game.type)?2:basketball&&game.sport==='NCAAB'?2:/basketball|football/.test(game.type)?4:Infinity;
  const baseball=/baseball/.test(game.type);
  const finalTime=baseball?game.period===9:soccer?game.period===2 && Number.isFinite(game.soccerMinute) && game.soccerMinute>=85:game.period===segments && Number.isFinite(game.remainingSeconds) && game.remainingSeconds>0 && game.remainingSeconds<(hockey?420:300);
  if (!game.verifiedLive || !game.scoreKnown || !finalTime || market.status!=='active' && market.status!=='open') return null;
  const h=game.homeUnits,a=game.awayUnits;
  if (!Number.isFinite(h)||!Number.isFinite(a)) return null;
  const margin=Math.abs(h-a),trailerScore=Math.min(h,a);
  const minimum=basketball?(game.remainingSeconds<20?3:game.remainingSeconds<180?5:8):football?10:hockey?(game.remainingSeconds<300?2:3):baseball||soccer?2:null;
  const ratio=trailerScore>0?Math.max(h,a)/trailerScore:Infinity;
  if (minimum===null ? trailerScore<=0||ratio<3.5 : margin<minimum) return null;
  const leader = h>a ? game.homeName : game.awayName;
  const trailer = h>a ? game.awayName : game.homeName;
  const description = `${market.title||''} ${market.yes_sub_title||''}`;
  const teamId=Object.entries(market.custom_strike||{}).find(([k,v])=>/_team$/.test(k)&&typeof v==='string')?.[1];
  const expectedId=h>a?game.homeTeamId:game.awayTeamId;
  const identityMatches=teamId&&expectedId?teamId===expectedId:Boolean(leader&&trailer&&norm(description).includes(norm(leader))&&!norm(description).includes(norm(trailer)));
  if (!/win|winner|victory/i.test(description) || /wins? by|spread|handicap|margin of victory/i.test(description) || market.event_ticker && !/GAME(?:-|$)/i.test(market.event_ticker) || !identityMatches) return null;
  if(soccer && !/after 90 minutes plus stoppage time/i.test(market.rules_primary||''))return null;
  const fraction=leadFraction(game,margin,minimum);
  return {strategy:'lead', reason:`${leader||market.yes_sub_title} leads ${h}–${a} ${game.unit} (${margin} ${game.unit} ahead); ${baseball?'9th inning':soccer?`${game.soccerMinute}' of regulation plus stoppage`:game.clock+' remaining'}`, fraction};
}
export function leadFraction(game,margin,minimum){
  const bigger=margin>minimum;
  if(/baseball/.test(game.type))return game.outs>=2 && game.period===9?.35:bigger?.30:.25;
  if(/soccer/.test(game.type))return game.soccerMinute>=87.5?.35:bigger?.30:.25;
  if(Number.isFinite(game.remainingSeconds)&&game.remainingSeconds<=150)return .35;
  if(bigger||Number.isFinite(game.remainingSeconds)&&game.remainingSeconds<=225)return .30;
  return .25;
}
export function tennisSignal(game,market){
  const t=game.tennis;
  if(!game.verifiedLive||!game.scoreKnown||!t||!['active','open'].includes(market.status)||market.event_ticker!==t.mainEvent||!/(?:wins?|winner).*match|wins?\b/i.test(`${market.title||''} ${market.rules_primary||''}`))return null;
  if(![3,5].includes(t.bestOf)||!t.firstId||!t.secondId||!t.server||!t.mainEvent||t.firstRound!=='ongoing'||t.secondRound!=='ongoing')return null;
  const first=t.firstGames===5 && t.firstGames-t.secondGames>=2 && t.firstSets===(t.bestOf-1)/2;
  const second=t.secondGames===5 && t.secondGames-t.firstGames>=2 && t.secondSets===(t.bestOf-1)/2;
  if(first===second)return null;
  const leaderId=first?t.firstId:t.secondId,opponentId=first?t.secondId:t.firstId;
  if(market.custom_strike?.tennis_competitor!==leaderId||t.server!==leaderId)return null;
  const leaderPoints=first?t.firstPoints:t.secondPoints,opponentPoints=first?t.secondPoints:t.firstPoints;
  if(![0,15,30,40].includes(leaderPoints)||![0,15,30,40].includes(opponentPoints))return null;
  // A known opponent game point is an imminent break or hold, so wait for the next update.
  if(opponentPoints===40 && leaderPoints<40 || leaderPoints===40 && opponentPoints===40 && t.advantage===opponentId)return null;
  if(t.advantage && !['',leaderId,opponentId].includes(t.advantage))return null;
  const leaderGames=first?t.firstGames:t.secondGames,opponentGames=first?t.secondGames:t.firstGames;
  return {strategy:'lead',reason:`Tennis match-clinching set ${leaderGames}–${opponentGames}; leader serves, points ${leaderPoints}–${opponentPoints}${t.advantage===leaderId?' advantage':''}`,fraction:opponentGames<=1||leaderPoints===40?.35:opponentGames===2?.30:.25};
}
export function minimumProfitCents(strategy,availableCents,sportType='',remainingSeconds=NaN){
  if(strategy==='lead' && /basketball/.test(sportType)){
    if(!Number.isFinite(remainingSeconds)||remainingSeconds<=0||remainingSeconds>=300)return Infinity;
    return remainingSeconds<=30?25:remainingSeconds<=180?50:100;
  }
  const hundreds=Math.floor(Math.max(0,Number(availableCents))/10000);
  return strategy==='over'?Math.max(50,hundreds*100):Math.max(25,hundreds*50);
}
export function netSettlementProfitCents(count,price,feeMultiplier=2){
  if(!Number.isFinite(count)||count<=0||!Number.isFinite(price)||price<=0||price>=1)return 0;
  return Math.floor(count*(1-price)*100+1e-8)-Math.ceil(7*count*price*(1-price)*feeMultiplier-1e-8);
}
export function profitableCount(count,price,feeMultiplier,strategy,availableCents,sportType='',remainingSeconds=NaN){
  const profit=netSettlementProfitCents(count,price,feeMultiplier);
  return profit>0&&profit>=minimumProfitCents(strategy,availableCents,sportType,remainingSeconds)?count:0;
}
export function comeback(game,market,strategy){
  if(!game?.verifiedLive||!game.scoreKnown)return false;
  if(strategy==='over')return Number.isFinite(Number(market.floor_strike))&&game.home+game.away<=Number(market.floor_strike);
  if(game.tennis){
    const t=game.tennis,leader=t.firstId===market.custom_strike?.tennis_competitor?0:t.secondId===market.custom_strike?.tennis_competitor?1:-1;
    return leader===0?t.firstGames<=t.secondGames:leader===1?t.secondGames<=t.firstGames:false;
  }
  const teamId=Object.entries(market.custom_strike||{}).find(([k,v])=>/_team$/.test(k)&&typeof v==='string')?.[1];
  const home=teamId&&game.homeTeamId?teamId===game.homeTeamId:!teamId&&game.homeName&&norm(market.yes_sub_title||market.title).includes(norm(game.homeName));
  const away=teamId&&game.awayTeamId?teamId===game.awayTeamId:!teamId&&game.awayName&&norm(market.yes_sub_title||market.title).includes(norm(game.awayName));
  return Boolean(home&&!away?game.home<=game.away:away&&!home?game.away<=game.home:false);
}
// Reserve twice the standard taker fee estimate when checking available cash.
// The exchange remains authoritative if a market has an exceptional fee schedule.
export function estimatedCostCents(count,price,feeMultiplier=2) {
  return Math.ceil(count*price*100-1e-8)+Math.ceil(7*count*price*(1-price)*feeMultiplier-1e-8);
}
export function orderSize(balanceCents, askDollars, askSize, fraction, cap=1, bankrollCents=balanceCents, maxSpendCents=Infinity, feeMultiplier=2) {
  const price=N(askDollars),size=N(askSize),cash=N(balanceCents),bankroll=N(bankrollCents),limit=N(maxSpendCents);
  if (!Number.isFinite(price)||price<=0||!Number.isFinite(cap)||cap<=0||price>Math.min(1,cap)||!Number.isFinite(size)||size<0.01||!Number.isFinite(cash)||cash<=0||!Number.isFinite(bankroll)||bankroll<0||!Number.isFinite(fraction)||fraction<=0||fraction>1||!(Number.isFinite(limit)||limit===Infinity)||limit<0||!Number.isFinite(feeMultiplier)||feeMultiplier<1) return 0;
  const budget=Math.min(Math.floor(cash),Math.floor(bankroll*fraction),Math.floor(limit));
  let low=0,high=Math.floor(size*100+1e-7);
  while(low<high){const mid=Math.ceil((low+high)/2);if(estimatedCostCents(mid/100,price,feeMultiplier)<=budget)low=mid;else high=mid-1}
  return low/100;
}
export function overBudget(balanceCents, portfolioValueCents, openOverExposureCents) {
  const cash=N(balanceCents), value=N(portfolioValueCents), exposure=N(openOverExposureCents);
  if (![cash,value,exposure].every(Number.isFinite) || Math.min(cash,value,exposure)<0) return 0;
  return Math.max(0,Math.floor((cash+value)*0.8)-Math.ceil(exposure));
}
