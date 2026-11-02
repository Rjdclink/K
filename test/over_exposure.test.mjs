import {rememberIndependentEntry} from '../src/entry_verification.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {gameState,overSignal,orderSize,estimatedCostCents,profitableCount,PLAYER_PROP_MAX_FRACTION} from '../src/strategy.mjs';
import {overContractKey,timedOverEntryValid,sameSportsContract} from '../src/over_verification.mjs';
import {singleSpendableCash} from '../src/combos.mjs';
import {externalOverMinimum,verifyExternalOverExposure,externalOverExposureValid,assertOverExposure} from '../src/over_exposure.mjs';
import {verifiedOverFraction} from '../src/lead_allocation.mjs';
import {scoreAgreement,verifyIndependentOverDecision,nbaAgreement} from '../src/score_verification.mjs';
import {remainingVerifiedOverCents,upgradeEligible} from '../src/upgrades.mjs';
const now=Date.now(),start='2026-11-02T12:00:00Z';
function fixture(){
  const milestone={id:'g',type:'soccer_match',title:'Rafaela vs Parana',start_date:start};
  const market={ticker:'KXSOCCERTOTAL-TEST-T05',event_ticker:'KXSOCCERTOTAL-TEST',status:'active',
    title:'Over 0.5 goals scored',rules_primary:'Combined total goals scored in the full game after 90 minutes plus stoppage time',
    floor_strike:.5,strike_type:'greater',yes_ask_dollars:'.91',yes_ask_size_fp:'1000'};
  const game=gameState(milestone,{milestone_id:'g',_observed_at:new Date(now).toISOString(),details:{status:'live',
    home_score:2,away_score:2,time:"68'",half:'2nd',home_team_name:'Rafaela',away_team_name:'Parana',last_updated_ts:now/1000}});
  game.verificationId='external';rememberIndependentEntry(game,market,'external',now);game.overVerification={route:'seller_cushion',contractKey:overContractKey(game,market),sellerAt:now};
  return {game,market,milestone};
}
async function proof(game,market,value=4){
  game.verificationId='new-independent-record';
  rememberIndependentEntry(game,market,game.verificationId,now,value);
  return verifyExternalOverExposure(game,market,{now:()=>now});
}
test('four goals over 0.5 withstands three removals; three goals do not',()=>{
  const {game,market}=fixture();
  assert.equal(externalOverMinimum(game,market),4);
  assert.equal(externalOverMinimum({...game,away:1},market),null);
  assert.equal(externalOverMinimum(game,{...market,floor_strike:1.5,title:'Over 1.5 goals scored'}),null);
  const basketball={...game,type:'basketball_game',sport:'NBA',home:105,away:0,period:3,remainingSeconds:300};
  const points={...market,event_ticker:'KXNBATOTAL-X',floor_strike:100.5,title:'Over 100.5 total points',rules_primary:'Combined total points in the full game'};
  assert.equal(externalOverMinimum(basketball,points),105,'the existing four-point correction allowance remains');
  assert.equal(externalOverMinimum({...basketball,home:104},points),null);
});
test('two removable goals unlock fifty percent; three removable goals unlock sixty percent',async()=>{
  for(const [goals,fraction] of [[3,.50],[4,.60]]){
    const {game,market}=fixture();game.home=goals;game.away=0;
    assert.equal(await proof(game,market,goals),true);
    assert.equal(verifiedOverFraction(overSignal(game,market),game,market),fraction);
    assert.doesNotThrow(()=>assertOverExposure(game,market,fraction,now));
    if(fraction===.50)assert.throws(()=>assertOverExposure(game,market,.60,now));
  }
});
test('an external reading with two removable goals cannot authorize sixty percent',async()=>{
  const {game,market}=fixture();
  assert.equal(await proof(game,market,3),true);
  assert.equal(verifiedOverFraction(overSignal(game,market),game,market),.50);
});
test('higher tiers require independently established cushion values; a basic passing record cannot authorize them',async()=>{
  for(const value of [undefined,0,1,2,3,4]){
    const {game,market}=fixture();
    assert.equal(verifiedOverFraction(overSignal(game,market),game,market),.40);
    assert.equal(await proof(game,market,value===undefined?NaN:value),value>=3);
    assert.equal(verifiedOverFraction(overSignal(game,market),game,market),value>=4?.60:value>=3?.50:.40);
  }
  const {game,market}=fixture();delete game.independentEntry;
  assert.equal(await verifyExternalOverExposure(game,market,{now:()=>now}),false,'an internal audit cannot serve as independent evidence');
  assert.throws(()=>assertOverExposure(game,market,.40,now));
});
test('enhanced dispatch rejects stale proofs, a changed contract, altered audit identity, a lost cushion, and oversized fractions',async()=>{
  const {game,market}=fixture();await proof(game,market);
  assert.equal(externalOverExposureValid(game,market,now),true);
  assert.doesNotThrow(()=>assertOverExposure(game,market,.60,now));
  for(const changed of [{...game,away:1},{...game,verificationId:'other'},
    {...game,externalOverProof:{...game.externalOverProof,requestedAt:now+1}}])
    assert.throws(()=>assertOverExposure(changed,market,.60,now),{code:'LOCAL_OVER_PROOF_EXPIRED'});
  assert.throws(()=>assertOverExposure(game,market,.60,now+10001));
  assert.throws(()=>assertOverExposure(game,{...market,rules_secondary:'Changed'},.60,now));
  assert.throws(()=>assertOverExposure(game,market,.61,now));
  const late=fixture();rememberIndependentEntry(late.game,late.market,late.game.verificationId,now-10001,4);
  assert.equal(await verifyExternalOverExposure(late.game,late.market,{now:()=>now}),false);
});
test('external totals must establish the entire cushion for the selected team or period',()=>{
  const {game,market}=fixture(),reading={home:2,away:2,live:true,clockOk:true};
  assert.equal(scoreAgreement(game,[[reading]],market,{minimumOverValue:4}),true);
  assert.equal(scoreAgreement(game,[[{...reading,away:3}]],market,{minimumOverValue:4}),true);
  assert.equal(scoreAgreement(game,[[{...reading,away:1}]],market,{minimumOverValue:4}),false);
  assert.equal(scoreAgreement(game,[[{...reading,away:1}]],market),true,'ordinary verification still accepts a crossed line');
  const g={...game,type:'basketball_game',sport:'NBA',home:120,away:110,homeTeamId:'h',awayTeamId:'a',homeName:'Home',awayName:'Away',periodScores:[{number:1,home:30,away:25}]};
  const team={...market,event_ticker:'KXNBATEAMTOTAL-X',floor_strike:100.5,title:'Home over 100.5 total points',custom_strike:{basketball_team:'h'}};
  assert.equal(scoreAgreement(g,[[{...reading,home:104,away:200}]],team,{minimumOverValue:105}),false);
  assert.equal(scoreAgreement(g,[[{...reading,home:105,away:200}]],team,{minimumOverValue:105}),true);
  const period={...market,event_ticker:'KXNBA1QTOTAL-X',floor_strike:50.5,title:'Over 50.5 total points in 1st quarter'};
  const r={...reading,home:120,away:110,periods:[{number:1,home:30,away:24}]};
  assert.equal(scoreAgreement(g,[[r]],period,{minimumOverValue:55}),false);
  assert.equal(scoreAgreement(g,[[{...r,periods:[{number:1,home:30,away:25}]}]],period,{minimumOverValue:55}),true);
});
test('ESPN must document the full soccer cushion on the exact live fixture',async()=>{
  const {game,market,milestone}=fixture();
  const event={id:'source',date:start,status:{type:{state:'in'},period:2,displayClock:"68'"},competitions:[{
    competitors:[{homeAway:'home',score:'2',team:{displayName:'Rafaela'}},{homeAway:'away',score:'2',team:{displayName:'Parana'}}],
    details:[1,1,1,1].map(scoreValue=>({scoringPlay:true,scoreValue}))}]};
  const run=(events,minimumOverValue=4)=>verifyIndependentOverDecision({...game},milestone,{market,minimumOverValue,
    fetcher:async()=>({ok:true,json:async()=>({events})})});
  assert.equal(await run([event]),true);
  const incomplete=structuredClone(event);incomplete.competitions[0].details.pop();
  assert.equal(await run([incomplete]),false);
  assert.equal(await run([event,event]),false);
  const wrong=structuredClone(event);wrong.competitions[0].competitors[1].team.displayName='Unknown Rival';
  assert.equal(await run([wrong]),null);
  assert.equal(await run([]),null);
});
test('official NBA evidence independently establishes the requested cushion',()=>{
  const {game,market,milestone}=fixture(),id='0022600001';
  const g={...game,type:'basketball_game',sport:'NBA',home:105,away:100,homeName:'Boston Celtics',awayName:'Brooklyn Nets'};
  const m={...milestone,title:'Brooklyn Nets at Boston Celtics'};
  const quote={...market,event_ticker:'KXNBATOTAL-X',floor_strike:200.5,title:'Over 200.5 total points',rules_primary:'Combined total points in the full game'};
  const official={gameId:id,gameTimeUTC:start,gameStatus:2,
    homeTeam:{teamCity:'Boston',teamName:'Celtics',score:105},awayTeam:{teamCity:'Brooklyn',teamName:'Nets',score:100}};
  assert.equal(nbaAgreement({game:official},g,m,quote,id,{minimumOverValue:205}),true);
  assert.equal(nbaAgreement({game:{...official,homeTeam:{...official.homeTeam,score:104}}},g,m,quote,id,{minimumOverValue:205}),false);
});
test('existing player-prop caps and combinations are not raised by the new tier',async()=>{
  const {game,market}=fixture();
  const g={...game,type:'basketball_game',sport:'NBA',period:1,remainingSeconds:480,playerStats:{p:{rebounds:10}}};
  const prop={...market,event_ticker:'KXNBAREB-X',floor_strike:5.5,title:'Pat: 6+ rebounds',yes_sub_title:'Pat: 6+',custom_strike:{basketball_player:'p'}};
  g.overVerification={...game.overVerification,contractKey:overContractKey(g,prop)};
  assert.equal(externalOverMinimum(g,prop),null);
  assert.equal(await verifyExternalOverExposure(g,prop,{verify:async()=>{throw Error('must not request a player increase')}}),false);
  rememberIndependentEntry(g,prop,g.verificationId,now);
  assert.equal(verifiedOverFraction(overSignal(g,prop),g,prop),.25);
});
test('sixty percent subtracts held exposure and paid fees from the entire position budget',()=>{
  const position={ticker:'OVER',position_fp:'40',market_exposure_dollars:'39',fees_paid_dollars:'1'};
  const budget=remainingVerifiedOverCents(position,10000,.60);
  assert.equal(budget,2000);
  const count=orderSize(10000,.91,1000,.60,1,10000,budget,2);
  assert.ok(count>0);assert.ok(estimatedCostCents(count,.91,2)+4000<=6000);
  assert.equal(remainingVerifiedOverCents({...position,market_exposure_dollars:'59'},10000,.60),0);
  const fill={status:'filled',strategy:'over',market_ticker:'OVER',event_ticker:'E',game_id:'g'};
  assert.equal(upgradeEligible(fill,position,{market:{ticker:'OVER'},event:{event_ticker:'E'},milestone:{id:'g'},signal:{strategy:'over',fraction:.60}}),true);
});
test('the final serialized gate includes holdings and fees for initial buys, upgrades and retries',async()=>{
  const source=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
  for(const held of [null,{ticker:'OVER',position_fp:'40',market_exposure_dollars:'39',fees_paid_dollars:'1'}]){
    const client={query:async sql=>({rows:sql.includes('pg_try_advisory_xact_lock')?[{acquired:true}]:[]}),release(){}};
    const context=vm.createContext({console,setTimeout,remainingVerifiedOverCents,estimatedCostCents,
      ensureManualCombos:async()=>{},accountBalance:async()=>({balance:10000,portfolio_value:0}),pool:{connect:async()=>client},allOpenPositions:async()=>({market_positions:held?[held]:[]}),
      filledOrderGateCount:()=>0,minimumProfitCents:()=>0,netSettlementProfitCents:()=>100});
    vm.runInContext(source.slice(source.indexOf('async function withEntryProfitFloor('),source.indexOf('async function milestones(')),context);
    let sent=0;
    const run=count=>context.withEntryProfitFloor({ticker:'OVER',count,price:.91,fees:2,strategy:'over',fraction:.60,bankroll:10000},async()=>++sent);
    assert.equal(await run(70),null);assert.equal(sent,0);
    assert.equal(await run(held?21:60),1);assert.equal(sent,1);
  }
  assert.equal((source.match(/assertOverExposure\(game,market,signal.fraction\)/g)||[]).length,2);
  assert.ok(source.includes('assertOverExposure(state,quote,verifiedSignal.fraction)'));
});
test('an existing forty percent fill can top up once through its separate sixty percent record; an uncertain earlier order blocks it',async()=>{
  const source=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
  for(const status of ['filled','check_order']){
    const {game,market,milestone}=fixture();await proof(game,market);
    const original={id:'initial',status:'filled',strategy:'over',market_ticker:market.ticker,event_ticker:market.event_ticker,game_id:game.id};
    const position={ticker:market.ticker,position_fp:'40',market_exposure_dollars:'39',fees_paid_dollars:'1'};
    const sent=[],reserved=[];
    const context=vm.createContext({console,PLAYER_PROP_MAX_FRACTION,overSignal,timedOverEntryValid,sameSportsContract,
      verifiedOverFraction,remainingVerifiedOverCents,upgradeEligible,estimatedCostCents,profitableCount,assertOverExposure,singleSpendableCash,
      upgradeTables:async()=>{},reconcileUpgrade:async row=>row,randomUUID:()=> 'external-upgrade',
      recoverSummaryAsk:async m=>m,hasAsk:()=>true,executableQuote:async m=>m,
      accountBalance:async()=>({balance:10000,portfolio_value:0}),allOpenPositions:async()=>({market_positions:[position]}),
      marketShard:()=>0,shardCash:()=>10000,feeReserve:()=>2,confirmedSingleFill:async()=>{},
      withEntryProfitFloor:async(options,send)=>{assert.equal(options.fraction,.60);return send()},
      contractCount:(cash,m,fraction,bankroll,budget,fees)=>orderSize(cash,m.yes_ask_dollars,m.yes_ask_size_fp,fraction,1,bankroll,budget,fees),
      pool:{query:async(sql,args)=>{
        if(sql.startsWith('SELECT * FROM robust_over_upgrades'))return {rows:[{status,id:'earlier-forty'}]};
        if(sql.startsWith('INSERT INTO external_cushion_upgrades')){reserved.push(args);return {rows:[{id:'external-upgrade'}],rowCount:1}}
        return {rows:[],rowCount:0};
      }},kalshi:async(path,options)=>{
        if(path.startsWith('/markets/'))return {market};
        options.beforeDispatch();sent.push(options.body);return {fill_count_fp:options.body.count,order_id:'external-fill'};
      }});
    vm.runInContext(source.slice(source.indexOf('async function upgradeHeldOver('),source.indexOf('async function immediatelyUpgradeFilledOver(')),context);
    const result=await context.upgradeHeldOver({state:game,market,milestone,event:{event_ticker:market.event_ticker}},
      {state:game,kalshiOnly:false},original);
    assert.equal(result.filled,status==='filled');assert.equal(sent.length,status==='filled'?1:0);
    assert.equal(reserved.length,status==='filled'?1:0);
    if(sent.length)assert.ok(estimatedCostCents(Number(sent[0].count),.91,2)+4000<=6000);
  }
});
test('sixty percent position reads reject a malformed exchange response',async()=>{
  const source=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
  const context=vm.createContext({URLSearchParams,kalshi:async()=>({})});
  vm.runInContext(source.slice(source.indexOf('async function allOpenPositions('),source.indexOf('// Serialize final buy decisions')),context);
  await assert.rejects(context.allOpenPositions({strict:true}),/complete position response/);
});

