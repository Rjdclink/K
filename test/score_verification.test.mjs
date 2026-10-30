import test from 'node:test';
import assert from 'node:assert/strict';
import { gameState } from '../src/strategy.mjs';
import { espnMatches, foxMatches, tennisMatches, scoreAgreement, verifyIndependentOver, verifyIndependentOverDecision, playerStatAgreement, foxPlayerStat, tableTennisMatches, verifyIndependentTableTennisLead, verifyIndependentTableTennisLeadDecision } from '../src/score_verification.mjs';

test('Liga Pro table tennis lead requires an exact independent live set score and fixture',async()=>{
  const milestone={id:'liga',type:'table_tennis_match',title:'Oleg Moshnikov vs Iurii Krivenkii',start_date:start,details:{league:'Russia Liga Pro',best_of:5,first_competitor_id:'oleg',second_competitor_id:'iurii'}};
  const state=gameState(milestone,{details:{status:'live',competitor1_is_home:true,competitor1_overall_score:2,competitor2_overall_score:2,period_scores:[{type:'set',number:5,competitor1_score:10,competitor2_score:4}]}});
  const match={startTimestamp:Math.floor(Date.parse(start)/1000),status:{type:'inprogress'},homeTeam:{name:'Oleg Moshnikov'},awayTeam:{name:'Iurii Krivenkii'},homeScore:{current:2,period5:10},awayScore:{current:2,period5:4}};
  const data={events:[match]};
  assert.equal(tableTennisMatches(data,state,milestone).length,1);
  assert.equal(await verifyIndependentTableTennisLead(state,milestone,{fetcher:async()=>({ok:true,json:async()=>data})}),true);
  assert.equal(await verifyIndependentTableTennisLead(state,milestone,{fetcher:async()=>({ok:true,json:async()=>({events:[{...match,awayScore:{current:2,period5:5}}]})})}),false);
  assert.equal(await verifyIndependentTableTennisLead(state,milestone,{fetcher:async()=>({ok:true,json:async()=>({events:[{...match,startTimestamp:match.startTimestamp+86400}]})})}),false);
  assert.equal(await verifyIndependentTableTennisLead(state,milestone,{fetcher:async()=>({ok:true,json:async()=>({events:[match,match]})})}),false);
  assert.equal(await verifyIndependentTableTennisLead(state,milestone,{fetcher:async()=>{throw Error('unavailable')}}),false);
  assert.equal(await verifyIndependentTableTennisLeadDecision(state,milestone,{fetcher:async()=>{throw Error('unavailable')}}),null);
  assert.equal(await verifyIndependentTableTennisLeadDecision(state,milestone,{fetcher:async()=>({ok:true,json:async()=>({events:[{...match,awayScore:{current:2,period5:5}}]})})}),false);
});

