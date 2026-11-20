import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {gameState} from '../src/strategy.mjs';
import {hockeyNoMarketSpec,hockeyTotalNo,verifyIndependentHockeyTotalNo} from '../src/hockey_total_no.mjs';
import {bestNoAsk,noDepthAtAsk} from '../src/no_strategy.mjs';
import {sameSportsContract,overContractKey} from '../src/over_verification.mjs';
import {rememberIndependentEntry} from '../src/entry_verification.mjs';

const milestone={id:'nhl-scanner',title:'Away at Home',type:'hockey_match',start_date:'2026-11-19T23:00:00Z',
  details:{league:'NHL',home_team_id:'home-id',away_team_id:'away-id',main_game_event_ticker:'KXNHLGAME-TEST'}};
const state=(clock='2:15',h=2,a=1)=>gameState(milestone,{milestone_id:milestone.id,_observed_at:new Date().toISOString(),
  details:{status:'inprogress',home_points:h,away_points:a,period:3,period_remaining_time:clock,
    last_updated_ts:Date.now()/1000,home_team_name:'Home',away_team_name:'Away'}});
const market=(period,line)=>({
  ticker:(period==='full_game'?'KXNHLTOTAL':'KXNHL3PTOTAL')+'-TEST-'+line,
  event_ticker:(period==='full_game'?'KXNHLTOTAL':'KXNHL3PTOTAL')+'-TEST',
  title:(period==='full_game'?'Full Game: ':'3rd Period: ')+'Over '+line+' goals scored',
  yes_sub_title:'Over '+line+' goals scored',floor_strike:line,strike_type:'greater',status:'active',
  rules_primary:'If the teams collectively score more than '+line+' goals in the '+
    (period==='full_game'?'Away vs Home NHL game':'3rd Period of the Away vs Home NHL game')+
    ' originally scheduled for Nov 19, 2026, then the market resolves to Yes.'
});
const markets=[market('full_game',5.5),market('third_period',2.5)];
const events=new Map(markets.map(m=>[m.event_ticker,{event_ticker:m.event_ticker,category:'Sports',markets:[m]}]));
const proof={source:'ESPN',eventId:'espn-game',home:2,away:1,period:3,seconds:89,
  periods:[{number:1,home:1,away:1},{number:2,home:1,away:0},{number:3,home:0,away:0}],
  period3:{home:0,away:0}};

function harness({ageMs=46000,canVerify=true,hasSeller=true,existingExposure=false}={}){
  const src=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
  const a=src.indexOf('async function scanHockeyTotalNos('),b=src.indexOf('async function scan(cachedMilestones',a);
  assert.ok(a>0&&b>a,'hockey scanner must be an isolated function in the total-NO pipeline');
  const code=src.slice(a,b);
  let n=0,verifications=0,orders=0,allocation=null,availablePool=null;
  const windows=new Map(),dashboard=new Map(),trace=[];
  const held={ticker:'KXNHLTOTAL-OLD',position_fp:-1,market_exposure_dollars:'4.00',fees_paid_dollars:'0.50'};
  const context=vm.createContext({
    Date,JSON,Number,Math,Promise,console,live:()=>true,
    liveBatch:async()=>new Map(),
    linkedEventTickers:()=>markets.map(x=>x.event_ticker),
    hockeyNoMarketSpec,hockeyTotalNo,
    verifyIndependentHockeyTotalNo:async(game)=>{
      verifications++;trace.push('external');
      return canVerify?{...proof,seconds:game.remainingSeconds}:null;
    },
    overContractKey,sameSportsContract,
    pool:{query:async(sql,args=[])=>{
      if(sql.startsWith('SELECT * FROM hockey_total_no_windows'))return {rows:windows.has(args[0])?[windows.get(args[0])]:[]};
      if(sql.startsWith('INSERT INTO hockey_total_no_windows')){
        windows.set(args[0],{market_ticker:args[0],game_id:args[1],contract_key:args[2],period:args[3],
          first_clock:args[4],first_evidence:JSON.parse(args[5]),first_at:new Date(Date.now()-ageMs)});
        return {rows:[],rowCount:1};
      }
      if(sql.startsWith('SELECT 1 FROM trade_attempts'))return {rows:[],rowCount:0};
      if(sql.startsWith('SELECT market_ticker,fill_count'))return {rows:existingExposure?[{market_ticker:held.ticker}]:[]};
      return {rows:[],rowCount:1};
    }},
    liveMilestone:async()=>({milestone_id:milestone.id,_observed_at:new Date().toISOString(),
      details:{status:'inprogress',home_points:2,away_points:1,period:3,
        period_remaining_time:'1:29',last_updated_ts:Date.now()/1000,
        home_team_name:'Home',away_team_name:'Away'}}),
    gameState,
    kalshi:async(path,opts)=>{
      if(path.endsWith('/orderbook')){trace.push('orderbook');return {orderbook_fp:{yes_dollars:hasSeller?[['0.95','100']]:[]}};}
      if(path.startsWith('/markets/'))return {market:markets.find(x=>path.includes(x.ticker))};
      if(path==='/portfolio/events/orders'){
        orders++;trace.push('order');
        assert.equal(opts.body.side,'ask');opts.beforeDispatch();
        return {fill_count_fp:'1',order_id:'filled'};
      }
      throw Error(path);
    },
    bestNoAsk,noDepthAtAsk,
    minimumCount:()=>1,
    allOpenPositions:async()=>({market_positions:existingExposure?[held]:[]}),
    accountBalance:async()=>({balance:10000,portfolio_value:0}),
    shardCash:()=>10000,marketShard:()=>0,singleSpendableCash:v=>v,feeReserve:()=>0,
    orderSize:(cash,price,depth,fraction,min,bankroll,budget)=>{
      allocation=fraction;availablePool=budget;return 1;
    },
    profitableCount:n=>n,estimatedCostCents:()=>0,
    auditTable:async()=>{},randomUUID:()=> 'hockey-verification',rememberIndependentEntry,
    reserve:async signal=>{trace.push('reserve');assert.equal(signal.fraction,.05);return 'hockey-order';},
    withEntryProfitFloor:async(options,fn)=>{assert.equal(options.fraction,.05);return fn();},
    invalidateBalance:async()=>{}
  });
  vm.runInContext(code,context);
  return {
    async scan(clock){return context.scanHockeyTotalNos([{milestone,state:state(clock)}],events,dashboard);},
    get windows(){return windows;},get trace(){return trace;},
    get dashboard(){return dashboard;},get verifications(){return verifications;},
    get orders(){return orders;},get allocation(){return allocation;},get availablePool(){return availablePool;}
  };
}

