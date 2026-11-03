import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gameState,leadSignal,basketballCloseoutEntry} from '../src/strategy.mjs';
import {leadEntryFraction} from '../src/lead_allocation.mjs';
import {parallelBasketballVerification,assertBasketballVerification} from '../src/basketball_verification.mjs';
import {scoreAgreement,verifyIndependentOverDecision,nbaAgreement} from '../src/score_verification.mjs';
const start='2026-11-02T12:00:00Z',now=Date.now();
function fixture(league='NBA',margin=6,seconds=104,possession='away'){
  const milestone={id:'game',type:'basketball_game',title:'Brooklyn Nets at Boston Celtics',start_date:start,
    details:{league,home_team_id:'home',away_team_id:'away'}};
  const period=league==='NCAAB'?2:4;
  const game=gameState(milestone,{milestone_id:'game',_observed_at:new Date(now).toISOString(),details:{status:'live',
    home_score:90+margin,away_score:90,period,clock:`${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`,
    home_team_name:'Boston Celtics',away_team_name:'Brooklyn Nets',possession_team_id:possession,last_updated_ts:now/1000}});
  const market={ticker:'KXNBAGAME-TEST-BOS',event_ticker:'KXNBAGAME-TEST',status:'active',title:'Boston Celtics wins',
    yes_sub_title:'Boston Celtics',custom_strike:{basketball_team:'home'},yes_ask_dollars:'.90',yes_ask_size_fp:'20'};
  return {game,market,milestone};
}
test('new basketball route uses +6 NBA / +7 college and international, strictly under 1:45, either or unknown possession',()=>{
  for(const league of ['NBA','NCAAB','NCAAW','Australia NBL','EuroLeague']){
    const minimum=league==='NBA'?6:7;
    for(const possession of ['home','away',null]){
      const {game,market}=fixture(league,minimum,104,possession);
      assert.ok(leadSignal(game,market),league);
      assert.equal(basketballCloseoutEntry(game),true);
      assert.equal(leadSignal({...game,remainingSeconds:105},market),null);
      assert.equal(leadSignal({...game,remainingSeconds:0},market),null);
      assert.equal(leadSignal({...game,home:game.home-1,homeUnits:game.homeUnits-1},market),null);
      assert.equal(leadSignal({...game,period:game.period-1},market),null);
    }
  }
  assert.equal(leadSignal(fixture('WNBA',6).game,fixture('WNBA',6).market),null);
  assert.ok(leadSignal(fixture('WNBA',7).game,fixture('WNBA',7).market),'WNBA +7 under 1:45');
});
test('new route cannot allocate without independent verification and caps at fifteen percent',()=>{
  const {game,market}=fixture(),signal=leadSignal(game,market);
  for(const decision of [null,false])assert.equal(leadEntryFraction(game,game,signal,market,decision,true),null);
  assert.equal(leadEntryFraction(game,game,signal,market,true,true),.15);
  const strong=fixture('NBA',20,90,'home');
  assert.equal(basketballCloseoutEntry(strong.game),true,'all NBA leads under 1:45 use the paired check');
  assert.equal(leadEntryFraction(strong.game,strong.game,leadSignal(strong.game,strong.market),strong.market,true,true),.15);
});
test('seller/depth and external requests start together and both must complete successfully',async()=>{
  const {game,market}=fixture(),started=[];
  let quoteDone,verificationDone;
  const pending=parallelBasketballVerification(game,market,{
    readQuote:()=>{started.push('ask');return new Promise(resolve=>quoteDone=resolve)},
    verify:()=>{started.push('external');return new Promise(resolve=>verificationDone=resolve)},now:()=>now});
  assert.deepEqual(started,['ask','external']);
  assert.throws(()=>assertBasketballVerification(game,market,now));
  verificationDone(true);await Promise.resolve();assert.equal(game.basketballVerification,undefined);
  quoteDone(market);assert.equal(await pending,market);assert.doesNotThrow(()=>assertBasketballVerification(game,market,now));
  for(const decision of [null,false]){
    const next=fixture();assert.equal(await parallelBasketballVerification(next.game,next.market,
      {readQuote:async()=>next.market,verify:async()=>decision}),null);
    assert.throws(()=>assertBasketballVerification(next.game,next.market,now));
  }
});
test('proof rejects missing ask, changed contract, stale score, expired external proof, or loss of the entry lead',async()=>{
  for(const quote of [null,{...fixture().market,event_ticker:'OTHER'},
    {...fixture().market,rules_secondary:'Different settlement terms'},
    {...fixture().market,yes_ask_dollars:null},{...fixture().market,yes_ask_size_fp:'0'}]){
    const {game,market}=fixture();assert.equal(await parallelBasketballVerification(game,market,{readQuote:async()=>quote,verify:async()=>true}),null);
  }
  const {game,market}=fixture();await parallelBasketballVerification(game,market,{readQuote:async()=>market,verify:async()=>true,now:()=>now});
  assert.throws(()=>assertBasketballVerification(game,market,now+10001));
  assert.throws(()=>assertBasketballVerification({...game,remainingSeconds:105},market,now));
  assert.throws(()=>assertBasketballVerification({...game,homeUnits:95,home:95},market,now));
  assert.throws(()=>assertBasketballVerification(game,{...market,close_time:'changed'},now));
});
test('mandatory external basketball check needs a compatible final-period clock and a sufficient selected-team lead',()=>{
  const {game,market}=fixture();
  const reading={home:96,away:90,live:true,clockOk:true,period:4,remainingSeconds:100};
  assert.equal(scoreAgreement(game,[[reading]],market),true);
  assert.equal(scoreAgreement(game,[[{...reading,home:99}]],market),true);
  assert.equal(scoreAgreement(game,[[{...reading,away:91}]],market),false);
  for(const patch of [{period:3},{remainingSeconds:105},{remainingSeconds:80},{remainingSeconds:NaN}])
    assert.equal(scoreAgreement(game,[[{...reading,...patch}]],market),false);
});
test('ESPN verifies the new rule end to end, including a stronger score and unavailable/ambiguous fixtures',async()=>{
  const {game,market,milestone}=fixture('NCAAB',7);
  const event={id:'espn',date:start,competitions:[{status:{type:{state:'in'},period:2,displayClock:'1:40'},competitors:[
    {homeAway:'home',score:'100',team:{displayName:'Boston Celtics'}},{homeAway:'away',score:'90',team:{displayName:'Brooklyn Nets'}}]}]};
  const run=events=>verifyIndependentOverDecision({...game},milestone,{market,fetcher:async()=>({ok:true,json:async()=>({events})})});
  assert.equal(await run([event]),true);assert.equal(await run([]),null);assert.equal(await run([event,event]),false);
  const wrong=structuredClone(event);wrong.competitions[0].competitors[0].team.displayName='Unknown ABL';
  assert.equal(await run([wrong]),null);
});
test('regular scan, fast lead watcher, funded recheck, initial order and retry share mandatory verification',()=>{
  const source=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
  for(const call of ['verifiedEntryQuote(second,milestone,offered,scoreboardCache)',
    'verifiedEntryQuote(freshState,c.milestone,c.market,scoreboardCache,c.signal.strategy,current=>{rawQuote=current})',
    'verifiedEntryQuote(checked,c.milestone,c.market,scoreboardCache,c.signal.strategy)'])assert.ok(source.includes(call));
  assert.equal((source.match(/assertFreshLead\(game,market\)\},body/g)||[]).length,2);
});
test('official NBA closeout verification requires a valid current final-period clock',()=>{
  const {game,market,milestone}=fixture(),id='0022600001';
  const official={gameId:id,gameTimeUTC:start,gameStatus:2,period:4,gameClock:'PT01M40.00S',
    homeTeam:{teamCity:'Boston',teamName:'Celtics',score:99},awayTeam:{teamCity:'Brooklyn',teamName:'Nets',score:90}};
  assert.equal(nbaAgreement({game:official},game,milestone,market,id),true);
  for(const patch of [{period:3},{gameClock:'PT01M45.00S'},{gameClock:'0:99'},{gameClock:null},
    {awayTeam:{...official.awayTeam,score:94}}])
    assert.equal(nbaAgreement({game:{...official,...patch}},game,milestone,market,id),false);
});