const start=new Date(Date.now()-20*60000).toISOString();
const m={id:'nba-game',title:'BKN Nets at BOS Celtics',type:'basketball_game',start_date:start,details:{league:'NBA'}};
const game=gameState(m,{details:{status:'live',home_score:24,away_score:20,quarter:1,clock:'05:00',home_team_name:'BOS Celtics',away_team_name:'BKN Nets'}});
const espn=(home=24,away=20,overrides={})=>({events:[{date:start,status:{type:{state:'in'},period:1,displayClock:'05:00'},competitions:[{competitors:[
  {homeAway:'home',score:String(home),team:{displayName:'Boston Celtics',abbreviation:'BOS',name:'Celtics'}},
  {homeAway:'away',score:String(away),team:{displayName:'Brooklyn Nets',abbreviation:'BKN',name:'Nets'}}
]}],...overrides}]});
const fox=(home=24,away=20,overrides={})=>({sectionList:[{events:[{eventTime:start,eventStatus:1,statusLine:'05:00',entityLink:{layout:{tokens:{homeUri:'team-bos',awayUri:'team-bkn'}}},upperTeam:{uri:'team-bkn',name:'BKN',longName:'Nets',score:away},lowerTeam:{uri:'team-bos',name:'BOS',longName:'Celtics',score:home},...overrides}]}]});
test('ESPN last scoring play is used only with a complete verified scoring list',async()=>{
  const soccer={id:'goal-1',type:'soccer_match',title:'Boston vs Brooklyn',start_date:start};
  const state=gameState(soccer,{details:{status:'live',home_score:2,away_score:1,time:"65'",home_team_name:'Boston',away_team_name:'Brooklyn'}});
  const event=(plays)=>({events:[{id:'espn-1',date:start,status:{type:{state:'in'},period:2,displayClock:"65'"},competitions:[{status:{type:{state:'in'},period:2,displayClock:"65'"},competitors:[
    {homeAway:'home',score:'2',team:{displayName:'Boston'}},{homeAway:'away',score:'1',team:{displayName:'Brooklyn'}}],details:plays.map(scoreValue=>({scoringPlay:true,scoreValue}))}]}]});
  const valid=event([1,1,1]);
  assert.equal(espnMatches(valid,state,soccer)[0].lastScoringPlay,1);
  assert.equal(await verifyIndependentOverDecision(state,soccer,{fetcher:async()=>({ok:true,json:async()=>valid})}),true);
  assert.equal(state.lastScoringPlay,1);
  const incomplete=event([1,1]);
  assert.equal(espnMatches(incomplete,state,soccer)[0].lastScoringPlay,null);
  const second=gameState(soccer,{details:{status:'live',home_score:2,away_score:1,time:"65'",home_team_name:'Boston',away_team_name:'Brooklyn'}});
  assert.equal(await verifyIndependentOverDecision(second,soccer,{fetcher:async()=>({ok:true,json:async()=>incomplete})}),true);
  assert.equal(second.lastScoringPlay,undefined);
});
test('NFL ESPN labels verify only the named receiving yard statistic',()=>{
  const athlete={athlete:{displayName:'Chuba Hubbard'},stats:['3','15','5.0','0','11','4']};
  const receiving={name:'receiving',labels:['REC','YDS','AVG','TD','LONG','TGTS'],athletes:[athlete]};
  const rushing={name:'rushing',labels:['CAR','YDS','AVG','TD','LONG'],athletes:[{athlete:{displayName:'Chuba Hubbard'},stats:['9','30','3.3','1','9']}]};
  const summary={boxscore:{players:[{statistics:[rushing,receiving]}]}};
  assert.equal(playerStatAgreement(summary,{name:'Chuba Hubbard',metric:'RECYDS',value:15}),true);
  assert.equal(playerStatAgreement(summary,{name:'Chuba Hubbard',metric:'RUSHYDS',value:30}),true);
  assert.equal(playerStatAgreement(summary,{name:'Chuba Hubbard',metric:'RECYDS',value:30}),false);
});
test('NBA scoreboard recognizes exact New Orleans abbreviation variants',()=>{
  const milestone={...m,title:'SAC Kings at NOP Pelicans'};
  const state={...game,homeName:'NOP Pelicans',awayName:'SAC Kings'};
  const fixture=espn(24,20,{competitions:[{competitors:[
    {homeAway:'home',score:'24',team:{displayName:'New Orleans Pelicans',abbreviation:'NO',name:'Pelicans'}},
    {homeAway:'away',score:'20',team:{displayName:'Sacramento Kings',abbreviation:'SAC',name:'Kings'}}]}]});
  assert.equal(espnMatches(fixture,state,milestone).length,1);
  assert.equal(espnMatches(fixture,{...state,homeName:'NOP Lakers'},milestone).length,0);
});
test('provider abbreviations match across sports without accepting the wrong team',()=>{
  const milestone={...m,title:'BKN at BOS'};
  const state={...game,homeName:'BOS',awayName:'BKN'};
  assert.equal(espnMatches(espn(),state,milestone).length,1);
  assert.equal(espnMatches(espn(),{...state,awayName:'NYK'},milestone).length,0);
});
test('NHL city labels match the exact franchise but not a same-city rival',()=>{
  const milestone={...m,title:'New York I at Minnesota'};
  const state={...game,homeName:'Minnesota',awayName:'New York I'};
  const fixture=espn(24,20,{competitions:[{competitors:[
    {homeAway:'home',score:'24',team:{displayName:'Minnesota Wild',abbreviation:'MIN',name:'Wild'}},
    {homeAway:'away',score:'20',team:{displayName:'New York Islanders',abbreviation:'NYI',name:'Islanders'}}]}]});
  assert.equal(espnMatches(fixture,state,milestone).length,1);
  const wrong={...fixture,events:fixture.events.map(e=>({...e,competitions:[{competitors:[
    fixture.events[0].competitions[0].competitors[0],
    {homeAway:'away',score:'20',team:{displayName:'New York Rangers',abbreviation:'NYR',name:'Rangers'}}]}]}))};
  assert.equal(espnMatches(wrong,state,milestone).length,0);
});
test('Saudi soccer alias matches one exact live fixture and its score',()=>{
  const milestone={id:'saudi',type:'soccer_match',title:'Al-Shabab vs Al Ahli Saudi',start_date:start};
  const state=gameState(milestone,{details:{status:'live',home_score:1,away_score:0,time:"20'"}});
  const fixture={events:[{date:start,status:{type:{state:'in'},period:1,displayClock:"20'"},competitions:[{competitors:[
    {homeAway:'home',score:'1',team:{displayName:'Al Shabab'}},
    {homeAway:'away',score:'0',team:{displayName:'Al Ahli'}}]}]}]};
  assert.equal(scoreAgreement(state,[espnMatches(fixture,state,milestone)]),true);
  assert.equal(scoreAgreement(state,[espnMatches({...fixture,events:fixture.events.map(e=>({...e,competitions:[{competitors:[e.competitions[0].competitors[0],{homeAway:'away',score:'1',team:{displayName:'Al Ahli'}}]}]}))},state,milestone)]),false);
  assert.equal(espnMatches({...fixture,events:fixture.events.map(e=>({...e,competitions:[{competitors:[e.competitions[0].competitors[0],{homeAway:'away',score:'0',team:{displayName:'Al Ahli Doha'}}]}]}))},state,milestone).length,0);
});
test('clockless three-goal soccer lead still vetoes an ESPN score conflict',async()=>{
  const milestone={id:'saudi-clockless',type:'soccer_match',title:'Al-Shabab vs Al Ahli Saudi',start_date:start};
  const state=gameState(milestone,{details:{status:'live',home_score:3,away_score:0,half:'2nd'}});
  const fixture={events:[{date:start,status:{type:{state:'in'},period:2,displayClock:"67'"},competitions:[{competitors:[
    {homeAway:'home',score:'2',team:{displayName:'Al Shabab'}},
    {homeAway:'away',score:'0',team:{displayName:'Al Ahli'}}]}]}]};
  const fetcher=async url=>{
    assert.match(url,/espn\.com/,'a conflicting ESPN fixture must veto without seeking another source');
    return {ok:true,json:async()=>fixture};
  };
  assert.equal(await verifyIndependentOverDecision(state,milestone,{fetcher}),false);
});
test('club suffixes and provider abbreviations verify Le Havre versus PSG exactly',()=>{
  const milestone={id:'havre-psg',type:'soccer_match',title:'Le Havre vs PSG',start_date:start};
  const state=gameState(milestone,{details:{status:'live',home_score:1,away_score:5,half:'2nd',time:"73'"}});
  const fixture={events:[{date:start,status:{type:{state:'in'},period:2,displayClock:"77'"},competitions:[{competitors:[
    {homeAway:'home',score:'1',team:{displayName:'Le Havre AC',shortDisplayName:'Le Havre AC',abbreviation:'HAC'}},
    {homeAway:'away',score:'5',team:{displayName:'Paris Saint-Germain',shortDisplayName:'PSG',abbreviation:'PSG'}}]}]}]};
  assert.equal(scoreAgreement(state,[espnMatches(fixture,state,milestone)]),true);
  assert.equal(scoreAgreement(state,[espnMatches({...fixture,events:[{...fixture.events[0],competitions:[{competitors:[
    fixture.events[0].competitions[0].competitors[0],
    {...fixture.events[0].competitions[0].competitors[1],score:'4'}]}]}]},state,milestone)]),false);
  const rival={...fixture,events:[{...fixture.events[0],competitions:[{competitors:[
    {...fixture.events[0].competitions[0].competitors[0],team:{displayName:'Le Havre United',abbreviation:'LHU'}},
    fixture.events[0].competitions[0].competitors[1]]}]}]};
  assert.equal(espnMatches(rival,state,milestone).length,0);
});

