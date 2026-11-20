import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {gameState} from '../src/strategy.mjs';
import {collegeFootballTotalNo,collegeBasketballTotalNo,bestNoAsk,noDepthAtAsk} from '../src/no_strategy.mjs';
import {verifyIndependentCollegeTotalNo,independentCollegeTotalNoReading} from '../src/college_total_no.mjs';
import {supportedScannerSport,eligibleForMarkets,linkedEventTickers,scanMilestones} from '../src/discovery.mjs';
import {overContractKey,sameSportsContract} from '../src/over_verification.mjs';
import {rememberIndependentEntry} from '../src/entry_verification.mjs';

function fixture(league='NBA',clock='0:29',period=4,home=70,away=70){
  const prefixes={NBA:'KXNBA',WNBA:'KXWNBA',NCAAMB:'KXNCAAMB',NCAAWB:'KXNCAAWB',FIBA:'KXFIBA',NBL:'KXNBL'};
  const prefix=prefixes[league]||'KXUNKNOWN';
  const milestone={id:'bb-'+league,title:'Away at Home',type:'basketball_game',
    start_date:'2026-11-19T23:00:00Z',details:{league,home_team_id:'home',away_team_id:'away',main_game_event_ticker:prefix+'GAME-TEST'}};
  const state=gameState(milestone,{milestone_id:milestone.id,_observed_at:new Date().toISOString(),
    details:{status:'live',home_points:home,away_points:away,period,clock,last_updated_ts:Date.now()/1000,
      home_team_name:'Home',away_team_name:'Away'}});
  return {milestone,state,prefix};
}
function market(league='NBA',line=165,{half=false,team=false}={}){
  const prefixes={NBA:'KXNBA',WNBA:'KXWNBA',NCAAMB:'KXNCAAMB',NCAAWB:'KXNCAAWB',FIBA:'KXFIBA',NBL:'KXNBL'};
  const series=prefixes[league]+(half?'1H':team?'TEAM':'')+'TOTAL';
  return {ticker:series+'-TEST-'+line,event_ticker:series+'-TEST',title:'Full Game: Over '+line+' points scored',
    yes_sub_title:'Over '+line+' points',floor_strike:line,status:'active',strike_type:'greater',
    rules_primary:'If over '+line+' total points are scored in '+(half?'the first half of ':'')+
      (team?'the home team total for ':'')+'the Away vs Home basketball game, then market resolves to Yes.'};
}

test('NBA, WNBA and mapped international basketball full-game NO require 20-point cushion and under 0:30',()=>{
  for(const league of ['NBA','WNBA','FIBA','NBL']){
    const g=fixture(league),contract=market(league,160);
    assert.equal(collegeBasketballTotalNo(g.state,contract)?.line,160,league+' exact 20-point gap');
    assert.equal(collegeBasketballTotalNo(g.state,market(league,159.5)),null,league+' rejects 19.5-point gap');
    assert.equal(collegeBasketballTotalNo(fixture(league,'0:30').state,contract),null);
    assert.equal(collegeBasketballTotalNo(fixture(league,'0:01').state,contract)?.period,'full_game');
    assert.equal(collegeBasketballTotalNo(fixture(league,'0:00').state,contract),null);
    assert.ok(collegeBasketballTotalNo(fixture(league,'4:59').state,contract,{beforeWindow:true}));
    assert.equal(collegeBasketballTotalNo(fixture(league,'5:00').state,contract,{beforeWindow:true}),null);
    assert.equal(collegeBasketballTotalNo(fixture(league,'0:29',2).state,contract),null);
    assert.equal(collegeBasketballTotalNo(g.state,market(league,165,{half:true})),null);
    assert.equal(collegeBasketballTotalNo(g.state,market(league,165,{team:true})),null);
  }
  const unknown=fixture('China CBA');
  assert.equal(collegeBasketballTotalNo(unknown.state,{...market('NBA'),event_ticker:'KXCBATOTAL-TEST'}),null);
});

test('new international discovery permits only externally verifiable NO leagues, not other trades or esports',()=>{
  for(const league of ['FIBA','NBL']){
    const {milestone,state}=fixture(league);
    assert.equal(supportedScannerSport(milestone),true);
    assert.equal(eligibleForMarkets(state),false,'existing winner/OVER path must stay disabled for '+league);
    assert.ok(linkedEventTickers(milestone).includes(market(league).event_ticker),'expected derived full-game event needs valid mapping');
    assert.equal(scanMilestones([milestone],new Set(),Date.parse('2026-11-20T00:00:00Z')).length,1);
  }
  assert.equal(supportedScannerSport(fixture('China CBA').milestone),false);
  assert.equal(supportedScannerSport({...fixture('FIBA').milestone,type:'esports_basketball_game'}),false);
});

