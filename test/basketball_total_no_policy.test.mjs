import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {gameState} from '../src/strategy.mjs';
import {collegeBasketballTotalNo,collegeFootballTotalNo,bestNoAsk,noDepthAtAsk} from '../src/no_strategy.mjs';
import {overContractKey,sameSportsContract} from '../src/over_verification.mjs';
import {rememberIndependentEntry} from '../src/entry_verification.mjs';

function basketball(league,period,clock,home=60,away=65){
  const prefix=league==='NCAAMB'?'KXNCAAMB':'KXNCAAWB';
  const milestone={id:'bb-total-no-test',title:'Away at Home',type:'basketball_game',
    start_date:'2026-11-04T00:00:00Z',
    details:{league,home_team_id:'home',away_team_id:'away',main_game_event_ticker:prefix+'GAME-TEST'}};
  const state=gameState(milestone,{milestone_id:milestone.id,_observed_at:new Date().toISOString(),
    details:{status:'live',home_points:home,away_points:away,period,clock,
      last_updated_ts:Date.now()/1000,home_team_name:'Home',away_team_name:'Away'}});
  return {milestone,state};
}
function totalMarket(league,half,line){
  const prefix=league==='NCAAMB'?'KXNCAAMB':'KXNCAAWB';
  return {ticker:prefix+(half?'1H':'')+'TOTAL-TEST-'+line,event_ticker:prefix+(half?'1H':'')+'TOTAL-TEST',
    status:'active',title:'Over '+line+' points',floor_strike:line,strike_type:'greater',
    rules_primary:'Resolves Yes if over '+line+' total points are scored in '+
      (half?'the 1st half of ':'')+'the Away vs Home college basketball game.'};
}

test('basketball total NO requires exactly 25 unscored points strictly under 0:30 for men and women, halves and games',()=>{
  for(const [league,halfPeriod,gamePeriod] of [['NCAAMB',1,2],['NCAAWB',2,4]]){
    for(const half of [true,false]){
      const period=half?halfPeriod:gamePeriod;
      const market=totalMarket(league,half,150);
      const at=clock=>basketball(league,period,clock).state;
      assert.equal(collegeBasketballTotalNo(at('0:29'),market)?.total,125);
      assert.ok(collegeBasketballTotalNo(at('0:01'),market));
      assert.equal(collegeBasketballTotalNo(at('0:30'),market),null,'thirty seconds is not strictly less');
      assert.equal(collegeBasketballTotalNo(at('0:00'),market),null,'game or period already ended');
      assert.equal(collegeBasketballTotalNo(at('3:29'),market),null,'old entry window must be closed');
      assert.equal(collegeBasketballTotalNo(at('0:29'),totalMarket(league,half,149.5)),null,
        '24.5-point cushion is insufficient');
      assert.ok(collegeBasketballTotalNo(at('0:39'),market,{beforeWindow:true}),
        'first check remains available before the entry window');
      assert.equal(collegeBasketballTotalNo(at('5:00'),market,{beforeWindow:true}),null);
      assert.equal(collegeBasketballTotalNo(basketball(league,period,'0:29',61,65).state,market),null,
        'a combined score of 126 is too high for Over 150');
    }
  }
});

test('college basketball NO submits only under 0:30 with an aggregate 5% bankroll ceiling',async()=>{
  const source=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
  const code=source.slice(source.indexOf('async function scanCollegeTotalNos('),
    source.indexOf('async function scan(cachedMilestones'));
  assert.ok(code.includes('async function scanCollegeTotalNos'));
  const league='NCAAMB',market=totalMarket(league,false,150);
  const first=basketball(league,2,'0:39'),last=basketball(league,2,'0:29');
  const events=new Map([[market.event_ticker,{event_ticker:market.event_ticker,
    category:'Sports',markets:[market]}]]);
  let window=null,checks=0,orders=0,reserved=null,floor=null,orderSizing=null;
  const context=vm.createContext({Date,JSON,Number,Math,Promise,console,live:()=>true,
    liveBatch:async()=>new Map(),
    linkedEventTickers:()=>[market.event_ticker],
    collegeFootballTotalNo,collegeBasketballTotalNo,overContractKey,sameSportsContract,
    verifyIndependentCollegeTotalNo:async()=>{checks++;return {source:'ESPN',seconds:29}},
    pool:{query:async(sql,args=[])=>{
      if(sql.startsWith('SELECT * FROM college_total_no_windows'))return {rows:window?[window]:[]};
      if(sql.startsWith('INSERT INTO college_total_no_windows')){
        window={market_ticker:args[0],game_id:args[1],contract_key:args[2],
          period:args[3],first_clock:args[4],first_evidence:JSON.parse(args[5]),
          first_at:new Date(Date.now()-25000)};
        return {rows:[]};
      }
      if(sql.startsWith('SELECT 1 FROM trade_attempts'))return {rowCount:0};
      if(sql.startsWith('SELECT market_ticker,fill_count'))return {rows:[]};
      return {rows:[],rowCount:1};
    }},
    kalshi:async(path,opts)=>{
      if(path.endsWith('/orderbook'))return {orderbook_fp:{yes_dollars:[['0.05','100']]}};
      if(path.startsWith('/markets/'))return {market};
      if(path==='/portfolio/events/orders'){
        orders++;
        assert.equal(opts.body.side,'ask');
        opts.beforeDispatch();
        return {fill_count_fp:'10',order_id:'filled'};
      }
      throw Error(path);
    },
    liveMilestone:async()=>({milestone_id:last.milestone.id,
      _observed_at:new Date().toISOString(),
      details:{status:'live',home_points:60,away_points:65,period:2,clock:'0:29',
        last_updated_ts:Date.now()/1000,home_team_name:'Home',away_team_name:'Away'}}),
    gameState,bestNoAsk,noDepthAtAsk,minimumCount:()=>1,
    allOpenPositions:async()=>({market_positions:[]}),
    accountBalance:async()=>({balance:10000,portfolio_value:0}),
    shardCash:()=>10000,marketShard:()=>0,singleSpendableCash:v=>v,feeReserve:()=>0,
    orderSize:(...args)=>{orderSizing=args;return 10;},
    profitableCount:n=>n,estimatedCostCents:()=>500,
    auditTable:async()=>{},randomUUID:()=> 'proof',rememberIndependentEntry,
    reserve:async signal=>{reserved=signal;return 'order-1';},
    withEntryProfitFloor:async(options,fn)=>{floor=options;return fn();},
    invalidateBalance:async()=>{}
  });
  vm.runInContext(code,context);
  const run=state=>context.scanCollegeTotalNos([{milestone:first.milestone,state}],events,'basketball');
  assert.equal(await run(last.state),0,'cannot preflight after entering the final 30-second window');
  assert.equal(checks,0);
  assert.equal(await run(first.state),0,'first independent check only');
  assert.equal(checks,1);
  assert.equal(window?.first_clock,39);
  assert.equal(await run(basketball(league,2,'0:30').state),0,'0:30 is not entry eligible');
  assert.equal(orders,0);
  assert.equal(await run(last.state),1,'second check should authorize the final 29 seconds');
  assert.equal(checks,2);
  assert.equal(orders,1);
  assert.equal(reserved.fraction,.05,'risk reservation must use 5%');
  assert.equal(floor.fraction,.05,'final profit validation must use 5%');
  assert.equal(orderSizing[3],.05,'per-order allocation must use 5%');
  assert.equal(orderSizing[6],500,'the aggregate 5% pool of a $10,000 bankroll is $500');
});