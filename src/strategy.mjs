const N = v => v === null || v === undefined || v === '' ? NaN : Number(v);
const pick = (obj, names) => names.map(k => obj?.[k]).find(v => Number.isFinite(N(v)));
export function sportName(m) {
  const s = `${m.details?.competition || ''} ${m.details?.league || ''} ${m.type || ''}`.toLowerCase();
  if (/esports/.test(String(m.type||'').toLowerCase())) return /soccer/.test(s)?'eSoccer':/basketball/.test(s)?'eBasketball':'Esports';
  if (/table_tennis/.test(s)) return 'Table tennis';
  if (/college.*football|cfb/.test(s)) return 'CFB';
  if (/college.*basketball|ncaab|ncaam|ncaaw/.test(s)) return 'NCAAB';
  if (/wnba/.test(s)) return 'WNBA';
  if (/nba|pro basketball/.test(s)) return 'NBA';
  if (/nfl|pro football/.test(s)) return 'NFL';
  if (/mlb|pro baseball/.test(s)) return 'MLB';
  if (/nhl|pro hockey/.test(s)) return 'NHL';
  if (/tennis|\batp\b|\bwta\b/.test(s)) return 'Tennis';
  if (/darts/.test(s)) return 'Darts';
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
  const tennis=/^tennis_/.test(String(m.type||''));
  const tableTennis=/^table_tennis_/.test(String(m.type||''));
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
  const period = N(pick(d, ['period','period_number','quarter','current_period','inning','current_inning']) ?? d.game?.period ?? (/^(?:2nd|second)$/.test(half)?2:/^(?:1st|first)$/.test(half)?1:undefined));
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
  const possessionValue=/hockey/.test(family)?d.puck_possession_team_id??d.puck_possession:
    /football/.test(family)?d.situation?.possession_team_id??d.possession_team_id??d.possession:
    /soccer/.test(family)?d.ball_possession_team_id??d.possession_team_id??d.possession:
    /basketball/.test(family)?d.possession_team_id??d.possession:null;
  const possessionSide=String(possessionValue||'').toLowerCase()==='home'||possessionValue&&possessionValue===m.details?.home_team_id?'home':
    String(possessionValue||'').toLowerCase()==='away'||possessionValue&&possessionValue===m.details?.away_team_id?'away':
    /baseball/.test(family)?d.inning_half===2||d.inning_half==='bottom'?'home':d.inning_half===1||d.inning_half==='top'?'away':null:null;
  // Only a final-whistle countdown can establish the last 45 seconds in soccer.
  // The displayed minute alone excludes unknown stoppage time.
  const matchRemainingSeconds=/soccer/.test(family)?N(d.match_remaining_seconds):NaN;
  // Soccer feeds include extra-time goals in same-game scores, while the
  // matching Kalshi totals and winner markets settle on regulation only.
  const soccerExtraTime=/soccer/.test(family) &&
    (/^(?:aet|et|extra.?time|overtime|penalties)$/i.test(String(d.match_status||'')) ||
      (Array.isArray(d.period_scores)?d.period_scores:[]).some(p=>/overtime|extra/i.test(String(p.type||''))) ||
      Number.isFinite(soccerMinute) && soccerMinute>=90);
  const segmentSeconds=/hockey/.test(family)||sport==='NCAAB'?1200:/basketball/.test(family)?sport==='WNBA'?600:720:900;
  const clockFraction = parts ? Math.min(1, remainingSeconds / segmentSeconds) : NaN;
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
  return {id:m.id, feedId:live?.milestone_id, observedAt:Date.parse(live?._observed_at||''), updatedAt:Number.isFinite(updated)?updated*1000:NaN, title:m.title, sport, type:family, status, home, away, homeUnits, awayUnits, unit, period, periodScores, playerStats:d.player_stats||null, setNumber:N(currentSet?.number), phase, periodConsistent, scoreConsistent, clock, remainingSeconds, clockRunning, soccerMinute, soccerHalf:half, soccerExtraTime, matchRemainingSeconds, possessionSide, tennis:tennisData, inningHalf:N(d.inning_half), outs:N(d.outs), progress, verifiedLive, scoreKnown:Number.isFinite(home)&&Number.isFinite(away), homeName:String(d.home_team?.name||d.home_team_name||d.home?.name||(names.length===2?names[1]:'')), awayName:String(d.away_team?.name||d.away_team_name||d.away?.name||(names.length===2?names[0]:'')),homeTeamId:m.details?.home_team_id,awayTeamId:m.details?.away_team_id,eventTickers:m.related_event_tickers||[]};
}
const wholeGame = s => !/1st|2nd|3rd|4th|first half|second half|quarter|period|inning|halftime|regulation only|first to score|team total|player|individual|series total/i.test(s);
export function periodValue(game,market){
  const match=String(market?.event_ticker||'').split('-')[0].match(/([1-9])(Q|P|H|INNING)(?:TEAM)?TOTAL$/);
  if(!match)return null;
  const n=Number(match[1]),unit=match[2];
  const numbers=unit==='H'&&/basketball/.test(game.type)&&game.sport!=='NCAAB'?(n===1?[1,2]:n===2?[3,4]:[]):[n];
  const parts=numbers.map(number=>game.periodScores?.find(p=>p.number===number));
  if(!parts.length||parts.some(p=>!p))return null;
  return {home:parts.reduce((s,p)=>s+p.home,0),away:parts.reduce((s,p)=>s+p.away,0),number:n,unit};
}
export function endWindow(game){
  if(!game.verifiedLive||!game.scoreKnown||!game.periodConsistent)return false;
  if(/basketball/.test(game.type))return game.period===(game.sport==='NCAAB'?2:4) && game.remainingSeconds>0 && game.remainingSeconds<450;
  if(/football/.test(game.type))return game.period===4 && game.remainingSeconds>0 && game.remainingSeconds<300;
  if(/hockey/.test(game.type))return game.period===3 && game.remainingSeconds>0 && game.remainingSeconds<420;
  if(/baseball/.test(game.type))return game.period===9;
  if(/soccer/.test(game.type))return game.period===2 && Number.isFinite(game.soccerMinute) && game.soccerMinute>=85 && game.soccerMinute<90 && !game.soccerExtraTime;
  return false;
}
export function overSignal(game, market) {
  if (!game.verifiedLive || !game.scoreKnown || !game.scoreConsistent || Math.min(game.home,game.away)<0 || game.home+game.away<=0 || market.status!=='active' && market.status!=='open') return null;
  // Scores from these feeds are not comparable to a whole-game contract line.
  if (!/basketball|baseball|football|hockey|soccer/.test(game.type) || /esports|table_tennis/.test(game.type)) return null;
  const series=String(market.event_ticker||'').split('-')[0];
  const teamTotal=/TEAMTOTAL$/.test(series),gameTotal=/TOTAL$/.test(series)&&!teamTotal;
  const player=playerOverSpec(game,market);
  if(Object.keys(market.custom_strike||{}).some(k=>/_player$/.test(k))&&!player)return null;
  if(!teamTotal&&!gameTotal&&!player)return null;
  if (game.soccerExtraTime || /soccer/.test(game.type) && !Number.isFinite(game.soccerMinute)) return null;
  // A nearly free YES after an apparently crossed line means the feed and
  // contract disagree. Never treat this as a guaranteed arbitrage.
  if (Number.isFinite(Number(market.yes_ask_dollars)) && market.yes_ask_dollars!=null && Number(market.yes_ask_dollars)<0.8) return null;
  if (market.result && !['','not_determined'].includes(String(market.result))) return null;
  const text = `${market.title||''} ${market.yes_sub_title||''} ${market.rules_primary||''}`;
  const segment=series.match(/([1-9])(?:Q|P|H|INNING)(?:TEAM)?TOTAL$/);
  if(!player && !segment && !wholeGame(teamTotal?text.replace(/team total/gi,''):text))return null;
  if(!player && !/total (points|runs|goals|score)|combined (points|runs|goals|score)|combined score|\bover\s+\d+(?:\.\d+)?\s+(?:points|runs|goals)\s+scored\b/i.test(text))return null;
  if (market.strike_type && !['greater','greater_than'].includes(market.strike_type)) return null;
  const strike = N(market.floor_strike);
  // The displayed line and structured strike must describe the same bet.
  for(const label of [market.title,market.yes_sub_title]){
    const shown=String(label||'').match(/\bover\s+(\d+(?:\.\d+)?)\b/i);
    if(shown && Number(shown[1])!==strike)return null;
  }
  let scored=game.home+game.away,team='';
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
  if (!Number.isFinite(strike) || strike<0 || scored<=strike) return null;
  return {strategy:'over', reason:`${scored} ${player?.metric||'scored'}${team?` by ${team}`:''}; line ${strike} already passed${segment?`; segment ${segment[1]}`:''}`, fraction:0.9};
}
export function playerOverSpec(game,market){
  if(!market||!/basketball/.test(game.type)||!/^(?:KX[A-Z0-9]+)(PTS|REB|AST|3PT|PRA|STL|BLK)$/.test(String(market.event_ticker||'').split('-')[0]))return null;
  const suffix=String(market.event_ticker).split('-')[0].match(/(PTS|REB|AST|3PT|PRA|STL|BLK)$/)?.[1];
  const id=market.custom_strike?.basketball_player,stats=game.playerStats?.[id];
  const name=String(market.yes_sub_title||market.title||'').split(':')[0].trim();
  const line=Number(market.floor_strike),shown=String(market.yes_sub_title||market.title||'').match(/:\s*(\d+)\s*\+/);
  if(!id||!stats||!name||!shown||!Number.isFinite(line)||Number(shown[1])!==line+0.5)return null;
  const metrics={PTS:stats.points,REB:stats.rebounds,AST:stats.assists,'3PT':stats.three_points_made,PRA:Number(stats.points)+Number(stats.rebounds)+Number(stats.assists),STL:stats.steals,BLK:stats.blocks};
  const value=Number(metrics[suffix]);
  if(!Number.isInteger(value)||value<0)return null;
  return {id,name,metric:suffix,value};
}
// A preflight over needs two distinct exchange updates after the line was
// crossed. An identical cached response, reversed clock, or corrected score
// cannot authorize an order even if both HTTP requests succeeded.
export function confirmedOver(first,second,market){
  if(!overSignal(first,market)||!overSignal(second,market))return false;
  if(first.id!==second.id||first.feedId!==first.id||second.feedId!==second.id)return false;
  const dwell=12000;
  if(!Number.isFinite(first.observedAt)||!Number.isFinite(second.observedAt)||second.observedAt-first.observedAt<dwell)return false;
  if(Number.isFinite(first.updatedAt)&&Number.isFinite(second.updatedAt)&&second.updatedAt<=first.updatedAt)return false;
  if([first,second].some(s=>Number.isFinite(s.updatedAt)&&(s.updatedAt>s.observedAt+5000||s.observedAt-s.updatedAt>30000)))return false;
  if(first.home!==second.home||first.away!==second.away||!first.periodConsistent||!second.periodConsistent)return false;
  const firstPlayer=playerOverSpec(first,market),secondPlayer=playerOverSpec(second,market);
  if(firstPlayer&&(!secondPlayer||firstPlayer.value!==secondPlayer.value))return false;
  if(Number.isFinite(first.period)&&Number.isFinite(second.period)&&second.period<first.period)return false;
  if(first.period===second.period&&Number.isFinite(first.remainingSeconds)&&Number.isFinite(second.remainingSeconds)&&second.remainingSeconds>first.remainingSeconds)return false;
  if(Number.isFinite(first.soccerMinute)&&Number.isFinite(second.soccerMinute)&&second.soccerMinute<first.soccerMinute)return false;
  return true;
}
const norm = s => String(s||'').toLowerCase().replace(/[^a-z0-9]/g,'');
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
  const segments=/baseball/.test(game.type)?9:/hockey/.test(game.type)?3:/soccer/.test(game.type)?2:basketball&&game.sport==='NCAAB'?2:/basketball|football/.test(game.type)?4:Infinity;
  const baseball=/baseball/.test(game.type);
  const finalTime=baseball?game.period===9:soccer?game.period===2 && Number.isFinite(game.soccerMinute) && game.soccerMinute>=85:game.period===segments && game.periodConsistent && Number.isFinite(game.remainingSeconds) && game.remainingSeconds>0 && (basketball?game.remainingSeconds<450:hockey?game.remainingSeconds<=390:game.remainingSeconds<300);
  if (!game.verifiedLive || !game.scoreKnown || !finalTime || market.status!=='active' && market.status!=='open') return null;
  const h=game.homeUnits,a=game.awayUnits;
  if (!Number.isFinite(h)||!Number.isFinite(a)) return null;
  const margin=Math.abs(h-a),trailerScore=Math.min(h,a);
  const soccerLastSeconds=soccer&&game.soccerMinute>=89&&game.matchRemainingSeconds>0&&game.matchRemainingSeconds<45;
  const minimum=basketball?11:football?10:hockey?3:baseball?2:soccer?soccerLastSeconds?1:2:null;
  const ratio=trailerScore>0?Math.max(h,a)/trailerScore:Infinity;
  if (minimum===null ? trailerScore<=0||ratio<3.5 : margin<minimum) return null;
  const leader = h>a ? game.homeName : game.awayName;
  const trailer = h>a ? game.awayName : game.homeName;
  if(!hockey&&!soccer&&game.possessionSide!==(h>a?'home':'away'))return null;
  const description = `${market.title||''} ${market.yes_sub_title||''}`;
  const teamId=Object.entries(market.custom_strike||{}).find(([k,v])=>/_team$/.test(k)&&typeof v==='string')?.[1];
  const expectedId=h>a?game.homeTeamId:game.awayTeamId;
  const identityMatches=teamId&&expectedId?teamId===expectedId:Boolean(leader&&trailer&&norm(description).includes(norm(leader))&&!norm(description).includes(norm(trailer)));
  if (!/win|winner|victory/i.test(description) || /wins? by|spread|handicap|margin of victory/i.test(description) || market.event_ticker && !/GAME(?:-|$)/i.test(market.event_ticker) || !identityMatches) return null;
  if(soccer && !/after 90 minutes plus stoppage time/i.test(market.rules_primary||''))return null;
  const fraction=leadFraction(game,margin,minimum);
  const timing=baseball?'9th inning':soccer?`${game.soccerMinute}' of regulation plus stoppage`:`${basketball?`period ${game.period}, `:''}${game.clock} remaining`;
  return {strategy:'lead', reason:`${leader||market.yes_sub_title} leads ${h}–${a} ${game.unit} (${margin} ${game.unit} ahead); ${timing}`, fraction};
}
export function leadFraction(game,margin,minimum){
  const veryCommanding=margin>=Math.ceil(minimum*1.5);
  if(!veryCommanding)return .15;
  if(/basketball/.test(game.type))return .15;
  if(/baseball/.test(game.type))return game.period===9&&game.outs>=2?.25:game.period===9&&game.outs>=1?.20:.15;
  if(/soccer/.test(game.type))return game.soccerMinute>=89?.35:game.soccerMinute>=88?.30:.25;
  if(Number.isFinite(game.remainingSeconds)&&game.remainingSeconds<=30)return .25;
  if(Number.isFinite(game.remainingSeconds)&&game.remainingSeconds<=150)return .20;
  return .15;
}
export function tennisSignal(game,market){
  const t=game.tennis;
  if(!game.verifiedLive||!game.scoreKnown||!t||!['active','open'].includes(market.status)||market.event_ticker!==t.mainEvent||!/(?:wins?|winner).*match|wins?\b/i.test(`${market.title||''} ${market.rules_primary||''}`))return null;
  if(![3,5].includes(t.bestOf)||!t.firstId||!t.secondId||!t.server||!t.mainEvent||t.firstRound!=='ongoing'||t.secondRound!=='ongoing')return null;
  const first=t.firstGames===5 && t.secondGames<=2 && t.firstSets===(t.bestOf-1)/2;
  const second=t.secondGames===5 && t.firstGames<=2 && t.secondSets===(t.bestOf-1)/2;
  if(first===second)return null;
  const leaderId=first?t.firstId:t.secondId,opponentId=first?t.secondId:t.firstId;
  if(market.custom_strike?.tennis_competitor!==leaderId||t.server!==leaderId)return null;
  const leaderPoints=first?t.firstPoints:t.secondPoints,opponentPoints=first?t.secondPoints:t.firstPoints;
  if(![0,15,30,40].includes(leaderPoints)||![0,15,30,40].includes(opponentPoints))return null;
  // A known opponent game point is an imminent break or hold, so wait for the next update.
  if(opponentPoints===40 && leaderPoints<40 || leaderPoints===40 && opponentPoints===40 && t.advantage===opponentId)return null;
  if(t.advantage && !['',leaderId,opponentId].includes(t.advantage))return null;
  const leaderGames=first?t.firstGames:t.secondGames,opponentGames=first?t.secondGames:t.firstGames;
  return {strategy:'lead',reason:`Tennis match-clinching set ${leaderGames}–${opponentGames}; leader serves, points ${leaderPoints}–${opponentPoints}${t.advantage===leaderId?' advantage':''}`,fraction:opponentGames<=1&&leaderPoints===40?.25:opponentGames<=1?.20:.15};
}
export function minimumProfitCents(strategy,availableCents,sportType='',remainingSeconds=NaN){
  return 25;
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
  return Math.max(0,Math.floor((cash+value)*0.9)-Math.ceil(exposure));
}
