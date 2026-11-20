import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {gameState,orderSize,estimatedCostCents} from '../src/strategy.mjs';
import {soccerNoMarketSpec,soccerTotalNo} from '../src/soccer_total_no.mjs';
import {bestNoAsk,noDepthAtAsk} from '../src/no_strategy.mjs';
import {sameSportsContract,overContractKey} from '../src/over_verification.mjs';
import {rememberIndependentEntry} from '../src/entry_verification.mjs';

const milestone={id:'soccer-scanner',title:'Away at Home',type:'soccer_match',
  start_date:'2026-11-20T17:00:00Z',
  details:{league:'EPL',main_game_event_ticker:'KXEPLGAME-26NOV20AWAYHOME'}};
const state=(seconds=540,home=2,away=1)=>gameState(milestone,{
  milestone_id:milestone.id,_observed_at:new Date().toISOString(),
  details:{status:'inprogress',home_score:home,away_score:away,half:'2nd',
    time:Math.floor(90-seconds/60)+"'",match_remaining_seconds:seconds,
    home_team_name:'Home',away_team_name:'Away',last_updated_ts:Date.now()/1000}});
const market={ticker:'KXEPLTOTAL-26NOV20AWAYHOME-5',
  event_ticker:'KXEPLTOTAL-26NOV20AWAYHOME',
  title:'Will over 4.5 goals be scored?',yes_sub_title:'Over 4.5 goals scored',
  floor_strike:4.5,strike_type:'greater',status:'active',
  rules_primary:'If over 4.5 goals are scored in the Away vs Home professional EPL soccer game originally scheduled for Nov 20, 2026 after 90 minutes plus stoppage time (does not include extra time or penalties), then the market resolves to Yes.'};
const events=new Map([[market.event_ticker,{event_ticker:market.event_ticker,category:'Sports',markets:[market]}]]);

function harness({canVerify=true,hasSeller=true,initialAgeMs=0,existingExposure=false,
  afterRefreshScore=3,missingClock=false,finalExternalFails=false,duplicate=false}={}){
  const src=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
  const a=src.indexOf('async function scanSoccerTotalNos('),b=src.indexOf('async function scan(cachedMilestones',a);
  assert.ok(a>0&&b>a,'soccer NO scanner must be confined to a dedicated function');
  const code=src.slice(a,b);
  const windows=new Map(),dashboard=new Map(),trace=[];
  let verified=0,orders=0,lastBudget=null,lastFraction=null,lastQuantity=null;
  const held={ticker:'KXEPLTOTAL-OLDER',position_fp:-1,market_exposure_dollars:'4.00',fees_paid_dollars:'0.50'};
  const context=vm.createContext({
    Date,JSON,Number,Math,Promise,console,live:()=>true,
    liveBatch:async()=>new Map(),
    linkedEventTickers:()=>[market.event_ticker],
    soccerNoMarketSpec,soccerTotalNo,
    verifyIndependentSoccerTotalNo:async game=>{
      verified++;trace.push('external');
      if(!canVerify||finalExternalFails&&verified>1)return null;
      return {source:'ESPN',eventId:'espn-soccer',home:game.home,away:game.away,
        period:2,elapsedMinute:game.soccerMinute,live:true};
    },
    overContractKey,sameSportsContract,
    pool:{query:async(sql,args=[])=>{
      if(sql.startsWith('SELECT * FROM soccer_total_no_windows'))
        return {rows:windows.has(args[0])?[windows.get(args[0])]:[]};
      if(sql.startsWith('INSERT INTO soccer_total_no_windows')){
        windows.set(args[0],{market_ticker:args[0],game_id:args[1],contract_key:args[2],
          period:args[3],first_clock:args[4],first_evidence:JSON.parse(args[5]),
          first_at:new Date(Date.now()-initialAgeMs)});
        return {rows:[],rowCount:1};
      }
      if(sql.startsWith('SELECT 1 FROM trade_attempts'))
        return {rows:duplicate?[{id:'existing'}]:[],rowCount:duplicate?1:0};
      if(sql.startsWith('SELECT market_ticker,fill_count'))
        return {rows:existingExposure?[{market_ticker:held.ticker}]:[]};
      return {rows:[],rowCount:1};
    }},
    liveMilestone:async()=>({
      milestone_id:milestone.id,_observed_at:new Date().toISOString(),
      details:{status:'inprogress',home_score:afterRefreshScore===3?2:3,away_score:1,half:'2nd',
        time:"82'",match_remaining_seconds:missingClock?undefined:479,
        home_team_name:'Home',away_team_name:'Away',last_updated_ts:Date.now()/1000}}),
    gameState,
    kalshi:async(path,opts)=>{
      if(path.endsWith('/orderbook')){
        trace.push('orderbook');
        return {orderbook_fp:{yes_dollars:hasSeller?[['0.50','100']]:[]}};
      }
      if(path.startsWith('/markets/'))return {market};
      if(path==='/portfolio/events/orders'){
        orders++;trace.push('order');
        assert.equal(opts.body.side,'ask');
        assert.equal(opts.body.time_in_force,'fill_or_kill');
        opts.beforeDispatch();
        return {fill_count_fp:'1',order_id:'filled'};
      }
      throw Error(path);
    },
    bestNoAsk,noDepthAtAsk,minimumCount:()=>.01,
    allOpenPositions:async()=>({market_positions:existingExposure?[held]:[]}),
    accountBalance:async()=>({balance:10000,portfolio_value:0}),
    shardCash:()=>10000,marketShard:()=>0,singleSpendableCash:v=>v,feeReserve:()=>2,
    orderSize:(cash,price,depth,fraction,min,bankroll,budget,fees)=>{
      lastFraction=fraction;lastBudget=budget;
      lastQuantity=orderSize(cash,price,depth,fraction,min,bankroll,budget,fees);
      return lastQuantity;
    },
    profitableCount:n=>n>0,estimatedCostCents,
    auditTable:async()=>{},randomUUID:()=> 'soccer-verification',rememberIndependentEntry,
    reserve:async signal=>{
      trace.push('reserve');assert.equal(signal.fraction,.05);return 'soccer-order';
    },
    withEntryProfitFloor:async(options,send)=>{
      assert.equal(options.fraction,.05);return send();
    },
    invalidateBalance:async()=>{}
  });
  vm.runInContext(code,context);
  return {
    scan:seconds=>context.scanSoccerTotalNos([{milestone,state:state(seconds)}],events,dashboard),
    get windows(){return windows;},get trace(){return trace;},
    get dashboard(){return dashboard;},get verifications(){return verified;},
    get orders(){return orders;},get lastBudget(){return lastBudget;},
    get lastFraction(){return lastFraction;},get lastQuantity(){return lastQuantity;}
  };
}

