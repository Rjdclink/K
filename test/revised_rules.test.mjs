import test from 'node:test';
import assert from 'node:assert/strict';
import {gameState,leadSignal,leadWatchReason,earlyLeadSignal,additionalLeadSignal,cricketLeadSignal,overSignal,confirmedSoccerWinnerClock,soccerWinnerWindowOpen,kalshiOnlyLead,soccerSingleReadLead} from '../src/strategy.mjs';
import {golfState,golfSignal} from '../src/golf.mjs';
import {finalLeadFraction} from '../src/lead_allocation.mjs';
import {comboLegAllocation,comboAllocation} from '../src/combos.mjs';
import {prioritizeMarketGames} from '../src/discovery.mjs';

const now=Date.now();
function team(type,league,margin,period,seconds,extra={}){
 const milestone={id:`${league}-${type}`,type,title:'Away at Home',details:{league,home_team_id:'home',away_team_id:'away',home_competitor_id:'home',away_competitor_id:'away',main_game_event_ticker:'KXGAME-TEST'}};
 const live={milestone_id:milestone.id,_observed_at:new Date(now).toISOString(),details:{status:'live',home_score:20+margin,away_score:20,period,clock:`${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`,home_team_name:'Home',away_team_name:'Away',possession_team_id:'home',...extra}};
 const market={ticker:'KXGAME-TEST-HOME',event_ticker:'KXGAME-TEST',status:'active',title:'Home wins',yes_sub_title:'Home',custom_strike:{[type.split('_')[0]+'_team']:'home'},yes_ask_dollars:'.96',rules_primary:'Home wins after 90 minutes plus stoppage time.'};
 return {state:gameState(milestone,live),market,milestone};
}
const signal=(type,league,margin,period,seconds,extra={})=>{const {state,market}=team(type,league,margin,period,seconds,extra);return leadSignal(state,market)};

test('revised CFB and NFL winners replace the old early football and last-seconds routes',()=>{
 assert.ok(signal('football_game','CFB',12,4,269,{possession_team_id:'away'}));
 assert.equal(signal('football_game','CFB',11,4,269),null);
 assert.ok(signal('football_game','CFB',20,4,270));
 assert.ok(signal('football_game','CFB',17,4,299,{possession_team_id:'away'}));
 assert.ok(signal('football_game','CFB',24,4,449,{possession_team_id:'away'}));
 const {state,market}=team('football_game','NFL',40,3,30);
 assert.equal(earlyLeadSignal(state,market),null);
 assert.ok(signal('football_game','NFL',11,4,359));
 assert.equal(signal('football_game','NFL',10,4,121),null);
 assert.ok(signal('football_game','NFL',10,4,119));
 assert.equal(signal('football_game','NFL',9,4,19),null);
});

test('revised NBA, WNBA and college windows enforce score, clock and no college possession',()=>{
 assert.equal(signal('basketball_game','NBA',20,4,390),null);
 assert.equal(signal('basketball_game','NBA',25,4,450),null);
 assert.equal(signal('basketball_game','NBA',24,4,449),null);
 assert.ok(signal('basketball_game','NBA',25,4,449));
 assert.equal(signal('basketball_game','NBA',19,4,389),null);
 assert.ok(signal('basketball_game','NBA',20,4,389));
 assert.equal(signal('basketball_game','NBA',8,4,90),null);
 assert.ok(signal('basketball_game','NBA',8,4,89));
 assert.ok(signal('basketball_game','WNBA',11,4,300));
 assert.equal(signal('basketball_game','WNBA',10,4,300),null);
 assert.ok(signal('basketball_game','WNBA',8,4,89));
 assert.ok(signal('basketball_game','NCAAB',8,2,89,{possession_team_id:null}));
 assert.equal(signal('basketball_game','NCAAB',8,2,90),null);
 assert.equal(signal('basketball_game','NCAAB',30,1,20),null);
 const {state,market}=team('basketball_game','NCAAB',30,1,20);
 assert.equal(earlyLeadSignal(state,market),null);
 const first=team('basketball_game','NCAAB',12,2,70,{possession_team_id:'home'});
 const second=team('basketball_game','NCAAB',12,2,60,{possession_team_id:'away'});
 first.state.observedAt=now-12000;
 assert.equal(kalshiOnlyLead(first.state,second.state,first.market),true,
   'the fallback still waits ten seconds but cannot require stable college possession');
});

test('revised hockey and inning-based baseball winners reject superseded thresholds',()=>{
 assert.ok(signal('hockey_match','NHL',4,3,119));
 assert.equal(signal('hockey_match','NHL',3,3,119),null);
 assert.equal(signal('hockey_match','NHL',4,3,120),null);
 const baseball=(margin,inning,half,outs)=>team('baseball_game','MLB',margin,inning,0,{inning,inning_half:half,outs,clock:''});
 for(const [margin,inning,half,outs,allowed] of [[5,8,'bottom',2,true],[4,8,'bottom',2,false],[5,8,'top',2,false],[4,9,'top',1,true],[3,9,'top',1,false],[4,9,'top',0,false]]){
   const {state,market}=baseball(margin,inning,half,outs);
   assert.equal(Boolean(leadSignal(state,market)),allowed,`${margin} in ${half} ${inning}, ${outs} outs`);
   assert.equal(earlyLeadSignal(state,market),null);
 }
});

