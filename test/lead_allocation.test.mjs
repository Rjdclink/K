import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {finalLeadFraction,leaderHasControl} from '../src/lead_allocation.mjs';
import {gameState,earlyLeadSignal,kalshiOnlyLead,nbaSingleReadLead} from '../src/strategy.mjs';

const lead={strategy:'lead',fraction:.15};
const game=(type,possessionSide='home')=>({type,sport:'Other',home:30,away:10,homeUnits:30,awayUnits:10,possessionSide});
test('winner allocations are uniform after independent verification',()=>{
  for(const type of ['hockey_match','football_game','baseball_game','rugby_match','handball_match','lacrosse_game','table_tennis_match']){
    const g=game(type);
    assert.equal(finalLeadFraction(g,g,lead,true),.20,type);
    assert.equal(finalLeadFraction(g,g,lead,false),.10,type+' fallback cap');
    assert.equal(finalLeadFraction({...g,possessionSide:null},g,lead,true),.20,'both observations must establish control');
    assert.equal(finalLeadFraction(g,{...g,possessionSide:'away'},lead,true),.20);
  }
  const volleyball={...game('volleyball_match'),homeUnits:2,awayUnits:2,volleyball:{current:{home:14,away:10}}};
  assert.equal(finalLeadFraction(volleyball,volleyball,lead,true),.20);
  const golf={type:'golf_tournament',golf:{}};
  assert.equal(finalLeadFraction(golf,golf,{...lead,fraction:.10},true),.20,'golf has no possession bonus');
});
test('rugby competitor IDs can identify the leader in possession without guessing',()=>{
  const milestone={id:'rugby',type:'rugby_match',title:'Home vs Away',details:{league:'United Rugby Championship',
    home_competitor_id:'home-id',away_competitor_id:'away-id'}};
  const live={milestone_id:'rugby',details:{status:'live',period:2,clock:'00:38',home_score:0,away_score:19,
    possession_team_id:'away-id'}};
  const state=gameState(milestone,live);
  assert.equal(state.possessionSide,'away');
  assert.equal(leaderHasControl(state),true);
  assert.equal(gameState(milestone,{...live,details:{...live.details,possession_team_id:'unrecognized'}}).possessionSide,null);
});
test('tennis serve, table-tennis serve, and darts turn must identify the leading competitor',()=>{
  for(const type of ['tennis_match','table_tennis_match']){
    const g=gameState({id:'g',type,title:'Alpha vs Beta',details:{first_competitor_id:'a',second_competitor_id:'b'}},
      {details:{status:'live',server:'a',home_score:5,away_score:4,competitor1_round_scores:[{score:5}],competitor2_round_scores:[{score:4}],period_scores:[{type:'set',number:5,competitor1_score:10,competitor2_score:5}]}});
    assert.equal(g.possessionSide,'home');
    assert.equal(finalLeadFraction(g,g,lead,true),.20);
  }
  const d={...game('darts_match'),darts:{firstId:'a',secondId:'b',firstLegs:5,secondLegs:3,nextThrow:'a'}};
  assert.equal(finalLeadFraction(d,d,lead,true),.20);
  assert.equal(leaderHasControl({...d,darts:{...d.darts,nextThrow:'b'}}),false);
});
test('CFB and soccer follow the same verification-based allocation',()=>{
  const cfb={...game('football_game'),sport:'CFB'};
  assert.equal(finalLeadFraction(cfb,cfb,{...lead,fraction:.35},true),.20);
  assert.equal(finalLeadFraction(cfb,cfb,{...lead,fraction:.35},false),.10);
  const soccer={...game('soccer_match'),home:2,away:0,homeUnits:2,awayUnits:0,matchRemainingSeconds:19};
  assert.equal(finalLeadFraction(soccer,soccer,{...lead,fraction:.40},true),.20);
  assert.equal(finalLeadFraction(soccer,soccer,{...lead,fraction:.40},false),.10);
  assert.equal(finalLeadFraction(cfb,cfb,{strategy:'over',fraction:.30},true),.30);
  const tied={...game('basketball_game'),home:10,away:10,homeUnits:10,awayUnits:10};
  assert.equal(finalLeadFraction(tied,tied,{...lead,fraction:.05},true),.10,'ordinary basketball allocation stays capped');
});
test('both live entry paths use the final verified allocation and funding rechecks recalculate it',()=>{
  const source=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
  assert.match(source,/directSoccer\?Math.min\(\.10,signal.fraction\):finalLeadFraction\(first,second,signal,independent===true,quote\)/);
  assert.match(source,/finalLeadFraction\(c.state,freshState,verifiedSignal,!kalshiOnly,quote\)/);
  assert.match(source,/directSoccer\?Math.min\(\.10,still.fraction\):finalLeadFraction\(state,checked,still,!kalshiOnly,executable\)/);
});
test('strong Kalshi-only leads use 20% only after two stable reads and a score cushion',()=>{
  const now=Date.now(),observed=(age)=>({observedAt:now-age,updatedAt:now-age-1000,
    id:'game',feedId:'game',verifiedLive:true,scoreKnown:true,scoreConsistent:true,periodConsistent:true});
  const tableMarket={event_ticker:'KXLIGAPROMATCH-DATE',status:'active',title:'Oleg Moshnikov',yes_sub_title:'Oleg Moshnikov',custom_strike:{table_tennis_competitor:'oleg'},yes_ask_dollars:'0.93'};
  const table={type:'table_tennis_match',home:2,away:2,homeName:'Oleg Moshnikov',awayName:'Iurii Krivenkii',
    tableTennis:{bestOf:5,setNumber:5,firstSets:2,secondSets:2,firstPoints:9,secondPoints:2,firstId:'oleg',secondId:'iurii',firstIsHome:true}};
  const check=(state,market,expected,qualifies=true)=>{
    const a={...observed(12000),...state},b={...observed(0),...state,
      ...(/soccer/.test(state.type)?{matchRemainingSeconds:state.matchRemainingSeconds-1}:{}),
      ...(/hockey/.test(state.type)?{remainingSeconds:state.remainingSeconds-1}:{})};
    assert.equal(kalshiOnlyLead(a,b,market),qualifies);
    assert.equal(finalLeadFraction(a,b,lead,false,market),expected);
    assert.equal(finalLeadFraction({...a,observedAt:now-3000},b,lead,false,market),.10,'short dwell never unlocks 20%');
  };
  check(table,tableMarket,.20);
  check({...table,tableTennis:{...table.tableTennis,firstPoints:10,secondPoints:4}},tableMarket,.10);

  const market={event_ticker:'KXGAME-TEST',status:'active',title:'Home wins',yes_sub_title:'Home',
    custom_strike:{soccer_team:'home',hockey_team:'home'},rules_primary:'Home wins after 90 minutes plus stoppage time.',yes_ask_dollars:'0.95'};
  const team={homeName:'Home',awayName:'Away',homeTeamId:'home',awayTeamId:'away',possessionSide:null,
    period:2,home:4,away:1,homeUnits:4,awayUnits:1,unit:'goals',soccerMinute:86,
    matchRemainingSeconds:240,remainingSeconds:240,clockRunning:true};
  check({...team,type:'soccer_match'},market,.20);
  check({...team,type:'soccer_match',matchRemainingSeconds:NaN},market,.20);
  check({...team,type:'soccer_match',soccerMinute:83,matchRemainingSeconds:449,home:3,homeUnits:3},market,.10,false);
  check({...team,type:'soccer_match',soccerMinute:50,matchRemainingSeconds:2400,home:5,homeUnits:5},market,.10);
  check({...team,type:'soccer_match',home:2,homeUnits:2},market,.10,false);
  check({...team,type:'hockey_match',sport:'NHL',period:3,home:6,homeUnits:6,away:1,awayUnits:1,remainingSeconds:80},market,.20);
  check({...team,type:'hockey_match',sport:'NHL',period:3,home:5,homeUnits:5,away:1,awayUnits:1,remainingSeconds:80},market,.10,false);
});
test('NBA +25 under 7:30 and +20 under 6:30 use single-read sizing',()=>{
  const market={status:'active',event_ticker:'KXGAME-TEST',title:'Home wins',yes_sub_title:'Home',
    custom_strike:{basketball_team:'home'},yes_ask_dollars:'.95'};
  const g={...game('basketball_game'),sport:'NBA',period:4,remainingSeconds:389,home:120,away:100,
    homeUnits:120,awayUnits:100,verifiedLive:true,scoreKnown:true,scoreConsistent:true,periodConsistent:true,homeName:'Home',awayName:'Away',homeTeamId:'home',awayTeamId:'away'};
  assert.equal(finalLeadFraction(g,g,lead,true,market),.05);
  assert.equal(finalLeadFraction(g,{...g,home:126,homeUnits:126},lead,true,market),.10);
  assert.equal(finalLeadFraction(g,{...g,remainingSeconds:119},lead,true,market),.15);
  assert.equal(finalLeadFraction(g,g,lead,false,market),.05);
  assert.equal(finalLeadFraction(g,{...g,home:108,homeUnits:108,remainingSeconds:60},lead,true,market),.10);
  const now=Date.now(),fresh={...g,id:'game',feedId:'game',observedAt:now,updatedAt:now-1000};
  assert.equal(nbaSingleReadLead(fresh,market,now),true);
  assert.equal(nbaSingleReadLead({...fresh,remainingSeconds:449,home:125,homeUnits:125},market,now),true);
  assert.equal(nbaSingleReadLead({...fresh,remainingSeconds:450,home:125,homeUnits:125},market,now),false);
  assert.equal(nbaSingleReadLead({...fresh,remainingSeconds:449,home:124,homeUnits:124},market,now),false);
  assert.equal(finalLeadFraction(fresh,{...fresh,remainingSeconds:449,home:125,homeUnits:125},lead,false,market),.10);
  assert.equal(nbaSingleReadLead({...fresh,remainingSeconds:390},market,now),false);
  assert.equal(nbaSingleReadLead({...fresh,home:119,homeUnits:119},market,now),false);
  assert.equal(nbaSingleReadLead({...fresh,updatedAt:now-31000},market,now),false);
  assert.equal(nbaSingleReadLead({...fresh,feedId:'other'},market,now),false);
  assert.equal(nbaSingleReadLead({...fresh,possessionSide:'away'},market,now),false);
  assert.equal(nbaSingleReadLead(fresh,{...market,custom_strike:{basketball_team:'away'}},now),false);
  assert.equal(nbaSingleReadLead(fresh,market,now+10001),false);
  const source=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
  assert.match(source,/if\(!directNba&&!directSoccer\)\{\s*decision.stage='independent_score'/);
  assert.match(source,/if\(c.signal.strategy==='lead'&&!freshState.golf&&!directNba&&!directSoccer\)/);
  assert.match(source,/if\(c.signal.strategy==='lead'&&!directNba&&!directSoccer\)/);
  assert.match(source,/if\(directNba&&!await auditSingleReadNbaLead\(freshState,quote,c.milestone\)\)continue/);
  assert.match(source,/singleRead\?'Eligible for one fresh Kalshi score; checking live ask'/);
  assert.match(source,/leadWatch&&!candidates.some\(c=>c.signal.strategy==='lead'\)/);
  assert.match(source,/signal\.execution\+'; last catalog result is older'/);
});
test('tennis two-match-point fallback permits 20% with an unchanged deciding set',()=>{
  const m={id:'tennis-fallback',type:'tennis_tournament_singles',title:'Hurkacz vs Bergs',
    details:{best_of:'3',first_competitor_id:'H',second_competitor_id:'B',main_game_event_ticker:'KXATPMATCH-DATE'}};
  const market={status:'active',event_ticker:'KXATPMATCH-DATE',title:'Hubert Hurkacz wins',
    rules_primary:'If Hubert Hurkacz wins the match, Yes.',custom_strike:{tennis_competitor:'H'},yes_ask_dollars:'.95'};
  const now=Date.now();
  const state=(at,points=40)=>gameState(m,{milestone_id:m.id,_observed_at:new Date(at).toISOString(),
    details:{status:'live',competitor1_is_home:true,competitor1_round_scores:[{outcome:'winner',score:6},{outcome:'loser',score:3},{outcome:'ongoing',score:5}],
      competitor2_round_scores:[{outcome:'loser',score:3},{outcome:'winner',score:6},{outcome:'ongoing',score:4}],
      competitor1_overall_score:1,competitor2_overall_score:1,competitor1_current_round_score:points,
      competitor2_current_round_score:15,server:'H',advantage:''}});
  const first=state(now-12000),second=state(now);
  assert.equal(kalshiOnlyLead(first,second,market),true);
  assert.equal(finalLeadFraction(first,second,lead,false,market),.20);
  assert.equal(kalshiOnlyLead(state(now-12000,30),state(now,30),market),false);
  assert.equal(finalLeadFraction(first,state(now-3000),lead,false,market),.10);
});
