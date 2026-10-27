import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gameState,overSignal,leadSignal,tennisSignal,orderSize,estimatedCostCents,overBudget,minimumProfitCents,netSettlementProfitCents,profitableCount,comeback} from '../src/strategy.mjs';

const milestone={id:'game-1',title:'Boston at New York',type:'basketball_game',details:{competition:'Pro Basketball (M)'},related_event_tickers:['GAME']};
const live=(home,away,quarter=4)=>({details:{status:'live',last_updated_ts:Math.floor(Date.now()/1000),home_score:home,away_score:away,quarter,clock:'04:59',home_team_name:'New York',away_team_name:'Boston'}});
test('over requires strict threshold exceeded and whole-game contract',()=>{
  const g=gameState(milestone,live(102,101));const market={status:'active',title:'Total points in game over 203',rules_primary:'Combined total points scored in the game',strike_type:'greater',floor_strike:203};
  assert.equal(overSignal(g,market),null);assert.equal(overSignal(gameState(milestone,live(103,101)),market)?.fraction,.8);
  assert.equal(overSignal(gameState(milestone,live(103,101)),{...market,title:'First half total points'}),null);
});
test('Kalshi whole-game over wording is recognized after the line is crossed',()=>{
  const m={id:'kbo-game',title:'Kia Tigers vs Samsung Lions',type:'baseball_game',details:{league:'Korea KBO'}};
  const g=gameState(m,{details:{status:'inprogress',away_points:3,home_points:8,inning:9}});
  const market={status:'active',title:'Over 9.5 runs scored?',yes_sub_title:'Over 9.5 runs scored',rules_primary:'If the teams collectively score more than 9.5 runs in the KBO game, the market resolves to Yes.',strike_type:'greater',floor_strike:9.5};
  assert.equal(overSignal(g,market)?.fraction,.8);
  assert.equal(overSignal(g,{...market,title:'Over 11.5 runs scored?',floor_strike:11.5}),null);
  assert.equal(orderSize(5097,'1.0000','0.00',.8),0);
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
  assert.equal(leadSignal(gameState(milestone,live(140,30,2)),market),null);
  assert.equal(leadSignal(gameState(milestone,{details:{...live(140,30).details,live_data_delayed:true}}),market),null);
  assert.equal(leadSignal(gameState(milestone,live(140,30)),{...market,title:'Will Boston win?',yes_sub_title:'Boston wins'}),null);
});
test('baseball needs two runs in the ninth and allocates 25 to 35 percent',()=>{
  const m={...milestone,type:'baseball_game',details:{league:'MLB'}};
  const market={status:'active',title:'New York wins',custom_strike:{baseball_team:'home'},yes_sub_title:'New York'};
  const board=(inning,home=5)=>({details:{status:'inprogress',home_runs:home,away_runs:3,inning,inning_half:2,outs:1,home_team_name:'New York',away_team_name:'Boston'}});
  assert.equal(leadSignal(gameState(m,board(8)),market),null);
  assert.equal(leadSignal(gameState(m,board(9,4)),market),null);
  assert.equal(leadSignal(gameState(m,board(9)),market)?.fraction,.25);
  assert.equal(leadSignal(gameState(m,board(9,6)),market)?.fraction,.30);
});
test('baseball accepts a two-run shutout lead',()=>{
  const baseball={...milestone,type:'baseball_game',details:{league:'MLB'}};
  const market={status:'active',title:'New York wins',yes_sub_title:'New York'};
  const at=(home,away,inning)=>({details:{status:'live',last_updated_ts:Math.floor(Date.now()/1000),home_runs:home,away_runs:away,inning,inning_half:2,home_team_name:'New York',away_team_name:'Boston'}});
  assert.equal(leadSignal(gameState(baseball,at(1,0,9)),market),null);
  assert.equal(leadSignal(gameState(baseball,at(2,0,9)),market)?.fraction,.25);
  assert.equal(leadSignal(gameState(baseball,at(3,0,9)),market)?.fraction,.30);
  assert.equal(leadSignal(gameState(baseball,at(2,0,8)),market),null);
});
test('spread contracts are not game winner contracts',()=>{
  const m={...milestone,type:'baseball_game',details:{league:'KBO',home_team_id:'home-id',away_team_id:'away-id'}};
  const g=gameState(m,{details:{status:'inprogress',home_points:8,away_points:3,inning:9,home_team_name:'Samsung Lions',away_team_name:'Kia Tigers'}});
  const spread={status:'active',event_ticker:'KXKBOSPREAD-26OCT260530KIASAM',title:'Samsung Lions wins by over 1.5 runs',yes_sub_title:'Samsung Lions wins by over 1.5 runs',custom_strike:{baseball_team:'home-id'}};
  assert.equal(leadSignal(g,spread),null);
  assert.equal(leadSignal(g,{...spread,event_ticker:'KXKBOGAME-26OCT260530KIASAM',title:'Samsung Lions wins',yes_sub_title:'Samsung Lions'} )?.fraction,.30);
});
test('soccer starts at 85:00 and excludes extra time or ambiguous stoppage scores',()=>{
  const m={id:'soccer',title:'Abha vs Al-Faisaly',type:'soccer_tournament_multi_leg',details:{league:'Saudi Pro League',home_team_id:'abha',away_team_id:'faisaly'}};
  const board=(home,away,time,half='2nd')=>gameState(m,{details:{status:'live',home_same_game_score:home,away_same_game_score:away,time,half}});
  const market={status:'active',event_ticker:'KXSAUDIPLGAME-26OCT27ABHFAI',title:'Abha wins',yes_sub_title:'Abha',custom_strike:{soccer_team:'abha'},rules_primary:'If Abha wins after 90 minutes plus stoppage time (does not include extra time or penalties), then Yes.'};
  assert.equal(leadSignal(board(2,0,"84'"),market),null);
  assert.equal(leadSignal(board(2,0,"85'"),market)?.fraction,.25);
  assert.equal(leadSignal(board(3,0,"85'"),market)?.fraction,.30);
  assert.equal(leadSignal(board(3,1,"90+4'"),market),null);
  assert.equal(leadSignal(board(2,0,"90+4'",'extra time'),market),null);
  assert.equal(leadSignal(board(2,0,"85'",'1st'),market),null);
  assert.equal(leadSignal(board(2,0,"85'"),{...market,rules_primary:'Includes extra time and penalty shootouts.'}),null);
});
test('regulation soccer totals reject extra-time goals even when live feed says in progress',()=>{
  const m={id:'cup',title:'Castellonense vs Almeria',type:'soccer_tournament_multi_leg'};
  const market={status:'active',title:'Will over 1.5 goals be scored?',yes_sub_title:'Reg Time: Over 1.5 goals scored',rules_primary:'If over 1.5 goals are scored after 90 minutes plus stoppage time (does not include extra time or penalties), then Yes.',floor_strike:1.5,strike_type:'greater',yes_ask_dollars:'0.0100'};
  const game=(time,match_status,price=market.yes_ask_dollars)=>gameState(m,{details:{status:'inprogress',time,half:'2nd',match_status,home_same_game_score:1,away_same_game_score:2,home_regulation_score:0,away_regulation_score:0,period_scores:[{type:match_status==='aet'?'overtime':'regular_period'}]}});
  assert.equal(overSignal(game("110'",'aet'),market),null);
  assert.equal(overSignal(game("89'",'aet'),{...market,yes_ask_dollars:'0.98'}),null);
  assert.equal(overSignal(game("90+4'",'live'),{...market,yes_ask_dollars:'0.98'}),null);
  assert.equal(overSignal(game("88'",'live'),market),null);
  assert.equal(overSignal(game("88'",'live'),{...market,yes_ask_dollars:'0.98'})?.fraction,.8);
  assert.equal(overSignal(game("88'",'live'),{...market,yes_ask_dollars:'0.98',result:'no'}),null);
});
test('tennis match winner requires clinching set, two-game lead, server and point score',()=>{
  const m={id:'tennis',title:'Hurkacz vs Bergs',type:'tennis_tournament_singles',details:{best_of:'3',first_competitor_id:'H',second_competitor_id:'B',main_game_event_ticker:'KXATPMATCH-26OCT26HURBER'}};
  const market={status:'active',event_ticker:'KXATPMATCH-26OCT26HURBER',title:'Hubert Hurkacz wins',rules_primary:'If Hubert Hurkacz wins the tennis match after a ball has been played, Yes.',custom_strike:{tennis_competitor:'H'}};
  const live=(games=3,sets=1,server='H',p1=30,p2=15,best='3')=>gameState({...m,details:{...m.details,best_of:best}},{details:{status:'live',competitor1_is_home:true,competitor1_round_scores:[{outcome:'winner',score:6},{outcome:'ongoing',score:5}],competitor2_round_scores:[{outcome:'loser',score:3},{outcome:'ongoing',score:games}],competitor1_overall_score:sets,competitor2_overall_score:0,competitor1_current_round_score:p1,competitor2_current_round_score:p2,server,advantage:''}});
  assert.equal(tennisSignal(live(),market),null);
  assert.equal(tennisSignal(live(2),market)?.fraction,.30);
  assert.equal(tennisSignal(live(1),market)?.fraction,.35);
  assert.equal(tennisSignal(live(4),market),null);
  assert.equal(tennisSignal(live(3,0),market),null);
  assert.equal(tennisSignal(live(3,2,'H',30,15,'5'),market),null);
  assert.equal(tennisSignal(live(2,2,'H',30,15,'5'),market)?.fraction,.30);
  assert.equal(tennisSignal(live(3,1,'H',30,15,'5'),market),null);
  assert.equal(tennisSignal(live(3,1,'B',30,40),market),null);
  assert.equal(tennisSignal(live(3,1,'H',15,40),market),null);
  assert.equal(tennisSignal(live(3,1,'unknown'),market),null);
  assert.equal(tennisSignal(live(),{...market,event_ticker:'KXATPSETWINNER-2'}),null);
});
test('hockey needs three goals under seven minutes or two under five in the final period',()=>{
  const hockey={...milestone,type:'hockey_match',details:{league:'NHL'}};
  const market={status:'active',title:'New York wins',yes_sub_title:'New York'};
  const at=(home,away,period,clock)=>({details:{...live(home,away,period).details,clock}});
  assert.equal(leadSignal(gameState(hockey,at(3,1,3,'04:59')),market)?.fraction,.25);
  assert.equal(leadSignal(gameState(hockey,at(4,1,3,'04:59')),market)?.fraction,.30);
  assert.equal(leadSignal(gameState(hockey,at(3,0,3,'06:59')),market)?.fraction,.25);
  assert.equal(leadSignal(gameState(hockey,at(3,0,3,'05:00')),market)?.fraction,.25);
  assert.equal(leadSignal(gameState(hockey,at(3,1,3,'06:59')),market),null);
  assert.equal(leadSignal(gameState(hockey,at(3,1,3,'05:00')),market),null);
  assert.equal(leadSignal(gameState(hockey,at(3,0,3,'07:00')),market),null);
  assert.equal(leadSignal(gameState(hockey,at(3,0,3,'07:01')),market),null);
  assert.equal(leadSignal(gameState(hockey,at(3,0,2,'06:59')),market),null);
  assert.equal(leadSignal(gameState(hockey,at(2,0,3,'04:59')),market)?.fraction,.25);
  assert.equal(leadSignal(gameState(hockey,at(2,1,3,'04:59')),market),null);
  assert.equal(leadSignal(gameState(hockey,at(3,1,2,'04:59')),market),null);
  assert.equal(leadSignal(gameState(hockey,at(3,1,3,'05:00')),market),null);
});
test('basketball lead tiers use strict five minute, three minute and twenty second boundaries',()=>{
  const market={status:'active',title:'New York wins',yes_sub_title:'New York'};
  for(const league of ['NBA','WNBA','Basketball','NCAAMB','NCAAW']){
    const m={...milestone,details:{league}};
    const last=/NCAA/.test(league)?2:4;
    const at=(lead,clock,period=last)=>gameState(m,{details:{...live(100+lead,100,period).details,clock}});
    assert.equal(leadSignal(at(8,'05:00'),market),null);
    assert.equal(leadSignal(at(7,'04:59'),market),null);
    assert.equal(leadSignal(at(8,'04:59'),market)?.fraction,.25);
    assert.equal(leadSignal(at(5,'03:00'),market),null);
    assert.ok(leadSignal(at(8,'03:00'),market));
    assert.equal(leadSignal(at(4,'02:59'),market),null);
    assert.ok(leadSignal(at(5,'02:59'),market));
    assert.equal(leadSignal(at(3,'00:20'),market),null);
    assert.ok(leadSignal(at(5,'00:20'),market));
    assert.equal(leadSignal(at(2,'00:19'),market),null);
    assert.ok(leadSignal(at(3,'00:19'),market));
    assert.equal(leadSignal(at(8,'00:00'),market),null);
    assert.equal(leadSignal(at(8,'00:19',last-1),market),null);
  }
});
test('football needs a ten point lead, independent of percentage, in final five minutes',()=>{
  const m={...milestone,type:'football_game',details:{league:'NFL'}};
  const market={status:'active',title:'New York wins',yes_sub_title:'New York'};
  const board={details:{...live(24,14).details,clock:'04:00'}};
  assert.equal(leadSignal(gameState(m,board),market)?.fraction,.25);
  board.details.home_score=24;board.details.away_score=15;
  assert.equal(leadSignal(gameState(m,board),market),null);
  board.details.home_score=25;board.details.away_score=14;
  assert.equal(leadSignal(gameState(m,board),market)?.fraction,.30);
  board.details.home_score=100;board.details.away_score=90;
  assert.equal(leadSignal(gameState(m,board),market)?.fraction,.25);
  board.details.home_score=10;board.details.away_score=0;
  assert.equal(leadSignal(gameState(m,board),market)?.fraction,.25);
  board.details.home_score=24;board.details.away_score=14;board.details.clock='05:00';
  assert.equal(leadSignal(gameState(m,board),market),null);
  board.details.clock='04:00';board.details.quarter=3;
  assert.equal(leadSignal(gameState(m,board),market),null);
});
test('quantity preflights cash, allocation, fees, price and displayed liquidity',()=>{
  const count=orderSize(10000,'0.50','400',.8);
  assert.ok(count>149&&count<150);
  assert.equal(orderSize(10000,'0.50','10',.8),10);
  assert.ok(orderSize(10000,'0.99','400',.8)>=80);
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
});
test('over allocation is capped across existing unsettled over positions',()=>{
  assert.equal(overBudget(10000,0,0),8000);
  assert.equal(overBudget(2000,8000,8000),0);
  assert.equal(overBudget(6000,4000,3000),5000);
  assert.equal(overBudget(10000,0,9000),0);
});
test('entry submissions and recovery use full fills while exits cannot target overs',()=>{
  const source=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
  assert.equal((source.match(/side:'bid'[^\n]+time_in_force:'fill_or_kill'/g)||[]).length,2);
  assert.match(source,/if\(original\?\.strategy!=='lead'\|\|\/TOTAL\/i\.test\(position\.ticker\)\)continue/);
});
test('zero score never creates an over and net profit tiers include conservative fees',()=>{
  const market={status:'active',title:'Total goals over 0',rules_primary:'Combined total goals scored in the game',strike_type:'greater',floor_strike:-0.5};
  const soccer={...milestone,type:'soccer_tournament_multi_leg'};
  assert.equal(overSignal(gameState(soccer,{details:{status:'live',home_score:0,away_score:0}}),market),null);
  assert.equal(minimumProfitCents('over',9900),50);
  assert.equal(minimumProfitCents('over',10000),100);
  assert.equal(minimumProfitCents('over',20000),200);
  assert.equal(minimumProfitCents('lead',9900),25);
  assert.equal(minimumProfitCents('lead',10000),50);
  assert.equal(minimumProfitCents('lead',20000),100);
  assert.equal(profitableCount(10,.99,2,'over',9900),0);
  assert.equal(profitableCount(100,.99,2,'over',9900),100);
  assert.ok(netSettlementProfitCents(100,.99,2)>0);
  assert.equal(profitableCount(1,1,2,'lead',100),0);
  assert.equal(profitableCount(1,.90,2,'lead',20000,'basketball_game',299),0);
  assert.equal(profitableCount(1,.90,2,'lead',20000,'football_game'),0);
  assert.equal(profitableCount(1,.99,2,'lead',20000,'basketball_game',20),0);
});
test('basketball net profit minimum steps down at three minutes and thirty seconds',()=>{
  for(const type of ['basketball_game','college_basketball_game']){
    assert.equal(minimumProfitCents('lead',20000,type,300),Infinity);
    assert.equal(minimumProfitCents('lead',20000,type,299),100);
    assert.equal(minimumProfitCents('lead',20000,type,181),100);
    assert.equal(minimumProfitCents('lead',20000,type,180),50);
    assert.equal(minimumProfitCents('lead',20000,type,31),50);
    assert.equal(minimumProfitCents('lead',20000,type,30),25);
    assert.equal(minimumProfitCents('lead',20000,type,1),25);
    assert.equal(minimumProfitCents('lead',20000,type,0),Infinity);
    assert.equal(profitableCount(12,.90,2,'lead',20000,type,299),12);
    assert.equal(profitableCount(6,.90,2,'lead',20000,type,181),0);
    assert.equal(profitableCount(6,.90,2,'lead',20000,type,180),6);
    assert.equal(profitableCount(3,.90,2,'lead',20000,type,31),0);
    assert.equal(profitableCount(3,.90,2,'lead',20000,type,30),3);
    assert.equal(profitableCount(3,.99,2,'lead',20000,type,20),0);
  }
  assert.equal(minimumProfitCents('lead',20000,'football_game',30),100);
  assert.equal(minimumProfitCents('over',20000,'basketball_game',30),200);
});
test('late lead reaches 35 percent at 2:30 and comeback detects a tie or reversal',()=>{
  const m={...milestone,type:'football_game',details:{league:'NFL',home_team_id:'NY',away_team_id:'BOS'}};
  const market={status:'active',title:'New York wins',yes_sub_title:'New York',custom_strike:{football_team:'NY'}};
  const at=(home,away,clock)=>gameState(m,{details:{...live(home,away).details,clock}});
  assert.equal(leadSignal(at(24,14,'02:30'),market)?.fraction,.35);
  assert.equal(comeback(at(24,14,'02:30'),market,'lead'),false);
  assert.equal(comeback(at(24,24,'02:00'),market,'lead'),true);
  assert.equal(comeback(at(24,25,'01:00'),market,'lead'),true);
  assert.equal(comeback(at(24,25,'01:00'),{floor_strike:20},'over'),false);
  const tennis={...milestone,type:'tennis_tournament_singles',details:{best_of:3,first_competitor_id:'A',second_competitor_id:'B'}};
  const tennisState=(a,b)=>gameState(tennis,{details:{status:'live',competitor1_round_scores:[{score:a}],competitor2_round_scores:[{score:b}]}});
  assert.equal(comeback(tennisState(5,5),{custom_strike:{tennis_competitor:'A'}},'lead'),true);
});
