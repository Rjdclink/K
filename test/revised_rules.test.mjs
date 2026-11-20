import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gameState,leadSignal,leadWatchReason,earlyLeadSignal,additionalLeadSignal,cricketLeadSignal,overSignal,confirmedSoccerWinnerClock,soccerWinnerWindowOpen,kalshiOnlyLead,soccerSingleReadLead,soccerSingleReadOver,singleReadOverSignal,kalshiSingleReadLead,nbaSingleReadLead} from '../src/strategy.mjs';
import {golfState,golfSignal} from '../src/golf.mjs';
import {finalLeadFraction,directLeadFraction,minimumThreeGoalSpend} from '../src/lead_allocation.mjs';
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

test('football uses inclusive score/time cutoffs and ignores possession',()=>{
 for(const [league,tiers] of [['CFB',[[18,450],[15,300],[12,270]]],['NFL',[[11,450],[8,120]]]]){
  for(const [points,seconds] of tiers)for(const possession of ['home','away',null]){
   assert.ok(signal('football_game',league,points,4,seconds,{possession_team_id:possession}));
   assert.ok(signal('football_game',league,points+1,4,seconds,{possession_team_id:possession}));
   assert.equal(signal('football_game',league,points-1,4,seconds,{possession_team_id:possession}),null);
   assert.equal(signal('football_game',league,points,4,seconds+1,{possession_team_id:possession}),null);
   assert.equal(signal('football_game',league,points,3,seconds,{possession_team_id:possession}),null);
  }
 }
});

test('basketball tiers include the stated lead and exclude the exact time boundary',()=>{
 const categories=[['NBA',4,[[16,270],[7,105]]],['WNBA',4,[[11,360],[7,105]]],
   ['NCAAB',2,[[18,270],[14,105]]],['NCAAW',4,[[18,270],[14,105]]],
   ...['China CBA','Italy Serie A','LNB Elite','Japan B League'].map(s=>[s,4,[[16,300],[10,270]]])];
 for(const [league,period,tiers] of categories)for(const [points,seconds] of tiers){
   const entrySeconds=Math.min(seconds,270);
   assert.ok(signal('basketball_game',league,points,period,entrySeconds-1),`${league} +${points} under ${entrySeconds}`);
   assert.ok(signal('basketball_game',league,points+1,period,entrySeconds-1));
   if(seconds<=270)assert.equal(Boolean(signal('basketball_game',league,points-1,period,entrySeconds-1)),false);
   assert.equal(signal('basketball_game',league,points,period,seconds),null);
   assert.equal(signal('basketball_game',league,points,period-1,entrySeconds-1),null);
 }
 for(const [league,period,margin] of [['NBA',4,16],['WNBA',4,11],['NCAAB',2,18],['NCAAW',4,18],['China CBA',4,16]]){
   assert.equal(signal('basketball_game',league,margin,period,270),null,`${league} exactly 4:30`);
   assert.ok(signal('basketball_game',league,margin,period,269),`${league} under 4:30`);
 }
 for(const league of ['NBA','WNBA','NCAAB','NCAAW','China CBA','Italy Serie A']){
   const period=league==='NCAAB'?2:4,minimum=['NBA','WNBA'].includes(league)?7:['NCAAB','NCAAW'].includes(league)?14:10;
   assert.ok(signal('basketball_game',league,minimum,period,104),`${league} under 1:45`);
   assert.equal(Boolean(signal('basketball_game',league,minimum-1,period,104)),!['NBA','WNBA','NCAAB','NCAAW'].includes(league));
   if(league==='NBA'||league==='WNBA')assert.equal(signal('basketball_game',league,minimum,period,105),null);
 }
 assert.equal(signal('basketball_game','NCAAW',12,4,268),null,'Jacksonville +12 at 4:28 is excluded');
 assert.equal(signal('basketball_game','NCAAW',12,4,105),null,'the new boundary is strict');
 assert.equal(signal('basketball_game','NCAAW',12,4,104),null,'the former +12 entry is disabled');
 assert.equal(signal('basketball_game','NCAAW',13,4,104),null);
 assert.ok(signal('basketball_game','NCAAW',14,4,104),'the +14 entry opens under 1:45');
 assert.equal(signal('basketball_game','NCAAW',7,4,104),null,'the former +7 closeout cannot bypass +12');
 assert.ok(signal('basketball_game','NCAAW',18,4,268),'the stronger early tier remains');
 assert.equal(signal('basketball_game','NBA',12,4,268),null,'the former NBA +12 route is removed');
 assert.ok(signal('basketball_game','NBA',16,4,268));
 for(const league of ['NCAAB','NCAAW','China CBA','Italy Serie A']){
   const period=league==='NCAAB'?2:4;
   const {state,market}=team('basketball_game',league,['NCAAB','NCAAW'].includes(league)?18:16,period,269,{possession_team_id:null});
   assert.ok(leadSignal(state,market));
   assert.match(leadWatchReason(state),/score and clock qualify/);
   assert.equal(nbaSingleReadLead({...state,updatedAt:now-1000},market,now),false);
 }
 for(const league of ['NBA','WNBA']){
   const margin=league==='NBA'?18:11,seconds=269;
   for(const possession of ['home','away',null]){
     const {state,market}=team('basketball_game',league,margin,4,seconds,{possession_team_id:possession});
     assert.ok(leadSignal(state,market));
     assert.match(leadWatchReason(state),/score and clock qualify; checking winner market and ask/);
   }
 }
 const first=team('basketball_game','NCAAB',18,2,70,{possession_team_id:'home'});
 const second=team('basketball_game','NCAAB',18,2,60,{possession_team_id:'away'});
 first.state.observedAt=now-12000;
 assert.equal(kalshiOnlyLead(first.state,second.state,first.market),true);
 const nbaFirst=team('basketball_game','NBA',20,4,200,{possession_team_id:'home'});
 const nbaSecond=team('basketball_game','NBA',20,4,190,{possession_team_id:'away'});
 nbaFirst.state.observedAt=now-12000;
 assert.equal(kalshiOnlyLead(nbaFirst.state,nbaSecond.state,nbaFirst.market),true);
});

