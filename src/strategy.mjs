import { golfState } from './golf.mjs';
import { VERIFY_DWELL_MS } from './combos.mjs';
export const KALSHI_ONLY_FRACTION=.10;
export const SOCCER_OVER_STABILITY_MS=10000;
export function soccerOverWaitMs(firstSeen,now=Date.now()){
  const first=firstSeen instanceof Date?firstSeen.getTime():Date.parse(firstSeen||'');
  return Number.isFinite(first)?Math.max(0,first+SOCCER_OVER_STABILITY_MS-now):Infinity;
}
export function soccerOverStable(firstSeen,now=Date.now()){return soccerOverWaitMs(firstSeen,now)===0;}
const N = v => v === null || v === undefined || v === '' ? NaN : Number(v);
const pick = (obj, names) => names.map(k => obj?.[k]).find(v => Number.isFinite(N(v)));
export function sportName(m) {
  const s = `${m.details?.competition || ''} ${m.details?.league || ''} ${m.type || ''}`.toLowerCase();
  if (/esports/.test(String(m.type||'').toLowerCase())) return /soccer/.test(s)?'eSoccer':/basketball/.test(s)?'eBasketball':'Esports';
  if (/table_tennis/.test(s)) return 'Table tennis';
  if (/college.*football|cfb|ncaafb/.test(s)) return 'CFB';
  if (/women.s college basketball|ncaaw/.test(s)) return 'NCAAW';
  if (/college.*basketball|ncaab|ncaam/.test(s)) return 'NCAAB';
  if (/wnba/.test(s)) return 'WNBA';
  if (/nba|pro basketball/.test(s)) return 'NBA';
  if (/nfl|pro football/.test(s)) return 'NFL';
  if (/mlb|pro baseball/.test(s)) return 'MLB';
  if (/nhl|pro hockey/.test(s)) return 'NHL';
  if (/tennis|\batp\b|\bwta\b/.test(s)) return 'Tennis';
  if (/darts/.test(s)) return 'Darts';
  if (/handball/.test(s)) return 'Handball';
  if (/rugby/.test(s)) return 'Rugby';
  if (/lacrosse/.test(s)) return 'Lacrosse';
  if (/volleyball/.test(s)) return 'Volleyball';
  if (/soccer|football match/.test(s)) return 'Soccer';
  if (/basketball/.test(s)) return m.details?.league || 'Basketball';
  if (/baseball/.test(s)) return m.details?.league || 'Baseball';
  if (/hockey/.test(s)) return m.details?.league || 'Hockey';
  if (/football/.test(s)) return m.details?.league || 'Football';
  return m.details?.league || m.details?.competition || m.type || 'Sports';
}
// Cricket innings scores are not the match total in a multi-innings Test.
// Require every innings to be assigned to the named home/away team.
function cricketFinalInnings(m,d){
  if(m.type!=='cricket_match')return null;
  const board=d.cricket_result?.scoreboard,league=String(m.details?.league||'');
  const max=cricketOneInningsFormat(league)?2:/\btest\b/i.test(league)?4:NaN;
  if(!board||![2,4].includes(max)||N(d.current_inning)!==max||N(board['Current Innings'])!==max||
    !m.details?.home_team_id||!m.details?.away_team_id)return null;
  const home=String(board.home||''),away=String(board.away||'');
  if(!home||!away||home===away)return null;
  const scores={home:0,away:0},counts={home:0,away:0};
  for(let i=1;i<=max;i++){
    const side=board['batting.'+i]===home?'home':board['batting.'+i]===away?'away':null;
    const runs=N(board['runs.'+i]);
    if(!side||!Number.isInteger(runs)||runs<0)return null;
    scores[side]+=runs;counts[side]++;
    if(i===max&&(board['Current Batting Team']!==board['batting.'+i]||d.batting!==side||
      runs!==N(d[side+'_score'])))return null;
  }
  if(counts.home!==max/2||counts.away!==max/2||
    Number.isFinite(N(d.home_total_runs))&&N(d.home_total_runs)!==scores.home||
    Number.isFinite(N(d.away_total_runs))&&N(d.away_total_runs)!==scores.away)return null;
  const format=/\btest\b/i.test(league)?null:/\b(?:T20|D20|IPL|Major League Cricket|Caribbean Premier League)\b/i.test(league)?20:
    /\b(?:ODI|Pro 50|One Day)\b/i.test(league)?50:null;
  const wickets=N(board['wickets.'+max]),balls=N(board['balls.'+max]);
  const overs=String(board['overs.'+max]??'').match(/^(\d{1,2})(?:\.([0-5]))?$/);
  const oversBalls=overs?Number(overs[1])*6+Number(overs[2]||0):NaN;
  const bowled=Number.isInteger(balls)&&(!Number.isFinite(oversBalls)||balls===oversBalls)?balls:
    !Number.isFinite(balls)?oversBalls:NaN;
  const ballsRemaining=format!=null&&Number.isInteger(bowled)&&bowled>=0&&bowled<=format*6?format*6-bowled:null;
  const wicketsRemaining=Number.isInteger(wickets)&&wickets>=0&&wickets<=9?10-wickets:null;
  return {homeTotal:scores.home,awayTotal:scores.away,innings:max,ballsRemaining,wicketsRemaining,mainEvent:m.details?.main_game_event_ticker};
}
export function gameState(m, live) {
  if(m.type==='golf_tournament')return golfState(m,live);
  const d = live?.details || {};
  const sport = sportName(m);
  const tennis=/^tennis_/.test(String(m.type||''));
  const tableTennis=/^table_tennis_/.test(String(m.type||''));
  const volleyball=/^volleyball_/.test(String(m.type||''));
  const darts=/^darts_/.test(String(m.type||''));
  const one=tennis?d.competitor1_round_scores?.at(-1):null,two=tennis?d.competitor2_round_scores?.at(-1):null;
  const currentSet=tableTennis&&Array.isArray(d.period_scores)?d.period_scores.filter(p=>p.type==='set').at(-1):null;
  const periodScores=(Array.isArray(d.period_scores)?d.period_scores:[]).filter(p=>Number.isInteger(Number(p.number))&&Number.isInteger(Number(p.home_score))&&Number.isInteger(Number(p.away_score)))
    .map(p=>({number:Number(p.number),home:Number(p.home_score),away:Number(p.away_score),type:String(p.type||'')}));
  const firstIsHome=d.competitor1_is_home!==false;
  const home = N(tennis?(firstIsHome?one?.score:two?.score):tableTennis?(firstIsHome?currentSet?.competitor1_score:currentSet?.competitor2_score):darts?(firstIsHome?d.competitor1_overall_score:d.competitor2_overall_score):pick(d, ['home_score','homeScore','home_points','home_runs','home_goals','home_same_game_score']) ?? d.home?.score ?? d.home_team?.score);
  const away = N(tennis?(firstIsHome?two?.score:one?.score):tableTennis?(firstIsHome?currentSet?.competitor2_score:currentSet?.competitor1_score):darts?(firstIsHome?d.competitor2_overall_score:d.competitor1_overall_score):pick(d, ['away_score','awayScore','away_points','away_runs','away_goals','away_same_game_score']) ?? d.away?.score ?? d.away_team?.score);
  // Different live-data aliases sometimes disagree while a score is being
  // corrected. Never infer an already-won over from only the first alias.
  const agrees=(side,score)=>{
    const names=side==='home'?['home_score','homeScore','home_points','home_runs','home_goals','home_same_game_score']:['away_score','awayScore','away_points','away_runs','away_goals','away_same_game_score'];
    if(/soccer/.test(String(m.type||'')))names.push(side+'_regulation_score');
    const values=[...names.map(k=>d[k]),d[side]?.score,d[side+'_team']?.score].map(N).filter(Number.isFinite);
    return values.every(value=>value===score);
  };
  const scoreConsistent=tennis||tableTennis||darts||agrees('home',home)&&agrees('away',away);
  const status = String(d.status || '').toLowerCase();
  const half=String(d.half||'').toLowerCase();
  const baseball=/baseball/.test(String(m.type||''));
  const inning=baseball?[d.inning,d.current_inning,d.inning_number,d.period,d.period_number].map(v=>String(v??'').trim().match(/^(\d{1,2})(?:st|nd|rd|th)?$/i)?.[1]).find(v=>v&&Number(v)>0):null;
  const period = inning?Number(inning):N(pick(d, ['period','period_number','quarter','current_period','inning','current_inning']) ?? d.game?.period ?? (/^(?:2nd|second)$/.test(half)?2:/^(?:1st|first)$/.test(half)?1:undefined));
  const periodText = String(d.period_display || d.period_name || d.clock?.period || d.inning_half || '').toLowerCase();
  const quarterText=periodText.match(/(?:\bq(?:uarter)?\s*([1-4])\b|\b([1-4])(?:st|nd|rd|th)\s*(?:quarter|qtr)\b)/);
  const statedQuarter=quarterText?Number(quarterText[1]||quarterText[2]):NaN;
  // A feed can disagree with itself about the quarter. Do not enter a
  // winner market on a clock that belongs to a different quarter.
  const reportedPeriods=/basketball|football/.test(String(m.type||''))?
    ['period','period_number','quarter','current_period'].map(k=>N(d[k])).filter(Number.isFinite):[];
  const periodConsistent=(!Number.isFinite(statedQuarter)||statedQuarter===period) &&
    reportedPeriods.every(value=>value===period);
  const clock = String(d.period_remaining_time || d.clock?.display || d.clock || d.time_remaining || '').trim();
  // The provider includes hundredths of a second near the end of a quarter.
  const parts = clock.match(/^(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?$/);
  const remainingSeconds=parts?Number(parts[1])*60+Number(parts[2])+(parts[3]?Number('0.'+parts[3]):0):NaN;
  const clockRunning=d.clock_running!==false;
  const soccerTime=String(d.time??d.minute??'').trim();
  const minuteMatch=soccerTime.match(/^(\d{1,3})(?::(\d{2}))?(?:\+(\d{1,2}))?['′]?$/);
  const soccerMinute=minuteMatch?Number(minuteMatch[1])+Number(minuteMatch[3]||0)+Number(minuteMatch[2]||0)/60:NaN;
  const family=String(m.type||'').toLowerCase();
  const phase=/esports/.test(family)?(()=>{const periods=[...Object.keys(d.home_periods||{}),...Object.keys(d.away_periods||{})].map(k=>Number(k.match(/^period_(\d+)$/)?.[1])).filter(Number.isFinite);const last=Math.max(0,...periods);return last?`${d.period_unit==='half'?'Half':d.period_unit==='quarter'?'Quarter':'Period'} ${last}`:''})():darts?String(d.match_status||''):'';
  const esportsPeriodsValid=/esports/.test(family)&&(()=>{
    const homePeriods=d.home_periods||{},awayPeriods=d.away_periods||{};
    const homeKeys=Object.keys(homePeriods).filter(k=>/^period_[1-9]\d*$/.test(k)).sort();
    const awayKeys=Object.keys(awayPeriods).filter(k=>/^period_[1-9]\d*$/.test(k)).sort();
    if(!homeKeys.length||homeKeys.join('|')!==awayKeys.join('|'))return false;
    const homeValues=homeKeys.map(k=>N(homePeriods[k])),awayValues=awayKeys.map(k=>N(awayPeriods[k]));
    return [...homeValues,...awayValues].every(v=>Number.isInteger(v)&&v>=0)&&
      homeValues.reduce((a,b)=>a+b,0)===home&&awayValues.reduce((a,b)=>a+b,0)===away;
  })();
  const possessionValue=/hockey/.test(family)?d.puck_possession_team_id??d.puck_possession:
    /football/.test(family)?d.situation?.possession_team_id??d.possession_team_id??d.possession:
    /soccer/.test(family)?d.ball_possession_team_id??d.possession_team_id??d.possession:
    /basketball/.test(family)?d.possession_team_id??d.possession:null;
  const possessionSide=String(possessionValue||'').toLowerCase()==='home'||possessionValue&&possessionValue===m.details?.home_team_id?'home':
    String(possessionValue||'').toLowerCase()==='away'||possessionValue&&possessionValue===m.details?.away_team_id?'away':
    /baseball/.test(family)?d.inning_half===2||/bottom/i.test(String(d.inning_half||periodText))?'home':d.inning_half===1||/top/i.test(String(d.inning_half||periodText))?'away':null:
    tennis&&d.server===m.details?.first_competitor_id?(firstIsHome?'home':'away'):
    tennis&&d.server===m.details?.second_competitor_id?(firstIsHome?'away':'home'):null;
  // Only a final-whistle countdown can establish a late soccer entry window.
  // The displayed minute alone excludes unknown stoppage time.
  const matchRemainingSeconds=/soccer/.test(family)?N(d.match_remaining_seconds):NaN;
  // Soccer feeds include extra-time goals in same-game scores, while the
  // matching Kalshi totals and winner markets settle on regulation only.
  const soccerOvertime=/soccer/.test(family) &&
    (/^(?:aet|et|extra.?time|overtime|penalties)$/i.test(String(d.match_status||'')) ||
      (Array.isArray(d.period_scores)?d.period_scores:[]).some(p=>/overtime|extra/i.test(String(p.type||''))));
  const soccerExtraTime=/soccer/.test(family) &&
    (soccerOvertime ||
      Number.isFinite(soccerMinute) && soccerMinute>=90);
  const segmentSeconds=/hockey/.test(family)||['NCAAB','NCAAW'].includes(sport)?1200:/basketball/.test(family)?sport==='WNBA'?600:720:900;
  const clockFraction = parts ? Math.min(1, remainingSeconds / segmentSeconds) : NaN;
  let progress = NaN;
  if ((['NFL','CFB','NBA','WNBA'].includes(sport)||/football_game|basketball_game/.test(family)) && Number.isFinite(period) && period>=1) progress = Math.min(0.99,(period-1 + (Number.isFinite(clockFraction)?1-clockFraction:0))/4);
  if (['NCAAB','NCAAW'].includes(sport) && Number.isFinite(period) && period>=1) progress = Math.min(0.99,(period-1 + (Number.isFinite(clockFraction)?1-clockFraction:0))/2);
  if ((sport==='NHL'||/hockey_match/.test(family)) && Number.isFinite(period) && period>=1) progress = Math.min(0.99,(period-1 + (Number.isFinite(clockFraction)?1-clockFraction:0))/3);
  if ((sport==='MLB'||/baseball_game/.test(family)) && Number.isFinite(period) && period>=1) progress = Math.min(0.99,(period-1 + (/bottom/.test(periodText)?0.5:0))/9);
  if (sport==='Soccer' && Number.isFinite(period) && period>=1) progress = Math.min(0.99,(period-1)/2);
  const updated=N(d.last_updated_ts);const fresh=!Number.isFinite(updated) || Math.abs(Date.now()-updated*1000)<120000;
  const verifiedLive = (['live','in_progress','in progress','playing','inprogress'].includes(status)||
    tennis&&status==='started'&&String(d.widget_status||'').toLowerCase()==='live') && !d.live_data_delayed && fresh;
  const names=String(m.title||'').split(/\s+at\s+/i);
  const versus=tableTennis||darts||/rugby/.test(String(m.type||''))?String(m.title||'').split(/\s+vs\.?\s+/i):[];
  const homeUnits=home,awayUnits=away;
  const unit=/baseball/.test(family)?'runs':/hockey|soccer/.test(family)?'goals':tennis?'games':'points';
  const itfDecidingThird=tennis&&String(m.details?.tour||'').toUpperCase()==='ITF'&&
    /^[MW]\d{2,3}\b/i.test(String(m.details?.tournament_name||''))&&d.completed_rounds===2&&
    d.competitor1_overall_score===1&&d.competitor2_overall_score===1&&
    d.competitor1_round_scores?.length===3&&d.competitor2_round_scores?.length===3&&
    one?.outcome==='ongoing'&&two?.outcome==='ongoing';
  const tennisData=tennis?{bestOf:Number.isInteger(N(m.details?.best_of))?N(m.details.best_of):itfDecidingThird?3:NaN,firstId:m.details?.first_competitor_id,secondId:m.details?.second_competitor_id,firstGames:N(one?.score),secondGames:N(two?.score),firstSets:N(d.competitor1_overall_score),secondSets:N(d.competitor2_overall_score),firstPoints:N(d.competitor1_current_round_score),secondPoints:N(d.competitor2_current_round_score),firstRound:one?.outcome,secondRound:two?.outcome,server:String(d.server||''),advantage:String(d.advantage||''),mainEvent:m.details?.main_game_event_ticker}:null;
  const tableTennisData=tableTennis?{bestOf:N(m.details?.best_of??d.best_of_sets),firstId:m.details?.first_competitor_id,secondId:m.details?.second_competitor_id,firstIsHome,firstSets:N(d.competitor1_overall_score),secondSets:N(d.competitor2_overall_score),setNumber:N(currentSet?.number),firstPoints:N(currentSet?.competitor1_score),secondPoints:N(currentSet?.competitor2_score)}:null;
  const tennisTotal=tennis?tennisGameTotal(d):NaN;
  return {id:m.id, feedId:live?.milestone_id, observedAt:Date.parse(live?._observed_at||''), updatedAt:Number.isFinite(updated)?updated*1000:NaN, title:m.title, sport, competition:String(m.details?.league||''), tour:String(m.details?.tour||''), type:family, status, home, away, homeUnits, awayUnits, unit, period, periodScores, playerStats:d.player_stats||null, tennisTotal, cricket:cricketFinalInnings(m,d), mainEvent:m.details?.main_game_event_ticker||m.primary_event_tickers?.[0], tableTennis:tableTennisData, darts:darts?{format:String(d.game_format||m.details?.format||''),bestOf:N(d.best_of_legs),firstIsHome,firstId:m.details?.first_competitor_id,secondId:m.details?.second_competitor_id,firstLegs:N(d.competitor1_overall_score),secondLegs:N(d.competitor2_overall_score),firstRemaining:N(d.competitor1_remaining_points),secondRemaining:N(d.competitor2_remaining_points),nextThrow:String(d.next_throw_competitor_id||''),firstCheckout:d.competitor1_checkout_possible===true,secondCheckout:d.competitor2_checkout_possible===true,firstDouble:d.competitor1_on_double===true,secondDouble:d.competitor2_on_double===true}:null, volleyball:volleyball?{bestOf:N(d.best_of),homeSets:home,awaySets:away,current:periodScores.find(p=>p.number===period)}:null, setNumber:N(currentSet?.number), phase, esportsPeriodsValid, periodConsistent, scoreConsistent, clock, remainingSeconds, clockRunning, soccerMinute, soccerHalf:half, soccerExtraTime, soccerOvertime, matchRemainingSeconds, possessionSide, tennis:tennisData, inningHalf:baseball?(/bottom/i.test(String(d.inning_half||''))?2:/top/i.test(String(d.inning_half||''))?1:N(d.inning_half)):N(d.inning_half), outs:N(d.outs), progress, verifiedLive, scoreKnown:Number.isFinite(home)&&Number.isFinite(away), homeName:String(d.home_team?.name||d.home_team_name||d.home?.name||(versus.length===2?versus[0]:names.length===2?names[1]:'')), awayName:String(d.away_team?.name||d.away_team_name||d.away?.name||(versus.length===2?versus[1]:names.length===2?names[0]:'')),homeTeamId:m.details?.home_team_id||(/rugby/.test(family)?m.details?.home_competitor_id:null),awayTeamId:m.details?.away_team_id||(/rugby/.test(family)?m.details?.away_competitor_id:null),eventTickers:m.related_event_tickers||m.events||[]};
}
export function tennisGameTotal(details){
  const first=details?.competitor1_round_scores,second=details?.competitor2_round_scores;
  if(!Array.isArray(first)||!Array.isArray(second)||!first.length||first.length!==second.length)return NaN;
  const values=first.flatMap((set,i)=>[N(set?.score),N(second[i]?.score)]);
  if(values.some(n=>!Number.isInteger(n)||n<0||n>7))return NaN;
  const total=values.reduce((sum,n)=>sum+n,0);
  for(const [stats,numbers] of [[details?.competitor1_statistics,first],[details?.competitor2_statistics,second]]){
    const reported=N(stats?.games_won);
    if(Number.isFinite(reported)&&reported!==numbers.reduce((sum,set)=>sum+N(set.score),0))return NaN;
  }
  return total;
}
const wholeGame = s => !/1st|2nd|3rd|4th|first half|second half|quarter|period|inning|halftime|regulation only|first to score|team total|player|individual|series total/i.test(s);
export function periodValue(game,market){
  const match=String(market?.event_ticker||'').split('-')[0].match(/([1-9])(Q|P|H|INNING)(?:TEAM)?TOTAL$/);
  if(!match)return null;
  const n=Number(match[1]),unit=match[2];
  const numbers=unit==='H'&&/basketball/.test(game.type)&&!['NCAAB','NCAAW'].includes(game.sport)?(n===1?[1,2]:n===2?[3,4]:[]):[n];
  const parts=numbers.map(number=>game.periodScores?.find(p=>p.number===number));
  if(!parts.length||parts.some(p=>!p))return null;
  return {home:parts.reduce((s,p)=>s+p.home,0),away:parts.reduce((s,p)=>s+p.away,0),number:n,unit};
}
export function endWindow(game){
  if(!game.verifiedLive||!game.scoreKnown||!game.periodConsistent)return false;
  if(/basketball/.test(game.type))return game.period===(['NCAAB','NCAAW'].includes(game.sport)?2:4) && game.remainingSeconds>0 && game.remainingSeconds<=60;
  if(/football/.test(game.type))return game.period===4 && game.remainingSeconds>0 && game.remainingSeconds<420;
  if(/hockey/.test(game.type))return game.period===3 && game.remainingSeconds>0 && game.remainingSeconds<420;
  if(/baseball/.test(game.type))return game.period===9;
  if(/soccer/.test(game.type))return game.period===2 && Number.isFinite(game.soccerMinute) && game.soccerMinute>=83 && game.soccerMinute<90 && !game.soccerExtraTime;
  return false;
}
export function overSignal(game, market) {
  if (!game.verifiedLive || !game.scoreKnown || !game.scoreConsistent || Math.min(game.home,game.away)<0 || game.home+game.away<=0 || market.status!=='active' && market.status!=='open') return null;
  if(game.type==='cricket_match')return cricketOverSignal(game,market);
  const player=playerOverSpec(game,market);
  // Scores from these feeds are not comparable to a whole-game contract line.
  const esportsScore=game.type==='esports_match'&&
    ((game.sport==='eSoccer'&&/^Half [12]$/.test(game.phase))||(game.sport==='eBasketball'&&/^Quarter [1-4]$/.test(game.phase)))&&game.esportsPeriodsValid;
  if ((!/basketball|baseball|football|hockey|soccer|^tennis_/.test(game.type)||/table_tennis/.test(game.type))&&!player&&!esportsScore || /esports/.test(game.type)&&!esportsScore) return null;
  const series=String(market.event_ticker||'').split('-')[0];
  if(esportsScore&&(!/TOTAL$/.test(series)||/[1-9](?:Q|P|H|INNING)(?:TEAM)?TOTAL$/.test(series)||Object.keys(market.custom_strike||{}).some(k=>/_player$/.test(k))))return null;
  const tennisTotal=/^KX(?:ATP|WTA)GTOTAL$/.test(series)&&/^tennis_/.test(game.type)&&/^(?:ATP|WTA)$/i.test(game.tour);
  const teamTotal=/TEAMTOTAL$/.test(series),gameTotal=/TOTAL$/.test(series)&&!teamTotal;
  if(Object.keys(market.custom_strike||{}).some(k=>/_player$/.test(k))&&!player)return null;
  if(!teamTotal&&!gameTotal&&!player&&!tennisTotal)return null;
  if (game.soccerExtraTime || /soccer/.test(game.type) && !Number.isFinite(game.soccerMinute)) return null;
  // A nearly free YES after an apparently crossed line means the feed and
  // contract disagree. Never treat this as a guaranteed arbitrage.
  if (Number.isFinite(Number(market.yes_ask_dollars)) && market.yes_ask_dollars!=null && Number(market.yes_ask_dollars)>0 && Number(market.yes_ask_dollars)<0.8) return null;
  if (market.result && !['','not_determined'].includes(String(market.result))) return null;
  const text = `${market.title||''} ${market.yes_sub_title||''} ${market.rules_primary||''}`;
  const segment=series.match(/([1-9])(?:Q|P|H|INNING)(?:TEAM)?TOTAL$/);
  if(!player && !segment && !tennisTotal && !wholeGame(teamTotal?text.replace(/team total/gi,''):text))return null;
  if(tennisTotal&&!/number of completed games in the full match is above/i.test(market.rules_primary||''))return null;
  if(!player && !tennisTotal && !/total (points|runs|goals|score)|combined (points|runs|goals|score)|combined score|\bover\s+\d+(?:\.\d+)?\s+(?:points|runs|goals)\s+scored\b/i.test(text))return null;
  if (market.strike_type && !['greater','greater_than'].includes(market.strike_type)) return null;
  const strike = N(market.floor_strike);
  // The displayed line and structured strike must describe the same bet.
  for(const label of [market.title,market.yes_sub_title]){
    const shown=String(label||'').match(/\bover\s+(\d+(?:\.\d+)?)\b/i);
    if(shown && Number(shown[1])!==strike)return null;
  }
  let scored=game.home+game.away,team='';
  if(tennisTotal)scored=game.tennisTotal;
  if(player){scored=player.value;team=player.name;}
  if(segment){
    const period=periodValue(game,market);
    if(!period || !new RegExp(`(?:${segment[1]}(?:st|nd|rd|th)?\\s*(?:quarter|period|half|inning)|(?:Q|P|H)${segment[1]})`,'i').test(text))return null;
    scored=period.home+period.away;
  }
  if(teamTotal){
    const target=Object.entries(market.custom_strike||{}).find(([k,v])=>/_team$/.test(k)&&typeof v==='string')?.[1];
    const home=target&&target===game.homeTeamId,away=target&&target===game.awayTeamId;
    if(!target||home===away)return null;
    const segmentResult=segment?periodValue(game,market):null;
    scored=segment?(home?segmentResult.home:segmentResult.away):(home?game.home:game.away);
    team=home?game.homeName:game.awayName;
    if(!team||!norm(market.title).includes(norm(team)))return null;
  }
  if (!Number.isFinite(strike) || strike<0 || !Number.isFinite(scored) || scored<=strike) return null;
  // Only an independently verified, complete play list identifies the last
  // score precisely enough for the 40% tier. Do not guess a reversal size.
  const lastPlay=game.lastScoringPlay;
  const robust=gameTotal&&!teamTotal&&!player&&!segment&&Number.isInteger(lastPlay)&&lastPlay>0&&scored-lastPlay>strike;
  return {strategy:'over', reason:`${scored} ${player?.metric||'scored'}${team?` by ${team}`:''}; line ${strike} already passed${segment?`; segment ${segment[1]}`:''}${robust?`; still crossed if the latest ${lastPlay}-unit scoring play is removed`:''}`, fraction:robust?.40:.30};
}
// The live cricket score is a team run total only in limited-over formats
// with one innings per side. Test/first-class and non-run props need separate
// contract-specific scoring and cannot borrow this signal.
export const cricketOneInningsFormat=competition=>/\b(?:T20|D20|ODI|IPL|Pro 50|One Day|Major League Cricket|Caribbean Premier League)\b/i.test(String(competition||''));
export function cricketOverSignal(game,market){
  if(game?.type!=='cricket_match'||!game.verifiedLive||!game.scoreKnown||!game.scoreConsistent||
    !cricketOneInningsFormat(game.competition)||
    ![1,2].includes(game.period)||!game.homeName||!game.awayName||
    !['active','open'].includes(market?.status)||market.result&&!['','not_determined'].includes(String(market.result)))return null;
  const series=String(market.event_ticker||'').split('-')[0];
  if(!/TEAMTOTAL$/.test(series)||/[1-9](?:Q|P|H|INNING)TEAMTOTAL$/.test(series)||
    market.floor_strike==null||market.cap_strike!=null||!['greater','greater_than'].includes(market.strike_type)||
    Object.keys(market.custom_strike||{}).some(k=>/_player$/.test(k)))return null;
  const line=Number(market.floor_strike);
  if(!Number.isFinite(line)||line<0||!Number.isInteger(line+.5))return null;
  const titles=[market.yes_sub_title,market.title].filter(Boolean).map(value=>String(value).trim());
  const parsed=titles.map(title=>title.match(/^(.+?)\s+over\s+(\d+(?:\.\d+)?)\s+runs\s+scored$/i)).filter(Boolean);
  const matched=parsed[0];
  const rules=String(market.rules_primary||'');
  if(!matched||parsed.some(candidate=>Number(candidate[2])!==line||norm(candidate[1])!==norm(matched[1]))||!/\bruns?\b/i.test(rules)||
    /\b(?:first|second|third|fourth|innings|powerplay|super over)\b/i.test(rules))return null;
  const home=norm(matched[1])===norm(game.homeName),away=norm(matched[1])===norm(game.awayName);
  if(home===away)return null;
  const teamId=Object.entries(market.custom_strike||{}).find(([key,value])=>/_team$/.test(key)&&typeof value==='string')?.[1];
  const expectedId=home?game.homeTeamId:game.awayTeamId;
  if(teamId&&(!expectedId||teamId!==expectedId))return null;
  if(!teamId&&!norm(rules).includes(norm(matched[1])))return null;
  const scored=home?game.home:game.away;
  if(!Number.isInteger(scored)||scored<=line)return null;
  if(market.yes_ask_dollars!=null&&Number(market.yes_ask_dollars)>0&&Number(market.yes_ask_dollars)<.8)return null;
  return {strategy:'over',reason:`${matched[1]} has ${scored} runs; team total ${line} crossed`,fraction:.05};
}
export function playerOverSpec(game,market){
  const family=String(game?.type||'');
  const suffix=String(market?.event_ticker||'').split('-')[0].match(/(PASSYDS|RUSHYDS|RECYDS|GOALS|SAVES|SOG|HITS|RBI|HR|PTS|REB|AST|3PT|PRA|STL|BLK)$/)?.[1];
  if(!market||!suffix||!/basketball|baseball|football|hockey|soccer|handball|rugby|lacrosse|volleyball|tennis|darts/.test(family))return null;
  const playerFields=Object.entries(market.custom_strike||{}).filter(([key,value])=>/_player$/.test(key)&&typeof value==='string');
  if(playerFields.length!==1||!family.startsWith(playerFields[0][0].replace(/_player$/,'')+'_'))return null;
  const id=playerFields[0][1],stats=game.playerStats?.[id];
  const name=String(market.yes_sub_title||market.title||'').split(':')[0].trim();
  const line=Number(market.floor_strike),shown=String(market.yes_sub_title||market.title||'').match(/:\s*(\d+)\s*\+/);
  if(!id||!stats||!name||!shown||!Number.isFinite(line)||Number(shown[1])!==line+0.5)return null;
  const metrics={PTS:stats.points,REB:stats.rebounds,AST:stats.assists,'3PT':stats.three_points_made,PRA:Number(stats.points)+Number(stats.rebounds)+Number(stats.assists),STL:stats.steals,BLK:stats.blocks,
    GOALS:stats.goals,SAVES:stats.saves,SOG:stats.shots_on_goal,HITS:stats.hits,RBI:stats.runs_batted_in,HR:stats.home_runs,PASSYDS:stats.passing_yards,RUSHYDS:stats.rushing_yards,RECYDS:stats.receiving_yards};
  const value=Number(metrics[suffix]);
  if(!Number.isInteger(value)||value<0)return null;
  return {id,name,metric:suffix,value};
}
// Two separate exchange reads ten seconds apart must retain the qualifying
// score. The feed may legitimately have no new update between reads.
export function confirmedOver(first,second,market,minimumDwellMs=VERIFY_DWELL_MS){
  if(!overSignal(first,market)||!overSignal(second,market))return false;
  if(first.id!==second.id||first.feedId!==first.id||second.feedId!==second.id)return false;
  const dwell=minimumDwellMs;
  if(!Number.isFinite(first.observedAt)||!Number.isFinite(second.observedAt)||second.observedAt-first.observedAt<dwell)return false;
  if(dwell===0&&second.observedAt<=first.observedAt)return false;
  if(Number.isFinite(first.updatedAt)&&Number.isFinite(second.updatedAt)&&second.updatedAt<first.updatedAt)return false;
  if([first,second].some(s=>Number.isFinite(s.updatedAt)&&(s.updatedAt>s.observedAt+5000||s.observedAt-s.updatedAt>30000)))return false;
  if((first.type==='cricket_match'?(second.home<first.home||second.away<first.away):first.home!==second.home||first.away!==second.away)||
    !first.periodConsistent||!second.periodConsistent)return false;
  if(/^KX(?:ATP|WTA)GTOTAL$/.test(String(market.event_ticker||'').split('-')[0])&&first.tennisTotal!==second.tennisTotal)return false;
  const firstPlayer=playerOverSpec(first,market),secondPlayer=playerOverSpec(second,market);
  if(firstPlayer&&(!secondPlayer||firstPlayer.value!==secondPlayer.value))return false;
  if(Number.isFinite(first.period)&&Number.isFinite(second.period)&&second.period<first.period)return false;
  if(first.period===second.period&&Number.isFinite(first.remainingSeconds)&&Number.isFinite(second.remainingSeconds)&&second.remainingSeconds>first.remainingSeconds)return false;
  if(Number.isFinite(first.soccerMinute)&&Number.isFinite(second.soccerMinute)&&second.soccerMinute<first.soccerMinute)return false;
  return true;
}
// When the provider supplies update times, the second read must be newer.
// Some live-data feeds omit that field; two separate, stable reads can still
// qualify for the limited fallback, but mixed timestamp availability cannot.
function kalshiUpdatePairOk(first,second){
  const firstHas=Number.isFinite(first?.updatedAt),secondHas=Number.isFinite(second?.updatedAt);
  return firstHas===secondHas&&(!firstHas||second.updatedAt>first.updatedAt);
}
// An independently unavailable scoreboard permits the exact over signal only
// after a second Kalshi read. The same segment and named statistic must remain
// crossed; a contradictory external source never reaches here.
export function kalshiOnlyOver(first,second,market){
  // A live soccer goal can be rescinded after two identical exchange reads.
  // Require an independent score before treating a crossed soccer total as final.
  if(/soccer/.test(first?.type||'')||/soccer/.test(second?.type||''))return false;
  const player=playerOverSpec(first,market),nextPlayer=playerOverSpec(second,market);
  // Player statistics can be corrected after the exchange's two live reads.
  // Only an exact independent player and statistic check can authorize entry.
  if(player||nextPlayer)return false;
  if(!overSignal(first,market)||!overSignal(second,market))return false;
  const initialSegment=periodValue(first,market),laterSegment=periodValue(second,market);
  if(Boolean(initialSegment)!==Boolean(laterSegment)||initialSegment&&
    (initialSegment.home!==laterSegment.home||initialSegment.away!==laterSegment.away))return false;
  if(!kalshiUpdatePairOk(first,second)||second.observedAt-first.observedAt<VERIFY_DWELL_MS)return false;
  return confirmedOver(first,second,market);
}
export function kalshiOnlyLead(first,second,market){
  const signal=s=>leadSignal(s,market)||additionalLeadSignal(s,market)||cricketLeadSignal(s,market)||drawSignal(s,market)||earlyLeadSignal(s,market)||tennisSignal(s,market)||tableTennisSignal(s,market);
  if(Number.isFinite(Number(market?.yes_ask_dollars))&&Number(market.yes_ask_dollars)<.8&&
      !drawSignal(first,market)&&!cricketLeadSignal(first,market)||
    !signal(first)||!signal(second)||first.id!==second.id||first.feedId!==first.id||second.feedId!==second.id||
    !first.scoreConsistent||!second.scoreConsistent||first.home!==second.home||first.away!==second.away||
    !Object.is(first.period,second.period)||!first.periodConsistent||!second.periodConsistent||
    !Number.isFinite(first.observedAt)||!Number.isFinite(second.observedAt)||second.observedAt-first.observedAt<VERIFY_DWELL_MS||
    !kalshiUpdatePairOk(first,second)||
    [first,second].some(s=>s.updatedAt>s.observedAt+5000||s.observedAt-s.updatedAt>30000)||
    !/^table_tennis_/.test(first.type)&&Number.isFinite(first.remainingSeconds)&&Number.isFinite(second.remainingSeconds)&&second.remainingSeconds>first.remainingSeconds||
    Number.isFinite(first.soccerMinute)&&Number.isFinite(second.soccerMinute)&&second.soccerMinute<first.soccerMinute||
    !confirmedSoccerOneGoalClock(first,second)||!confirmedDrawClock(first,second,market))return false;
  // Soccer possession is required only for the higher one-goal tiers.
  if(first.possessionSide!==second.possessionSide&&!/soccer/.test(second.type))return false;
  for(const key of ['tennis','tableTennis','volleyball','darts','cricket']){
    if(JSON.stringify(first[key])!==JSON.stringify(second[key]))return false;
  }
  return true;
}
export function confirmedExternalLead(first,second,market){
  const signal=s=>leadSignal(s,market)||additionalLeadSignal(s,market)||cricketLeadSignal(s,market)||drawSignal(s,market)||earlyLeadSignal(s,market)||tennisSignal(s,market)||tableTennisSignal(s,market);
  if(!signal(first)||!signal(second)||first.id!==second.id||first.feedId!==first.id||second.feedId!==second.id||
    !first.scoreConsistent||!second.scoreConsistent||first.home!==second.home||first.away!==second.away||
    !Object.is(first.period,second.period)||!first.periodConsistent||!second.periodConsistent||
    !Number.isFinite(first.observedAt)||!Number.isFinite(second.observedAt)||second.observedAt<=first.observedAt||
    Number.isFinite(first.updatedAt)&&Number.isFinite(second.updatedAt)&&second.updatedAt<first.updatedAt||
    [first,second].some(s=>Number.isFinite(s.updatedAt)&&(s.updatedAt>s.observedAt+5000||s.observedAt-s.updatedAt>30000))||
    Number.isFinite(first.remainingSeconds)&&Number.isFinite(second.remainingSeconds)&&second.remainingSeconds>first.remainingSeconds||
    Number.isFinite(first.soccerMinute)&&Number.isFinite(second.soccerMinute)&&second.soccerMinute<first.soccerMinute||
    !confirmedSoccerOneGoalClock(first,second)||!confirmedDrawClock(first,second,market))return false;
  return ['tennis','tableTennis','volleyball','darts','cricket'].every(key=>JSON.stringify(first[key])===JSON.stringify(second[key]));
}
const norm = s => String(s||'').toLowerCase().replace(/[^a-z0-9]/g,'');
export function tableTennisSignal(game,market){
  const t=game?.tableTennis;
  if(!t||!game.verifiedLive||!game.scoreKnown||!game.scoreConsistent||!/MATCH-/.test(String(market?.event_ticker||''))||
    !['active','open'].includes(market.status)||market.result&&!['','not_determined'].includes(String(market.result))||
    market.yes_ask_dollars!=null&&Number(market.yes_ask_dollars)<.8)return null;
  const bestOf=Number.isFinite(t.bestOf)?t.bestOf:game.competition==='Russia Liga Pro'?5:NaN;
  const before=(bestOf-1)/2;
  if(![3,5,7].includes(bestOf)||t.setNumber!==bestOf||t.firstSets!==before||t.secondSets!==before||
    !Number.isInteger(t.firstPoints)||!Number.isInteger(t.secondPoints))return null;
  const first=t.firstPoints>=8&&t.firstPoints-t.secondPoints>=4,second=t.secondPoints>=8&&t.secondPoints-t.firstPoints>=4;
  if(first===second)return null;
  const selectedId=first?t.firstId:t.secondId;
  const leaderName=first?(t.firstIsHome?game.homeName:game.awayName):(t.firstIsHome?game.awayName:game.homeName);
  const contractName=String(market.yes_sub_title||market.title||'').trim();
  if(!leaderName||norm(leaderName).length<5||norm(contractName)!==norm(leaderName))return null;
  const strike=market.custom_strike||{};
  if(Object.values(strike).some(value=>typeof value==='string'&&value=== (first?t.secondId:t.firstId)))return null;
  if(Object.values(strike).some(value=>typeof value==='string'&&[t.firstId,t.secondId].includes(value))&&
    !Object.values(strike).includes(selectedId))return null;
  const margin=Math.abs(t.firstPoints-t.secondPoints);
  return {strategy:'lead',reason:`Table tennis deciding set ${first?t.firstPoints:t.secondPoints}–${first?t.secondPoints:t.firstPoints}; sets ${before}–${before}, independently verified before order`,fraction:margin>=6?.15:.10};
}
export function leadSignal(game, market) {
  if(game.soccerExtraTime)return null;
  if(!/basketball|baseball|football|hockey|soccer/.test(game.type)||/esports|table_tennis/.test(game.type))return null;
  // A low YES ask in the final minutes conflicts with an apparently commanding
  // lead and often signals a stale or incorrectly mapped live game clock.
  if(market.yes_ask_dollars!=null&&Number.isFinite(Number(market.yes_ask_dollars))&&Number(market.yes_ask_dollars)<0.8)return null;
  const basketball=/basketball/.test(game.type);
  const football=/football/.test(game.type);
  const hockey=/hockey/.test(game.type);
  const soccer=/soccer/.test(game.type);
  if(soccer&&/^(?:1st|first)$/.test(game.soccerHalf))return null;
  const segments=/baseball/.test(game.type)?9:/hockey/.test(game.type)?3:/soccer/.test(game.type)?2:basketball&&['NCAAB','NCAAW'].includes(game.sport)?2:/basketball|football/.test(game.type)?4:Infinity;
  const baseball=/baseball/.test(game.type);
  const finalTime=baseball?game.period===9:soccer?game.period===2&&(!Number.isFinite(game.soccerMinute)||game.soccerMinute<90):game.period===segments && game.periodConsistent && Number.isFinite(game.remainingSeconds) && game.remainingSeconds>0 && (basketball?game.remainingSeconds<=60:hockey?game.remainingSeconds<=390:game.remainingSeconds<420);
  if (!game.verifiedLive || !game.scoreKnown || soccer&&!game.scoreConsistent || !finalTime || market.status!=='active' && market.status!=='open') return null;
  const h=game.homeUnits,a=game.awayUnits;
  if (!Number.isFinite(h)||!Number.isFinite(a)) return null;
  const margin=Math.abs(h-a),trailerScore=Math.min(h,a);
  const finalWhistleSeconds=soccer&&Number.isFinite(game.matchRemainingSeconds)&&game.matchRemainingSeconds>0?game.matchRemainingSeconds:Infinity;
  // A two-goal lead still needs a reliable final-whistle countdown. An
  // elapsed minute cannot account for stoppage time or prove this window.
  if(soccer&&margin===2&&finalWhistleSeconds>=300 ||
    soccer&&margin===1&&finalWhistleSeconds>=30)return null;
  if(soccer&&margin===1&&game.soccerMinute<89)return null;
  // A three-goal soccer lead can receive the 20% tier only near the end.
  // When a final countdown is available it takes precedence over an estimated minute.
  if(soccer&&margin>=3&&!(Number.isFinite(game.matchRemainingSeconds)?
    game.matchRemainingSeconds>0&&game.matchRemainingSeconds<600:
    Number.isFinite(game.soccerMinute)&&game.soccerMinute>80&&game.soccerMinute<90))return null;
  const minimum=basketball?5:football?10:hockey?3:baseball?2:soccer?finalWhistleSeconds<30?1:finalWhistleSeconds<300?2:3:null;
  const closeLeaderPossession=game.possessionSide===(h>a?'home':'away');
  const closeLeadThreshold=basketball?4:football?7:hockey?1:Infinity;
  const closeLead=game.remainingSeconds>0&&game.remainingSeconds<21&&
    margin>=closeLeadThreshold&&margin<minimum&&closeLeaderPossession;
  const ratio=trailerScore>0?Math.max(h,a)/trailerScore:Infinity;
  if (minimum===null ? trailerScore<=0||ratio<3.5 : margin<minimum&&!closeLead) return null;
  const leader = h>a ? game.homeName : game.awayName;
  const trailer = h>a ? game.awayName : game.homeName;
  if(!hockey&&!soccer&&!baseball&&game.possessionSide!==(h>a?'home':'away'))return null;
  const description = `${market.title||''} ${market.yes_sub_title||''}`;
  const teamId=Object.entries(market.custom_strike||{}).find(([k,v])=>/_team$/.test(k)&&typeof v==='string')?.[1];
  const expectedId=h>a?game.homeTeamId:game.awayTeamId;
  const identityMatches=teamId&&expectedId?teamId===expectedId:Boolean(leader&&trailer&&norm(description).includes(norm(leader))&&!norm(description).includes(norm(trailer)));
  if (!/win|winner|victory/i.test(description) || /wins? by|spread|handicap|margin of victory/i.test(description) || market.event_ticker && !/GAME(?:-|$)/i.test(market.event_ticker) || !identityMatches) return null;
  if(soccer && !/after 90 minutes plus stoppage time/i.test(market.rules_primary||''))return null;
  const fraction=closeLead?.05:leadFraction(game,margin,minimum);
  const timing=baseball?'9th inning':soccer?Number.isFinite(game.soccerMinute)?`${game.soccerMinute}' of regulation plus stoppage`:'second half (no clock)':`${basketball?`period ${game.period}, `:''}${game.clock} remaining`;
  return {strategy:'lead', reason:`${leader||market.yes_sub_title} leads ${h}–${a} ${game.unit} (${margin} ${game.unit} ahead); ${timing}`, fraction};
}
export function leadFraction(game,margin,minimum){
  if(/soccer/.test(game.type)&&margin===1){
    const leaderHasBall=game.possessionSide===(game.homeUnits>game.awayUnits?'home':'away');
    return game.matchRemainingSeconds<20?(leaderHasBall?.40:.35):(leaderHasBall?.15:.10);
  }
  if(/soccer/.test(game.type)&&margin>=3)return .20;
  return .15;
}
export function stableSoccerLeadFraction(first,second,signal){
  if(!/soccer/.test(second.type)||signal.strategy!=='lead'||Math.abs(second.home-second.away)!==1)return signal.fraction;
  const leader=second.home>second.away?'home':'away';
  return first.possessionSide===leader&&second.possessionSide===leader?signal.fraction:
    second.matchRemainingSeconds<20?.35:.10;
}
export function externallyVerifiedEarlySoccerLead(first,second,signal,firstConfirmed,secondConfirmed){
  if(!firstConfirmed||!secondConfirmed||signal?.fraction!==.02||
    !/^Restricted 2% lead:/.test(signal.reason)||
    !/soccer/.test(first?.type||'')||first.type!==second?.type||
    first.period!==2||second.period!==2||first.soccerExtraTime||second.soccerExtraTime||
    first.home!==second.home||first.away!==second.away||
    Math.abs(second.home-second.away)<4)return signal;
  return {...signal,fraction:.20,reason:signal.reason.replace(/^Restricted 2% lead:/,'Externally verified 20% lead:')};
}
export function confirmedSoccerOneGoalClock(first,second){
  if(!/soccer/.test(second.type)||Math.abs(second.home-second.away)!==1)return true;
  return first.clockRunning&&second.clockRunning&&
    Number.isFinite(first.matchRemainingSeconds)&&first.matchRemainingSeconds>0&&first.matchRemainingSeconds<30&&
    Number.isFinite(second.matchRemainingSeconds)&&second.matchRemainingSeconds>0&&
    second.matchRemainingSeconds<first.matchRemainingSeconds;
}
export function confirmedDrawClock(first,second,market){
  if(!drawSignal(first,market))return true;
  const soccer=/soccer/.test(first.type);
  const before=soccer?first.matchRemainingSeconds:first.remainingSeconds;
  const after=soccer?second.matchRemainingSeconds:second.remainingSeconds;
  return first.clockRunning&&second.clockRunning&&
    Number.isFinite(before)&&Number.isFinite(after)&&before>after&&after>0;
}
export function soccerOneGoalWindowOpen(game,now=Date.now()){
  if(!/soccer/.test(game.type)||Math.abs(game.home-game.away)!==1)return true;
  return Number.isFinite(game.observedAt)&&Number.isFinite(game.matchRemainingSeconds)&&
    game.matchRemainingSeconds*1000-(now-game.observedAt)>5000;
}
// Clock-free games use the deciding set, leg and throw data in their feed.
// A missing contract identity or a missing decisive field never grants entry.
export function additionalLeadSignal(game,market){
  if(!game?.verifiedLive||!game.scoreKnown||!game.scoreConsistent||!['active','open'].includes(market?.status))return null;
  const family=game.type,description=`${market.title||''} ${market.yes_sub_title||''}`;
  if(!/(?:GAME|MATCH)-/i.test(String(market.event_ticker||''))||!/win|winner|victory/i.test(description)||/wins? by|spread|handicap|margin of victory/i.test(description))return null;
  if(/darts/.test(family)){
    const d=game.darts;
    if(!d||!/501/.test(d.format)||!Number.isInteger(d.bestOf)||d.bestOf<3||d.bestOf%2!==1||!d.firstId||!d.secondId)return null;
    const needed=Math.ceil(d.bestOf/2)-1;
    const first=d.firstLegs===needed&&d.firstLegs>d.secondLegs&&d.firstRemaining>0&&d.firstRemaining<=40&&d.secondRemaining>=250&&d.firstCheckout&&d.firstDouble&&d.nextThrow===d.firstId;
    const second=d.secondLegs===needed&&d.secondLegs>d.firstLegs&&d.secondRemaining>0&&d.secondRemaining<=40&&d.firstRemaining>=250&&d.secondCheckout&&d.secondDouble&&d.nextThrow===d.secondId;
    if(first===second||market.custom_strike?.darts_competitor!==(first?d.firstId:d.secondId))return null;
    return {strategy:'lead',reason:`Darts 501: ${first?(d.firstIsHome?game.homeName:game.awayName):(d.firstIsHome?game.awayName:game.homeName)} has checkout ${first?d.firstRemaining:d.secondRemaining}, opponent ${first?d.secondRemaining:d.firstRemaining}; one leg from match, on a double with next throw`,fraction:.15};
  }
  const h=game.home,a=game.away,home=/volleyball/.test(family)?(game.volleyball?.current?.home??-1)>(game.volleyball?.current?.away??-1):h>a;
  const margin=Math.abs(h-a),leader=home?game.homeName:game.awayName,trailer=home?game.awayName:game.homeName;
  const teamId=Object.entries(market.custom_strike||{}).find(([key,value])=>/_team$/.test(key)&&typeof value==='string')?.[1];
  const identityMatches=teamId?teamId===(home?game.homeTeamId:game.awayTeamId):Boolean(leader&&trailer&&norm(description).includes(norm(leader))&&!norm(description).includes(norm(trailer)));
  if(!leader||!trailer||!identityMatches)return null;
  let minimum=0,very=0,label='';
  if(/handball|rugby|lacrosse/.test(family)){
    const rule=/handball/.test(family)?[5,8,180,2]:/rugby/.test(family)?[15,22,300,2]:[4,7,180,4];
    [minimum,very]=rule;
    if(game.period!==rule[3]||!game.periodConsistent||!Number.isFinite(game.remainingSeconds)||game.remainingSeconds<=0||game.remainingSeconds>rule[2])return null;
    label=`${game.clock} remaining`;
  }else if(/volleyball/.test(family)){
    const v=game.volleyball,point=v?.current;
    if(!v||![3,5].includes(v.bestOf)||v.homeSets!==Math.floor(v.bestOf/2)||v.awaySets!==Math.floor(v.bestOf/2)||game.period!==v.bestOf||!point)return null;
    const lead=home?point.home:point.away,other=home?point.away:point.home;
    if(!Number.isInteger(lead)||!Number.isInteger(other)||lead<12)return null;
    minimum=3;very=5;label=`deciding set ${lead}–${other}`;
    if(lead-other<minimum)return null;
  }else return null;
  if(margin<minimum&&!/volleyball/.test(family))return null;
  const decisive=/volleyball/.test(family)?Math.abs((game.volleyball.current?.home??0)-(game.volleyball.current?.away??0)):margin;
  return {strategy:'lead',reason:`${leader} leads; ${label}; margin ${decisive}`,fraction:decisive>=very?.15:.10};
}
export function cricketLeadSignal(game,market){
  const c=game?.cricket;
  if(!c||c.innings!==2||!game.verifiedLive||!game.scoreKnown||!game.scoreConsistent||
    !Number.isInteger(c.ballsRemaining)||c.ballsRemaining<1||c.ballsRemaining>12||
    !Number.isInteger(c.wicketsRemaining)||c.wicketsRemaining<1||c.wicketsRemaining>3||
    !['active','open'].includes(market?.status)||market.event_ticker!==c.mainEvent||
    !Number.isFinite(N(market.yes_ask_dollars))||N(market.yes_ask_dollars)<.90||
    !/\bwins?\b/i.test(String(market.rules_primary||''))||/\b(?:draw|tie|spread|handicap)\b/i.test(String(market.title||'')))return null;
  const home=c.homeTotal>c.awayTotal,margin=Math.abs(c.homeTotal-c.awayTotal);
  if(margin<50||market.custom_strike?.cricket_team!==(home?game.homeTeamId:game.awayTeamId))return null;
  return {strategy:'lead',fraction:.10,comboEligible:false,
    reason:'Restricted 10% late cricket chase; verified match totals '+c.homeTotal+'–'+c.awayTotal+
      ' runs ('+margin+' ahead); '+c.ballsRemaining+' balls and '+c.wicketsRemaining+' wickets left'};
}
export function earlyLeadSignal(game,market){
  const type=String(game?.type||'');
  if(!game?.verifiedLive||!game.scoreKnown||!game.scoreConsistent||!game.periodConsistent||
    !['active','open'].includes(market?.status)||market.event_ticker!==game.mainEvent||
    !/^(?:.+ )?wins?\b/i.test(String(market.title||''))||
    /\b(?:spread|handicap|draw|tie)\b/i.test(String(market.title||'')))return null;
  const ncaab=['NCAAB','NCAAW'].includes(game.sport);
  // Baseline applies throughout the live final segment; the higher threshold
  // applies in the last minute of the preceding segment.
  const rule=/basketball/.test(type)?[18,20,ncaab?1:3,ncaab?2:4,ncaab?1200:game.sport==='WNBA'?600:720]:
    /football/.test(type)?[21,28,3,4,900]:/hockey/.test(type)?[3,4,2,3,1200]:
    /handball/.test(type)?[11,13,1,2,1800]:/lacrosse/.test(type)?[4,6,3,4,900]:null;
  const baseball=/baseball/.test(type),soccer=/soccer/.test(type);
  let minimum=NaN,stage='';
  if(rule){
    if(game.period===rule[2]&&Number.isFinite(game.remainingSeconds)&&game.remainingSeconds>=0&&game.remainingSeconds<60){minimum=rule[1];stage='end of penultimate segment'}
    if(game.period===rule[3]&&Number.isFinite(game.remainingSeconds)&&game.remainingSeconds<=rule[4]&&game.remainingSeconds>0){minimum=rule[0];stage='final segment'}
  }else if(baseball){
    if(game.period===8&&game.inningHalf===2&&game.outs>=2){minimum=7;stage='end of eighth inning'}
    if(game.period===9&&[1,2].includes(game.inningHalf)&&game.outs>=0&&game.outs<=2){minimum=5;stage='ninth inning'}
  }else if(soccer){
    // A second-half lead can qualify before the final ten minutes only at
    // four goals or more; three goals must use leadSignal's late window.
    if(game.period===2&&!game.soccerExtraTime){minimum=4;stage='second half'}
  }
  if(!Number.isFinite(minimum))return null;
  const margin=Math.abs(game.home-game.away);
  if(margin<minimum||teamScorePosition(game,market)!==1)return null;
  return {strategy:'lead',fraction:.02,comboEligible:false,reason:`Restricted 2% lead: ${game.home>game.away?game.homeName:game.awayName} leads ${game.home}–${game.away} ${game.unit}; ${stage}, ${margin} ${game.unit} ahead`};
}
export function drawSignal(game,market){
  const type=String(game?.type||''),soccer=/soccer/.test(type),hockey=/hockey/.test(type);
  const basketball=/basketball/.test(type),football=/football/.test(type);
  const final=soccer?2:hockey?3:basketball?['NCAAB','NCAAW'].includes(game.sport)?2:4:
    football?4:/rugby|handball/.test(type)?2:/lacrosse/.test(type)?4:NaN;
  const seconds=soccer?game?.matchRemainingSeconds:game?.remainingSeconds;
  const rules=String(market?.rules_primary||'');
  if(!game?.verifiedLive||!game.scoreKnown||!game.scoreConsistent||game.home!==game.away||
    game.period!==final||!Number.isFinite(seconds)||seconds<=0||seconds>=45||
    soccer&&game.soccerOvertime||!['active','open'].includes(market?.status)||
    market.event_ticker!==game.mainEvent||!/^(?:draw|tie)(?:\b|\/)/i.test(String(market.title||market.yes_sub_title||''))||
    !/\b(?:draw|tie)\b/i.test(rules)||!/\b(?:yes|settles|resolves)\b/i.test(rules)||
    (hockey||basketball||football)&&!/regulation/i.test(rules))return null;
  return {strategy:'lead',fraction:.05,comboEligible:false,reason:`Restricted 5% draw at ${game.home}–${game.away}; final segment, ${seconds.toFixed(1)} seconds remaining`};
}
export function tennisSignal(game,market){
  const t=game.tennis;
  if(!game.verifiedLive||!game.scoreKnown||!t||!['active','open'].includes(market.status)||market.event_ticker!==t.mainEvent||!/(?:wins?|winner).*match|wins?\b/i.test(`${market.title||''} ${market.rules_primary||''}`))return null;
  if(![3,5].includes(t.bestOf)||!t.firstId||!t.secondId||!t.server||!t.mainEvent||t.firstRound!=='ongoing'||t.secondRound!=='ongoing')return null;
  // Only a leader serving at 5–4 or 6–5 can clinch the deciding set in this game.
  const first=[5,6].includes(t.firstGames)&&t.firstGames-t.secondGames===1&&t.firstSets===(t.bestOf-1)/2;
  const second=[5,6].includes(t.secondGames)&&t.secondGames-t.firstGames===1&&t.secondSets===(t.bestOf-1)/2;
  if(first===second)return null;
  const leaderId=first?t.firstId:t.secondId,opponentId=first?t.secondId:t.firstId;
  if(market.custom_strike?.tennis_competitor!==leaderId||t.server!==leaderId)return null;
  const leaderPoints=first?t.firstPoints:t.secondPoints,opponentPoints=first?t.secondPoints:t.firstPoints;
  if(![0,15,30,40].includes(leaderPoints)||![0,15,30,40].includes(opponentPoints))return null;
  // A known opponent game point is an imminent break or hold, so wait for the next update.
  if(opponentPoints===40 && leaderPoints<40 || leaderPoints===40 && opponentPoints===40 && t.advantage===opponentId)return null;
  if(t.advantage && !['',leaderId,opponentId].includes(t.advantage))return null;
  const leaderGames=first?t.firstGames:t.secondGames,opponentGames=first?t.secondGames:t.firstGames;
  return {strategy:'lead',reason:`Tennis match-clinching set ${leaderGames}–${opponentGames}; leader serves, points ${leaderPoints}–${opponentPoints}${t.advantage===leaderId?' advantage':''}`,fraction:.15};
}
export function minimumProfitCents(strategy,availableCents,sportType='',remainingSeconds=NaN,filledOrders=0){
  const tier=filledOrders>=20?50:filledOrders>=15?35:filledOrders>=10?15:0;
  const existing=strategy==='weather'?30:
    strategy==='over'||strategy==='lead'?1:
    Number(availableCents)>=20000?200:Number(availableCents)>=10000?50:25;
  return Math.max(existing,tier);
}
export function netSettlementProfitCents(count,price,feeMultiplier=2){
  if(!Number.isFinite(count)||count<=0||!Number.isFinite(price)||price<=0||price>=1)return 0;
  return Math.floor(count*(1-price)*100+1e-8)-Math.ceil(7*count*price*(1-price)*feeMultiplier-1e-8);
}
export function profitableCount(count,price,feeMultiplier,strategy,availableCents,sportType='',remainingSeconds=NaN){
  const profit=netSettlementProfitCents(count,price,feeMultiplier);
  const cost=estimatedCostCents(count,price,feeMultiplier);
  return cost>0&&profit>=minimumProfitCents(strategy,availableCents,sportType,remainingSeconds)?count:0;
}
export function comeback(game,market,strategy){
  if(!game?.verifiedLive||!game.scoreKnown)return false;
  if(strategy==='over')return false;
  if(game.tennis){
    const t=game.tennis,chosen=market.custom_strike?.tennis_competitor;
    if(![3,5].includes(t.bestOf)||![t.firstId,t.secondId].includes(chosen))return false;
    const first=chosen===t.firstId,opponentId=first?t.secondId:t.firstId;
    const ours=first?t.firstGames:t.secondGames,theirs=first?t.secondGames:t.firstGames;
    const ourPoints=first?t.firstPoints:t.secondPoints,theirPoints=first?t.secondPoints:t.firstPoints;
    // A tie, a broken serve, or 5–6 by itself is not a match point.
    return ours===5&&theirs===6&&t.server===opponentId&&
      (theirPoints===40&&ourPoints<40||theirPoints===40&&ourPoints===40&&t.advantage===opponentId);
  }
  if(game.tableTennis){
    const t=game.tableTennis,chosen=market.custom_strike?.table_tennis_competitor;
    if(![t.firstId,t.secondId].includes(chosen)||t.setNumber!==t.bestOf)return false;
    const first=chosen===t.firstId,ours=first?t.firstPoints:t.secondPoints,theirs=first?t.secondPoints:t.firstPoints;
    return t.firstSets===t.secondSets&&theirs>=10&&theirs>ours;
  }
  if(game.golf){
    const board=game.golf.board||[],chosen=market.custom_strike?.golf_competitor;
    const player=board.find(p=>p.competitor_id===chosen);
    return Boolean(player&&board.some(p=>p.competitor_id!==chosen&&Number.isFinite(p.total_score)&&p.total_score<player.total_score)&&
      board.every(p=>p.current_round_thru>=17));
  }
  if(game.darts){
    const d=game.darts,chosen=market.custom_strike?.darts_competitor,first=chosen===d.firstId;
    if(![d.firstId,d.secondId].includes(chosen)||!Number.isInteger(d.bestOf))return false;
    const theirs=first?d.secondLegs:d.firstLegs,ours=first?d.firstLegs:d.secondLegs;
    return theirs>ours&&theirs===Math.ceil(d.bestOf/2)-1&&
      (first?d.secondCheckout&&d.secondDouble&&d.nextThrow===d.secondId:d.firstCheckout&&d.firstDouble&&d.nextThrow===d.firstId);
  }
  if(game.volleyball){
    const chosen=Object.entries(market.custom_strike||{}).find(([k,v])=>/_team$/.test(k)&&typeof v==='string')?.[1];
    const first=chosen===game.homeTeamId,second=chosen===game.awayTeamId;
    if(first===second||game.period!==game.volleyball.bestOf)return false;
    const point=game.volleyball.current,ours=first?point?.home:point?.away,theirs=first?point?.away:point?.home;
    return Number.isInteger(ours)&&Number.isInteger(theirs)&&theirs>=14&&theirs>ours;
  }
  const position=teamScorePosition(game,market);
  if(position===null||position===1)return false;
  const type=String(game.type||'');
  if(!/basketball|football|hockey|soccer/.test(type))return position===-1;
  const soccer=/soccer/.test(type),basketball=/basketball/.test(type),hockey=/hockey/.test(type);
  const finalPeriod=soccer?2:hockey?3:basketball?['NCAAB','NCAAW'].includes(game.sport)?2:4:4;
  const seconds=soccer?game.matchRemainingSeconds:game.remainingSeconds;
  return game.period===finalPeriod&&(!soccer||!game.soccerExtraTime)&&Number.isFinite(seconds)&&seconds>=0&&
    seconds<(position===0?30:120);
}
export function teamScorePosition(game,market){
  if(!game?.verifiedLive||!game.scoreKnown||!market)return null;
  const teamId=Object.entries(market.custom_strike||{}).find(([k,v])=>/_team$/.test(k)&&typeof v==='string')?.[1];
  const home=teamId&&game.homeTeamId?teamId===game.homeTeamId:!teamId&&game.homeName&&norm(market.yes_sub_title||market.title).includes(norm(game.homeName));
  const away=teamId&&game.awayTeamId?teamId===game.awayTeamId:!teamId&&game.awayName&&norm(market.yes_sub_title||market.title).includes(norm(game.awayName));
  const ours=home&&!away?game.home:away&&!home?game.away:NaN;
  const theirs=home&&!away?game.away:away&&!home?game.home:NaN;
  return Number.isFinite(ours)&&Number.isFinite(theirs)?Math.sign(ours-theirs):null;
}
export function timedProfitExitAllowed(game,market){
  const position=teamScorePosition(game,market);
  return position===1||position!==null&&comeback(game,market,'lead');
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
export function overBudget(balanceCents, portfolioValueCents) {
  const cash=N(balanceCents), value=N(portfolioValueCents);
  if (![cash,value].every(Number.isFinite) || Math.min(cash,value)<0) return 0;
  // Each single has its own 30% bankroll limit. Existing positions do not
  // reduce another trade's limit; cash availability is checked separately.
  return Math.floor((cash+value)*0.30);
}

