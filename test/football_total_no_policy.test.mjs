import {noFinalCheckpoint,pairedExternalMatch} from './support/no_final_checkpoint_mock.mjs';
import {noAskTimeout,waitingOnAsk,NO_ASK_RETIRED,noAskKey} from './support/no_ask_mock.mjs';

import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {gameState} from '../src/strategy.mjs';
import {collegeFootballTotalNo,collegeBasketballTotalNo,bestNoAsk,noDepthAtAsk} from '../src/no_strategy.mjs';
import {verifyIndependentCollegeTotalNo,independentCollegeTotalNoReading} from '../src/college_total_no.mjs';
import {linkedEventTickers} from '../src/discovery.mjs';
import {sameSportsContract,overContractKey} from '../src/over_verification.mjs';
import {rememberIndependentEntry} from '../src/entry_verification.mjs';

function fixture(sport='NFL',period=4,clock='4:59',home=20,away=17) {
  const prefix=sport==='NFL'?'KXNFL':'KXNCAAF';
  const milestone={id:'football-'+sport,title:'Away at Home',type:'football_game',
    start_date:'2026-11-19T01:00:00Z',
    details:{league:sport,home_team_id:'home-id',away_team_id:'away-id',
      main_game_event_ticker:prefix+'GAME-26NOV19AWAYHOME'}};
  const state=gameState(milestone,{milestone_id:milestone.id,_observed_at:new Date().toISOString(),
    details:{status:'inprogress',home_points:home,away_points:away,quarter:period,clock,
      home_team_name:'Home',away_team_name:'Away',last_updated_ts:Date.now()/1000}});
  return {milestone,state};
}
function market(sport='NFL',line=52,{half=false,quarter=false}={}){
  const prefix=sport==='NFL'?'KXNFL':'KXNCAAF';
  const series=prefix+(half?'1H':quarter?'4Q':'')+'TOTAL',name=half?'the 1st half of ':quarter?'the 4th quarter of ':'the full ';
  return {ticker:series+'-26NOV19AWAYHOME-'+line,event_ticker:series+'-26NOV19AWAYHOME',
    status:'active',title:'Over '+line+' points',floor_strike:line,strike_type:'greater',
    rules_primary:'The teams collectively score more than '+line+' points in '+name+
      'Away vs Home football game.'};
}

test('football total NO accepts only Q4 full-game contracts strictly under five minutes',()=>{
  for(const sport of ['CFB','NFL']){
    const line=sport==='CFB'?57:52;
    for(const period of [1,2,3,5]){
      assert.equal(collegeFootballTotalNo(fixture(sport,period).state,market(sport,line)),null,
        sport+' must reject all non-Q4 periods');
      assert.equal(collegeFootballTotalNo(fixture(sport,period,'5:30').state,market(sport,line),{beforeWindow:true}),null,
        sport+' must not preflight any other quarter');
    }
    assert.ok(collegeFootballTotalNo(fixture(sport,4,'4:59').state,market(sport,line)));
    assert.ok(collegeFootballTotalNo(fixture(sport,4,'0:01').state,market(sport,line)));
    assert.equal(collegeFootballTotalNo(fixture(sport,4,'5:00').state,market(sport,line)),null);
    assert.equal(collegeFootballTotalNo(fixture(sport,4,'0:00').state,market(sport,line)),null);
    assert.ok(collegeFootballTotalNo(fixture(sport,4,'5:30').state,market(sport,line),{beforeWindow:true}));
    assert.equal(collegeFootballTotalNo(fixture(sport,4,'6:00').state,market(sport,line),{beforeWindow:true}),null);
    assert.equal(collegeFootballTotalNo(fixture(sport,4,'4:59').state,market(sport,line,{half:true})),null);
    assert.equal(collegeFootballTotalNo(fixture(sport,4,'4:59').state,market(sport,line,{quarter:true})),null);
    assert.equal(collegeFootballTotalNo(fixture(sport,4,'4:59').state,
      {...market(sport,line),title:'Over '+(line+1)+' points'}),null,'contract titles must match strikes');
  }
});