test('NHL NO checks both full-game and P3, with independent 2:15 preflight then one fresh proof per entry under 1:30',async()=>{
  const h=harness();
  assert.equal(await h.scan('2:16'),0);
  assert.equal(h.verifications,0);
  assert.equal(await h.scan('2:15'),0);
  assert.equal(h.windows.size,2,'track separate windows for game and third period');
  assert.equal(h.orders,0);
  assert.equal(await h.scan('1:30'),0);
  assert.equal(h.orders,0,'strictly under 90s required');
  assert.equal(await h.scan('1:29'),2);
  assert.equal(h.orders,2,'both distinct markets can qualify');
  assert.equal(h.allocation,.05);
  assert.ok(h.trace.lastIndexOf('external')<h.trace.lastIndexOf('reserve'),'external immediately precedes reservation');
  assert.ok(h.trace.indexOf('orderbook')<h.trace.lastIndexOf('external'),'final check after NO quote');
  assert.deepEqual(new Set((h.dashboard.get(milestone.id)||[]).filter(x=>x.strategy==='no').map(x=>x.ticker)),
    new Set(markets.map(x=>x.ticker)));
});

test('NHL total NO enters after its first external proof without a 45-second wait',async()=>{
  const h=harness({ageMs:1000});
  await h.scan('2:15');
  assert.equal(h.windows.size,2);
  assert.equal(await h.scan('1:29'),2);
  assert.equal(h.orders,2,'no arbitrary wall-clock dwell after preflight');
  assert.ok((h.dashboard.get(milestone.id)||[]).every(s=>!/45-second/.test(s.execution)));
  assert.ok(h.trace.lastIndexOf('external')<h.trace.lastIndexOf('reserve'));
});

test('NHL total NO rejects a preflight timestamp from the future',async()=>{
  const h=harness({ageMs:-1000});
  await h.scan('2:15');
  assert.equal(await h.scan('1:29'),0);
  assert.equal(h.orders,0);
});

test('NHL total NO requires verifiable period linescores and declines missing independent evidence',async()=>{
  const h=harness({canVerify:false});
  await h.scan('2:15');
  assert.equal(h.windows.size,0);
  assert.equal(await h.scan('1:29'),0);
  assert.equal(h.orders,0);
});

test('NHL NO never enters without an executable NO seller',async()=>{
  const h=harness({hasSeller:false});
  await h.scan('2:15');
  assert.equal(await h.scan('1:29'),0);
  assert.equal(h.orders,0);
  assert.ok((h.dashboard.get(milestone.id)||[]).some(s=>/NO seller/i.test(s.execution)));
});

test('NHL total NO caps full-game and P3 entries in one shared fee-inclusive 5% pool',async()=>{
  const h=harness({existingExposure:true});
  await h.scan('2:15');
  await h.scan('1:29');
  assert.equal(h.allocation,.05);
  assert.equal(h.availablePool,50,'$5 total cap minus existing $4 exposure and $0.50 fees leaves $0.50');
});

test('hockey NO dashboard signals are persisted alongside existing strategies, without changing football or basketball scans',()=>{
  const src=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
  assert.match(src,/scanHockeyTotalNos\(marketGames,events,hockeyNoSignals\)/);
  assert.match(src,/hockeyNoSignals\.get\(id\)/);
  assert.match(src,/const hockeyNoSignals=new Map\(\)/);
  const begin=src.indexOf('for(const [id,candidates] of snapshotCandidates){');
  const end=src.indexOf('// Expire only the current ten-minute attempt.',begin);
  assert.ok(begin>0&&end>begin);
  const row=Array(18).fill(null);row.leadWatch=null;
  const snapshotRows=new Map([['game',row]]);
  const snapshotCandidates=new Map([['game',[]]]);
  const hockeyNoSignals=new Map([['game',[{strategy:'no',ticker:markets[0].ticker,title:'Over 5.5 goals',execution:'Preflight scheduled'}]]]);
  const basketballNoSignals=new Map();
  vm.runInNewContext(src.slice(begin,end),{snapshotRows,snapshotCandidates,hockeyNoSignals,basketballNoSignals,
    crossingRows:[],filled:new Set(),account:{},balance:0,bankroll:0,signalExecution:()=>''});
  assert.equal(JSON.parse(row[14])[0].strategy,'no');
  assert.equal(JSON.parse(row[14])[0].ticker,markets[0].ticker);
});