import test from 'node:test';
import assert from 'node:assert/strict';
import { threatenedLead } from '../src/lead_profit_protection.mjs';
import { eligibleProfitExit } from '../src/profit_exits.mjs';

const market={ticker:'KXNHLGAME-26NOV22ABCCD-ABC',event_ticker:'KXNHLGAME-26NOV22ABCCD',
  status:'active',custom_strike:{hockey_team:'home-id'},yes_sub_title:'Home'};
const game=(home,away,patch={})=>({
  id:'hockey-game',feedId:'hockey-game',type:'hockey_match',status:'live',
  verifiedLive:true,scoreKnown:true,scoreConsistent:true,periodConsistent:true,
  home,away,homeUnits:home,awayUnits:away,homeTeamId:'home-id',awayTeamId:'away-id',...patch
});

test('a formerly commanding hockey or soccer leader triggers protection at one goal, tie, and behind',()=>{
  for(const type of ['hockey_match','soccer_match']){
    assert.equal(threatenedLead(game(3,1,{type}),market),false);
    assert.equal(threatenedLead(game(3,2,{type}),market),true);
    assert.equal(threatenedLead(game(3,3,{type}),market),true);
    assert.equal(threatenedLead(game(3,4,{type}),market),true);
    assert.equal(threatenedLead(game(0,2,{type}),market),true,
      'after losing the lead, continue watching for a profitable exit');
  }
});

test('a single possible score ties the commanding lead across football, basketball, goals and other team sports',()=>{
 for(const [type,margin] of [
  ['football_game',8],['basketball_game',4],['soccer_match',1],
  ['hockey_match',1],['baseball_game',4],['rugby_match',7],
  ['cricket_match',6],['lacrosse_match',1],['handball_match',1],
  ['volleyball_match',1],['table_tennis_match',1]
 ]){
  assert.equal(threatenedLead(game(50,50-margin,{type}),market),true,type+' at tieable margin');
  assert.equal(threatenedLead(game(50,49-margin,{type}),market),false,type+' beyond single-score margin');
 }
 assert.equal(threatenedLead(game(21,13,{type:'football_game'}),market),true,
  'a touchdown plus two-point conversion can tie an 8-point football lead');
 assert.equal(threatenedLead(game(30,26,{type:'basketball_game'}),market),true,
  'a rare four-point basketball scoring play can tie the margin');
});
test('unknown team, stale or inconsistent scoreboard, wrong fixture and non-team sports fail closed',()=>{
  assert.equal(threatenedLead(game(3,2),{...market,custom_strike:{hockey_team:'third-id'}}),false);
  assert.equal(threatenedLead(game(3,2,{verifiedLive:false}),market),false);
  assert.equal(threatenedLead(game(3,2,{scoreConsistent:false}),market),false);
  assert.equal(threatenedLead(game(3,2,{periodConsistent:false}),market),false);
  assert.equal(threatenedLead(game(3,2,{feedId:'wrong-id'}),market),false);
  assert.equal(threatenedLead(game(3,2,{type:'tennis_tournament_singles'}),market),false);
  assert.equal(threatenedLead(game(3,2,{home:NaN}),market),false);
});

test('only provably profitable executable sales qualify, accounting for acquisition and fees',()=>{
  const position={position_fp:'20',market_exposure_dollars:'17.00',fees_paid_dollars:'.20'};
  assert.equal(eligibleProfitExit('lead',position,{price:.97,count:10}),true);
  assert.equal(eligibleProfitExit('lead',position,{price:.86,count:10}),false);
  assert.equal(eligibleProfitExit('lead',position,{price:.86,count:10},[],2),false);
  assert.equal(eligibleProfitExit('lead',position,{price:.97,count:10},[],100),false,
    'unusually high market fee multipliers must veto profitable-looking sales');
  assert.equal(eligibleProfitExit('lead',{position_fp:'20',market_exposure_dollars:'17.00'}, {price:.97,count:10}),false);
  assert.equal(eligibleProfitExit('over',position,{price:.97,count:10}),false);
});