test('independent scoreboards must match the exact live fixture and both team scores',()=>{
  assert.equal(scoreAgreement(game,[espnMatches(espn(),game,m),foxMatches(fox(),game,m)]),true);
  assert.equal(scoreAgreement(game,[espnMatches(espn(),game,m),foxMatches(fox(25),game,m)]),false,'one conflicting feed vetoes');
  assert.equal(scoreAgreement(game,[espnMatches(espn(25),game,m),[]]),false);
  assert.equal(scoreAgreement(game,[espnMatches(espn(),game,m),[]]),true);
  assert.equal(scoreAgreement(game,[[],[]]),false,'no coverage');
  assert.equal(scoreAgreement(game,[espnMatches(espn(20,24),game,m),[]]),false,'home and away cannot swap');
  assert.equal(scoreAgreement(game,[espnMatches(espn(24,20,{date:new Date(Date.now()-86400000).toISOString()}),game,m),[]]),false,'wrong fixture time');
  assert.equal(scoreAgreement(game,[espnMatches(espn(24,20,{status:{type:{state:'pre'},period:1,displayClock:'05:00'}}),game,m),[]]),false,'scheduled score');
  assert.equal(scoreAgreement(game,[[],foxMatches(fox(24,20,{eventStatus:3}),game,m)]),false,'final score cannot confirm a live game');
  assert.equal(scoreAgreement(game,[espnMatches(espn(24,20,{status:{type:{state:'in'},period:1,displayClock:'11:00'}}),game,m),[]]),false,'stale clock');
  assert.equal(scoreAgreement(game,[espnMatches({events:[...espn().events,...espn().events]},game,m),[]]),false,'ambiguous duplicate');
  assert.equal(scoreAgreement(game,[[],foxMatches(fox(24,20,{entityLink:{layout:{tokens:{homeUri:'team-bkn',awayUri:'team-bos'}}}}),game,m)]),false,'FOX row orientation cannot be guessed');
});

