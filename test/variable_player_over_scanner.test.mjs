import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {gameState,playerPropEarlyWindow} from '../src/strategy.mjs';
import {variablePlayerOverSpec,variableProofValid,VARIABLE_CONFIRM_DELAY_MS} from '../src/variable_player_over.mjs';
import {sameSportsContract} from '../src/over_verification.mjs';
import {rememberIndependentEntry,independentEntryValid} from '../src/entry_verification.mjs';

const milestone={id:'variable-nba-scan',type:'basketball_game',title:'Away at Home',
  start_date:new Date(Date.now()-15*60000).toISOString(),
  details:{league:'NBA',main_game_event_ticker:'KXNBAGAME-TEST'}};
const market={ticker:'KXNBAPTS-TEST-PAT-20',event_ticker:'KXNBAPTS-TEST',title:'Pat Player: 20+ points',
  yes_sub_title:'Pat Player: 20+',rules_primary:'If Pat Player records 20+ points in the Away vs Home NBA game originally scheduled for Nov 20, 2026, then the market resolves to Yes.',
  status:'active',strike_type:'greater',floor_strike:19.5,
  custom_strike:{basketball_player:'p'},yes_ask_dollars:'0.75',yes_ask_size_fp:'50'};
const events=new Map([[market.event_ticker,{category:'Sports',
  event_ticker:market.event_ticker,markets:[market]}]]);
const raw=(points=22)=>({milestone_id:milestone.id,_observed_at:new Date().toISOString(),details:{
  status:'live',home_score:21,away_score:12,period:1,clock:'08:00',
  last_updated_ts:Date.now()/1000,home_team_name:'Home',away_team_name:'Away',
  player_stats:{p:{points}}}});
const state=()=>gameState(milestone,raw());
function harness({ageMs=211000,initialUnavailable=false,finalUnavailable=false,
  finalPoints=22,noSeller=false,noLaterPlay=false,firstSource='ESPN',secondSource=firstSource,existingOrder=false}={}){
  const src=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
  const a=src.indexOf('async function scanVariablePlayerOvers(');
  const b=src.indexOf('async function scan(cachedMilestones',a);
  assert.ok(a>0&&b>a,'scanner has a dedicated function');
  const stored=new Map(),dashboard=new Map(),trace=[];
  let verified=0,orders=0,spentFraction=null;
  const source=vm.createContext({
    Date,Math,Number,JSON,Promise,console,process:{env:{}},
    live:()=>true,playerPropEarlyWindow,linkedEventTickers:()=>[market.event_ticker],
    variablePlayerOverSpec,variableProofValid,VARIABLE_CONFIRM_DELAY_MS,
    sameSportsContract,gameState,
    verifyIndependentVariableOver:async(game,m,seller)=>{
      verified++;trace.push('external-'+verified);
      if(initialUnavailable||finalUnavailable&&verified>1)return null;
      const spec=variablePlayerOverSpec(game,seller);
      return {source:verified===1?firstSource:secondSource,eventId:'ESPN-GAME',
        gameId:game.id,metric:spec.metric,playerId:spec.player.id,
        playerValue:spec.player.value,contractKey:spec.contractKey,
        requestedAt:verified===1?Date.now()-ageMs:Date.now(),
        lastPlaySequence:verified===1?100:102,
        plays:[{id:'one',sequenceNumber:'100',type:{text:'Made Shot'}},
          ...(verified===1||noLaterPlay?[]:[{id:'two',sequenceNumber:'101',type:{text:'Made Shot'}}])]};
    },
    pool:{query:async(sql,args=[])=>{
      if(sql.startsWith('SELECT * FROM variable_player_over_windows'))
        return {rows:stored.has(args[0])?[stored.get(args[0])]:[],rowCount:stored.has(args[0])?1:0};
      if(sql.startsWith('INSERT INTO variable_player_over_windows')){
        stored.set(args[0],{market_ticker:args[0],game_id:args[1],contract_key:args[2],
          player_id:args[3],metric:args[4],first_requested_at:args[5],first_proof:JSON.parse(args[6])});
        return {rows:[],rowCount:1};
      }
      if(sql.startsWith('SELECT 1 FROM trade_attempts'))
        return {rows:existingOrder?[{id:'existing'}]:[],rowCount:existingOrder?1:0};
      return {rows:[],rowCount:1};
    }},
    liveMilestone:async()=>raw(finalPoints),
    kalshi:async(path,opts)=>{
      if(path.startsWith('/markets/'))return {market};
      if(path==='/portfolio/events/orders'){
        orders++;trace.push('order');opts.beforeDispatch();
        assert.equal(opts.body.side,'bid');
        assert.equal(opts.body.time_in_force,'fill_or_kill');
        assert.equal(opts.body.ticker,market.ticker);
        assert.equal(opts.body.price,'0.7500');
        return {fill_count_fp:'1',order_id:'filled'};
      }
      throw Error(path);
    },
    recoverSummaryAsk:async m=>m,
    hasAsk:m=>Number(m?.yes_ask_size_fp)>0,
    executableQuote:async m=>noSeller?null:m,
    allOpenPositions:async()=>({market_positions:[]}),
    accountBalance:async()=>({balance:10000,portfolio_value:0}),
    shardCash:()=>10000,marketShard:()=>0,singleSpendableCash:x=>x,
    feeReserve:()=>2,contractCount:(cash,seller,fraction)=>{spentFraction=fraction;return 1;},
    profitableCount:n=>n,
    auditTable:async()=>{},randomUUID:()=> 'test-proof',
    rememberIndependentEntry,independentEntryValid,
    reserve:async signal=>{trace.push('reserve');assert.equal(signal.fraction,.25);return 'order-1';},
    withEntryProfitFloor:async(opt,send)=>{assert.equal(opt.fraction,.25);return send();},
    invalidateBalance:async()=>{},
  });
  vm.runInContext(src.slice(a,b),source);
  return {
    scan:()=>source.scanVariablePlayerOvers([{state:state(),milestone}],events,dashboard),
    get stored(){return stored;},get dashboard(){return dashboard;},
    get verified(){return verified;},get orders(){return orders;},
    get trace(){return trace;},get spentFraction(){return spentFraction;}
  };
}