test('NBA, WNBA and mapped international NO independently verify exact ESPN fixture, score and clock',async()=>{
  for(const [league,feed] of [['NBA','basketball/nba'],['WNBA','basketball/wnba'],['FIBA','basketball/fiba']]){
    const g=fixture(league,'4:20');
    const board={events:[{id:'exact-fixture',date:g.milestone.start_date,competitions:[{
      status:{period:4,displayClock:'4:20',type:{state:'in'}},
      competitors:[{homeAway:'home',score:'70',team:{displayName:'Home',abbreviation:'HOM'}},
        {homeAway:'away',score:'70',team:{displayName:'Away',abbreviation:'AWY'}}]
    }]}]};
    const urls=[];
    const evidence=await verifyIndependentCollegeTotalNo(g.state,g.milestone,market(league),{fetcher:async url=>{
      urls.push(url);return {ok:true,json:async()=>board};
    }});
    assert.equal(evidence?.source,'ESPN');
    assert.ok(urls.some(url=>url.includes('/'+feed+'/scoreboard')));
    const changed=structuredClone(board);changed.events[0].competitions[0].competitors[0].score='71';
    assert.equal(independentCollegeTotalNoReading(changed,g.state,g.milestone,market(league)),false);
  }
});

test('multiple qualifying NO lines receive independent tracked windows and dashboard statuses',async()=>{
  const base=fixture('NBA','1:15'),later=fixture('NBA','0:29'),contracts=[market('NBA',160),market('NBA',165)];
  const events=new Map([[contracts[0].event_ticker,{category:'Sports',event_ticker:contracts[0].event_ticker,markets:contracts}]]);
  const source=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
  const code=source.slice(source.indexOf('async function scanCollegeTotalNos('),source.indexOf('async function scan(cachedMilestones'));
  const windows=new Map(),sink=new Map();let verificationCalls=0,orders=0,marketReads=0;
  const context=vm.createContext({Date,JSON,Number,Math,Promise,console,live:()=>true,
    liveBatch:async()=>new Map(),linkedEventTickers:()=>[contracts[0].event_ticker],
    collegeFootballTotalNo,collegeBasketballTotalNo,overContractKey,sameSportsContract,
    verifyIndependentCollegeTotalNo:async()=>{verificationCalls++;return {source:'ESPN',seconds:269};},
    pool:{query:async(sql,args=[])=>{
      if(sql.startsWith('SELECT * FROM college_total_no_windows'))return {rows:windows.has(args[0])?[windows.get(args[0])]:[]};
      if(sql.startsWith('INSERT INTO college_total_no_windows')){
        windows.set(args[0],{market_ticker:args[0],game_id:args[1],contract_key:args[2],period:args[3],
          first_clock:args[4],first_evidence:JSON.parse(args[5]),first_at:new Date(Date.now()-46000)});
        return {rows:[]};
      }
      if(sql.startsWith('SELECT 1 FROM trade_attempts'))return {rows:[],rowCount:0};
      if(sql.startsWith('SELECT market_ticker,fill_count'))return {rows:[]};
      return {rows:[],rowCount:1};
    }},
    liveMilestone:async()=>({milestone_id:base.milestone.id,_observed_at:new Date().toISOString(),
      details:{status:'live',home_points:70,away_points:70,period:4,clock:'0:29',last_updated_ts:Date.now()/1000,
        home_team_name:'Home',away_team_name:'Away'}}),gameState,
    kalshi:async path=>{
      if(path.startsWith('/markets/')&&path.endsWith('/orderbook'))return {orderbook_fp:{yes_dollars:[]}};
      if(path.startsWith('/markets/')){marketReads++;return {market:contracts.find(m=>path.includes(m.ticker))};}
      if(path==='/portfolio/events/orders'){orders++;throw Error('Unexpected order');}
      throw Error(path);
    },
    bestNoAsk,noDepthAtAsk,minimumCount:()=>1,allOpenPositions:async()=>({market_positions:[]}),
    accountBalance:async()=>({balance:10000,portfolio_value:0}),shardCash:()=>10000,marketShard:()=>0,
    singleSpendableCash:v=>v,feeReserve:()=>0,orderSize:()=>0,profitableCount:n=>n,
    estimatedCostCents:()=>0,auditTable:async()=>{},randomUUID:()=> 'proof',
    rememberIndependentEntry,reserve:async()=>null,withEntryProfitFloor:async()=>null,invalidateBalance:async()=>{}
  });
  vm.runInContext(code,context);
  const run=f=>context.scanCollegeTotalNos([{milestone:f.milestone,state:f.state}],events,'basketball',sink);
  assert.equal(await run(base),0);
  assert.equal(windows.size,2,'each qualifying line must retain its own first-check window');
  assert.equal(verificationCalls,1,'same verified scoreboard can be shared across initial per-line windows');
  assert.deepEqual(new Set((sink.get(base.state.id)||[]).map(s=>s.ticker)),new Set(contracts.map(m=>m.ticker)));
  assert.equal(await run(later),0,'no executable NO seller');
  assert.equal(marketReads,2,'each eligible contract must receive its own final quote/contract check');
  assert.equal(orders,0);
  assert.ok((sink.get(base.state.id)||[]).every(s=>s.strategy==='no'&&/NO seller/i.test(s.execution)),
    'dashboard must display the precise rejection reason for both contracts');
});

