import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {variablePlayerOverSpec,variableProofValid} from '../src/variable_player_over.mjs';
import {gameState} from '../src/strategy.mjs';
const src=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');

test('variable-value player prop scanner remains available for historical proof tests but is not scheduled to buy',()=>{
 assert.match(src,/async function scanVariablePlayerOvers\(games,events,signalSink=null,\{maxMarkets=Infinity\}=\{\}\)/);
 assert.doesNotMatch(src,/submitted\+=await scanVariablePlayerOvers\(marketGames,events,variableOverSignals\)/);
 assert.match(src,/\.\.\.\(variableOverSignals\.get\(id\)\|\|\[\]\)/);
 assert.match(src,/variableProofValid\(first,proof,fresh,seller/);
 assert.match(src,/verifyIndependentVariableOver\(fresh,c\.milestone,seller\)/);
 assert.match(src,/time_in_force:'fill_or_kill'/);
});
test('two independent player-prop checks must be same source and event, 210 seconds apart',()=>{
 const now=Date.now(),milestone={id:'nba-sample',title:'Away at Home',type:'basketball_game',
  details:{league:'NBA',main_game_event_ticker:'KXNBAGAME-TEST'}};
 const game=gameState(milestone,{milestone_id:milestone.id,_observed_at:new Date(now).toISOString(),
  details:{status:'live',period:1,clock:'08:00',home_score:22,away_score:12,
    player_stats:{p:{points:22}},last_updated_ts:now/1000}});
 const market={ticker:'KXNBAPTS-TEST-P-20',event_ticker:'KXNBAPTS-TEST',status:'active',
  floor_strike:19.5,strike_type:'greater',custom_strike:{basketball_player:'p'},
  title:'Pat Player: 20+ points',yes_sub_title:'Pat Player: 20+',
  rules_primary:'If Pat Player records 20+ points in the Away vs Home Pro Basketball game originally scheduled for Nov 20, 2026, then the market resolves to Yes.'};
 const spec=variablePlayerOverSpec(game,market);
 assert.ok(spec);
 const first={source:'ESPN',eventId:'event-1',gameId:game.id,metric:'PTS',playerId:'p',
  playerValue:22,contractKey:spec.contractKey,requestedAt:now-210000,lastPlaySequence:100};
 const second={...first,requestedAt:now,plays:[{id:'basketball-play',sequenceNumber:'101',
  type:{text:'Made Shot'}}]};
 assert.equal(variableProofValid(first,second,game,market,now),true);
 assert.equal(variableProofValid({...first,requestedAt:now-209999},second,game,market,now),false);
 assert.equal(variableProofValid(first,{...second,source:'FOX Sports'},game,market,now),false);
 assert.equal(variableProofValid(first,{...second,eventId:'other-event'},game,market,now),false);
 assert.equal(variableProofValid(first,{...second,playerValue:18},game,market,now),false);
 assert.equal(variableProofValid(first,{...second,plays:[{id:'timeout',sequenceNumber:'101',type:{text:'Timeout'}}]},game,market,now),false);
});