test('variable NBA prop persists initial proof then purchases only after 3:30 and later play',async()=>{
  const h=harness();
  assert.equal(await h.scan(),0);
  assert.equal(h.stored.size,1);
  assert.equal(h.orders,0);
  assert.equal(await h.scan(),1);
  assert.equal(h.verified,2);
  assert.equal(h.orders,1);
  assert.equal(h.spentFraction,.25);
  assert.ok(h.trace.indexOf('external-2')<h.trace.indexOf('reserve'));
  assert.ok((h.dashboard.get(milestone.id)||[]).some(s=>s.player_prop&&s.ticker===market.ticker));
});
test('both checkpoints may use FOX when ESPN was unavailable twice at each, without mixing providers',async()=>{
  const h=harness({firstSource:'FOX Sports',secondSource:'FOX Sports'});
  await h.scan();assert.equal(await h.scan(),1);
  assert.equal(h.orders,1);assert.equal(h.verified,2);
});
test('no live order is allowed before the second independent check is due',async()=>{
  const h=harness({ageMs:209000});
  await h.scan();assert.equal(await h.scan(),0);
  assert.equal(h.verified,1);assert.equal(h.orders,0);
});
test('a missing initial check prevents entry and creates no preflight',async()=>{
  const h=harness({initialUnavailable:true});await h.scan();await h.scan();
  assert.equal(h.orders,0);assert.equal(h.stored.size,0);
});
test('stale or contradicted final statistics never authorize an order',async()=>{
  for(const opt of [{finalUnavailable:true},{finalPoints:19},{noLaterPlay:true},
    {secondSource:'FOX Sports'},{noSeller:true},{existingOrder:true}]){
    const h=harness(opt);
    await h.scan();assert.equal(await h.scan(),0,JSON.stringify(opt));
    assert.equal(h.orders,0,JSON.stringify(opt));
  }
});