test('basketball NO dashboard snapshots are populated from actual scanner results, not hypothetical OVER signals',()=>{
  const src=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
  assert.match(src,/basketballNoSignals/);
  assert.match(src,/basketballNoSignals\.get\(id\)/);
  assert.match(src,/noOnlyBasketballGames/);
  assert.match(src,/scanCollegeTotalNos\([^;]*'basketball',basketballNoSignals\)/);
  assert.match(src,/checkedIds\.add/);
});

test('real Kalshi NBA, WNBA and Australian NBL contracts retain exact line and settlement identity',()=>{
  const examples=[
    {league:'NBA',home:70,away:70,line:197.5,title:'Full Game: Over 197.5 points scored',
      subtitle:'Over 197.5 points',
      rules:'If over 197.5 total points are scored in the Utah vs Los Angeles L Pro Basketball game originally scheduled for Nov 18, 2026, then the market resolves to Yes.'},
    {league:'WNBA',home:40,away:50,line:130.5,title:'Full Game: Over 130.5 points scored',
      subtitle:'Over 130.5 points',
      rules:"If the teams in the Atlanta vs Golden State women's Pro Basketball game originally scheduled for Oct 31, 2026 collectively score more than 130.5 points, then the market resolves to Yes."},
    {league:'NBL',home:40,away:50,line:129.5,title:'Over 129.5 points scored',
      subtitle:'Over 129.5 points scored',
      rules:"If over 129.5 total points are scored in the New Zealand Breakers vs Melbourne United men's professional Australia NBL basketball game originally scheduled for Nov 2, 2026 at 3:30 AM EST, then the market resolves to Yes."}
  ];
  for(const sample of examples){
    const {state}=fixture(sample.league,'0:29',4,sample.home,sample.away);
    const contract={...market(sample.league,sample.line),title:sample.title,yes_sub_title:sample.subtitle,rules_primary:sample.rules};
    assert.equal(collegeBasketballTotalNo(state,contract)?.line,sample.line,sample.league);
    assert.equal(collegeBasketballTotalNo(state,{...contract,yes_sub_title:'Over 999.5 points'}),null);
    assert.equal(collegeBasketballTotalNo(state,{...contract,event_ticker:'KXFAKETOTAL-TEST'}),null);
  }
});

test('dashboard serializes actual NO signals alongside existing strategies in persisted snapshots',()=>{
  const src=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
  const begin=src.indexOf('for(const [id,candidates] of snapshotCandidates){');
  const end=src.indexOf('// Expire only the current ten-minute attempt.',begin);
  assert.ok(begin>0&&end>begin);
  const row=Array(18).fill(null);row.leadWatch=null;
  const snapshotRows=new Map([['game',row]]);
  const snapshotCandidates=new Map([['game',[{signal:{strategy:'lead',reason:'original lead'},market:{ticker:'LEAD',title:'Lead winner'}}]]]);
  const basketballNoSignals=new Map([['game',[{strategy:'no',ticker:'KXNBATOTAL-X',title:'Over 250 points',execution:'No NO seller'}]]]);
  vm.runInNewContext(src.slice(begin,end),{snapshotRows,snapshotCandidates,basketballNoSignals,
    crossingRows:[],filled:new Set(),account:{},balance:0,bankroll:0,signalExecution:()=> 'Original strategy unchanged'});
  const signals=JSON.parse(row[14]);
  assert.equal(signals.length,2);
  assert.equal(signals[0].strategy,'no');
  assert.equal(signals[0].execution,'No NO seller');
  assert.equal(signals[1].strategy,'lead');
  assert.equal(signals[1].execution,'Original strategy unchanged');
});