test('every over preflight needs an exact independent source; missing data fails closed',async()=>{
  const fetcher=async url=>({ok:true,json:async()=>url.includes('espn.com')?espn():fox()});
  assert.equal(await verifyIndependentOver(game,m,{fetcher}),true);
  assert.equal(await verifyIndependentOver(game,m,{fetcher:async url=>({ok:true,json:async()=>url.includes('espn.com')?espn(0,0):fox(0,0)})}),false);
  assert.equal(await verifyIndependentOver(game,m,{fetcher:async()=>{throw Error('provider unavailable')}}),false);
  const unknown={...m,type:'hockey_match',details:{league:'KHL'}};
  const unknownGame=gameState(unknown,{details:{status:'live',home_score:2,away_score:1}});
  assert.equal(await verifyIndependentOver(unknownGame,unknown,{fetcher}),false,'unmapped league cannot borrow NBA scores');
  const soccer={id:'cup-game',type:'soccer_match',title:'Dolomiti Bellunesi vs Desenzano',start_date:start};
  const soccerGame=gameState(soccer,{details:{status:'live',home_score:1,away_score:0,time:"20'"}});
  assert.equal(await verifyIndependentOver(soccerGame,soccer,{fetcher}),false,'the incident game is absent from both providers');
  assert.equal(await verifyIndependentOverDecision(soccerGame,soccer,{fetcher}),null,'no exact independent fixture permits only the restricted fallback');
  assert.equal(await verifyIndependentOverDecision(game,m,{fetcher:async url=>({ok:true,json:async()=>url.includes('espn.com')?espn(0,0):fox(0,0)})}),false,'a confirmed contradiction cannot fall back');
});

