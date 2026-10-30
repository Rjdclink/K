import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gameState,overSignal,confirmedOver,kalshiOnlyOver,leadSignal,tennisSignal,tableTennisSignal,orderSize,estimatedCostCents,overBudget,minimumProfitCents,netSettlementProfitCents,profitableCount,comeback} from '../src/strategy.mjs';

test('each trade has its own percentage of the full bankroll',()=>{
  const bankroll=14600,alreadyHeld=4372;
  assert.equal(overBudget(10228,alreadyHeld,alreadyHeld),4380);
  assert.equal(overBudget(10228,alreadyHeld,alreadyHeld),overBudget(10228,alreadyHeld,0));
  assert.ok(orderSize(10228,'.98','1000',.30,1,bankroll,4380,2)>40);
  assert.ok(orderSize(10228,'.98','1000',.15,1,bankroll,Infinity,2)>20);
});

test('table tennis deciding set uses four and six point tiers without a clock',()=>{
  const m={id:'liga',type:'table_tennis_match',title:'Oleg Moshnikov vs Iurii Krivenkii',details:{league:'Russia Liga Pro',best_of:5,first_competitor_id:'oleg',second_competitor_id:'iurii'},related_event_tickers:['KXLIGAPROMATCH-DATE']};
  const state=(a,b,sets=[2,2],number=5,status='live')=>gameState(m,{milestone_id:m.id,_observed_at:new Date().toISOString(),details:{status,competitor1_is_home:true,competitor1_overall_score:sets[0],competitor2_overall_score:sets[1],period_scores:[{type:'set',number,competitor1_score:a,competitor2_score:b}]}});
  const market={event_ticker:'KXLIGAPROMATCH-DATE',status:'active',title:'Oleg Moshnikov',yes_sub_title:'Oleg Moshnikov',custom_strike:{table_tennis_competitor:'oleg'},yes_ask_dollars:'0.93'};
  assert.equal(tableTennisSignal(state(10,4),market)?.fraction,.15);
  assert.equal(tableTennisSignal(state(10,5),market)?.fraction,.10);
  assert.equal(tableTennisSignal(state(8,4),market)?.fraction,.10);
  assert.equal(tableTennisSignal(state(10,4),market)?.fraction,.15);
  assert.equal(tableTennisSignal(state(8,5),market),null);
  assert.equal(tableTennisSignal(state(10,4,[2,1]),market),null);
  assert.equal(tableTennisSignal(state(10,4,[2,2],4),market),null);
  assert.equal(tableTennisSignal(state(10,4,[2,2],5,'final'),market),null);
  assert.equal(tableTennisSignal(state(4,10),market),null);
});

