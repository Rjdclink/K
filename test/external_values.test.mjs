import test from 'node:test';
import assert from 'node:assert/strict';
import {externalValueQualifies,externalScoresQualify} from '../src/external_values.mjs';
import {scoreAgreement,playerStatAgreement} from '../src/score_verification.mjs';
const game={type:'basketball_game',sport:'NBA',home:100,away:90,homeTeamId:'h',awayTeamId:'a',homeName:'Home',awayName:'Away'};
const total={event_ticker:'KXNBATOTAL-X',floor_strike:189.5};
const winner={event_ticker:'KXNBAGAME-X',title:'Home wins',custom_strike:{basketball_team:'h'}};
test('over evidence may equal/exceed Kalshi or independently clear the exact contract line',()=>{
  for(const actual of [10,11,9])assert.equal(externalValueQualifies(actual,10,8.5),true);
  for(const actual of [8,NaN,-1])assert.equal(externalValueQualifies(actual,10,8.5),false);
  assert.equal(externalScoresQualify(game,{home:101,away:90},total),true);
  assert.equal(externalScoresQualify(game,{home:98,away:92},total),true);
  assert.equal(externalScoresQualify(game,{home:99,away:90},total),false);
  const team={...total,event_ticker:'KXNBATEAMTOTAL-X',floor_strike:99.5,custom_strike:{basketball_team:'h'}};
  assert.equal(externalScoresQualify(game,{home:101,away:200},team),true);
  assert.equal(externalScoresQualify(game,{home:99,away:200},team),false,'opponent points cannot establish our team total');
});
test('winner evidence preserves the selected team and accepts an equal or larger lead, not a larger opponent score',()=>{
  assert.equal(externalScoresQualify(game,{home:102,away:91},winner),true);
  assert.equal(externalScoresQualify(game,{home:102,away:92},winner),true);
  assert.equal(externalScoresQualify(game,{home:102,away:93},winner),false);
  assert.equal(externalScoresQualify(game,{home:90,away:110},winner),false);
  assert.equal(externalScoresQualify(game,{home:102,away:91},{...winner,custom_strike:{basketball_team:'unknown'}}),false);
});
test('period evidence must independently clear its own line; whole-game scores cannot replace it',()=>{
  const g={...game,periodScores:[{number:1,home:25,away:20}]},market={event_ticker:'KXNBA1QTOTAL-X',floor_strike:43.5};
  const reading={home:100,away:90,live:true,clockOk:true,periods:[{number:1,home:24,away:20}]};
  assert.equal(scoreAgreement(g,[[reading]],market),true);
  assert.equal(scoreAgreement(g,[[{...reading,periods:[{number:1,home:23,away:20}]}]],market),false);
  assert.equal(scoreAgreement(g,[[{...reading,periods:[]}]],market),false);
});
test('named player readings require an external one-stat cushion and exact identity',()=>{
  const summary=value=>({boxscore:{players:[{statistics:[{names:['REB'],athletes:[{athlete:{displayName:'Exact Player'},stats:[String(value)]}]}]}]}});
  const player={name:'Exact Player',metric:'REB',value:8,line:5.5};
  for(const n of [7,8,9])assert.equal(playerStatAgreement(summary(n),player),true);
  for(const n of [5,6])assert.equal(playerStatAgreement(summary(n),player),false);
  assert.equal(playerStatAgreement(summary(9),{...player,name:'Wrong Player'}),null);
});
test('draw evidence remains a tie even when both scores have advanced',()=>{
  const g={...game,home:90},market={title:'Tie',rules_primary:'Resolves Yes if tied after regulation'};
  assert.equal(externalScoresQualify(g,{home:92,away:92},market),true);
  assert.equal(externalScoresQualify(g,{home:92,away:91},market),false);
});