test('all basketball NO leagues share one 5% fee-inclusive pool without affecting football',async()=>{
  const f=fixture('NBA','0:29'),m=market('NBA',165);
  const held={ticker:'KXNCAAMBTOTAL-EXISTING',position_fp:-1,market_exposure_dollars:'4.00',fees_paid_dollars:'0.50'};
  const src=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
  const code=src.slice(src.indexOf('async function scanCollegeTotalNos('),src.indexOf('async function scan(cachedMilestones'));
  const window={market_ticker:m.ticker,game_id:f.state.id,contract_key:overContractKey(f.state,m),
    period:4,first_clock:75,first_evidence:{source:'ESPN'},first_at:new Date(Date.now()-46000)};
  let allocated=null,budget=null,orders=0,patterns=null;
  const ctx=vm.createContext({Date,JSON,Number,Math,Promise,console,live:()=>true,
    liveBatch:async()=>new Map(),linkedEventTickers:()=>[m.event_ticker],
    collegeFootballTotalNo,collegeBasketballTotalNo,overContractKey,sameSportsContract,
    verifyIndependentCollegeTotalNo:async()=>({source:'ESPN',seconds:29}),
    pool:{query:async(sql,args=[])=>{
      if(sql.startsWith('SELECT * FROM college_total_no_windows'))return {rows:[window]};
      if(sql.startsWith('SELECT 1 FROM trade_attempts')){if(sql.includes('reason LIKE ANY'))patterns=args[0];return {rows:[],rowCount:0};}
      if(sql.startsWith('SELECT market_ticker,fill_count'))return {rows:[{market_ticker:held.ticker}]};
      return {rows:[],rowCount:1};
    }},
    liveMilestone:async()=>({milestone_id:f.milestone.id,_observed_at:new Date().toISOString(),
      details:{status:'live',home_points:70,away_points:70,period:4,clock:'0:29',last_updated_ts:Date.now()/1000,
        home_team_name:'Home',away_team_name:'Away'}}),
    gameState,bestNoAsk,noDepthAtAsk,minimumCount:()=>1,allOpenPositions:async()=>({market_positions:[held]}),
    kalshi:async(path,opts)=>{
      if(path.endsWith('/orderbook'))return {orderbook_fp:{yes_dollars:[['0.95','100']]}};
      if(path.startsWith('/markets/'))return {market:m};
      if(path==='/portfolio/events/orders'){orders++;assert.equal(opts.body.side,'ask');opts.beforeDispatch();return {fill_count_fp:'1',order_id:'filled'};}
      throw Error(path);
    },
    accountBalance:async()=>({balance:10000,portfolio_value:0}),shardCash:()=>10000,marketShard:()=>0,
    singleSpendableCash:v=>v,feeReserve:()=>0,
    orderSize:(cash,ask,depth,fraction,min,bankroll,pool)=>{allocated=fraction;budget=pool;return 1;},
    profitableCount:n=>n,estimatedCostCents:()=>0,
    auditTable:async()=>{},randomUUID:()=> 'verify',rememberIndependentEntry,
    reserve:async signal=>{assert.equal(signal.fraction,.05);return 'order-id';},
    withEntryProfitFloor:async(options,fn)=>{assert.equal(options.fraction,.05);return fn();},
    invalidateBalance:async()=>{}
  });
  vm.runInContext(code,ctx);
  const count=await ctx.scanCollegeTotalNos([{milestone:f.milestone,state:f.state}],
    new Map([[m.event_ticker,{category:'Sports',event_ticker:m.event_ticker,markets:[m]}]]),'basketball',new Map());
  assert.equal(count,1);
  assert.equal(orders,1);
  assert.equal(allocated,.05);
  assert.equal(budget,50,'5% of $100 ($5) less $4.50 held exposure and fees leaves 50 cents');
  assert.ok(patterns.includes('College basketball %')&&patterns.includes('Basketball total NO %'),
    'legacy NCAA and new pro/international NO holdings must share the same 5% ceiling');
});