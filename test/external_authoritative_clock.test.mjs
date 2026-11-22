import test from 'node:test';
import assert from 'node:assert/strict';
import {authoritativeGameState} from '../src/external_authority.mjs';

const game={id:'match',type:'soccer_match',sport:'Soccer',verifiedLive:true,
 scoreKnown:true,scoreConsistent:true,periodConsistent:true,period:2,
 home:1,away:1,homeUnits:1,awayUnits:1,soccerMinute:83,matchRemainingSeconds:420};
const reading={source:'ESPN',eventId:'matched-independent-123',gameId:'match',
 home:2,away:1,live:true,period:2,elapsedMinute:87};
test('ESPN score and soccer match minute govern an independently verified winner state',()=>{
 const updated=authoritativeGameState(game,reading);
 assert.deepEqual([updated.home,updated.away,updated.soccerMinute,updated.matchRemainingSeconds],[2,1,87,180]);
 assert.deepEqual(updated.kalshiScore,{home:1,away:1});
 assert.equal(updated.externalScore.source,'ESPN');
});
test('ESPN remaining period clock governs verified NHL and college basketball games',()=>{
 for(const sport of ['NHL','NCAAB','CFB']){
  const updated=authoritativeGameState({...game,sport,type:sport==='NHL'?'hockey_match':sport==='CFB'?'football_game':'basketball_game',
   remainingSeconds:550}, {...reading,seconds:305});
  assert.equal(updated?.remainingSeconds,305,sport);
 }
});
test('invalid external clocks must not create an invented new time',()=>{
 const updated=authoritativeGameState(game,{...reading,elapsedMinute:NaN});
 assert.equal(updated?.soccerMinute,83);
});