test('the production audit records the independently documented cushion and erases permission after a conflicting recheck',async()=>{
  const source=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
  const {game,market,milestone}=fixture();let goals=4,documented=4;const audits=[];
  const context=vm.createContext({console,AbortSignal,verifyIndependentOverDecision,rememberIndependentEntry,randomUUID:()=>String(audits.length),
    auditTable:async()=>{},pool:{query:async(sql,args)=>{audits.push(args);return {rows:[]}}},
    fetch:async()=>({ok:true,status:200,text:async()=>JSON.stringify({events:[{id:'external',date:start,
      status:{period:2,displayClock:"68'",type:{state:'in'}},competitions:[{competitors:[
        {homeAway:'home',score:String(goals),team:{displayName:'Rafaela'}},{homeAway:'away',score:'0',team:{displayName:'Parana'}}],
        details:Array.from({length:documented},()=>({scoringPlay:true,scoreValue:1}))}]}]})})});
  vm.runInContext(source.slice(source.indexOf('async function auditedOver('),source.indexOf('async function verifyCommandingLead(')),context);
  assert.equal(await context.auditedOver(game,milestone,{market}),true);
  assert.equal(game.independentEntry.overValue,4);assert.equal(await verifyExternalOverExposure(game,market),true);
  assert.equal(verifiedOverFraction(overSignal(game,market),game,market),.60);
  documented=3;assert.equal(await context.auditedOver(game,milestone,{market}),true);
  assert.equal(game.independentEntry.overValue,3);await verifyExternalOverExposure(game,market);
  assert.equal(verifiedOverFraction(overSignal(game,market),game,market),.50);
  goals=0;documented=0;assert.equal(await context.auditedOver(game,milestone,{market}),false);
  assert.equal(game.independentEntry,undefined);assert.throws(()=>assertOverExposure(game,market,.40));
  assert.equal(audits.at(-1)[2],false);
});