test('college football needs 20 points; NFL needs 15 points above both teams combined',()=>{
  for(const [sport,line,threshold] of [['CFB',57,20],['NFL',52,15]]){
    const game=fixture(sport).state;
    assert.equal(collegeFootballTotalNo(game,market(sport,line))?.total,37);
    assert.equal(collegeFootballTotalNo(game,market(sport,line))?.line,37+threshold);
    assert.equal(collegeFootballTotalNo(game,market(sport,line-.5)),null,
      sport+' rejects a cushion half a point below its minimum');
    if(sport==='CFB')assert.equal(collegeFootballTotalNo(game,market(sport,55)),null,
      'old 18-point college football cushion must not qualify');
    assert.ok(collegeFootballTotalNo(game,market(sport,line+.5)));
    assert.equal(collegeFootballTotalNo(game,market(sport,line+1,{half:true})),null);
    assert.equal(collegeFootballTotalNo(game,market(sport,line+1,{quarter:true})),null);
    assert.equal(collegeFootballTotalNo(game,{...market(sport,line),status:'closed'}),null);
    assert.equal(collegeFootballTotalNo({...game,sport:sport==='CFB'?'NFL':'CFB'},market(sport,line)),null);
  }
  const nfl=fixture('NFL');
  assert.ok(linkedEventTickers(nfl.milestone).includes(market('NFL').event_ticker),
    'NFL full-game TOTAL event is discovered from linked GAME');
});

test('NFL total NO independently verifies teams and scores, not ESPN clock',async()=>{
  const f=fixture('NFL',4,'5:30'),m=market('NFL');
  const board={events:[{id:'nfl-game',date:f.milestone.start_date,competitions:[{
    status:{period:4,displayClock:'5:30',type:{state:'in'}},
    competitors:[{homeAway:'home',score:'20',team:{displayName:'Home',abbreviation:'HOM'}},
      {homeAway:'away',score:'17',team:{displayName:'Away',abbreviation:'AWY'}}]
  }]}]};
  assert.equal(independentCollegeTotalNoReading(board,f.state,f.milestone,m)?.seconds,330);
  const urls=[];
  const proof=await verifyIndependentCollegeTotalNo(f.state,f.milestone,m,{fetcher:async url=>{
    urls.push(url);
    return {ok:true,json:async()=>board};
  }});
  assert.equal(proof?.eventId,'nfl-game');
  assert.ok(urls.length>0&&urls.every(url=>url.includes('/football/nfl/')&&!url.includes('&groups=')));
  const conflict=structuredClone(board);conflict.events[0].competitions[0].competitors[0].score='21';
  assert.equal(independentCollegeTotalNoReading(conflict,f.state,f.milestone,m)?.home,21);
  assert.equal((await verifyIndependentCollegeTotalNo(f.state,f.milestone,m,{fetcher:async()=>({ok:true,json:async()=>conflict})}))?.home,21);
  const clockConflict=structuredClone(board);clockConflict.events[0].competitions[0].status.displayClock='5:00';
  assert.equal(independentCollegeTotalNoReading(clockConflict,f.state,f.milestone,m)?.home,20);
});