const milestone={id:'game-1',title:'Boston at New York',type:'basketball_game',details:{competition:'Pro Basketball (M)'},related_event_tickers:['GAME']};
const live=(home,away,quarter=4)=>({details:{status:'live',last_updated_ts:Math.floor(Date.now()/1000),home_score:home,away_score:away,quarter,clock:'00:59',possession:'home',home_team_name:'New York',away_team_name:'Boston'}});
test('fractional final-minute clock is parsed and stopped clock is identified',()=>{
  const details={...live(79,73).details,period_remaining_time:'00:09.20',clock_running:false};
  const state=gameState(milestone,{details});
  assert.equal(state.remainingSeconds,9.2);
  assert.equal(state.clockRunning,false);
  assert.equal(state.period,4);
  assert.equal(gameState(milestone,{details:{...details,period_remaining_time:'06:27',clock_running:true}}).remainingSeconds,387);
});
test('over requires strict threshold exceeded and whole-game contract',()=>{
  const g=gameState(milestone,live(102,101));const market={status:'active',event_ticker:'KXNBATOTAL-26OCT27BOSNYK',title:'Total points in game over 203',rules_primary:'Combined total points scored in the game',strike_type:'greater',floor_strike:203};
  assert.equal(overSignal(g,market),null);assert.equal(overSignal(gameState(milestone,live(103,101)),market)?.fraction,.30);
  assert.ok(overSignal(gameState(milestone,live(103,101,3)),market));
  assert.ok(overSignal(gameState(milestone,{details:{...live(103,101).details,clock:'03:01'}}),market));
  assert.equal(overSignal(gameState(milestone,live(103,101)),{...market,title:'First half total points'}),null);
});
test('over preflight requires stable scores from a newer, fresh milestone update',()=>{
  const m={id:'soccer-1',title:'Dolomiti Bellunesi vs Desenzano',type:'soccer_match'};
  const market={status:'active',event_ticker:'KXSERIECTOTAL-26OCT28BELLDESE',title:'Over 0.5 goals',rules_primary:'Combined total goals scored in the game',floor_strike:.5,yes_ask_dollars:'0.99'};
  const now=Date.now();
  const sample=(home,away,observed,updated,extra={})=>gameState(m,{milestone_id:m.id,_observed_at:new Date(observed).toISOString(),details:{status:'live',home_score:home,away_score:away,time:"55'",last_updated_ts:updated/1000,...extra}});
  const first=sample(1,0,now-13000,now-14000);
  const valid=sample(1,0,now,now-1000);
  assert.equal(confirmedOver(first,valid,market),true);
  assert.equal(confirmedOver(first,sample(0,0,now,now-1000),market),false,'goal overturned');
  assert.equal(confirmedOver(first,sample(1,0,now,now-14000),market),true,'a stable feed can be checked twice');
  assert.equal(confirmedOver(sample(1,0,now-4000,now-5000),sample(1,0,now-2000,now-3000),market),false,'less than three seconds between reads');
  assert.equal(confirmedOver(first,sample(1,0,now,now-1000,{time:"54'"}),market),false,'clock reversed');
  assert.equal(confirmedOver(first,sample(1,0,now,now-1000,{away_goals:1}),market),false,'score aliases disagree');
  assert.equal(confirmedOver(first,sample(1,0,now,now-1000,{live_data_delayed:true}),market),false);
  assert.equal(confirmedOver(first,sample(1,0,now,now-1000),{...market,title:'Over 1.5 goals'}),false,'displayed line differs');
  assert.equal(confirmedOver(first,sample(1,0,now,now-1000),{...market,floor_strike:1.5}),false);
  assert.equal(confirmedOver(first,sample(1,0,now,now-1000),{...market,status:'closed'}),false);
  assert.equal(confirmedOver(first,gameState(m,{milestone_id:'wrong',_observed_at:new Date(now).toISOString(),details:{status:'live',home_score:1,away_score:0,time:"55'",last_updated_ts:(now-1000)/1000}}),market),false,'wrong game');
  assert.equal(confirmedOver(first,sample(1,0,now,now-1000,{home_regulation_score:0}),market),false,'regulation score conflicts');
  assert.equal(confirmedOver(sample(1,0,now-13000,now-100000),valid,market),false,'initial score stale');
  assert.equal(confirmedOver(first,sample(1,0,now,now-50000),market),false,'latest score stale');
  assert.equal(confirmedOver(first,gameState(m,{milestone_id:m.id,_observed_at:new Date(now).toISOString(),details:{status:'live',home_score:1,away_score:0,time:"55'"}}),market),true,'provider may omit its update timestamp; independent source still required');
});
test('Kalshi-only game total requires a newer score update six seconds later and rejects unidentified player strikes',()=>{
  const m={id:'kbo',title:'Kia Tigers vs Samsung Lions',type:'baseball_game',details:{league:'Korea KBO'}};
  const market={status:'active',event_ticker:'KXKBOTOTAL-26OCT30KIASAM',title:'Over 9.5 runs scored?',rules_primary:'The teams collectively score more than 9.5 runs',floor_strike:9.5,strike_type:'greater'};
  const now=Date.now();
  const state=(observed,updated,home=8)=>gameState(m,{milestone_id:m.id,_observed_at:new Date(observed).toISOString(),details:{status:'live',home_score:home,away_score:3,inning:9,last_updated_ts:updated/1000}});
  const first=state(now-8000,now-9000),second=state(now,now-1000);
  assert.equal(kalshiOnlyOver(first,second,market),true);
  assert.equal(kalshiOnlyOver(first,state(now-3000,now-4000),market),false);
  assert.equal(kalshiOnlyOver(first,state(now,now-9000),market),false);
  assert.equal(kalshiOnlyOver(first,state(now,NaN),market),false);
  assert.equal(kalshiOnlyOver(first,state(now,now-1000,6),market),false);
  assert.equal(kalshiOnlyOver(first,second,{...market,custom_strike:{baseball_player:'player'}}),false);
  assert.equal(kalshiOnlyOver(first,second,{...market,event_ticker:'KXKBOGAME-26OCT30KIASAM'}),false);
  assert.equal(kalshiOnlyOver(first,second,{...market,event_ticker:'KXKBO1INNINGTOTAL-26OCT30KIASAM'}),false);
  assert.ok(orderSize(10000,'.94','100',.05,1,15000,Infinity,2)<=8,'fallback is capped at five percent of the full bankroll');
});
test('Kalshi-only crossed player prop requires the same identified statistic on a newer update',()=>{
  const m={id:'nba-prop',title:'New York Knicks at Chicago Bulls',type:'basketball_game',details:{home_team_id:'chi',away_team_id:'nyk'}};
  const market={status:'active',event_ticker:'KXNBAREB-26OCT30NYKCHI',title:'Matas Buzelis: 6+ rebounds',yes_sub_title:'Matas Buzelis: 6+',floor_strike:5.5,strike_type:'greater',custom_strike:{basketball_player:'buzelis'},yes_ask_dollars:'0.91'};
  const now=Date.now();
  const state=(at,updated,rebounds)=>gameState(m,{milestone_id:m.id,_observed_at:new Date(at).toISOString(),details:{status:'live',home_score:127,away_score:133,quarter:4,last_updated_ts:updated/1000,player_stats:{buzelis:{rebounds}}}});
  const first=state(now-8000,now-9000,6),second=state(now,now-1000,6);
  assert.equal(kalshiOnlyOver(first,second,market),true);
  assert.equal(kalshiOnlyOver(first,state(now,now-1000,7),market),false);
  assert.equal(kalshiOnlyOver(first,state(now,now-9000,6),market),false);
  assert.equal(kalshiOnlyOver(first,second,{...market,custom_strike:{basketball_player:'someone_else'}}),false);
  assert.equal(kalshiOnlyOver(first,second,{...market,event_ticker:'KXNBAGAME-26OCT30NYKCHI'}),false);
});
test('Kalshi whole-game over wording is recognized after the line is crossed',()=>{
  const m={id:'kbo-game',title:'Kia Tigers vs Samsung Lions',type:'baseball_game',details:{league:'Korea KBO'}};
  const g=gameState(m,{details:{status:'inprogress',away_points:3,home_points:8,inning:9}});
  const market={status:'active',event_ticker:'KXKBOTOTAL-26OCT27KIASAM',title:'Over 9.5 runs scored?',yes_sub_title:'Over 9.5 runs scored',rules_primary:'If the teams collectively score more than 9.5 runs in the KBO game, the market resolves to Yes.',strike_type:'greater',floor_strike:9.5};
  assert.equal(overSignal(g,market)?.fraction,.30);
  assert.equal(overSignal(g,{...market,title:'Over 11.5 runs scored?',floor_strike:11.5}),null);
  assert.equal(orderSize(5097,'1.0000','0.00',.8),0);
});
test('team overs use only the named team score; player props cannot use the game score',()=>{
  const m={id:'nhl',title:'Columbus at Philadelphia',type:'hockey_match',details:{home_team_id:'phi',away_team_id:'cbj'}};
  const board=(home,away)=>gameState(m,{details:{status:'live',home_goals:home,away_goals:away,period:3,clock:'04:59'}});
  const team={status:'active',event_ticker:'KXNHLTEAMTOTAL-26OCT27CBJPHI',title:'Philadelphia over 1.5 goals scored',yes_sub_title:'Philadelphia over 1.5',rules_primary:'If Philadelphia scores over 1.5 goals in the game, Yes.',floor_strike:1.5,strike_type:'greater',custom_strike:{hockey_team:'phi'},yes_ask_dollars:'0.81'};
  assert.equal(overSignal(board(1,3),team),null);
  assert.match(overSignal(board(2,3),team)?.reason,/2 scored by Philadelphia; line 1\.5/);
  assert.equal(overSignal(board(2,3),{...team,custom_strike:{hockey_team:'unknown'}}),null);
  assert.equal(overSignal(board(2,3),{...team,event_ticker:'KXNHLTOTAL-26OCT27CBJPHI',custom_strike:{hockey_player:'id'}}),null);
  const player={...team,event_ticker:'KXNBAPRA-26OCT27BKNBOS',title:'Jayson Tatum: 35+ points, rebounds, and assists',floor_strike:34.5,custom_strike:{basketball_player:'tatum'}};
  assert.equal(overSignal(gameState({...milestone,details:{...milestone.details,home_team_id:'boston',away_team_id:'brooklyn'}},live(57,56)),player),null);
});
test('a live player stat qualifies at the contract winning count',()=>{
  const m={id:'nba',title:'New York Knicks at Chicago Bulls',type:'basketball_game',details:{home_team_id:'chi',away_team_id:'nyk'}};
  const market={status:'active',event_ticker:'KXNBAREB-26OCT28NYKCHI',title:'Matas Buzelis: 6+ rebounds',yes_sub_title:'Matas Buzelis: 6+',floor_strike:5.5,strike_type:'greater',custom_strike:{basketball_player:'buzelis'},yes_ask_dollars:'0.81'};
  const state=rebounds=>gameState(m,{details:{status:'live',home_score:127,away_score:133,quarter:4,player_stats:{buzelis:{rebounds}}}});
  assert.equal(overSignal(state(5),market),null);
  assert.equal(overSignal(state(6),market)?.strategy,'over');
  assert.equal(overSignal(state(7),market)?.strategy,'over');
});
test('WTA full-match game totals use all completed and current set games',()=>{
  const m={id:'wta',title:'Rakhimova vs Alexandrova',type:'tennis_tournament_singles',details:{tour:'WTA'}};
  const details={status:'live',competitor1_is_home:true,competitor1_round_scores:[{score:6},{score:4},{score:3}],competitor2_round_scores:[{score:4},{score:6},{score:2}],competitor1_statistics:{games_won:13},competitor2_statistics:{games_won:12}};
  const game=gameState(m,{details});
  const market={event_ticker:'KXWTAGTOTAL-DATE',status:'active',title:'Over 24.5 games',rules_primary:'If the number of completed games in the full match is above 24.5, then Yes.',floor_strike:24.5,strike_type:'greater',yes_ask_dollars:'0.90'};
  assert.equal(game.tennisTotal,25);
  assert.match(overSignal(game,market)?.reason||'',/25 scored; line 24.5/);
  assert.equal(overSignal(game,{...market,floor_strike:25.5}),null);
  assert.equal(overSignal(gameState(m,{details:{...details,competitor1_statistics:{games_won:12}}}),market),null);
  assert.equal(overSignal(game,{...market,event_ticker:'KXWTASETWINNER-DATE'}),null);
});
test('a period over uses that period alone and never substitutes the game total',()=>{
  const m={...milestone,related_event_tickers:['KXNBA1QTOTAL-26OCT28BOSBKN']};
  const board=gameState(m,{details:{status:'live',home_score:60,away_score:58,quarter:3,clock:'06:00',period_scores:[{number:1,type:'regular_period',home_score:25,away_score:20},{number:2,type:'regular_period',home_score:20,away_score:20},{number:3,type:'regular_period',home_score:15,away_score:18}]}});
  const market={status:'active',event_ticker:'KXNBA1QTOTAL-26OCT28BOSBKN',title:'1st quarter total points over 44.5',rules_primary:'Total points scored in the 1st quarter',floor_strike:44.5,strike_type:'greater',yes_ask_dollars:'.90'};
  assert.match(overSignal(board,market)?.reason||'',/45 scored/);
  assert.equal(overSignal(board,{...market,floor_strike:45.5}),null);
  assert.equal(overSignal(gameState(m,{details:{status:'live',home_score:60,away_score:58,quarter:3,clock:'06:00'}}),market),null);
});
test('inning team totals use only verified inning runs from the named team',()=>{
  const m={id:'mlb',title:'Boston at New York',type:'baseball_game',details:{league:'MLB',home_team_id:'ny',away_team_id:'bos'}};
  const board=gameState(m,{details:{status:'live',home_runs:6,away_runs:4,inning:9,home_team_name:'New York',away_team_name:'Boston',period_scores:[{number:9,home_score:2,away_score:0}]}});
  const market={status:'active',event_ticker:'KXMLB9INNINGTEAMTOTAL-DATE',title:'New York 9th inning team total runs over 1.5',rules_primary:'Total runs scored by New York in the 9th inning',custom_strike:{baseball_team:'ny'},floor_strike:1.5,strike_type:'greater',yes_ask_dollars:'0.90'};
  assert.match(overSignal(board,market)?.reason||'',/2 scored by New York/);
  assert.equal(overSignal(board,{...market,custom_strike:{baseball_team:'bos'}}),null);
  assert.equal(overSignal(gameState(m,{details:{status:'live',home_runs:6,away_runs:4,inning:9}}),market),null);
});
test('threshold overs enter in any live segment without a countdown clock',()=>{
  const market={status:'active',event_ticker:'KXTESTTOTAL-26OCT27GAME',title:'Total points in game over 1.5',rules_primary:'Combined total points scored in the game',floor_strike:1.5,yes_ask_dollars:'0.98'};
  const board=(type,details)=>gameState({id:type,title:'Away at Home',type,details:{league:type==='basketball_game'?'NBA':''}},{details:{status:'live',home_score:2,away_score:1,...details}});
  assert.ok(overSignal(board('basketball_game',{quarter:3,clock:'00:20'}),market));
  assert.ok(overSignal(board('basketball_game',{quarter:4,clock:'01:01'}),market));
  assert.ok(overSignal(board('basketball_game',{quarter:4,clock:'01:00'}),market));
  assert.ok(overSignal(board('football_game',{quarter:3,clock:'00:20'}),market));
  assert.ok(overSignal(board('football_game',{quarter:4,clock:'04:59'}),market));
  assert.ok(overSignal(board('hockey_match',{period:2,clock:'00:20'}),market));
  assert.ok(overSignal(board('hockey_match',{period:3,clock:'06:59'}),market));
  assert.ok(overSignal(board('baseball_game',{inning:8}),market));
  assert.ok(overSignal(board('baseball_game',{inning:9}),market));
  assert.ok(overSignal(board('soccer_match',{half:'2nd',time:"84'"}),market));
  assert.ok(overSignal(board('soccer_match',{half:'2nd',time:"85'"}),market));
  assert.ok(overSignal(board('soccer_match',{half:'1st',time:"20'"}),market));
  for(const type of ['basketball_game','football_game','hockey_match','baseball_game'])assert.ok(overSignal(board(type,{}),market),type);
  assert.equal(overSignal(board('basketball_game',{status:'closed'}),market),null);
  assert.equal(overSignal(board('basketball_game',{home_score:null}),market),null);
});
test('scanner refuses unsupported score formats and delayed live data',()=>{
  const total={status:'active',title:'Combined total points over 8',floor_strike:8,strike_type:'greater',yes_ask_dollars:'0.95'};
  const winner={status:'active',title:'Home wins',yes_sub_title:'Home wins'};
  for(const type of ['table_tennis_match','esports_soccer_game','cricket_match']){
    const game=gameState({id:type,type,title:'Away at Home'},live(9,1));
    assert.equal(overSignal(game,total),null,type);
    assert.equal(leadSignal(game,winner),null,type);
  }
  const delayed=gameState(milestone,{details:{...live(210,5).details,last_updated_ts:Math.floor(Date.now()/1000)-300}});
  assert.equal(overSignal(delayed,total),null);
});
test('late lead requires verified live score, leader identity, and progress',()=>{
  const market={status:'active',title:'Will New York win?',yes_sub_title:'New York wins'};
  assert.ok(leadSignal(gameState(milestone,live(140,30)),market));
  assert.equal(leadSignal(gameState(milestone,live(140,30)),{...market,yes_ask_dollars:'0.41'}),null);
  assert.equal(leadSignal(gameState(milestone,live(140,30,2)),market),null);
  assert.equal(leadSignal(gameState(milestone,{details:{...live(140,30).details,live_data_delayed:true}}),market),null);
  assert.equal(leadSignal(gameState(milestone,live(140,30)),{...market,title:'Will Boston win?',yes_sub_title:'Boston wins'}),null);
  assert.equal(leadSignal(gameState(milestone,{details:{...live(140,30).details,possession:'away'}}),market),null);
  assert.equal(leadSignal(gameState(milestone,{details:{...live(140,30).details,possession:undefined}}),market),null);
});
test('baseball needs two runs in the ninth and caps allocation at 15 percent',()=>{
  const m={...milestone,type:'baseball_game',details:{league:'MLB'}};
  const market={status:'active',title:'New York wins',custom_strike:{baseball_team:'home'},yes_sub_title:'New York'};
  const board=(inning,home=5)=>({details:{status:'inprogress',home_runs:home,away_runs:3,inning,inning_half:2,outs:1,home_team_name:'New York',away_team_name:'Boston'}});
  assert.equal(leadSignal(gameState(m,board(8)),market),null);
  assert.equal(leadSignal(gameState(m,board(9,4)),market),null);
  assert.equal(leadSignal(gameState(m,board(9)),market)?.fraction,.15);
  assert.equal(leadSignal(gameState(m,{details:{...board(9).details,inning_half:1}}),market)?.fraction,.15);
  assert.equal(leadSignal(gameState(m,board(9,6)),market)?.fraction,.15);
  const veryLate=board(9,6);veryLate.details.outs=2;
  assert.equal(leadSignal(gameState(m,veryLate),market)?.fraction,.15);
});
test('baseball accepts a two-run shutout lead',()=>{
  const baseball={...milestone,type:'baseball_game',details:{league:'MLB'}};
  const market={status:'active',title:'New York wins',yes_sub_title:'New York'};
  const at=(home,away,inning)=>({details:{status:'live',last_updated_ts:Math.floor(Date.now()/1000),home_runs:home,away_runs:away,inning,inning_half:2,home_team_name:'New York',away_team_name:'Boston'}});
  assert.equal(leadSignal(gameState(baseball,at(1,0,9)),market),null);
  assert.equal(leadSignal(gameState(baseball,at(2,0,9)),market)?.fraction,.15);
  assert.equal(leadSignal(gameState(baseball,at(3,0,9)),market)?.fraction,.15);
  assert.equal(leadSignal(gameState(baseball,at(2,0,8)),market),null);
});
test('baseball ninth inning lead and exceeded over need no countdown clock',()=>{
  const m={id:'mlb-no-clock',type:'baseball_game',title:'Boston at New York',details:{league:'MLB',home_team_id:'ny',away_team_id:'bos'}};
  const live={milestone_id:m.id,_observed_at:new Date().toISOString(),details:{status:'live',home_runs:6,away_runs:3,inning:'9th',inning_half:'bottom',home_team_name:'New York',away_team_name:'Boston'}};
  const game=gameState(m,live);
  const winner={event_ticker:'KXMLBGAME-DATE',status:'active',title:'New York wins',yes_sub_title:'New York',custom_strike:{baseball_team:'ny'},yes_ask_dollars:'0.95'};
  const total={event_ticker:'KXMLBTOTAL-DATE',status:'active',title:'Combined total runs over 8.5',rules_primary:'Combined total runs scored in the game',floor_strike:8.5,yes_ask_dollars:'0.95'};
  assert.equal(Number.isNaN(game.remainingSeconds),true);
  assert.equal(game.period,9);
  assert.equal(leadSignal(game,winner)?.strategy,'lead');
  assert.equal(overSignal(game,total)?.strategy,'over');
});
test('spread contracts are not game winner contracts',()=>{
  const m={...milestone,type:'baseball_game',details:{league:'KBO',home_team_id:'home-id',away_team_id:'away-id'}};
  const g=gameState(m,{details:{status:'inprogress',home_points:8,away_points:3,inning:9,inning_half:2,home_team_name:'Samsung Lions',away_team_name:'Kia Tigers'}});
  const spread={status:'active',event_ticker:'KXKBOSPREAD-26OCT260530KIASAM',title:'Samsung Lions wins by over 1.5 runs',yes_sub_title:'Samsung Lions wins by over 1.5 runs',custom_strike:{baseball_team:'home-id'}};
  assert.equal(leadSignal(g,spread),null);
  assert.equal(leadSignal(g,{...spread,event_ticker:'KXKBOGAME-26OCT260530KIASAM',title:'Samsung Lions wins',yes_sub_title:'Samsung Lions'} )?.fraction,.15);
});
test('soccer starts at 85:00 and excludes extra time or ambiguous stoppage scores',()=>{
  const m={id:'soccer',title:'Abha vs Al-Faisaly',type:'soccer_tournament_multi_leg',details:{league:'Saudi Pro League',home_team_id:'abha',away_team_id:'faisaly'}};
  const board=(home,away,time,half='2nd')=>gameState(m,{details:{status:'live',home_same_game_score:home,away_same_game_score:away,time,half,possession:'home'}});
  const market={status:'active',event_ticker:'KXSAUDIPLGAME-26OCT27ABHFAI',title:'Abha wins',yes_sub_title:'Abha',custom_strike:{soccer_team:'abha'},rules_primary:'If Abha wins after 90 minutes plus stoppage time (does not include extra time or penalties), then Yes.'};
  assert.equal(leadSignal(board(2,0,"82'"),market),null);
  assert.equal(leadSignal(board(2,0,"83'"),market),null);
  assert.equal(leadSignal(board(2,0,"85'"),market),null);
  assert.equal(leadSignal(board(3,0,"85'"),market)?.fraction,.15);
  assert.equal(leadSignal(board(3,0,"88'"),market)?.fraction,.15);
  assert.equal(leadSignal(board(3,0,"89'"),market)?.fraction,.15);
  assert.equal(leadSignal(gameState(m,{details:{status:'live',home_same_game_score:2,away_same_game_score:0,time:"89'",half:'2nd',match_remaining_seconds:119}}),market)?.fraction,.15);
  assert.equal(leadSignal(gameState(m,{details:{status:'live',home_same_game_score:2,away_same_game_score:0,time:"89'",half:'2nd',match_remaining_seconds:120}}),market),null);
  assert.equal(leadSignal(board(3,1,"90+4'"),market),null);
  assert.equal(leadSignal(board(2,0,"90+4'",'extra time'),market),null);
  assert.equal(leadSignal(board(2,0,"85'",'1st'),market),null);
  assert.equal(leadSignal(board(2,0,"85'"),{...market,rules_primary:'Includes extra time and penalty shootouts.'}),null);
  const finalSeconds=(remaining)=>gameState(m,{details:{status:'live',home_same_game_score:2,away_same_game_score:1,time:'89:30',half:'2nd',match_remaining_seconds:remaining}});
  assert.equal(leadSignal(finalSeconds(44),market),null);
  assert.equal(leadSignal(finalSeconds(45),market),null);
  assert.equal(leadSignal(board(2,1,"89:30"),market),null);
});
test('regulation soccer totals reject extra-time goals even when live feed says in progress',()=>{
  const m={id:'cup',title:'Castellonense vs Almeria',type:'soccer_tournament_multi_leg'};
  const market={status:'active',event_ticker:'KXCOPADELREYTOTAL-26OCT27CASALM',title:'Will over 1.5 goals be scored?',yes_sub_title:'Reg Time: Over 1.5 goals scored',rules_primary:'If over 1.5 goals are scored after 90 minutes plus stoppage time (does not include extra time or penalties), then Yes.',floor_strike:1.5,strike_type:'greater',yes_ask_dollars:'0.0100'};
  const game=(time,match_status,price=market.yes_ask_dollars)=>gameState(m,{details:{status:'inprogress',time,half:'2nd',match_status,home_same_game_score:1,away_same_game_score:2,home_regulation_score:0,away_regulation_score:0,period_scores:[{type:match_status==='aet'?'overtime':'regular_period'}]}});
  assert.equal(overSignal(game("110'",'aet'),market),null);
  assert.equal(overSignal(game("89'",'aet'),{...market,yes_ask_dollars:'0.98'}),null);
  assert.equal(overSignal(game("90+4'",'live'),{...market,yes_ask_dollars:'0.98'}),null);
  assert.equal(overSignal(game("88'",'live'),market),null);
  assert.equal(overSignal(game("88'",'live'),{...market,yes_ask_dollars:'0.98'}),null,'conflicting regulation score');
  const consistent=gameState(m,{details:{status:'inprogress',time:"88'",half:'2nd',home_same_game_score:1,away_same_game_score:2,home_regulation_score:1,away_regulation_score:2}});
  assert.equal(overSignal(consistent,{...market,yes_ask_dollars:'0.98'})?.fraction,.30);
  assert.equal(overSignal(game("88'",'live'),{...market,yes_ask_dollars:'0.98',result:'no'}),null);
});
test('tennis match winner requires clinching set, two-game lead, server and point score',()=>{
  const m={id:'tennis',title:'Hurkacz vs Bergs',type:'tennis_tournament_singles',details:{best_of:'3',first_competitor_id:'H',second_competitor_id:'B',main_game_event_ticker:'KXATPMATCH-26OCT26HURBER'}};
  const market={status:'active',event_ticker:'KXATPMATCH-26OCT26HURBER',title:'Hubert Hurkacz wins',rules_primary:'If Hubert Hurkacz wins the tennis match after a ball has been played, Yes.',custom_strike:{tennis_competitor:'H'}};
  const live=(games=3,sets=1,server='H',p1=30,p2=15,best='3')=>gameState({...m,details:{...m.details,best_of:best}},{details:{status:'live',competitor1_is_home:true,competitor1_round_scores:[{outcome:'winner',score:6},{outcome:'ongoing',score:5}],competitor2_round_scores:[{outcome:'loser',score:3},{outcome:'ongoing',score:games}],competitor1_overall_score:sets,competitor2_overall_score:0,competitor1_current_round_score:p1,competitor2_current_round_score:p2,server,advantage:''}});
  assert.equal(tennisSignal(live(),market),null);
  assert.equal(tennisSignal(live(2),market)?.fraction,.15);
  assert.equal(tennisSignal(live(1),market)?.fraction,.15);
  assert.equal(tennisSignal(live(1,1,'H',40,15),market)?.fraction,.15);
  assert.equal(tennisSignal(live(4),market),null);
  assert.equal(tennisSignal(live(3,0),market),null);
  assert.equal(tennisSignal(live(3,2,'H',30,15,'5'),market),null);
  assert.equal(tennisSignal(live(2,2,'H',30,15,'5'),market)?.fraction,.15);
  assert.equal(tennisSignal(live(3,1,'H',30,15,'5'),market),null);
  assert.equal(tennisSignal(live(3,1,'B',30,40),market),null);
  assert.equal(tennisSignal(live(3,1,'H',15,40),market),null);
  assert.equal(tennisSignal(live(3,1,'unknown'),market),null);
  assert.equal(tennisSignal(live(),{...market,event_ticker:'KXATPSETWINNER-2'}),null);
});
test('hockey requires three goals at 6:30 or less in final period',()=>{
  const hockey={...milestone,type:'hockey_match',details:{league:'NHL'}};
  const market={status:'active',title:'New York wins',yes_sub_title:'New York'};
  const at=(home,away,period,clock)=>({details:{...live(home,away,period).details,clock,puck_possession:'home'}});
  assert.equal(leadSignal(gameState(hockey,at(3,1,3,'04:59')),market),null);
  assert.equal(leadSignal(gameState(hockey,at(4,1,3,'04:59')),market)?.fraction,.15);
  assert.equal(leadSignal(gameState(hockey,at(3,0,3,'06:31')),market),null);
  assert.equal(leadSignal(gameState(hockey,at(3,0,3,'06:30')),market)?.fraction,.15);
  assert.equal(leadSignal(gameState(hockey,{details:{...at(3,0,3,'06:30').details,puck_possession:undefined}}),market)?.fraction,.15);
  assert.equal(leadSignal(gameState(hockey,at(3,0,3,'05:00')),market)?.fraction,.15);
  assert.equal(leadSignal(gameState(hockey,at(5,0,3,'02:30')),market)?.fraction,.15);
  assert.equal(leadSignal(gameState(hockey,at(5,0,3,'00:29')),market)?.fraction,.15);
  assert.equal(leadSignal(gameState(hockey,at(3,1,3,'06:59')),market),null);
  assert.equal(leadSignal(gameState(hockey,at(3,1,3,'05:00')),market),null);
  assert.equal(leadSignal(gameState(hockey,at(3,1,3,'03:59')),market),null);
  assert.equal(leadSignal(gameState(hockey,at(3,0,3,'07:00')),market),null);
  assert.equal(leadSignal(gameState(hockey,at(3,0,3,'07:01')),market),null);
  assert.equal(leadSignal(gameState(hockey,at(3,0,2,'06:59')),market),null);
  assert.equal(leadSignal(gameState(hockey,at(2,0,3,'04:59')),market),null);
  assert.equal(leadSignal(gameState(hockey,at(2,1,3,'04:59')),market),null);
  assert.equal(leadSignal(gameState(hockey,at(3,1,2,'04:59')),market),null);
  assert.equal(leadSignal(gameState(hockey,at(3,1,3,'05:00')),market),null);
});
test('basketball requires a five point lead in the last minute with a fifteen percent cap',()=>{
  const market={status:'active',title:'New York wins',yes_sub_title:'New York'};
  for(const league of ['NBA','WNBA','Basketball','NCAAMB','NCAAW']){
    const m={...milestone,details:{league}};
    const last=/NCAA/.test(league)?2:4;
    const at=(lead,clock,period=last)=>gameState(m,{details:{...live(100+lead,100,period).details,clock}});
    assert.equal(leadSignal(at(5,'01:01'),market),null);
    assert.equal(leadSignal(at(4,'00:59'),market),null);
    assert.equal(leadSignal(at(5,'01:00'),market)?.fraction,.15);
    assert.equal(leadSignal(at(10,'00:20'),market)?.fraction,.15);
    assert.equal(leadSignal(at(20,'00:00'),market),null);
    assert.equal(leadSignal(at(8,'00:19',last-1),market),null);
    const conflicting=gameState(m,{details:{...live(108,100,last).details,clock:'00:17',period_display:`Q${last-1}`}});
    assert.equal(conflicting.periodConsistent,false);
    assert.equal(leadSignal(conflicting,market),null);
    const numericConflict=gameState(m,{details:{...live(108,100,last).details,period:last-1,clock:'00:17'}});
    assert.equal(numericConflict.periodConsistent,false);
    assert.equal(leadSignal(numericConflict,market),null);
  }
});
test('football needs a ten point lead in the final seven minutes',()=>{
  const m={...milestone,type:'football_game',details:{league:'NFL'}};
  const market={status:'active',title:'New York wins',yes_sub_title:'New York'};
  const board={details:{...live(24,14).details,clock:'04:00'}};
  assert.equal(leadSignal(gameState(m,board),market)?.fraction,.15);
  board.details.home_score=24;board.details.away_score=15;
  assert.equal(leadSignal(gameState(m,board),market),null);
  board.details.home_score=25;board.details.away_score=14;
  assert.equal(leadSignal(gameState(m,board),market)?.fraction,.15);
  board.details.home_score=100;board.details.away_score=90;
  assert.equal(leadSignal(gameState(m,board),market)?.fraction,.15);
  board.details.home_score=10;board.details.away_score=0;
  assert.equal(leadSignal(gameState(m,board),market)?.fraction,.15);
  board.details.home_score=24;board.details.away_score=14;board.details.clock='07:00';
  assert.equal(leadSignal(gameState(m,board),market),null);
  board.details.clock='04:00';board.details.quarter=3;
  assert.equal(leadSignal(gameState(m,board),market),null);
  const identified={...m,details:{...m.details,home_team_id:'NY',away_team_id:'BOS'}};
  const play={...live(24,14).details,clock:'04:00',possession:undefined,situation:{possession_team_id:'NY'}};
  assert.equal(leadSignal(gameState(identified,{details:play}),market)?.fraction,.15);
  play.situation.possession_team_id='BOS';
  assert.equal(leadSignal(gameState(identified,{details:play}),market),null);
});
test('quantity preflights cash, allocation, fees, price and displayed liquidity',()=>{
  const count=orderSize(10000,'0.50','400',.8);
  assert.ok(count>149&&count<150);
  assert.equal(orderSize(10000,'0.50','10',.8),10);
  assert.ok(orderSize(10000,'0.99','400',.8)>=80);
  assert.ok(estimatedCostCents(orderSize(10000,'0.90','400',.10,1,10000),.90)<=1000);
  assert.equal(orderSize(10000,'0.50',undefined,.8),0);
  assert.ok(orderSize(10000,'0.50','400',.2,1,20000)<orderSize(10000,'0.50','400',.3,1,20000));
  assert.ok(orderSize(2000,'0.50','400',.3,1,20000)<orderSize(10000,'0.50','400',.3,1,20000));
  assert.equal(orderSize(10000,'0.50','0.37',.8),.37);
  assert.equal(orderSize(1,'0.50','0.37',1),0);
  assert.ok(orderSize(99,'0.99','10',1)>0);
  assert.equal(orderSize(54,'0.50','10',1,1,54,Infinity,4),0.94);
  assert.ok(orderSize(10000,'0.50','400',.8,1,10000,1000)<count);
  assert.equal(orderSize(10000,'0.50','400',.8,.98),count);
  assert.equal(orderSize(10000,'0.99','400',.8,.98),0);
  assert.ok(estimatedCostCents(count,.5)<=8000);
  assert.ok(estimatedCostCents(count+.01,.5)>8000);
  assert.ok(estimatedCostCents(orderSize(10000,'.95','1000',.9),.95)<=9000);
  assert.ok(estimatedCostCents(orderSize(10000,'.95','1000',.15),.95)<=1500);
  assert.ok(estimatedCostCents(orderSize(10000,'.95','1000',.25),.95)<=2500);
});
test('over allocation is a per-trade cap independent of existing positions',()=>{
  assert.equal(overBudget(10000,0,0),3000);
  assert.equal(overBudget(2000,8000,8000),3000);
  assert.equal(overBudget(6000,4000,3000),3000);
  assert.equal(overBudget(10000,0,9000),3000);
});
test('entry submissions and recovery use full fills while exits cannot target overs',()=>{
  const source=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
  assert.equal((source.match(/side:'bid'[^\n]+time_in_force:'fill_or_kill'/g)||[]).length,2);
  assert.match(source,/if\(original\?\.strategy!=='lead'\|\|\/TOTAL\/i\.test\(position\.ticker\)\)continue/);
  assert.match(source,/const combo=Array\.isArray\(original\.combo_legs\)&&original\.combo_legs\.length>=2;\s*if\(combo\)continue;/);
  assert.match(source,/if\(live\(\)\|\|exitOnly\(\)\)await exitComebacks/);
  assert.match(source,/for\(const c of opportunities\)[^]*?if\(!live\(\)\)continue/);
  assert.match(source,/if\(a\.signal\.strategy!==b\.signal\.strategy\)return a\.signal\.strategy==='over'\?-1:1/);
  assert.match(source,/return profit\(b\)-profit\(a\)/);
});
test('zero score never creates an over; overs need only positive net profit',()=>{
  const market={status:'active',title:'Total goals over 0',rules_primary:'Combined total goals scored in the game',strike_type:'greater',floor_strike:-0.5};
  const soccer={...milestone,type:'soccer_tournament_multi_leg'};
  assert.equal(overSignal(gameState(soccer,{details:{status:'live',home_score:0,away_score:0}}),market),null);
  for(const strategy of ['lead']){
    for(const cash of [9900,9999])assert.equal(minimumProfitCents(strategy,cash),25);
    assert.equal(minimumProfitCents(strategy,10000),50);
    assert.equal(minimumProfitCents(strategy,20000),200);
  }
  for(const cash of [9900,10000,20000])assert.equal(minimumProfitCents('over',cash),1);
  assert.equal(profitableCount(10,.99,2,'over',9900),10);
  assert.equal(profitableCount(10,.99,2,'over',20000),10);
  assert.equal(profitableCount(1,.99,2,'over',9900),0);
  assert.equal(profitableCount(100,.99,2,'over',9900),100);
  assert.equal(profitableCount(100,.90,2,'over',9900),100);
  assert.ok(netSettlementProfitCents(100,.99,2)>0);
  assert.equal(profitableCount(1,1,2,'lead',100),0);
  assert.equal(profitableCount(1,.90,2,'lead',20000,'basketball_game',299),0);
  assert.equal(profitableCount(1,.90,2,'lead',20000,'football_game'),0);
  assert.equal(profitableCount(1,.99,2,'lead',20000,'basketball_game',20),0);
});
test('basketball and other sports share the dynamic net floor',()=>{
  for(const type of ['basketball_game','college_basketball_game']){
    for(const seconds of [300,181,180,61,60,30,1,0])assert.equal(minimumProfitCents('lead',20000,type,seconds),200);
    assert.equal(profitableCount(12,.90,2,'lead',20000,type,299),0);
    assert.equal(profitableCount(6,.90,2,'lead',20000,type,61),0);
    assert.equal(profitableCount(6,.90,2,'lead',20000,type,60),0);
    assert.equal(profitableCount(3,.90,2,'lead',20000,type,31),0);
    assert.equal(profitableCount(3,.90,2,'lead',20000,type,30),0);
    assert.equal(profitableCount(3,.99,2,'lead',20000,type,20),0);
  }
  assert.equal(minimumProfitCents('lead',20000,'football_game',30),200);
  assert.equal(minimumProfitCents('over',20000,'basketball_game',30),1);
});
test('late lead respects the 15 percent cap; ties alone do not trigger an exit',()=>{
  const m={...milestone,type:'football_game',details:{league:'NFL',home_team_id:'NY',away_team_id:'BOS'}};
  const market={status:'active',title:'New York wins',yes_sub_title:'New York',custom_strike:{football_team:'NY'}};
  const at=(home,away,clock)=>gameState(m,{details:{...live(home,away).details,clock}});
  assert.equal(leadSignal(at(24,14,'02:30'),market)?.fraction,.15);
  assert.equal(leadSignal(at(25,10,'00:30'),market)?.fraction,.15);
  assert.equal(leadSignal(at(24,14,'00:30'),market)?.fraction,.15);
  assert.equal(comeback(at(24,14,'02:30'),market,'lead'),false);
  assert.equal(comeback(at(24,24,'02:00'),market,'lead'),false);
  assert.equal(comeback(at(24,25,'01:00'),market,'lead'),true);
  assert.equal(comeback(at(24,25,'01:00'),{floor_strike:20},'over'),false);
  const tennis={...milestone,type:'tennis_tournament_singles',details:{best_of:3,first_competitor_id:'A',second_competitor_id:'B'}};
  const tennisState=(a,b)=>gameState(tennis,{details:{status:'live',competitor1_round_scores:[{score:a}],competitor2_round_scores:[{score:b}]}});
  assert.equal(comeback(tennisState(5,5),{custom_strike:{tennis_competitor:'A'}},'lead'),false);
  const point=(a,b,firstPoints,secondPoints,server='B')=>gameState(tennis,{details:{status:'live',competitor1_round_scores:[{score:a}],competitor2_round_scores:[{score:b}],competitor1_current_round_score:firstPoints,competitor2_current_round_score:secondPoints,server}});
  assert.equal(comeback(point(5,6,15,30),{custom_strike:{tennis_competitor:'A'}},'lead'),false);
  assert.equal(comeback(point(5,6,15,40),{custom_strike:{tennis_competitor:'A'}},'lead'),true);
});