test('soccer winner allows +3 throughout the second half and +2 strictly under 7:30',()=>{
 const soccer=(margin,minute,remaining)=>team('soccer_match','Soccer',margin,2,0,{half:'2nd',time:`${minute}'`,match_remaining_seconds:remaining,clock:''});
 let {state,market}=soccer(3,47,2580);
 assert.ok(leadSignal(state,market));
 assert.equal(earlyLeadSignal(state,market),null);
 assert.equal(leadSignal(soccer(2,47,2580).state,market),null);
 assert.ok(leadSignal(soccer(3,50,2400).state,market));
 assert.ok(leadSignal(soccer(3,77,NaN).state,market));
 assert.ok(leadSignal(soccer(3,80,599).state,market));
 assert.equal(leadSignal(soccer(2,77,NaN).state,market),null);
 assert.equal(leadSignal(soccer(2,82,450).state,market),null);
 assert.ok(leadSignal(soccer(2,82,449).state,market));
 assert.ok(leadSignal(soccer(2,84,NaN).state,market));
 assert.ok(leadSignal(soccer(4,84,NaN).state,market));
 assert.ok(leadSignal(soccer(4,84,NaN).state,{...market,yes_ask_dollars:'1.0000'}),
   'the score rule remains visible even when the orderbook has no executable ask');
 assert.equal(leadSignal(soccer(2,84,0).state,market),null);
 assert.ok(leadSignal(soccer(3,85,299).state,market));
 assert.ok(leadSignal(soccer(3,93,NaN).state,market),
   'stoppage time belongs to the 90-minutes-plus-stoppage winner contract');
 assert.equal(leadSignal(team('soccer_match','Soccer',3,2,0,
   {half:'2nd',time:"93'",match_status:'aet',clock:''}).state,market),null);
 assert.equal(leadSignal(soccer(1,89,10).state,market),null);
 assert.equal(confirmedSoccerWinnerClock(soccer(2,82,449).state,soccer(2,82,448).state),true);
 assert.equal(confirmedSoccerWinnerClock(soccer(2,82,449).state,soccer(2,82,449).state),false);
 assert.equal(confirmedSoccerWinnerClock(soccer(2,82,450).state,soccer(2,82,449).state),false);
 assert.equal(confirmedSoccerWinnerClock(soccer(2,84,NaN).state,soccer(2,84,NaN).state),true);
 assert.equal(confirmedSoccerWinnerClock(soccer(3,47,2580).state,soccer(3,47,2579).state),true);
 assert.match(leadWatchReason(soccer(3,47,2580).state),/3-goal lead/);
 assert.match(leadWatchReason(soccer(3,77,NaN).state),/late winner rule reached/);
 assert.match(leadWatchReason(soccer(2,75,900).state),/2-goal lead/);
 assert.match(leadWatchReason(soccer(4,84,NaN).state),/late winner rule reached/);
 assert.match(leadWatchReason(soccer(4,93,NaN).state),/late winner rule reached/);
 assert.equal(leadWatchReason(soccer(2,47,2580).state),null);
 assert.equal(soccerWinnerWindowOpen({...soccer(2,84,NaN).state,observedAt:now},now),true);
 assert.equal(soccerWinnerWindowOpen({...soccer(2,93,NaN).state,observedAt:now},now),true);
 assert.equal(soccerWinnerWindowOpen({...soccer(2,83,5).state,observedAt:now},now),false);
 assert.equal(soccerWinnerWindowOpen({...soccer(2,84,0).state,observedAt:now},now),false);
 assert.equal(soccerWinnerWindowOpen({...state,observedAt:now,matchRemainingSeconds:NaN},now),true);
});
test('soccer entry reuses one Kalshi score for 30 seconds on the correct contract',()=>{
  const soccer=(margin,minute,remaining)=>team('soccer_match','Soccer',margin,2,0,
    {half:'2nd',time:`${minute}'`,match_remaining_seconds:remaining,clock:''});
  const {state,market}=soccer(2,84,NaN);
  assert.equal(soccerSingleReadLead(state,market,state.observedAt+29999),true);
  assert.equal(soccerSingleReadLead(state,market,state.observedAt+30001),false);
  assert.equal(soccerSingleReadLead(soccer(2,77,NaN).state,market,now),false);
  assert.equal(soccerSingleReadLead(soccer(3,77,NaN).state,market,now),true);
  assert.equal(soccerSingleReadLead(state,{...market,custom_strike:{soccer_team:'away'}},now),false);
  assert.equal(soccerSingleReadLead({...state,clockRunning:false},market,now),false);
  assert.equal(soccerSingleReadLead({...state,scoreConsistent:false},market,now),false);
  assert.equal(soccerSingleReadLead({...state,feedId:'another-game'},market,now),false);
  const tie={...soccer(0,89,49).state,matchRemainingSeconds:49};
  const tieMarket={...market,title:'Tie',yes_sub_title:'Tie',rules_primary:'Tie settles Yes after 90 minutes plus stoppage time.'};
  assert.equal(soccerSingleReadLead(tie,tieMarket,now),true);
  assert.equal(soccerSingleReadLead({...tie,matchRemainingSeconds:50},tieMarket,now),false);
});

