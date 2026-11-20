import test from 'node:test';
import assert from 'node:assert/strict';
import {gameState} from '../src/strategy.mjs';
import {variablePlayerOverSpec,independentVariableOverDecision,variableProofValid,
  verifyIndependentVariableOver} from '../src/variable_player_over.mjs';

const since=new Date(Date.now()-20*60000).toISOString();
const m=(sport,type)=>({id:'variable-'+sport,title:'Away at Home',type,start_date:since,
  details:{league:sport,main_game_event_ticker:'KX'+sport+'GAME-TEST'}});
const game=(milestone,stats,period=1)=>gameState(milestone,{
  milestone_id:milestone.id,_observed_at:new Date().toISOString(),details:{
    status:'live',period,clock:'08:00',last_updated_ts:Date.now()/1000,
    home_score:12,away_score:9,home_team_name:'Home',away_team_name:'Away',
    player_stats:{p:stats}}});
const market=(sport,metric,n,label)=>({
  ticker:'KX'+sport+metric+'-TEST-P-'+n,event_ticker:'KX'+sport+metric+'-TEST',
  status:'active',strike_type:'greater',floor_strike:n-.5,
  custom_strike:{[sport==='MLB'?'baseball_player':'basketball_player']:'p'},
  title:'Pat Player: '+n+'+ '+label,yes_sub_title:'Pat Player: '+n+'+',
  rules_primary:'If Pat Player records '+n+'+ '+label+
    ' in the Away vs Home Pro game originally scheduled for Nov 20, 2026, then the market resolves to Yes.'
});
const board=(milestone,period=1)=>({events:[{id:'ESPN-KEY',date:milestone.start_date,
 competitions:[{status:{period,displayClock:'08:00',type:{state:'in'}},competitors:[
 {homeAway:'home',score:'12',team:{displayName:'Home'}},
 {homeAway:'away',score:'9',team:{displayName:'Away'}}]}]}]});
const summary=(stats,plays)=>({header:{id:'ESPN-KEY'},
  boxscore:{players:[{statistics:[{name:'batting',labels:Object.keys(stats),athletes:[{
    athlete:{displayName:'Pat Player'},stats:Object.values(stats).map(String)}]}]}]},plays});
const play=(seq,kind='Single')=>({id:'play-'+seq,sequenceNumber:String(seq),type:{text:kind},
  atBatId:'at-bat-'+seq,isPenalty:false});

test('NBA combined points/rebounds/assists verifies exact named player and all three components',()=>{
 const milestone=m('NBA','basketball_game'),g=game(milestone,{points:20,rebounds:5,assists:4});
 const contract=market('NBA','PRA',25,'combined points, rebounds, and assists');
 assert.equal(variablePlayerOverSpec(g,contract)?.player.value,29);
 const first=independentVariableOverDecision(board(milestone),summary({PTS:20,REB:5,AST:4},[play(100)]),g,milestone,contract);
 assert.equal(first?.playerValue,29);
 assert.equal(independentVariableOverDecision(board(milestone),summary({PTS:20,REB:4,AST:4},[play(100)]),g,milestone,contract),false,
  'a real ESPN component disagreement vetoes FOX fallback');
 const late={...first,requestedAt:Date.now(),plays:[play(100),play(110,'Rebound')]};
 const earlier={...first,requestedAt:late.requestedAt-210000};
 assert.equal(variableProofValid(earlier,late,g,contract,late.requestedAt),true);
});

test('MLB RBI uses exact independently credited run total, not the game score',()=>{
 const milestone=m('MLB','baseball_game'),g=game(milestone,{runs_batted_in:2},5);
 const contract=market('MLB','RBI',2,'runs batted in');
 assert.equal(variablePlayerOverSpec(g,contract)?.player.value,2);
 const proof=independentVariableOverDecision(board(milestone,5),summary({RBI:2},[play(100)]),g,milestone,contract);
 assert.equal(proof?.playerValue,2);
 assert.equal(independentVariableOverDecision(board(milestone,5),summary({RBI:1},[play(100)]),g,milestone,contract),false);
 const later={...proof,requestedAt:Date.now(),plays:[play(100),play(110)]};
 const earlier={...proof,requestedAt:later.requestedAt-210000};
 assert.equal(variableProofValid(earlier,later,g,contract,later.requestedAt),true);
});

test('unsupported MLB FOX boxscore cannot authorize a fallback purchase',async()=>{
 const milestone=m('MLB','baseball_game'),g=game(milestone,{runs_batted_in:2},5);
 const contract=market('MLB','RBI',2,'runs batted in');
 const seen=[];
 const result=await verifyIndependentVariableOver(g,milestone,contract,{fetcher:async url=>{
  seen.push(url);
  if(url.includes('espn.com'))return {ok:false,status:503};
  if(url.includes('scores-segment'))return {ok:true,json:async()=>({sectionList:[]})};
  return {ok:false,status:404};
 }});
 assert.equal(result,null);
 assert.ok(seen.some(s=>s.includes('foxsports.com')));
});