test('FOX soccer home team may be the upper row',()=>{
  const fixture={id:'milan-game',type:'soccer_match',title:'AC Milan vs Bologna',start_date:start};
  const state=gameState(fixture,{details:{status:'live',home_score:2,away_score:1,time:"35'",home_team_name:'AC Milan',away_team_name:'Bologna'}});
  const data={sectionList:[{events:[{eventTime:start,eventStatus:1,statusLine:"35'",entityLink:{layout:{tokens:{homeUri:'milan',awayUri:'bologna'}}},upperTeam:{uri:'milan',longName:'AC Milan',score:2},lowerTeam:{uri:'bologna',longName:'Bologna',score:1}}]}]};
  assert.equal(scoreAgreement(state,[[],foxMatches(data,state,fixture)]),true);
});
test('a period total requires an independent matching period breakdown, not just game scores',()=>{
  const board={...game,periodScores:[{number:1,home:14,away:10}]};
  const contract={event_ticker:'KXNBA1QTOTAL-26OCT28BOSBKN'};
  const same={source:'ESPN',home:24,away:20,live:true,clockOk:true,periods:[{number:1,home:14,away:10}]};
  assert.equal(scoreAgreement(board,[[same],[]],contract),true);
  assert.equal(scoreAgreement(board,[[{...same,periods:[{number:1,home:13,away:11}]}],[]],contract),false);
  assert.equal(scoreAgreement(board,[[],[{source:'FOX Sports',home:24,away:20,live:true,clockOk:true}]],contract),false);
});
test('player point and PRA overs require the named ESPN athlete and matching boxscore stat',async()=>{
  const live={milestone_id:m.id,_observed_at:new Date().toISOString(),details:{status:'live',home_score:24,away_score:20,quarter:1,clock:'05:00',last_updated_ts:Date.now()/1000,player_stats:{player1:{points:16,rebounds:4,assists:3}}}};
  const state=gameState(m,live);
  const market={event_ticker:'KXNBAPTS-DATE',status:'active',title:'Player points',yes_sub_title:'Cade Cunningham: 15+',rules_primary:'Cade Cunningham records 15+ points',custom_strike:{basketball_player:'player1'},floor_strike:14.5,yes_ask_dollars:'0.90'};
  const summary={boxscore:{players:[{statistics:[{names:['PTS','REB','AST'],athletes:[{athlete:{displayName:'Cade Cunningham'},stats:['16','4','3']}]}]}]}};
  assert.equal(playerStatAgreement(summary,{name:'Cade Cunningham',metric:'PTS',value:16}),true);
  assert.equal(playerStatAgreement(summary,{name:'Cade Cunningham',metric:'PRA',value:23}),true);
  assert.equal(playerStatAgreement(summary,{name:'Cade Cunningham',metric:'PTS',value:17}),false);
  const board=espn(24,20,{id:'espn-game'});
  const fetcher=async url=>({ok:true,json:async()=>url.includes('/summary?')?summary:url.includes('espn.com')?board:fox()});
  assert.equal(await verifyIndependentOver(state,m,{fetcher,market}),true);
  assert.equal(await verifyIndependentOver({...state,playerStats:{player1:{points:17,rebounds:4,assists:3}}},m,{fetcher,market}),false);
  assert.equal(await verifyIndependentOver(state,m,{fetcher:async url=>({ok:true,json:async()=>url.includes('/summary?')?{boxscore:{players:[]}}:url.includes('espn.com')?board:fox()}),market}),false);
});
test('ESPN player statistic takes precedence over a delayed FOX box score',async()=>{
  const player={name:'Cade Cunningham',metric:'REB',value:7};
  const box=value=>({header:{id:'106594'},boxscore:{boxscoreSections:[{boxscoreItems:[{boxscoreTable:{headers:[{columns:[{index:0,text:'STARTERS'},{index:4,text:'REB'}]}],rows:[{entityLink:{title:'CADE CUNNINGHAM'},columns:[{index:0,text:'C. Cunningham'},{index:4,text:String(value)}]}]}}]}]}});
  assert.equal(foxPlayerStat(box(7),player,'106594'),7);
  assert.equal(foxPlayerStat(box(6),player,'106594'),6);
  assert.equal(foxPlayerStat(box(7),player,'wrong-fixture'),null);
  const milestone={...m,start_date:start},state=gameState(milestone,{details:{status:'live',home_score:24,away_score:20,quarter:1,clock:'05:00',player_stats:{p:{rebounds:7}}}});
  const market={event_ticker:'KXNBAREB-DATE',status:'active',yes_sub_title:'Cade Cunningham: 6+',custom_strike:{basketball_player:'p'},floor_strike:5.5};
  const board=espn(24,20,{id:'espn-game'});
  const summary={boxscore:{players:[{statistics:[{names:['REB'],athletes:[{athlete:{displayName:'Cade Cunningham'},stats:['7']}]}]}]}};
  const foxBoard=fox(24,20,{entityLink:{layout:{tokens:{homeUri:'team-bos',awayUri:'team-bkn',id:'106594'}}}});
  const fetcher=value=>async url=>({ok:true,json:async()=>url.includes('/summary?')?summary:url.includes('espn.com')?board:url.includes('/event/106594/data')?box(value):foxBoard});
  assert.equal(await verifyIndependentOver(state,milestone,{market,fetcher:fetcher(6)}),true);
  assert.equal(await verifyIndependentOver(state,milestone,{market,fetcher:fetcher(7)}),true);
  assert.equal(await verifyIndependentOver(state,milestone,{market,fetcher:async url=>url.includes('/event/106594/data')?{ok:false,status:503}:{ok:true,json:async()=>url.includes('/summary?')?summary:url.includes('espn.com')?board:foxBoard}}),true);
});
test('FOX is queried only when ESPN is unavailable, never as a veto of confirmed ESPN stats',async()=>{
  const state=gameState(m,{details:{status:'live',home_score:85,away_score:96,quarter:4,clock:'09:47',player_stats:{p:{steals:2}}}});
  const market={event_ticker:'KXNBASTL-DATE',status:'active',yes_sub_title:'Ty Jerome: 2+ steals',custom_strike:{basketball_player:'p'},floor_strike:1.5};
  const board=espn(85,96,{id:'espn-game',status:{type:{state:'in'},period:4,displayClock:'09:47'}});
  const summary={boxscore:{players:[{statistics:[{names:['STL'],athletes:[{athlete:{displayName:'Ty Jerome'},stats:['2']}]}]}]}};
  const delayed=fox(83,91,{statusLine:'END 3RD'});
  const urls=[];
  const read=foxBoard=>async url=>{
    urls.push(url);
    if(url.includes('cdn.nba.com')||url.includes('cbssports.com')||url.includes('yahoo.com'))throw Error('unavailable');
    return {ok:true,json:async()=>url.includes('/summary?')?summary:url.includes('espn.com')?board:foxBoard};
  };
  assert.equal(foxMatches(delayed,state,m)[0]?.stale,true);
  assert.equal(await verifyIndependentOver(state,m,{market,fetcher:read(delayed)}),true);
  assert.equal(urls.some(url=>url.includes('foxsports.com')),false);
  assert.equal(await verifyIndependentOver(state,m,{market,fetcher:read(fox(83,91,{statusLine:'09:47 4TH'}))}),true);
  const wrong=async url=>{
    if(url.includes('cdn.nba.com')||url.includes('cbssports.com')||url.includes('yahoo.com'))throw Error('unavailable');
    if(url.includes('foxsports.com'))throw Error('FOX must not be queried when ESPN disagrees');
    return {ok:true,json:async()=>url.includes('/summary?')?summary:espn(83,91,{id:'espn-game',status:{type:{state:'in'},period:4,displayClock:'09:47'}})};
  };
  assert.equal(await verifyIndependentOver(state,m,{market,fetcher:wrong}),false);
  const fallback=async url=>{
    if(url.includes('cdn.nba.com')||url.includes('cbssports.com')||url.includes('yahoo.com')||url.includes('espn.com'))throw Error('unavailable');
    return {ok:true,json:async()=>fox(85,96,{statusLine:'09:47'})};
  };
  assert.equal(await verifyIndependentOver(state,m,{market:{event_ticker:'KXNBATOTAL-DATE'},fetcher:fallback}),true);
});
test('WTA game totals need the exact ESPN match and all set games',async()=>{
  const milestone={id:'wta',title:'Rakhimova vs Alexandrova',type:'tennis_tournament_singles',start_date:start,details:{tour:'WTA'}};
  const live={details:{status:'live',competitor1_is_home:true,competitor1_round_scores:[{score:6},{score:4},{score:3}],competitor2_round_scores:[{score:4},{score:6},{score:2}]}};
  const state=gameState(milestone,live),market={event_ticker:'KXWTAGTOTAL-DATE',status:'active',title:'Over 24.5 games',rules_primary:'If the number of completed games in the full match is above 24.5, then Yes.',floor_strike:24.5,yes_ask_dollars:'0.90'};
  const competition={date:start,status:{type:{state:'in'}},competitors:[
    {homeAway:'home',athlete:{displayName:'Kamilla Rakhimova'},linescores:[{value:6},{value:4},{value:3}]},
    {homeAway:'away',athlete:{displayName:'Ekaterina Alexandrova'},linescores:[{value:4},{value:6},{value:2}]}]};
  const board={events:[{groupings:[{competitions:[competition]}]}]};
  assert.equal(scoreAgreement(state,[tennisMatches(board,state,milestone),[]],market),true);
  assert.equal(await verifyIndependentOver(state,milestone,{market,fetcher:async url=>({ok:true,json:async()=>board})}),true);
  const wrong={events:[{groupings:[{competitions:[{...competition,competitors:[competition.competitors[0],{...competition.competitors[1],linescores:[{value:4},{value:6},{value:1}]}]}]}]}]};
  assert.equal(await verifyIndependentOver(state,milestone,{market,fetcher:async()=>({ok:true,json:async()=>wrong})}),false);
  assert.equal(tennisMatches({events:[{groupings:[{competitions:[{...competition,date:new Date(Date.now()-86400000).toISOString()}]}]}]},state,milestone).length,0);
});
test('women college basketball uses its own ESPN scoreboard for independent verification',async()=>{
  const milestone={...m,details:{league:'NCAAW'}};
  const state=gameState(milestone,{details:{status:'live',home_score:24,away_score:20,period:1,home_team_name:'BOS Celtics',away_team_name:'BKN Nets'}});
  assert.equal(state.sport,'NCAAW');
  const urls=[];
  assert.equal(await verifyIndependentOver(state,milestone,{fetcher:async url=>{urls.push(url);return {ok:true,json:async()=>espn()}}}),true);
  assert.ok(urls.some(url=>url.includes('womens-college-basketball')));
});