test('rugby +15 is one tier; cricket +30 and golf +4 use the revised thresholds',()=>{
 const rugby=team('rugby_match','United Rugby Championship',15,2,179);
 assert.equal(additionalLeadSignal(rugby.state,{...rugby.market,event_ticker:'KXRUGBYMATCH-TEST'})?.fraction,.10);
 const weaker=team('rugby_match','United Rugby Championship',14,2,179);
 assert.equal(additionalLeadSignal(weaker.state,{...weaker.market,event_ticker:'KXRUGBYMATCH-TEST'}),null);
 const higher=team('rugby_match','United Rugby Championship',27,2,179);
 assert.equal(additionalLeadSignal(higher.state,{...higher.market,event_ticker:'KXRUGBYMATCH-TEST'})?.fraction,.10);
 const cricket={type:'cricket_match',verifiedLive:true,scoreKnown:true,scoreConsistent:true,homeTeamId:'home',awayTeamId:'away',cricket:{innings:2,ballsRemaining:9,wicketsRemaining:2,homeTotal:130,awayTotal:100,mainEvent:'KXCRICKETMATCH-TEST'}};
 const cm={status:'active',event_ticker:'KXCRICKETMATCH-TEST',title:'Home wins',rules_primary:'Home wins',custom_strike:{cricket_team:'home'},yes_ask_dollars:'.95'};
 assert.ok(cricketLeadSignal(cricket,cm));
 assert.equal(cricketLeadSignal({...cricket,cricket:{...cricket.cricket,homeTotal:129}},cm),null);
 const gm={id:'g',type:'golf_tournament',title:'Open',details:{tour:'pga',main_game_event_ticker:'KXGOLFMATCH-TEST'}};
 const golf=board=>golfState(gm,{milestone_id:'g',details:{status:'inprogress',current_round:4,leaderboard:board}});
 const b=[{competitor_id:'a',total_score:-10,current_round_thru:18},{competitor_id:'b',total_score:-6,current_round_thru:17}];
 const gmarket={status:'active',event_ticker:'KXGOLFMATCH-TEST',custom_strike:{golf_competitor:'a'},yes_sub_title:'A',rules_primary:'A wins'};
 assert.ok(golfSignal(golf(b),gmarket));
 assert.equal(golfSignal(golf([{...b[0],total_score:-9},b[1]]),gmarket),null);
});

test('player props use the extra-stat cushion immediately and relax only after seven continuous minutes',()=>{
 const market={ticker:'KXNBASTL-TEST-P',event_ticker:'KXNBASTL-TEST',status:'active',floor_strike:1.5,yes_sub_title:'Pat Player: 2+',title:'Pat Player: 2+ steals',custom_strike:{basketball_player:'p'},yes_ask_dollars:'.90'};
 const game=steals=>({...team('basketball_game','NBA',15,4,60).state,playerStats:{p:{steals}},playerPropFirstCrossedAt:{}});
 assert.equal(overSignal(game(2),market),null);
 assert.equal(overSignal(game(3),market)?.fraction,.40);
 const early=game(2);early.playerPropFirstCrossedAt[market.ticker]=new Date(now-419000).toISOString();
 assert.equal(overSignal(early,market),null);
 const aged=game(2);aged.playerPropFirstCrossedAt[market.ticker]=new Date(now-421000).toISOString();
 assert.equal(overSignal(aged,market)?.fraction,.10);
 assert.equal(overSignal(game(1),market),null);
});

test('winner and combo allocations follow 20% independent, 10% fallback; crossed overs remain separate',()=>{
 const lead={strategy:'lead',fraction:.05},over={strategy:'over',fraction:.40};
 assert.equal(finalLeadFraction({}, {},lead,true),.20);
 assert.equal(finalLeadFraction({}, {},lead,false),.10);
 assert.equal(finalLeadFraction({}, {},over,true),.40);
 const verified={signal:{strategy:'lead',externallyVerified:true}},fallback={signal:{strategy:'lead',externallyVerified:false}};
 assert.equal(comboAllocation(),.20);
 assert.equal(comboLegAllocation([verified,verified],comboAllocation()),.20);
 assert.equal(comboLegAllocation([verified,fallback],comboAllocation()),.10);
 assert.equal(comboLegAllocation([verified,{signal:{strategy:'over',externallyVerified:true}}],comboAllocation()),.10);
});

test('active crossed-prop games join the urgent scan instead of the rotating early-game budget',()=>{
 const games=['prop','early'].map(id=>({milestone:{id},state:{verifiedLive:true,type:'basketball_game',sport:'NBA',period:1,remainingSeconds:600},watchable:false}));
 const selected=prioritizeMarketGames(games,{signaledIds:new Set(['prop']),lowBudget:0});
 assert.deepEqual(selected.map(g=>g.milestone.id),['prop']);
});
