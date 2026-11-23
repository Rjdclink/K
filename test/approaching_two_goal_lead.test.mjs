import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {soccerRegulationSeconds} from '../src/strategy.mjs';

const source=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
const body=source.slice(source.indexOf('function approachingGoalLead('),
  source.indexOf('const leadCandidate=',source.indexOf('function approachingGoalLead(')));
const context=vm.createContext({soccerRegulationSeconds});
vm.runInContext(body+'globalThis.check=approachingGoalLead;',context);
const game=(type,seconds)=>({type,verifiedLive:true,scoreKnown:true,
 scoreConsistent:true,periodConsistent:true,home:2,away:0,
 homeTeamId:'home',awayTeamId:'away',period:type.startsWith('hockey')?3:2,
 remainingSeconds:seconds,soccerMinute:90-seconds/60});
const market=type=>({ticker:'winner',event_ticker:'KX'+type+'GAME-ONE',
 status:'active',custom_strike:{[type+'_team']:'home'}});

test('two-goal first proof starts in the seven-minute approach window',()=>{
 for(const type of ['soccer','hockey']){
  const entry=game(type+'_match',420),contract=market(type);
  assert.equal(context.check(entry,contract),true,type);
  assert.equal(context.check(game(type+'_match',421),contract),false,type);
  assert.equal(context.check({...entry,home:3,away:0},contract),type==='soccer',type);
  assert.equal(context.check({...entry,home:3,away:1,homeTeamId:'home'},contract),true,type);
  assert.equal(context.check({...entry,home:4,away:2},contract),false,type);
  assert.equal(context.check(entry,{...contract,custom_strike:{[type+'_team']:'away'}}),false,type);
 }
});
