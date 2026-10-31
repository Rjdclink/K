import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {finalLeadFraction,leaderHasControl} from '../src/lead_allocation.mjs';
import {gameState,earlyLeadSignal} from '../src/strategy.mjs';

const lead={strategy:'lead',fraction:.15};
const game=(type,possessionSide='home')=>({type,sport:'Other',home:30,away:10,homeUnits:30,awayUnits:10,possessionSide});
test('all supported leader-control sports get five points after independent verification',()=>{
  for(const type of ['basketball_game','hockey_match','football_game','baseball_game','rugby_match','handball_match','lacrosse_game','table_tennis_match']){
    const g=game(type);
    assert.equal(finalLeadFraction(g,g,lead,true),.20,type);
    assert.equal(finalLeadFraction(g,g,lead,false),.10,type+' fallback cap');
    assert.equal(finalLeadFraction({...g,possessionSide:null},g,lead,true),.15,'both observations must establish control');
    assert.equal(finalLeadFraction(g,{...g,possessionSide:'away'},lead,true),.15);
  }
  const volleyball={...game('volleyball_match'),homeUnits:2,awayUnits:2,volleyball:{current:{home:14,away:10}}};
  assert.equal(finalLeadFraction(volleyball,volleyball,lead,true),.20);
  const golf={type:'golf_tournament',golf:{}};
  assert.equal(finalLeadFraction(golf,golf,{...lead,fraction:.10},true),.10,'golf has no possession bonus');
});
test('Kalshi-only late rugby lead scales to twenty percent with margin, time, and confirmed control',()=>{
  const first={type:'rugby_match',sport:'Rugby',period:2,verifiedLive:true,scoreConsistent:true,periodConsistent:true,
    home:19,away:0,homeUnits:19,awayUnits:0,remainingSeconds:89,possessionSide:null};
  const fraction=(margin,seconds,control=null)=>{
    const state={...first,home:margin,homeUnits:margin,remainingSeconds:seconds,possessionSide:control};
    return finalLeadFraction(state,state,{strategy:'lead',fraction:margin>=22?.15:.10},false);
  };
  assert.equal(fraction(15,89),.12);
  assert.equal(fraction(19,60),.12);
  assert.equal(fraction(19,38),.13);
  assert.equal(fraction(19,29),.14);
  assert.equal(fraction(22,38),.16);
  assert.equal(fraction(28,29),.20);
  assert.equal(fraction(28,29,'home'),.20);
  assert.equal(fraction(19,38,'home'),.15);
  assert.equal(finalLeadFraction({...first,possessionSide:null},{...first,possessionSide:'home',remainingSeconds:38},lead,false),.13,
    'a single possession observation earns no bonus');
  assert.equal(fraction(19,90),.10);
  assert.equal(fraction(14,38),.10);
  assert.equal(finalLeadFraction({...first,remainingSeconds:37},{...first,remainingSeconds:38},lead,false),.10,
    'a clock that moves backward cannot receive the higher tier');
  assert.equal(finalLeadFraction({...first,verifiedLive:false},{...first,remainingSeconds:38},lead,false),.10);
  assert.equal(finalLeadFraction({...first,remainingSeconds:38},{...first,remainingSeconds:38},lead,true),.15,
    'independently verified rugby keeps its existing fraction');
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
test('CFB and existing one-goal soccer possession tiers are not boosted twice',()=>{
  const cfb={...game('football_game'),sport:'CFB'};
  assert.equal(finalLeadFraction(cfb,cfb,{...lead,fraction:.35},true),.35);
  assert.equal(finalLeadFraction(cfb,cfb,{...lead,fraction:.35},false),.10);
  const soccer={...game('soccer_match'),home:1,away:0,homeUnits:1,awayUnits:0,matchRemainingSeconds:19};
  assert.equal(finalLeadFraction(soccer,soccer,{...lead,fraction:.40},true),.40,'existing higher soccer tier is preserved');
  assert.equal(finalLeadFraction(soccer,soccer,{...lead,fraction:.40},false),.10);
  assert.equal(finalLeadFraction(cfb,cfb,{strategy:'over',fraction:.30},true),.30);
  const tied={...game('basketball_game'),home:10,away:10,homeUnits:10,awayUnits:10};
  assert.equal(finalLeadFraction(tied,tied,{...lead,fraction:.05},true),.05,'draw has no leader');
});
test('early football allocation uses margin, clock and possession, with a hard ten-percent maximum',()=>{
  const market={event_ticker:'KXGAME-X',title:'Alpha wins',status:'active',custom_strike:{football_team:'a'}};
  const g={...game('football_game','away'),verifiedLive:true,scoreKnown:true,scoreConsistent:true,periodConsistent:true,
    period:4,remainingSeconds:800,mainEvent:'KXGAME-X',homeTeamId:'a',awayTeamId:'b',homeName:'Alpha',awayName:'Beta',unit:'points'};
  for(const sport of ['NFL']){
    const s={...g,sport,home:31,homeUnits:31};
    assert.equal(earlyLeadSignal(s,market)?.fraction,.05);
    assert.equal(earlyLeadSignal({...s,possessionSide:'home'},market)?.fraction,.07);
    assert.equal(earlyLeadSignal({...s,home:38,homeUnits:38},market)?.fraction,.07);
    assert.equal(earlyLeadSignal({...s,remainingSeconds:449},market)?.fraction,.06);
    const strong={...s,home:38,homeUnits:38,remainingSeconds:449,possessionSide:'home'};
    const signal=earlyLeadSignal(strong,market);
    assert.equal(signal.fraction,.10);assert.equal(finalLeadFraction(strong,strong,signal,true),.10);
    assert.equal(finalLeadFraction(strong,strong,signal,false),.10);
    assert.equal(earlyLeadSignal({...s,period:3,remainingSeconds:59},market),null);
    assert.equal(earlyLeadSignal({...s,period:3,remainingSeconds:59,home:38,homeUnits:38},market)?.fraction,.05);
    assert.equal(earlyLeadSignal({...s,sport:'CFB'},market),null);
    assert.equal(earlyLeadSignal({...s,sport:'CFB',period:3,remainingSeconds:59,home:38,homeUnits:38},market),null);
  }
});
test('both live entry paths use the final verified allocation and funding rechecks recalculate it',()=>{
  const source=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
  assert.match(source,/fraction:finalLeadFraction\(first,second,signal,independent===true\)/);
  assert.match(source,/finalLeadFraction\(c.state,freshState,verifiedSignal,!kalshiOnly\)/);
  assert.match(source,/fraction:finalLeadFraction\(state,checked,still,!kalshiOnly\)/);
});
