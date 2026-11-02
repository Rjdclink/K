import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {gameState,tennisSignal,kalshiSingleReadLead,kalshiOnlyLead,confirmedExternalLead} from '../src/strategy.mjs';
import * as exits from '../src/positions.mjs';
import {sellQuote} from '../src/sell.mjs';

function fixture({bestOf=3,selected=0,games=[5,4],points=[40,30],sets,advantage='',server,at=Date.now(),status='live'}={}){
  const ids=['jov','lew'],before=(bestOf-1)/2;
  const milestone={id:'tennis-loss',type:'tennis_tournament_singles',title:'Jovanovic vs Lew Yan Foon',details:{
    best_of:bestOf,first_competitor_id:ids[0],second_competitor_id:ids[1],main_game_event_ticker:'KXITFWMATCH-26NOV02LEWJOV'}};
  const game=gameState(milestone,{milestone_id:milestone.id,_observed_at:new Date(at).toISOString(),details:{
    status,competitor1_is_home:true,competitor1_overall_score:sets?.[0]??before,competitor2_overall_score:sets?.[1]??before,
    competitor1_round_scores:[{outcome:'ongoing',score:games[0]}],competitor2_round_scores:[{outcome:'ongoing',score:games[1]}],
    competitor1_current_round_score:points[0],competitor2_current_round_score:points[1],server:server??ids[selected],advantage}});
  const market={ticker:milestone.details.main_game_event_ticker+'-'+ids[selected].toUpperCase(),event_ticker:milestone.details.main_game_event_ticker,
    status:'active',title:ids[selected]+' wins the match',rules_primary:'If the selected player wins the match, then Yes.',
    custom_strike:{tennis_competitor:ids[selected]},yes_ask_dollars:'.95'};
  return {game,market};
}

test('tennis enters only one point from the match win while serving in the deciding set',()=>{
  for(const bestOf of [3,5])for(const selected of [0,1])for(const score of [[5,0],[5,2],[5,4],[6,5]]){
    for(const opponent of [0,15,30,40]){
      const games=selected?[score[1],score[0]]:score,points=selected?[opponent,40]:[40,opponent];
      const {game,market}=fixture({bestOf,selected,games,points,advantage:opponent===40?(selected?'lew':'jov'):''});
      assert.equal(tennisSignal(game,market)?.strategy,'lead',JSON.stringify({bestOf,selected,games,points}));
    }
  }
});

test('tennis rejects early game points, deuce, opponent advantage and non-deciding or invalid states',()=>{
  for(const options of [
    {points:[0,0]},{points:[30,15]},{points:[40,40]},{points:[40,40],advantage:'lew'},
    {points:[40,30],advantage:'jov'},{advantage:'unknown'},{sets:[1,0]},{sets:[0,1]},
    {games:[4,3]},{games:[5,5]},{games:[6,6]},{games:[7,5]},{games:[5,-1]},
    {server:'lew'},{status:'final'},{bestOf:1}
  ]){
    const {game,market}=fixture(options);assert.equal(tennisSignal(game,market),null,JSON.stringify(options));
  }
  const {game,market}=fixture();
  assert.equal(tennisSignal(game,{...market,event_ticker:'KXATPSETWINNER-3'}),null);
  assert.equal(tennisSignal(game,{...market,custom_strike:{tennis_competitor:'lew'}}),null);
});

test('the recorded five-four love-all entry is blocked on every tennis entry route',()=>{
  const now=Date.now(),{game:first,market}=fixture({points:[0,0],at:now-12000}),{game:second}=fixture({points:[0,0],at:now});
  assert.equal(tennisSignal(second,market),null);
  assert.equal(kalshiSingleReadLead(second,market,now),false);
  assert.equal(kalshiOnlyLead(first,second,market),false);
  assert.equal(confirmedExternalLead(first,second,market),false);
  const {game:matchPoint}=fixture({at:now});
  assert.equal(kalshiSingleReadLead(matchPoint,market,now),true);
});

const original={market_ticker:'KXITFWMATCH-26NOV02LEWJOV-JOV',game_id:'tennis-loss',sport:'Tennis',strategy:'lead'};
const held={ticker:original.market_ticker,position_fp:'10',market_exposure_dollars:'7.00',fees_paid_dollars:'.10'};
test('tennis sells strictly above ten percent of potential net profit after fees, without a half-profit target',()=>{
  const sale={count:10,price:.77}; // $7.70 less $7.00 basis, $0.10 paid fees and $0.25 reserved sell fees = $0.35; potential = $2.90.
  assert.equal(exits.estimatedSaleProfitCents(held,sale),35);
  assert.equal(exits.halfPotentialProfitExitEligible(held,sale),false);
  assert.equal(exits.tennisProfitExitEligible(original,held,sale),true);
  assert.equal(exits.tennisProfitExitEligible(original,held,{count:5,price:.80}),true,'partial proceeds still exceed the whole-position target');
  assert.equal(exits.tennisProfitExitEligible(original,held,{count:5,price:.79}),false,'partial depth below the whole-position target waits');
  assert.equal(exits.tennisProfitExitEligible(original,held,{count:10,price:.74}),false,'positive profit alone does not qualify');
  const boundary={...held,market_exposure_dollars:'6.90'}; // Potential profit is exactly $3.00.
  assert.equal(exits.estimatedSaleProfitCents(boundary,{count:10,price:.756}),30);
  assert.equal(exits.tennisProfitExitEligible(original,boundary,{count:10,price:.756}),false,'exactly ten percent does not qualify');
  assert.equal(exits.tennisProfitExitEligible(original,boundary,{count:10,price:.757}),true,'one cent above the boundary qualifies');
  const example={...held,market_exposure_dollars:'9.15'}; // Potential profit $0.75 requires at least $0.08 net.
  assert.equal(exits.estimatedSaleProfitCents(example,{count:10,price:.940}),7);
  assert.equal(exits.tennisProfitExitEligible(original,example,{count:10,price:.940}),false);
  assert.equal(exits.estimatedSaleProfitCents(example,{count:10,price:.941}),8);
  assert.equal(exits.tennisProfitExitEligible(original,example,{count:10,price:.941}),true);
  assert.equal(exits.tennisProfitExitEligible(original,held,{count:10,price:.73}),false,'a higher bid than entry can still lose after fees');
  for(const change of [{sport:'Table tennis'},{sport:'NBA'},{strategy:'over'},{combo_legs:[{sport:'Tennis'},{sport:'NBA'}]}])
    assert.equal(exits.tennisProfitExitEligible({...original,...change},held,sale),false,JSON.stringify(change));
  for(const field of ['market_exposure_dollars','fees_paid_dollars'])
    assert.equal(exits.tennisProfitExitEligible(original,{...held,[field]:null},sale),false,field);
});

