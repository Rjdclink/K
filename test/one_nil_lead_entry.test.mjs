import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {goalCommandingLeadEntry,leadWatchReason,leadSignal,soccerRegulationSeconds}
 from '../src/strategy.mjs';
import {finalFiveEntryEligible} from '../src/final_five_entry.mjs';
import {leadFirstProofReady} from '../src/lead_verification_timer.mjs';
import {sportsContractKey} from '../src/entry_verification.mjs';

const source=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
const begin=source.indexOf('function approachingGoalLead('),end=source.indexOf('const leadCandidate=',begin);
assert.ok(begin>0&&end>begin);
const ctx=vm.createContext({Number,Math,String,soccerRegulationSeconds});
vm.runInContext(source.slice(begin,end),ctx);
const base={id:'one-nil',feedId:'one-nil',verifiedLive:true,scoreKnown:true,
 scoreConsistent:true,periodConsistent:true,clockRunning:true,home:1,away:0,
 homeUnits:1,awayUnits:0,homeTeamId:'home-id',awayTeamId:'away-id',
 homeName:'Home',awayName:'Away',unit:'goals',status:'live'};
const soccer=(minute,changes={})=>({...base,type:'soccer_match',sport:'Soccer',period:2,
 soccerMinute:minute,matchRemainingSeconds:Math.max(0,Math.round((90-minute)*60)),
 soccerExtraTime:false,soccerOvertime:false,...changes});
const hockey=(seconds,changes={})=>({...base,type:'hockey_match',sport:'NHL',period:3,
 remainingSeconds:seconds,clock:`0:${String(seconds).padStart(2,'0')}`,...changes});
const market=sport=>({ticker:'KX'+sport.toUpperCase()+'GAME-TEST-HOME',
 event_ticker:'KX'+sport.toUpperCase()+'GAME-TEST',status:'active',
 custom_strike:{[sport+'_team']:'home-id'},title:'Home wins',yes_sub_title:'Home',
 rules_primary:'Home wins after 90 minutes plus stoppage time'});

test('hockey 1–0 starts independent checking at 1:15 and enters only under 0:15',()=>{
 const m=market('hockey');
 assert.equal(ctx.approachingGoalLead(hockey(76),m),false);
 assert.equal(ctx.approachingGoalLead(hockey(75),m),true);
 for(const [seconds,allowed] of [[16,false],[15,false],[14,true],[1,true],[0,false]]){
  const g=hockey(seconds);
  assert.equal(goalCommandingLeadEntry(g),allowed,seconds);
  assert.equal(Boolean(leadSignal(g,m)),allowed,seconds);
  assert.equal(finalFiveEntryEligible(g,{strategy:'lead',market:m}),allowed,seconds);
 }
 assert.match(leadWatchReason(hockey(75)),/waiting for clock threshold/);
 assert.equal(goalCommandingLeadEntry(hockey(14,{home:2,homeUnits:2})),true,
  'the existing two-goal rule remains eligible');
 assert.equal(goalCommandingLeadEntry(hockey(14,{period:2})),false);
});

test('soccer 1–0 starts independent checking at 91:00 and enters from live 92:00',()=>{
 const m=market('soccer');
 assert.equal(ctx.approachingGoalLead(soccer(90.99),m),false);
 assert.equal(ctx.approachingGoalLead(soccer(91),m),true);
 for(const [minute,allowed] of [[89,false],[91,false],[91.99,false],[92,true],[93,true]]){
  const g=soccer(minute);
  assert.equal(goalCommandingLeadEntry(g),allowed,minute);
  assert.equal(Boolean(leadSignal(g,m)),allowed,minute);
  assert.equal(finalFiveEntryEligible(g,{strategy:'lead',market:m}),allowed,minute);
 }
 assert.match(leadWatchReason(soccer(91)),/waiting for 92:00/);
 for(const changes of [{soccerExtraTime:true},{clockRunning:false},{period:3},
  {home:2,homeUnits:2,away:1,awayUnits:1}]){
  assert.equal(goalCommandingLeadEntry(soccer(92,changes)),false,JSON.stringify(changes));
 }
});

test('one-goal entry still needs two independent checks at least 60 real seconds apart',()=>{
 const m=market('soccer'),g=soccer(92),now=Date.now(),key=sportsContractKey(g,m);
 g.externalScore={home:1,away:0,source:'ESPN'};
 const proof={game_id:g.id,contract_key:key,first_verification_id:'first',
  first_at:new Date(now-59999),first_evidence:{source:'ESPN',eventId:'fixture',
   gameId:g.id,home:1,away:0}};
 assert.equal(leadFirstProofReady(proof,g,m,now),false);
 assert.equal(leadFirstProofReady({...proof,first_at:new Date(now-60000)},g,m,now),true);
 assert.equal(leadFirstProofReady({...proof,first_at:new Date(now-60000)},
  {...g,externalScore:{...g.externalScore,home:2}},m,now),false);
});
