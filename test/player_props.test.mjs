import test from 'node:test';
import assert from 'node:assert/strict';
import {gameState,overSignal,playerOverSpec} from '../src/strategy.mjs';
import {playerStatAgreement} from '../src/score_verification.mjs';

test('non-basketball player overs use an exact linked player statistic and external box score',()=>{
  const game=gameState({id:'fixture',type:'soccer_match',title:'Away at Home'},
    {details:{status:'live',home_score:2,away_score:1,time:"70'",player_stats:{p1:{goals:2}}}});
  const market={event_ticker:'KXSOCCERGOALS-26OCT29GAME',status:'active',strike_type:'greater',floor_strike:1.5,
    custom_strike:{soccer_player:'p1'},yes_sub_title:'John Doe: 2+',title:'John Doe: 2+ goals',rules_primary:'John Doe goals',yes_ask_dollars:'.95'};
  const player=playerOverSpec(game,market);
  assert.equal(player?.value,2);
  assert.equal(overSignal(game,market)?.strategy,'over');
  assert.equal(overSignal({...game,playerStats:null},market),null);
  assert.equal(playerStatAgreement({boxscore:{players:[{statistics:[{name:'scoring',names:['G'],athletes:[{athlete:{displayName:'John Doe'},stats:['2']}]}]}]}},player),true);
  assert.equal(playerStatAgreement({boxscore:{players:[{statistics:[{name:'scoring',names:['G'],athletes:[{athlete:{displayName:'John Doe'},stats:['1']}]}]}]}},player),false);
});
