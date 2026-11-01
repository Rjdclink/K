import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gameState,overSignal,singleReadCushionedOver,confirmedOver,kalshiOnlyOver,kalshiOnlyLead,fallbackOverFraction,fallbackLeadFraction,confirmedExternalLead,leadSignal,earlyLeadSignal,leadWatchReason,confirmedSoccerWinnerClock,soccerWinnerWindowOpen,soccerOverStable,soccerOverWaitMs,externallyVerifiedEarlySoccerLead,tennisSignal,tableTennisSignal,orderSize,estimatedCostCents,overBudget,minimumProfitCents,netSettlementProfitCents,profitableCount,timedProfitExitAllowed,comeback,KALSHI_ONLY_FRACTION} from '../src/strategy.mjs';

test('each trade has its own percentage of the full bankroll',()=>{
  const bankroll=14600,alreadyHeld=4372;
  assert.equal(overBudget(10228,alreadyHeld,alreadyHeld),1460);
  assert.equal(overBudget(10228,alreadyHeld,alreadyHeld),overBudget(10228,alreadyHeld,0));
  assert.ok(orderSize(10228,'.98','1000',.10,1,bankroll,1460,2)>10);
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

test('late baseball commanding leads enter the fast watch before the winner window',()=>{
  const m={id:'baseball',type:'baseball_game',title:'Away at Home',details:{league:'MLB'}};
  const state=(inning,half,outs,home,away)=>gameState(m,{milestone_id:m.id,details:{status:'live',inning,inning_half:half,outs,home_score:home,away_score:away}});
  assert.match(leadWatchReason(state(8,'bottom',1,8,3)),/late-inning winner market/);
  assert.equal(leadWatchReason(state(8,'bottom',1,7,3)),null);
  assert.equal(leadWatchReason(state(9,'top',1,8,4)),null);
  assert.equal(leadWatchReason(state(8,'top',2,8,3)),null);
});

test('table tennis lead fallback verifies two live scores without using a clock',()=>{
  const m={id:'liga-clockless',type:'table_tennis_match',title:'Oleg Moshnikov vs Iurii Krivenkii',details:{league:'Russia Liga Pro',best_of:5,first_competitor_id:'oleg',second_competitor_id:'iurii'}};
  const market={event_ticker:'KXLIGAPROMATCH-DATE',status:'active',title:'Oleg Moshnikov',yes_sub_title:'Oleg Moshnikov',custom_strike:{table_tennis_competitor:'oleg'},yes_ask_dollars:'0.93'};
  const now=Date.now();
  const state=(at,updated,clock,points=10)=>gameState(m,{milestone_id:m.id,_observed_at:new Date(at).toISOString(),details:{status:'live',last_updated_ts:updated/1000,competitor1_overall_score:2,competitor2_overall_score:2,period_remaining_time:clock,period_scores:[{type:'set',number:5,competitor1_score:points,competitor2_score:4}]}});
  const first=state(now-12000,now-13000,'00:10'),second=state(now,now-1000,'00:11');
  assert.equal(kalshiOnlyLead(first,second,market),true,'an incidental clock increase cannot veto a table tennis score');
  assert.equal(kalshiOnlyLead(state(now-12000,now-13000,''),state(now,now-1000,''),market),true,'no clock is accepted');
  assert.equal(kalshiOnlyLead(state(now-12000,NaN,''),state(now,NaN,''),market),true,'the clockless fallback accepts two reads when both update timestamps are absent');
  assert.equal(kalshiOnlyLead(first,state(now,now-1000,'00:11',9),market),false,'changed points still fail');
  assert.equal(kalshiOnlyLead(first,state(now-3000,now-4000,'00:11'),market),false,'ten-second dwell remains mandatory');
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
  assert.equal(overSignal(g,market),null);assert.equal(overSignal(gameState(milestone,live(103,101)),market)?.fraction,.10);
  assert.ok(overSignal(gameState(milestone,live(103,101,3)),market));
  assert.ok(overSignal(gameState(milestone,{details:{...live(103,101).details,clock:'03:01'}}),market));
  assert.equal(overSignal(gameState(milestone,live(103,101)),{...market,title:'First half total points'}),null);
});
test('a whole-game over gets 40% only when removing the independently recorded last play leaves it crossed',()=>{
  const market={status:'active',event_ticker:'KXNBATOTAL-26OCT30BOSNYK',title:'Over 139.5 total points',rules_primary:'Combined total points scored in the full game',floor_strike:139.5,strike_type:'greater',yes_ask_dollars:'0.98'};
  assert.equal(overSignal(gameState(milestone,live(81,88)),market)?.fraction,.10,'a large margin does not substitute for the actual last play');
  assert.equal(overSignal({...gameState(milestone,live(81,88)),lastScoringPlay:3},market)?.fraction,.40);
  assert.equal(overSignal({...gameState(milestone,live(74,71)),lastScoringPlay:6},market)?.fraction,.10);
  assert.equal(overSignal({...gameState(milestone,live(74,72)),lastScoringPlay:2},market)?.fraction,.40);
  const soccer={id:'s',type:'soccer_match',title:'Home vs Away'};
  const soccerMarket={...market,event_ticker:'KXSOCCERTOTAL-26OCT30HOMEAWAY',title:'Over 0.5 total goals',floor_strike:.5};
  const score=(home,away)=>gameState(soccer,{details:{status:'live',home_score:home,away_score:away,time:"65'"}});
  assert.equal(overSignal(score(1,0),soccerMarket)?.fraction,.10);
  assert.equal(overSignal({...score(2,0),lastScoringPlay:1},soccerMarket)?.fraction,.40);
  const player={...market,event_ticker:'KXNBAPTS-26OCT30BOSNYK',title:'Player: 20+ points',yes_sub_title:'Player: 20+',floor_strike:19.5,custom_strike:{basketball_player:'p'}};
  assert.equal(overSignal(gameState({...milestone,details:{...milestone.details,home_team_id:'ny',away_team_id:'bos'}},{details:{...live(81,88).details,player_stats:{p:{points:30}}}}),player)?.fraction,.40);
  assert.equal(overSignal({...gameState({...milestone,details:{...milestone.details,home_team_id:'ny',away_team_id:'bos'}},{details:{...live(81,88).details,player_stats:{p:{points:30}}}}),lastScoringPlay:3},player)?.fraction,.40,
    'the extra player statistic, not the whole-game scoring play, sets this cap');
});
test('one fresh Kalshi score admits only a crossed over with a conservative cushion',()=>{
  const now=Date.now();
  const market={status:'active',event_ticker:'KXNBATOTAL-TEST',title:'Over 139.5 total points',
    rules_primary:'Combined total points scored in the full game',floor_strike:139.5,
    strike_type:'greater',yes_ask_dollars:'0.98'};
  const state=(home,away)=>gameState(milestone,{milestone_id:milestone.id,_observed_at:new Date(now).toISOString(),
    details:{...live(home,away).details,last_updated_ts:Math.floor((now-1000)/1000)}});
  assert.equal(singleReadCushionedOver(state(74,69),market,now),null,'one four-point play could undo this over');
  assert.equal(singleReadCushionedOver(state(74,70),market,now)?.fraction,.40);
  assert.equal(singleReadCushionedOver(state(74,70),market,now+10001),null);
  assert.equal(singleReadCushionedOver({...state(74,70),feedId:'wrong'},market,now),null);
  assert.equal(singleReadCushionedOver({...state(74,70),updatedAt:now-32000},market,now),null);
  const player={ticker:'KXNBASTL-TEST',status:'active',event_ticker:'KXNBASTL-TEST',
    title:'Pat Player: 2+ steals',yes_sub_title:'Pat Player: 2+',floor_strike:1.5,
    custom_strike:{basketball_player:'pat'},yes_ask_dollars:'.95'};
  const prop=steals=>({...state(74,71),playerStats:{pat:{steals}},playerPropFirstCrossedAt:{}});
  assert.equal(singleReadCushionedOver(prop(3),player,now)?.fraction,.40);
  assert.equal(singleReadCushionedOver(prop(2),player,now),null);
  const points={...player,event_ticker:'KXNBAPTS-TEST',title:'Pat Player: 20+ points',
    yes_sub_title:'Pat Player: 20+',floor_strike:19.5};
  const pointProp=value=>({...prop(3),playerStats:{pat:{points:value}}});
  assert.equal(singleReadCushionedOver(pointProp(23),points,now),null);
  assert.equal(singleReadCushionedOver(pointProp(24),points,now)?.fraction,.40,
    'basketball points use a four-point correction');
  const yardage={...player,event_ticker:'KXNFLPASSYDS-TEST',title:'Pat Player: 200+ passing yards',
    yes_sub_title:'Pat Player: 200+',floor_strike:199.5,
    custom_strike:{football_player:'pat'}};
  const football={...prop(3),type:'football_game',playerStats:{pat:{passing_yards:240}}};
  assert.equal(singleReadCushionedOver(football,yardage,now),null,'a single play can change many yards');

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
  assert.equal(confirmedOver(sample(1,0,now-4000,now-5000),sample(1,0,now-2000,now-3000),market),false,'less than ten seconds between reads');
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
test('Kalshi-only game total checks two reads ten seconds apart, including feeds without update timestamps',()=>{
  const m={id:'kbo',title:'Kia Tigers vs Samsung Lions',type:'baseball_game',details:{league:'Korea KBO'}};
  const market={status:'active',event_ticker:'KXKBOTOTAL-26OCT30KIASAM',title:'Over 9.5 runs scored?',rules_primary:'The teams collectively score more than 9.5 runs',floor_strike:9.5,strike_type:'greater'};
  const now=Date.now();
  const state=(observed,updated,home=11)=>gameState(m,{milestone_id:m.id,_observed_at:new Date(observed).toISOString(),details:{status:'live',home_score:home,away_score:3,inning:9,last_updated_ts:updated/1000}});
  const first=state(now-12000,now-13000),second=state(now,now-1000);
  assert.equal(kalshiOnlyOver(first,second,market),true);
  assert.equal(fallbackOverFraction(second,market),.05);
  assert.equal(fallbackOverFraction(state(now,now-1000,15),market),.10);
  assert.equal(fallbackOverFraction(state(now,now-1000,19),market),.10);
  assert.equal(fallbackOverFraction(state(now,now-1000,10),market),null);
  assert.equal(kalshiOnlyOver(first,state(now-3000,now-4000),market),false);
  assert.equal(kalshiOnlyOver(first,state(now,now-13000),market),false);
  assert.equal(kalshiOnlyOver(first,state(now,NaN),market),false);
  const noTimestamp=at=>gameState(m,{milestone_id:m.id,_observed_at:new Date(at).toISOString(),details:{status:'live',home_score:11,away_score:3,inning:9}});
  assert.equal(kalshiOnlyOver(noTimestamp(now-12000),noTimestamp(now),market),true);
  assert.equal(kalshiOnlyOver(noTimestamp(now-3000),noTimestamp(now),market),false);
  assert.equal(kalshiOnlyOver(noTimestamp(now-12000),second,market),false,'mixed timestamp availability fails closed');
  assert.equal(kalshiOnlyOver(noTimestamp(now-12000),{...noTimestamp(now),verifiedLive:false},market),false);
  assert.equal(kalshiOnlyOver(first,state(now,now-1000,6),market),false);
  assert.equal(kalshiOnlyOver(first,second,{...market,custom_strike:{baseball_player:'player'}}),false);
  assert.equal(kalshiOnlyOver(first,second,{...market,event_ticker:'KXKBOGAME-26OCT30KIASAM'}),false);
  assert.equal(kalshiOnlyOver(first,second,{...market,event_ticker:'KXKBO1INNINGTOTAL-26OCT30KIASAM'}),false);
  const bankroll=15000,count=orderSize(10000,'.94','100',KALSHI_ONLY_FRACTION,1,bankroll,Infinity,2);
  assert.equal(KALSHI_ONLY_FRACTION,.10);
  assert.ok(count>orderSize(10000,'.94','100',.05,1,bankroll,Infinity,2));
  assert.ok(estimatedCostCents(count,.94,2)<=bankroll*.10,'fallback including fees is capped at ten percent of the full bankroll');
});
test('a crossed player prop cannot use the Kalshi-only over fallback',()=>{
  const m={id:'nba-prop',title:'New York Knicks at Chicago Bulls',type:'basketball_game',details:{home_team_id:'chi',away_team_id:'nyk'}};
  const market={status:'active',event_ticker:'KXNBAREB-26OCT30NYKCHI',title:'Matas Buzelis: 6+ rebounds',yes_sub_title:'Matas Buzelis: 6+',floor_strike:5.5,strike_type:'greater',custom_strike:{basketball_player:'buzelis'},yes_ask_dollars:'0.91'};
  const now=Date.now();
  const state=(at,updated,rebounds)=>gameState(m,{milestone_id:m.id,_observed_at:new Date(at).toISOString(),details:{status:'live',home_score:127,away_score:133,quarter:4,last_updated_ts:updated/1000,player_stats:{buzelis:{rebounds}}}});
  const first=state(now-12000,now-13000,6),second=state(now,now-1000,6);
  assert.equal(kalshiOnlyOver(first,second,market),false,'an independent player statistic is required');
  assert.equal(kalshiOnlyOver(first,state(now,now-1000,7),market),false);
  assert.equal(kalshiOnlyOver(first,state(now,now-13000,6),market),false);
  assert.equal(kalshiOnlyOver(first,second,{...market,custom_strike:{basketball_player:'someone_else'}}),false);
  assert.equal(kalshiOnlyOver(first,second,{...market,event_ticker:'KXNBAGAME-26OCT30NYKCHI'}),false);
});
test('independently checked crossed overs use two fresh exchange reads without a timed dwell across sports',()=>{
  const at=Date.now();
  for(const [type,title,event,strike,details] of [
    ['soccer_tournament_multi_leg','Alpha vs Beta','KXSGPPLTOTAL-26OCT31ALPBET',1.5,{half:'2nd',time:"85'"}],
    ['basketball_game','Alpha vs Beta','KXNBATOTAL-TEST',169.5,{quarter:4,clock:'00:20'}]
  ]){
    const milestone={id:`fast-${type}`,type,title,details:{league:'Test'}};
    const market={status:'active',event_ticker:event,title:`Over ${strike} ${strike===1.5?'goals':'points'} scored`,rules_primary:`Total ${strike===1.5?'goals':'points'} scored in regulation`,floor_strike:strike,strike_type:'greater',yes_ask_dollars:'0.95'};
    const score=strike===1.5?[2,1]:[92,85];
    const state=(time,home=score[0])=>gameState(milestone,{milestone_id:milestone.id,_observed_at:new Date(time).toISOString(),details:{status:'live',home_score:home,away_score:score[1],...details}});
    const first=state(at-500),second=state(at);
    assert.ok(overSignal(first,market),type);
    assert.equal(confirmedOver(first,second,market,0),true,type);
    assert.equal(confirmedOver(first,second,market),false,type);
    assert.equal(confirmedOver(first,state(at,score[0]-2),market,0),false,type);
  }
});
test('esports game overs use verified period totals and a newer ten-second Kalshi update without a clock',()=>{
  const m={id:'esoc',type:'esports_match',title:'Fede vs Eder',details:{league:'eSoccer'}};
  const market={status:'active',event_ticker:'KXESOCCTOTAL-26OCT30FEDEDER',title:'Over 5.5 total goals',rules_primary:'The teams score over 5.5 total goals in the full match.',floor_strike:5.5,strike_type:'greater',yes_ask_dollars:'0.95'};
  const now=Date.now();
  const state=(at,updated,home=4)=>gameState(m,{milestone_id:m.id,_observed_at:new Date(at).toISOString(),details:{status:'live',home_score:home,away_score:3,period_unit:'half',home_periods:{period_1:2,period_2:2},away_periods:{period_1:1,period_2:2},last_updated_ts:updated/1000}});
  const first=state(now-12000,now-13000),second=state(now,now-1000);
  assert.ok(overSignal(first,market));
  assert.equal(kalshiOnlyOver(first,second,market),true);
  assert.equal(kalshiOnlyOver(first,state(now,now-1000,5),market),false);
  assert.equal(kalshiOnlyOver(first,second,{...market,event_ticker:'KXESOCC1HTOTAL-26OCT30FEDEDER'}),false);
  assert.equal(overSignal(first,{...market,title:'Over 8.5 total goals',floor_strike:8.5}),null);
  assert.equal(overSignal(gameState({...m,details:{league:'unrecognized'}},{milestone_id:m.id,details:{status:'live',home_score:4,away_score:3,period_unit:'half',home_periods:{period_1:2,period_2:2},away_periods:{period_1:1,period_2:2}}}),market),null);
});
test('limited-over cricket team run totals need exact team, crossed line, and two newer updates ten seconds apart',()=>{
  const m={id:'ipl',type:'cricket_match',title:'Ajman vs Abu Dhabi',details:{league:'Emirates D20',home_team_id:'ajman-id',away_team_id:'abu-id'}};
  const market={status:'active',event_ticker:'KXIPLTEAMTOTAL-26OCT30AJMABU',title:'Ajman over 149.5 runs scored',yes_sub_title:'Ajman over 149.5 runs scored',rules_primary:'Ajman scores more than 149.5 runs in the professional cricket match.',floor_strike:149.5,strike_type:'greater',custom_strike:{cricket_team:'ajman-id'},yes_ask_dollars:'0.94'};
  const now=Date.now();
  const state=(at,updated,home=170,away=0)=>gameState(m,{milestone_id:m.id,_observed_at:new Date(at).toISOString(),details:{status:'live',home_score:home,away_score:away,inning:1,home_team_name:'Ajman',away_team_name:'Abu Dhabi',last_updated_ts:updated/1000}});
  const first=state(now-12000,now-13000),second=state(now,now-1000,171);
  assert.equal(overSignal(first,market)?.fraction,.05);
  assert.equal(overSignal(first,{...market,yes_sub_title:'Over 149.5 runs scored'})?.fraction,.05);
  assert.equal(kalshiOnlyOver(first,second,market),false,'a cricket delivery has no safe upper bound without a play record');
  assert.equal(kalshiOnlyOver(first,state(now-4000,now-1000,171),market),false);
  assert.equal(kalshiOnlyOver(first,state(now,now-13000,171),market),false);
  assert.equal(kalshiOnlyOver(first,state(now,now-1000,169),market),false);
  assert.equal(overSignal(first,{...market,title:'Abu Dhabi over 149.5 runs scored',yes_sub_title:'Abu Dhabi over 149.5 runs scored'}),null);
  assert.equal(overSignal(first,{...market,custom_strike:{cricket_team:'abu-id'}}),null);
  assert.equal(overSignal(first,{...market,rules_primary:'Ajman scores over 149.5 runs in the first innings.'}),null);
  assert.equal(overSignal(first,{...market,custom_strike:{},rules_primary:'Abu Dhabi scores more than 149.5 runs.'}),null);
  assert.equal(overSignal({...first,period:3},market),null);
  assert.equal(overSignal({...first,competition:'Sheffield Shield'},market),null);
  assert.ok(orderSize(10000,'.94','100',.05,1,15000,Infinity,2)<=8);
});
test('Kalshi whole-game over wording is recognized after the line is crossed',()=>{
  const m={id:'kbo-game',title:'Kia Tigers vs Samsung Lions',type:'baseball_game',details:{league:'Korea KBO'}};
  const g=gameState(m,{details:{status:'inprogress',away_points:3,home_points:8,inning:9}});
  const market={status:'active',event_ticker:'KXKBOTOTAL-26OCT27KIASAM',title:'Over 9.5 runs scored?',yes_sub_title:'Over 9.5 runs scored',rules_primary:'If the teams collectively score more than 9.5 runs in the KBO game, the market resolves to Yes.',strike_type:'greater',floor_strike:9.5};
  assert.equal(overSignal(g,market)?.fraction,.10);
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
test('a crossed player statistic is a timed candidate; one extra unit keeps the higher allocation',()=>{
  const m={id:'nba',title:'New York Knicks at Chicago Bulls',type:'basketball_game',details:{home_team_id:'chi',away_team_id:'nyk'}};
  const market={status:'active',event_ticker:'KXNBAREB-26OCT28NYKCHI',title:'Matas Buzelis: 6+ rebounds',yes_sub_title:'Matas Buzelis: 6+',floor_strike:5.5,strike_type:'greater',custom_strike:{basketball_player:'buzelis'},yes_ask_dollars:'0.81'};
  const state=rebounds=>gameState(m,{details:{status:'live',home_score:127,away_score:133,quarter:4,player_stats:{buzelis:{rebounds}}}});
  assert.equal(overSignal(state(5),market),null);
  assert.equal(overSignal(state(6),market)?.fraction,.10);
  assert.equal(overSignal(state(7),market)?.strategy,'over');
  const three={...market,event_ticker:'KXNBA3PT-26OCT28NYKCHI',title:'Matas Buzelis: 1+ threes',yes_sub_title:'Matas Buzelis: 1+',floor_strike:.5};
  const shots=n=>gameState(m,{details:{status:'live',home_score:127,away_score:133,quarter:4,player_stats:{buzelis:{three_points_made:n}}}});
  assert.equal(overSignal(shots(1),three)?.fraction,.10);
  assert.equal(overSignal(shots(2),three)?.strategy,'over');
  const steals={...market,event_ticker:'KXNBASTL-26OCT28NYKCHI',title:'Matas Buzelis: 2+ steals',yes_sub_title:'Matas Buzelis: 2+',floor_strike:1.5};
  const defense=n=>gameState(m,{details:{status:'live',home_score:127,away_score:133,quarter:4,player_stats:{buzelis:{steals:n}}}});
  assert.equal(overSignal(defense(2),steals)?.fraction,.10);
  assert.equal(overSignal(defense(3),steals)?.strategy,'over');
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
test('a soccer over waits ten seconds within the current scan before fresh score checks',()=>{
  const now=Date.now();
  assert.equal(soccerOverStable(null,now),false);
  assert.equal(soccerOverWaitMs(null,now),Infinity);
  assert.equal(soccerOverWaitMs(new Date(now-9999),now),1);
  assert.equal(soccerOverStable(new Date(now-9999),now),false);
  assert.equal(soccerOverStable(new Date(now-10000),now),true);
});
test('two Kalshi-only soccer goal reads cannot confirm an over after a reversible score',()=>{
  const m={id:'hou-ygl',title:'Hougang United vs Young Lions',type:'soccer_tournament_multi_leg',
    details:{league:'Singapore Premier League'}};
  const market={status:'active',event_ticker:'KXSGPPLTOTAL-26OCT31HOUYGL',title:'Over 1.5 goals',
    rules_primary:'Total goals scored in regulation',floor_strike:1.5,yes_ask_dollars:'0.96'};
  const at=Date.now();
  const state=ms=>gameState(m,{milestone_id:m.id,_observed_at:new Date(ms).toISOString(),
    details:{status:'live',home_score:1,away_score:1,half:'1st',time:"33'"}});
  const first=state(at-12000),second=state(at);
  assert.ok(overSignal(first,market));
  assert.equal(kalshiOnlyOver(first,second,market),false);
  const safe=ms=>gameState(m,{milestone_id:m.id,_observed_at:new Date(ms).toISOString(),
    details:{status:'live',home_score:3,away_score:1,half:'1st',time:"33'"}});
  assert.equal(kalshiOnlyOver(safe(at-12000),safe(at),market),true);
  assert.equal(fallbackOverFraction(safe(at),market),.10);
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
  assert.equal(overSignal(consistent,{...market,yes_ask_dollars:'0.98'})?.fraction,.10);
  const stoppage=gameState(m,{details:{status:'inprogress',time:"90+4'",half:'2nd',home_same_game_score:1,away_same_game_score:2,home_regulation_score:1,away_regulation_score:2}});
  assert.equal(stoppage.soccerExtraTime,false);
  assert.equal(overSignal(stoppage,{...market,yes_ask_dollars:'0.98'})?.fraction,.10);
  assert.equal(overSignal(game("88'",'live'),{...market,yes_ask_dollars:'0.98',result:'no'}),null);
});
test('tennis match winner requires a deciding-set service game that can clinch the match',()=>{
  const m={id:'tennis',title:'Hurkacz vs Bergs',type:'tennis_tournament_singles',details:{best_of:'3',first_competitor_id:'H',second_competitor_id:'B',main_game_event_ticker:'KXATPMATCH-26OCT26HURBER'}};
  const market={status:'active',event_ticker:'KXATPMATCH-26OCT26HURBER',title:'Hubert Hurkacz wins',rules_primary:'If Hubert Hurkacz wins the tennis match after a ball has been played, Yes.',custom_strike:{tennis_competitor:'H'}};
  const live=(ours=5,theirs=4,sets=1,server='H',p1=30,p2=15,best='3')=>gameState({...m,details:{...m.details,best_of:best}},{details:{status:'live',competitor1_is_home:true,competitor1_round_scores:[{outcome:'winner',score:6},{outcome:'loser',score:3},{outcome:'ongoing',score:ours}],competitor2_round_scores:[{outcome:'loser',score:3},{outcome:'winner',score:6},{outcome:'ongoing',score:theirs}],competitor1_overall_score:sets,competitor2_overall_score:sets,competitor1_current_round_score:p1,competitor2_current_round_score:p2,server,advantage:''}});
  assert.equal(tennisSignal(live(),market)?.fraction,.15);
  assert.equal(tennisSignal(live(6,5),market)?.fraction,.15);
  assert.equal(tennisSignal(live(3,1),market),null);
  assert.equal(tennisSignal(live(5,3),market),null);
  assert.equal(tennisSignal(live(5,5),market),null);
  assert.equal(tennisSignal(live(6,6),market),null);
  assert.equal(tennisSignal(live(5,4,0),market),null);
  assert.equal(tennisSignal(live(5,4,2,'H',30,15,'5'),market)?.fraction,.15);
  assert.equal(tennisSignal(live(5,4,1,'H',30,15,'5'),market),null);
  assert.equal(tennisSignal(live(5,4,1,'B',30,40),market),null);
  assert.equal(tennisSignal(live(5,4,1,'H',15,40),market),null);
  assert.equal(tennisSignal(live(5,4,1,'unknown'),market),null);
  assert.equal(tennisSignal(live(),{...market,event_ticker:'KXATPSETWINNER-2'}),null);
});
test('ITF men and women accept only the match-clinching deciding-set service game',()=>{
  const m={id:'covato',title:'Covato vs Delgado',type:'tennis_tournament_singles',details:{tour:'ITF',tournament_name:'M15 Mazatlan',first_competitor_id:'cov',second_competitor_id:'del',main_game_event_ticker:'KXITFMATCH-26OCT28COVDEL'}};
  const market={status:'active',event_ticker:m.details.main_game_event_ticker,title:'Matteo Covato wins',rules_primary:'If Matteo Covato wins the professional tennis match, then Yes.',custom_strike:{tennis_competitor:'cov'},yes_ask_dollars:'0.95'};
  const now=Date.now();
  const state=(at,first=5,second=4,server='cov',widget='live',milestone=m)=>gameState(milestone,{milestone_id:m.id,_observed_at:new Date(at).toISOString(),details:{status:'started',widget_status:widget,completed_rounds:2,competitor1_is_home:true,competitor1_overall_score:1,competitor2_overall_score:1,competitor1_round_scores:[{outcome:'winner',score:6},{outcome:'loser',score:1},{outcome:'ongoing',score:first}],competitor2_round_scores:[{outcome:'loser',score:4},{outcome:'winner',score:6},{outcome:'ongoing',score:second}],competitor1_current_round_score:40,competitor2_current_round_score:0,server}});
  const first=state(now-12000),next=state(now);
  assert.equal(first.verifiedLive,true);
  assert.equal(first.tennis.bestOf,3);
  assert.equal(tennisSignal(first,market)?.fraction,.15);
  assert.equal(kalshiOnlyLead(first,next,market),true,'a 40–0 service game remains eligible after one tennis point is removed');
  assert.equal(tennisSignal(state(now,5,4,'del'),market),null);
  assert.equal(tennisSignal(state(now,3,2),market),null);
  assert.equal(tennisSignal(state(now,2,0),market),null);
  assert.equal(tennisSignal(state(now,5,4,'cov','pregame'),market),null);
  assert.equal(tennisSignal(state(now,5,4,'cov','live',{...m,details:{...m.details,tour:'unknown'}}),market),null);
  assert.equal(kalshiOnlyLead(first,state(now,3,2),market),false);
  const women={...m,details:{...m.details,tournament_name:'W75 Toronto',main_game_event_ticker:'KXITFWMATCH-26OCT30BRARYS'}};
  const womenMarket={...market,event_ticker:women.details.main_game_event_ticker,title:'Reese Brantmeier wins'};
  assert.equal(tennisSignal(state(now,2,1,'cov','live',women),womenMarket),null,'an early one-game lead is insufficient');
  assert.equal(tennisSignal(state(now,3,1,'cov','live',women),womenMarket),null,'the former 3–1 entry is removed');
  assert.equal(tennisSignal(state(now,5,4,'cov','live',women),womenMarket)?.fraction,.15);
  assert.equal(tennisSignal(state(now,5,4,'del','live',women),womenMarket),null,'the leader must serve');
});
test('small basketball leads below every configured minimum never enter',()=>{
  const market={status:'active',title:'New York wins',yes_sub_title:'New York',yes_ask_dollars:'0.95'};
  const now=Date.now();
  for(const league of ['NBA','WNBA','NCAAW']){
    const m={...milestone,details:{league}};
    const final=4;
    const at=(when,lead,clock='00:20',possession='home',period=final)=>gameState(m,{milestone_id:m.id,_observed_at:new Date(when).toISOString(),details:{...live(100+lead,100,period).details,clock,possession,last_updated_ts:(when-500)/1000}});
    assert.equal(leadSignal(at(now,4),market),null);
    assert.equal(leadSignal(at(now,5),market),null);
    assert.equal(leadSignal(at(now,3),market),null);
    assert.equal(leadSignal(at(now,4,'00:21'),market),null);
    assert.equal(leadSignal(at(now,4,'00:00'),market),null);
    assert.equal(leadSignal(at(now,4,'00:20','away'),market),null);
    assert.equal(leadSignal(at(now,4,'00:20','home',final-1),market),null);
    assert.equal(kalshiOnlyLead(at(now-12000,4),at(now,4),market),false,'a four-point lead does not survive one four-point play');
    assert.equal(kalshiOnlyLead(at(now-12000,4,'00:20','away'),at(now,4),market),false);
  }
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
  assert.equal(overBudget(10000,0,0),1000);
  assert.equal(overBudget(2000,8000,8000),1000);
  assert.equal(overBudget(6000,4000,3000),1000);
  assert.equal(overBudget(10000,0,9000),1000);
});
test('entry submissions use full fills and commanding leads use the half-potential exit target',()=>{
  const source=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
  assert.equal((source.match(/side:'bid'[^\n]+time_in_force:'fill_or_kill'/g)||[]).length,3);
  assert.match(source,/const leadPosition=original\.strategy==='lead'&&![^;]+;/);
  assert.match(source,/const targetReached=profitTargetAllowed\(original\)&&sale\.count/);
  assert.match(source,/leadPosition\?halfPotentialProfitExitEligible\(position,sale\):oneAndHalfExitEligible\(position,sale\)/);
  assert.match(source,/if\(!leadExit&&!targetReached&&!corrected\)continue;/);
  assert.match(source,/if\(live\(\)\|\|exitOnly\(\)\)await exitComebacks/);
  assert.match(source,/for\(const c of \[\.\.\.opportunities,\.\.\.upgradeCandidates\]\)[^]*?if\(!live\(\)\)continue/);
  assert.match(source,/if\(a\.signal\.strategy!==b\.signal\.strategy\)return a\.signal\.strategy==='over'\?-1:1/);
  assert.match(source,/return profit\(b\)-profit\(a\)/);
});
test('zero score never creates an over; overs need only positive net profit',()=>{
  const market={status:'active',title:'Total goals over 0',rules_primary:'Combined total goals scored in the game',strike_type:'greater',floor_strike:-0.5};
  const soccer={...milestone,type:'soccer_tournament_multi_leg'};
  assert.equal(overSignal(gameState(soccer,{details:{status:'live',home_score:0,away_score:0}}),market),null);
  for(const strategy of ['lead','over'])for(const cash of [9900,9999,10000,20000])assert.equal(minimumProfitCents(strategy,cash),1);
  assert.equal(profitableCount(10,.99,2,'over',9900),10);
  assert.equal(profitableCount(10,.99,2,'over',20000),10);
  assert.equal(profitableCount(1,.99,2,'over',9900),0);
  assert.equal(profitableCount(100,.99,2,'over',9900),100);
  assert.equal(profitableCount(100,.90,2,'over',9900),100);
  assert.ok(netSettlementProfitCents(100,.99,2)>0);
  assert.equal(profitableCount(1,1,2,'lead',100),0);
  assert.equal(profitableCount(1,.90,2,'lead',20000,'basketball_game',299),1);
  assert.equal(profitableCount(1,.90,2,'lead',20000,'football_game'),1);
  assert.equal(profitableCount(1,.99,2,'lead',20000,'basketball_game',20),0);
});
test('filled order tiers preserve higher existing minimums and exact boundaries',()=>{
  for(const [orders,expected] of [[0,1],[9,1],[10,15],[14,15],[15,35],[19,35],[20,50],[21,50]]){
    assert.equal(minimumProfitCents('over',5000,'',NaN,orders),expected);
    assert.equal(minimumProfitCents('lead',5000,'',NaN,orders),expected);
  }
  assert.equal(minimumProfitCents('weather',5000,'',NaN,10),30);
  assert.equal(minimumProfitCents('weather',5000,'',NaN,15),35);
  assert.equal(minimumProfitCents('weather',5000,'',NaN,20),50);
  assert.equal(minimumProfitCents('combo',20000,'',NaN,20),200);
  assert.equal(netSettlementProfitCents(1,.75,2),22);
  assert.equal(netSettlementProfitCents(2,.75,2),44);
  assert.equal(netSettlementProfitCents(3,.75,2),67);
});
test('leads need only positive net profit at all game clock times',()=>{
  for(const type of ['basketball_game','college_basketball_game']){
    for(const seconds of [300,181,180,61,60,30,1,0])assert.equal(minimumProfitCents('lead',20000,type,seconds),1);
    assert.equal(profitableCount(12,.90,2,'lead',20000,type,299),12);
    assert.equal(profitableCount(6,.90,2,'lead',20000,type,61),6);
    assert.equal(profitableCount(6,.90,2,'lead',20000,type,60),6);
    assert.equal(profitableCount(3,.90,2,'lead',20000,type,31),3);
    assert.equal(profitableCount(3,.90,2,'lead',20000,type,30),3);
    assert.equal(profitableCount(3,.99,2,'lead',20000,type,20),3);
  }
  assert.equal(minimumProfitCents('lead',20000,'football_game',30),1);
  assert.equal(minimumProfitCents('over',20000,'basketball_game',30),1);
});
test('basketball positive exit cannot bypass tie and trailing clock windows',()=>{
  const m={...milestone,type:'basketball_game',details:{league:'NBA',home_team_id:'NY',away_team_id:'BOS'}};
  const market={title:'New York wins',yes_sub_title:'New York',custom_strike:{basketball_team:'NY'}};
  const at=(home,away,period,clock)=>gameState(m,{details:{...live(home,away,period).details,clock}});
  assert.equal(timedProfitExitAllowed(at(100,100,4,'00:30'),market),false);
  assert.equal(timedProfitExitAllowed(at(100,100,4,'00:29'),market),true);
  assert.equal(timedProfitExitAllowed(at(100,101,4,'02:00'),market),false);
  assert.equal(timedProfitExitAllowed(at(100,101,4,'01:59'),market),true);
  assert.equal(timedProfitExitAllowed(at(101,100,4,'03:00'),market),true);
  assert.equal(timedProfitExitAllowed(at(100,101,3,'00:10'),market),false);
});