test('soccer NO checks once near 9:00 and once just before entry strictly under 8:00',async()=>{
  const h=harness();
  assert.equal(await h.scan(541),0);
  assert.equal(h.verifications,0);
  assert.equal(await h.scan(540),0);
  assert.equal(h.windows.size,1);
  assert.equal(h.orders,0);
  assert.equal(await h.scan(480),0);
  assert.equal(h.verifications,1,'waiting at eight minutes must not repeat external proof');
  assert.equal(await h.scan(479),1);
  assert.equal(h.verifications,2);
  assert.equal(h.orders,1);
  assert.equal(h.lastFraction,.05);
  assert.ok(h.lastQuantity>0);
  assert.ok(h.trace.indexOf('orderbook')<h.trace.lastIndexOf('external'));
  assert.ok(h.trace.lastIndexOf('external')<h.trace.lastIndexOf('reserve'));
  assert.ok((h.dashboard.get(milestone.id)||[]).some(s=>s.strategy==='no'&&s.ticker===market.ticker));
});

test('soccer NO never enters without the original independently verified 9-minute window',async()=>{
  const h=harness();
  assert.equal(await h.scan(479),0);
  assert.equal(h.orders,0);
  assert.equal(h.verifications,0);
});

test('soccer NO blocks final order on a missing or contradictory external reading',async()=>{
  for(const opts of [{canVerify:false},{finalExternalFails:true},{afterRefreshScore:4},{missingClock:true}]){
    const h=harness(opts);
    await h.scan(540);
    assert.equal(await h.scan(479),0,JSON.stringify(opts));
    assert.equal(h.orders,0,JSON.stringify(opts));
  }
});

test('soccer NO requires an executable NO seller and refuses stale or future-dated initial proof',async()=>{
  for(const opts of [{hasSeller:false},{initialAgeMs:-1000},{initialAgeMs:1000000}]){
    const h=harness(opts);await h.scan(540);
    assert.equal(await h.scan(479),0,JSON.stringify(opts));
    assert.equal(h.orders,0,JSON.stringify(opts));
  }
});

test('soccer NO cumulatively caps held exposure plus fees at five percent',async()=>{
  const h=harness({existingExposure:true});
  await h.scan(540);
  await h.scan(479);
  assert.equal(h.lastFraction,.05);
  assert.equal(h.lastBudget,50,'$5.00 cap less $4 exposure and 50-cent fees leaves 50 cents');
  assert.ok(estimatedCostCents(h.lastQuantity,.5,2)<=50,'new trade including fees fits the remaining 50 cents');
});

test('soccer NO signals are published to the dashboard without removing other strategies',()=>{
  const src=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
  assert.match(src,/scanSoccerTotalNos\(marketGames,events,soccerNoSignals\)/);
  const begin=src.indexOf('for(const [id,candidates] of snapshotCandidates){');
  const end=src.indexOf('// Expire only the current ten-minute attempt.',begin);
  assert.ok(begin>0&&end>begin);
  const row=Array(18).fill(null);row.leadWatch=null;
  const snapshotRows=new Map([['game',row]]);
  const snapshotCandidates=new Map([['game',[]]]);
  const soccerNoSignals=new Map([['game',[{strategy:'no',ticker:market.ticker,title:market.title,execution:'Preflight pending'}]]]);
  const hockeyNoSignals=new Map([['game',[{strategy:'no',ticker:'NHL',execution:'NHL state'}]]]);
  const basketballNoSignals=new Map([['game',[{strategy:'watch',execution:'Basketball state'}]]]);
  vm.runInNewContext(src.slice(begin,end),{
    snapshotRows,snapshotCandidates,soccerNoSignals,hockeyNoSignals,basketballNoSignals,
    crossingRows:[],filled:new Set(),account:{},balance:0,bankroll:0,signalExecution:()=>''});
  assert.deepEqual(JSON.parse(row[14]).map(s=>s.ticker||s.execution).slice(0,3),[market.ticker,'NHL','Basketball state']);
});