test('football scanner enforces shared 5% NO pool including NFL, CFB and fees',async()=>{
  const source=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
  const code=source.slice(source.indexOf('async function scanCollegeTotalNos('),source.indexOf('async function scan(cachedMilestones'));
  assert.ok(code.includes('async function scanCollegeTotalNos'));
  const m=market('NFL'),first=fixture('NFL',4,'5:30'),later=fixture('NFL',4,'4:59');
  const events=new Map([[m.event_ticker,{category:'Sports',event_ticker:m.event_ticker,markets:[m]}]]);
  let saved=null,orders=0,checks=0,allocation=null,budget=null,patterns=[];
  const fakeHeld={ticker:'KXNCAAFTOTAL-OLD',position_fp:-2,market_exposure_dollars:'3.00',fees_paid_dollars:'1.00'};
  const context=vm.createContext({noFinalCheckpoint,noAskTimeout,waitingOnAsk,NO_ASK_RETIRED,noAskKey,recordDecision:async()=>{},pairedExternalMatch,Date,JSON,Number,Math,Promise,console,live:()=>true,
    liveBatch:async()=>new Map(),linkedEventTickers:()=>[m.event_ticker],
    collegeFootballTotalNo,collegeBasketballTotalNo,overContractKey,sameSportsContract,
    verifyIndependentCollegeTotalNo:async game=>{checks++;return {source:'ESPN',eventId:'nfl-external',gameId:game.id,home:game.home,away:game.away,seconds:299};},
    pool:{query:async(sql,args=[])=>{
      if(sql.includes('strategy=')&&sql.includes('reason')&&args[0])patterns.push(args[0]);
      if(sql.startsWith('SELECT * FROM college_total_no_windows'))return {rows:saved?[saved]:[]};
      if(sql.startsWith('INSERT INTO college_total_no_windows')){
        saved={game_id:args[1],contract_key:args[2],period:args[3],first_clock:args[4],
          first_evidence:JSON.parse(args[5]),first_at:new Date(Date.now()-25000)};
        return {rows:[]};
      }
      if(sql.startsWith('SELECT 1 FROM trade_attempts'))return {rows:[],rowCount:0};
      if(sql.startsWith('SELECT market_ticker,fill_count'))return {rows:[{market_ticker:fakeHeld.ticker}]};
      return {rows:[],rowCount:1};
    }},
    kalshi:async(path,opts)=>{
      if(path.endsWith('/orderbook'))return {orderbook_fp:{yes_dollars:[['0.95','100']]}};
      if(path.startsWith('/markets/'))return {market:m};
      if(path==='/portfolio/events/orders'){orders++;opts.beforeDispatch();return {fill_count_fp:'1',order_id:'filled'};}
      throw Error(path);
    },
    liveMilestone:async()=>({milestone_id:first.milestone.id,_observed_at:new Date().toISOString(),
      details:{status:'inprogress',home_points:20,away_points:17,quarter:4,clock:'4:59',
        home_team_name:'Home',away_team_name:'Away',last_updated_ts:Date.now()/1000}}),
    gameState,bestNoAsk,noDepthAtAsk,minimumCount:()=>1,
    allOpenPositions:async()=>({market_positions:[fakeHeld]}),
    accountBalance:async()=>({balance:10000,portfolio_value:0}),shardCash:()=>10000,
    marketShard:()=>0,singleSpendableCash:v=>v,feeReserve:()=>0,
    orderSize:(cash,price,depth,fraction,min,bankroll,b)=>{allocation=fraction;budget=b;return b>=5?1:0;},
    profitableCount:n=>n,estimatedCostCents:()=>0,auditTable:async()=>{},
    randomUUID:()=> 'proof',rememberIndependentEntry,
    reserve:async signal=>{assert.equal(signal.fraction,.05);return 'order-1';},
    withEntryProfitFloor:async(options,fn)=>{assert.equal(options.fraction,.05);return fn();},
    invalidateBalance:async()=>{}
  });
  vm.runInContext(code,context);
  const run=(f,scanSport='football')=>context.scanCollegeTotalNos([{milestone:f.milestone,state:f.state}],events,scanSport);
  assert.equal(await run(first),0,'football does not verify before the under-5:00 entry window');
  assert.equal(checks,0);
  assert.equal(saved,null,'no football preflight window');
  assert.equal(await run(later),1,'NFL Q4 enters after one immediate independent check');
  assert.equal(checks,1);
  assert.equal(orders,1);
  assert.equal(allocation,.05);
  assert.equal(budget,100,'$100 bankroll, with $3 CFB exposure and $1 fee, leaves only $1');
  assert.ok(patterns.some(p=>Array.isArray(p)&&p.includes('CFB %')&&p.includes('NFL %')),
    'open holdings for both football leagues must be pooled into a single 5% limit');
});