const source=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
async function runExit({owner=original,position=held,price='.80',pending=false}={}){
  const orders=[];
  const context=vm.createContext({console,Date,Number,Math,Map,Set,JSON,...exits,sellQuote,
    ensureExitFills:async()=>{},reconcilePendingExit:async()=>!pending,minimumCount:()=>.01,
    randomUUID:()=> 'exit-id',comeback:()=>{throw Error('no score is required for a profitable exit')},
    recordExitFill:async()=>{},invalidateBalance:async()=>{},
    pool:{query:async(sql)=>{
      if(sql.includes('SELECT DISTINCT ON (market_ticker)'))return {rows:[owner]};
      if(sql.startsWith('SELECT market_ticker FROM exit_attempts'))return {rows:pending?[{market_ticker:held.ticker}]:[]};
      if(sql.includes('to_regclass'))return {rows:[{name:null}]};
      if(sql.includes('INSERT INTO exit_attempts'))return {rows:[{id:'exit-id'}],rowCount:1};
      return {rows:[],rowCount:1};
    }},kalshi:async(path,options)=>{
      if(options?.method==='POST'){orders.push(options.body);return {fill_count_fp:'5',order_id:'sold'}}
      if(path.endsWith('/orderbook'))return {orderbook_fp:{yes_dollars:[[price,'5']]}};
      return {market:{status:'active'}};
    }});
  vm.runInContext(source.slice(source.indexOf('async function exitComebacks('),source.indexOf('// A full discovery scan')),context);
  await context.exitComebacks([],new Map(),{market_positions:[position]});
  return orders;
}
test('the live exit path sells tennis above the ten-percent target without score verification or full depth',async()=>{
  const orders=await runExit();
  assert.equal(orders.length,1);
  assert.equal(orders[0].ticker,held.ticker);
  assert.equal(orders[0].count,'5.00');
  assert.equal(orders[0].time_in_force,'immediate_or_cancel');
  assert.equal(orders[0].reduce_only,true);
});

test('the live exit path blocks fees that erase profit, other sports and duplicate uncertain sells',async()=>{
  for(const options of [{price:'.73'},{price:'.79'},{position:{...held,fees_paid_dollars:null}},
    {owner:{...original,sport:'Table tennis'}},{owner:{...original,sport:'NBA'}},
    {owner:{...original,strategy:'over'}},{owner:{...original,combo_legs:[{sport:'Tennis'},{sport:'NBA'}]}},
    {pending:true}])assert.deepEqual(await runExit(options),[],JSON.stringify(options));
});

test('the fast tennis watcher checks only held tennis singles and repeats independently of discovery',async()=>{
  let clock=0,positionReads=0;const checked=[];
  const context=vm.createContext({console,Number,Math,Map,Set,Date:{now:()=>clock},live:()=>true,exitOnly:()=>false,
    tennisWinnerPosition:exits.tennisWinnerPosition,
    pool:{query:async()=>({rows:[original,{...original,market_ticker:'TABLE',sport:'Table tennis'},
      {...original,market_ticker:'COMBO',combo_legs:[{sport:'Tennis'},{sport:'NBA'}]}]})},
    allOpenPositions:async()=>{positionReads++;return {market_positions:[held,{...held,ticker:'TABLE'},{...held,ticker:'COMBO'}]}},
    exitComebacks:async(games,events,positions)=>checked.push(positions.market_positions.map(p=>p.ticker)),
    setTimeout:(resolve,ms)=>{clock+=ms;resolve()}});
  vm.runInContext(source.slice(source.indexOf('async function watchTennisProfits('),source.indexOf('// A full discovery scan')),context);
  await context.watchTennisProfits(5001);
  assert.equal(positionReads,3);
  assert.equal(checked.length,3);
  for(const tickers of checked)assert.deepEqual(Array.from(tickers),[held.ticker]);
  assert.ok(source.indexOf('const tennisProfitJob=')<source.indexOf('if(!cached.length){await discoveryJob'));
  assert.match(source,/await Promise\.all\(\[tennisProfitJob,correctionJob/);
});