test('revised hockey and inning-based baseball winners reject superseded thresholds',()=>{
 assert.ok(signal('hockey_match','NHL',4,3,119));
 assert.equal(signal('hockey_match','NHL',1,3,119),null);
 assert.equal(signal('hockey_match','NHL',2,3,360),null);
 assert.ok(signal('hockey_match','NHL',2,3,226));
 assert.equal(signal('hockey_match','NHL',3,3,600),null);
 assert.ok(signal('hockey_match','NHL',3,3,599));
 assert.ok(signal('hockey_match','NHL',2,3,210));
 const baseball=(margin,inning,half,outs)=>team('baseball_game','MLB',margin,inning,0,{inning,inning_half:half,outs,clock:''});
 for(const [margin,inning,half,outs,allowed] of [[5,8,'bottom',2,true],[4,8,'bottom',2,false],[5,8,'top',2,false],[4,9,'top',1,false],[20,9,'bottom',2,false],[3,9,'top',1,false],[4,9,'top',0,false]]){
   const {state,market}=baseball(margin,inning,half,outs);
   assert.equal(Boolean(leadSignal(state,market)),allowed,`${margin} in ${half} ${inning}, ${outs} outs`);
   assert.equal(earlyLeadSignal(state,market),null);
 }
});
test('three-goal hockey winner has a 5% maximum with no contradictory 15% minimum',()=>{
 const {state,market}=team('hockey_match','NHL',3,3,405),winner=leadSignal(state,market);
 assert.ok(winner);
 assert.equal(minimumThreeGoalSpend(state,winner,market,10000),0);
 assert.equal(minimumThreeGoalSpend(state,winner,market,10001),0);
 assert.equal(directLeadFraction(state,winner,market),.05);
 assert.equal(finalLeadFraction(state,state,winner,false,market),.05);
 assert.equal(minimumThreeGoalSpend(state,winner,{...market,yes_ask_dollars:'.50'},10000),0);
});
test('soccer commanding winners share the same 5% limit; draw remains a separate strategy',()=>{
 const {state,market}=team('soccer_match','Soccer',3,2,0,
   {half:'2nd',time:"85'",match_remaining_seconds:299,clock:''}),winner=leadSignal(state,market);
 assert.ok(winner);
 assert.equal(minimumThreeGoalSpend(state,winner,market,10000),0);
 assert.equal(directLeadFraction(state,winner,market),.05);
 assert.equal(finalLeadFraction(state,state,winner,true,market),.05);
 assert.equal(minimumThreeGoalSpend({...state,homeUnits:state.awayUnits+2},{...winner},market,10000),0);
});
test('preview, initial order, and retry no longer enforce an obsolete 15% commanding-lead floor',()=>{
 const source=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
 assert.equal((source.match(/estimatedCostCents\([^\n]+<minimumThreeGoalSpend\(/g)||[]).length,0);
});

test('soccer commanding winner replaces legacy windows: +3 strictly under 10:00 or +2 strictly under 6:00',()=>{
 const soccer=(margin,minute,remaining=undefined)=>team('soccer_match','Soccer',margin,2,0,
   {half:'2nd',time:`${minute}'`,match_remaining_seconds:remaining,clock:''});
 const {market}=soccer(3,47);
 for(const [margin,time,allowed] of [
   [3,'79:59',false],[3,80,false],[3,'80:01',true],[3,83,true],
   [2,84,false],[2,'84:01',true],[2,87,true],[1,89,false],
   [3,90,false],[3,93,false]]){
  assert.equal(Boolean(leadSignal(soccer(margin,time).state,market)),allowed,`+${margin} at ${time}`);
 }
 assert.equal(leadSignal(soccer(3,75,899).state,market),null,'no legacy fifteen-minute route');
 assert.ok(leadSignal(soccer(3,'80:01',NaN).state,market),'entry derives from regulation clock, not a speculative feed countdown');
 assert.equal(leadSignal(soccer(2,84,299).state,market),null,'feed countdown cannot override elapsed regulation clock');
 assert.equal(leadSignal(soccer(3,93,200).state,market),null,'stoppage cannot extend entry');
 assert.equal(confirmedSoccerWinnerClock(soccer(2,87).state,soccer(2,'87:01').state),true);
 assert.equal(confirmedSoccerWinnerClock(soccer(2,87).state,soccer(2,87).state),false);
 assert.match(leadWatchReason(soccer(3,79).state),/10:00/);
 assert.match(leadWatchReason(soccer(3,83).state),/late winner rule reached/);
 assert.match(leadWatchReason(soccer(2,83).state),/waiting for score and clock threshold/);
 assert.match(leadWatchReason(soccer(2,85).state),/late winner rule reached/);
 assert.equal(leadWatchReason(soccer(3,93).state),null);
 assert.equal(soccerWinnerWindowOpen({...soccer(2,93).state,observedAt:now},now),false);
 assert.equal(soccerWinnerWindowOpen({...soccer(2,87).state,observedAt:now},now),true);
});

test('soccer entry reuses one Kalshi score for 30 seconds on the correct contract',()=>{
  const soccer=(margin,minute,remaining)=>team('soccer_match','Soccer',margin,2,0,
    {half:'2nd',time:`${minute}'`,match_remaining_seconds:remaining,clock:''});
  const {state,market}=soccer(2,87,NaN);
  assert.equal(soccerSingleReadLead(state,market,state.observedAt+29999),true);
  assert.equal(soccerSingleReadLead(state,market,state.observedAt+30001),false);
  assert.equal(soccerSingleReadLead(soccer(2,77,NaN).state,market,now),false);
  assert.equal(soccerSingleReadLead(soccer(3,83,NaN).state,market,now),true);
  assert.equal(soccerSingleReadLead(state,{...market,custom_strike:{soccer_team:'away'}},now),false);
  assert.equal(soccerSingleReadLead({...state,clockRunning:false},market,now),false);
  assert.equal(soccerSingleReadLead({...state,scoreConsistent:false},market,now),false);
  assert.equal(soccerSingleReadLead({...state,feedId:'another-game'},market,now),false);
  const tie={...soccer(0,89,49).state,matchRemainingSeconds:49};
  const tieMarket={...market,title:'Tie',yes_sub_title:'Tie',rules_primary:'Tie settles Yes after 90 minutes plus stoppage time.'};
  assert.equal(soccerSingleReadLead(tie,tieMarket,now),false,'all automatic soccer tie entries are disabled');
  assert.equal(soccerSingleReadLead({...tie,matchRemainingSeconds:10},tieMarket,tie.observedAt+11000),false);
  assert.equal(soccerSingleReadLead({...tie,matchRemainingSeconds:50},tieMarket,now),false);
});

test('rugby +15 is one tier; cricket +15 and golf +4 use the revised thresholds',()=>{
 const rugby=team('rugby_match','United Rugby Championship',15,2,179);
 assert.equal(additionalLeadSignal(rugby.state,{...rugby.market,event_ticker:'KXRUGBYMATCH-TEST'})?.fraction,.15);
 const weaker=team('rugby_match','United Rugby Championship',14,2,179);
 assert.equal(additionalLeadSignal(weaker.state,{...weaker.market,event_ticker:'KXRUGBYMATCH-TEST'}),null);
 const higher=team('rugby_match','United Rugby Championship',27,2,179);
 assert.equal(additionalLeadSignal(higher.state,{...higher.market,event_ticker:'KXRUGBYMATCH-TEST'})?.fraction,.15);
 const cricket={type:'cricket_match',verifiedLive:true,scoreKnown:true,scoreConsistent:true,homeTeamId:'home',awayTeamId:'away',cricket:{innings:2,ballsRemaining:9,wicketsRemaining:2,homeTotal:130,awayTotal:100,mainEvent:'KXCRICKETMATCH-TEST'}};
 const cm={status:'active',event_ticker:'KXCRICKETMATCH-TEST',title:'Home wins',rules_primary:'Home wins',custom_strike:{cricket_team:'home'},yes_ask_dollars:'.95'};
 assert.ok(cricketLeadSignal(cricket,cm));
 assert.ok(cricketLeadSignal({...cricket,cricket:{...cricket.cricket,homeTotal:115}},cm));
 assert.equal(cricketLeadSignal({...cricket,cricket:{...cricket.cricket,homeTotal:115,targetAdjusted:true}},cm),null);
 assert.equal(cricketLeadSignal({...cricket,cricket:{...cricket.cricket,homeTotal:114}},cm),null);
 const gm={id:'g',type:'golf_tournament',title:'Open',details:{tour:'pga',main_game_event_ticker:'KXGOLFMATCH-TEST'}};
 const golf=board=>golfState(gm,{milestone_id:'g',details:{status:'inprogress',current_round:4,leaderboard:board}});
 const b=[{competitor_id:'a',total_score:-10,current_round_thru:18},{competitor_id:'b',total_score:-6,current_round_thru:17}];
 const gmarket={status:'active',event_ticker:'KXGOLFMATCH-TEST',custom_strike:{golf_competitor:'a'},yes_sub_title:'A',rules_primary:'A wins'};
 assert.ok(golfSignal(golf(b),gmarket));
 assert.equal(golfSignal(golf([{...b[0],total_score:-9},b[1]]),gmarket),null);
});

test('crossed player props are candidates through the ten-minute boundary',()=>{
 const market={ticker:'KXNBASTL-TEST-P',event_ticker:'KXNBASTL-TEST',status:'active',floor_strike:1.5,yes_sub_title:'Pat Player: 2+',title:'Pat Player: 2+ steals',custom_strike:{basketball_player:'p'},yes_ask_dollars:'.90'};
 const game=steals=>({...team('basketball_game','NBA',15,4,600).state,playerStats:{p:{steals}},playerPropFirstCrossedAt:{}});
 assert.equal(overSignal(game(2),market)?.fraction,.10);
 assert.equal(overSignal(game(3),market)?.fraction,.10);
 const early=game(2);early.playerPropFirstCrossedAt[market.ticker]=new Date(now-419000).toISOString();
 assert.equal(overSignal(early,market)?.fraction,.10);
 const aged=game(2);aged.playerPropFirstCrossedAt[market.ticker]=new Date(now-421000).toISOString();
 assert.equal(overSignal(aged,market)?.fraction,.10);
 assert.equal(overSignal(game(1),market),null);
 assert.equal(overSignal({...game(3),remainingSeconds:599},market),null);
});

test('winner allocation remains 20%; verified combos use 35%, fallback combos 15%',()=>{
 const lead={strategy:'lead',fraction:.05},over={strategy:'over',fraction:.40};
 assert.equal(finalLeadFraction({}, {},lead,true),.20);
 assert.equal(finalLeadFraction({}, {},lead,false),.15);
 assert.equal(finalLeadFraction({}, {},over,true),.40);
 const verified={signal:{strategy:'lead',externallyVerified:true}},fallback={signal:{strategy:'lead',externallyVerified:false}};
 assert.equal(comboAllocation(),.35);
 assert.equal(comboLegAllocation([verified,verified],comboAllocation()),.35);
 assert.equal(comboLegAllocation([verified,fallback],comboAllocation()),.15);
 assert.equal(comboLegAllocation([verified,{signal:{strategy:'over',externallyVerified:true}}],comboAllocation()),.15);
});

test('active crossed-prop games join the urgent scan instead of the rotating early-game budget',()=>{
 const games=['prop','early'].map(id=>({milestone:{id,type:'basketball_game',details:{league:'NBA'}},state:{verifiedLive:true,type:'basketball_game',sport:'NBA',period:1,remainingSeconds:600},watchable:false}));
 const selected=prioritizeMarketGames(games,{signaledIds:new Set(['prop']),lowBudget:0});
 assert.deepEqual(selected.map(g=>g.milestone.id),['prop']);
});


test('a soccer over requires an extra-goal cushion even on the single-read route',()=>{
 const m={id:'mumbai',type:'soccer_match',title:'Mumbai vs SC Delhi'};
 const raw={milestone_id:m.id,_observed_at:new Date(now).toISOString(),details:{status:'live',home_score:2,away_score:3,period:2,half:'2nd',time:"96'"}};
 const state=gameState(m,raw);
 const market={ticker:'KXSOCCERTOTAL-MUMDEL-5',event_ticker:'KXSOCCERTOTAL-MUMDEL',status:'active',title:'Will over 4.5 goals be scored?',rules_primary:'Combined total goals scored after 90 minutes plus stoppage time.',floor_strike:4.5,strike_type:'greater',yes_ask_dollars:'.99'};
 assert.equal(soccerSingleReadOver(state,market,state.observedAt+29999),null);
 assert.equal(soccerSingleReadOver({...state,home:3,homeUnits:3},market,state.observedAt+29999)?.fraction,.40);
 assert.equal(soccerSingleReadOver(state,market,state.observedAt+30001),null);
 assert.equal(soccerSingleReadOver({...state,home:1,homeUnits:1},market,now),null);
 assert.equal(soccerSingleReadOver({...state,feedId:'other'},market,now),null);
 assert.equal(soccerSingleReadOver({...state,scoreConsistent:false},market,now),null);
 assert.equal(soccerSingleReadOver({...state,soccerExtraTime:true},market,now),null);
 assert.equal(soccerSingleReadOver(state,{...market,status:'closed'},now),null);
 assert.equal(soccerSingleReadOver(state,{...market,title:'Will over 5.5 goals be scored?',floor_strike:5.5},now),null);
});


test('commanding leads qualify on one recent Kalshi observation without an external scoreboard',()=>{
 const cases=[['basketball_game','NBA',18,4,269,{}],['basketball_game','WNBA',10,4,89,{}],
 ['basketball_game','NCAAB',18,2,269,{}],['basketball_game','China CBA',16,4,269,{}],
 ['football_game','CFB',24,4,449,{}],['football_game','NFL',11,4,359,{}],
 ['hockey_match','NHL',4,3,119,{}],['baseball_game','MLB',5,8,0,{inning:8,inning_half:'bottom',outs:2,clock:''}]];
 for(const args of cases){
  const {state,market}=team(...args);
  assert.equal(kalshiSingleReadLead(state,market,state.observedAt+29999),true,args[1]);
  assert.equal(kalshiSingleReadLead(state,market,state.observedAt+30001),false);
  assert.equal(kalshiSingleReadLead({...state,scoreConsistent:false},market,now),false);
 }
});

test('non-player overs require a scoring cushion; player overs retain independent verification',()=>{
 const {state}=team('basketball_game','NBA',3,4,60);
 const total={event_ticker:'KXNBATOTAL-TEST',status:'active',title:'Over 42.5 total points',rules_primary:'Combined total points scored',floor_strike:42.5,strike_type:'greater',yes_ask_dollars:'.99'};
 assert.equal(singleReadOverSignal(state,total,now),null);
 assert.equal(singleReadOverSignal({...state,home:state.home+4},total,now)?.fraction,.40);
 const player={event_ticker:'KXNBASTL-TEST',status:'active',title:'Pat Player: 2+ steals',floor_strike:1.5,custom_strike:{basketball_player:'pat'},yes_ask_dollars:'.95'};
 const credited={...state,remainingSeconds:600,playerStats:{pat:{steals:4}}};
 assert.ok(overSignal(credited,player));
 assert.equal(singleReadOverSignal(credited,player,now),null);
});


test('college women use the fourth quarter rather than a second-half period number',()=>{
 assert.equal(signal('basketball_game','NCAAW',18,2,269),null);
 assert.ok(signal('basketball_game','NCAAW',18,4,269));
 assert.equal(signal('basketball_game','NCAAW',12,4,105),null);
 assert.equal(signal('basketball_game','NCAAW',12,4,104),null);
 assert.ok(signal('basketball_game','NCAAW',14,4,104));
});

test('hockey commanding lead replaces legacy windows: +3 strictly under 10:00 or +2 strictly under 6:00',()=>{
 for(const league of ['NHL','Germany DEL']){
  for(const [margin,seconds,allowed] of [[3,600,false],[3,599,true],[3,405,true],
    [2,600,false],[2,360,false],[2,359,true],[2,225,true],[1,225,false],[4,0,false]]){
   const {state,market}=team('hockey_match',league,margin,3,seconds);
   assert.equal(Boolean(leadSignal(state,market)),allowed,`${league}: ${margin} at ${seconds}`);
   assert.equal(kalshiSingleReadLead(state,market,now),allowed);
  }
  assert.equal(signal('hockey_match',league,4,2,405),null,'second period never qualifies');
  assert.match(leadWatchReason(team('hockey_match',league,3,3,405).state),/score and clock qualify/);
  assert.match(leadWatchReason(team('hockey_match',league,2,3,405).state),/waiting for clock threshold/);
 }
});