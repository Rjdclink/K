import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {gameState,tennisSignal,kalshiSingleReadLead,kalshiOnlyLead,confirmedExternalLead,comeback} from '../src/strategy.mjs';
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
  return {game,market,milestone};
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
test('tennis singles have no automatic profit target, including the previous half-profit fallback',()=>{
  assert.equal(exits.profitTargetAllowed(original),false);
  assert.equal(exits.profitTargetAllowed({...original,combo_legs:[]}),false);
  assert.equal(exits.halfPotentialProfitExitEligible(held,{count:10,price:.99}),true,'a profitable quote must still be blocked for tennis');
  assert.equal(exits.profitTargetAllowed({...original,sport:'Table tennis'}),true);
  assert.equal(exits.profitTargetAllowed({...original,sport:'NBA'}),true);
  assert.equal(exits.profitTargetAllowed({...original,strategy:'over'}),true);
  assert.equal(exits.profitTargetAllowed({...original,combo_legs:[{sport:'Tennis'},{sport:'NBA'}]}),true);
});

const source=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
async function runExit({owner=original,position=held,price='.99',count='10',pending=false,reversal=false}={}){
  const orders=[],now=Date.now();
  const first=fixture({games:[5,6],points:[30,40],server:'lew',at:now-1000});
  const second=fixture({games:[5,6],points:[30,40],server:'lew',at:now}).game;
  const context=vm.createContext({console,Date,Number,Math,Map,Set,JSON,...exits,sellQuote,
    ensureExitFills:async()=>{},reconcilePendingExit:async()=>!pending,minimumCount:()=>.01,
    randomUUID:()=> 'exit-id',comeback,linkedEventTickers:()=>[first.market.event_ticker],
    auditedOver:async()=>true,liveMilestone:async()=>({}),gameState:()=>second,
    recordExitFill:async()=>{},invalidateBalance:async()=>{},
    pool:{query:async(sql)=>{
      if(sql.includes('SELECT DISTINCT ON (market_ticker)'))return {rows:[owner]};
      if(sql.startsWith('SELECT market_ticker FROM exit_attempts'))return {rows:pending?[{market_ticker:held.ticker}]:[]};
      if(sql.includes('to_regclass'))return {rows:[{name:null}]};
      if(sql.includes('INSERT INTO exit_attempts'))return {rows:[{id:'exit-id'}],rowCount:1};
      return {rows:[],rowCount:1};
    }},kalshi:async(path,options)=>{
      if(options?.method==='POST'){orders.push(options.body);return {fill_count_fp:count,order_id:'sold'}}
      if(path.endsWith('/orderbook'))return {orderbook_fp:{yes_dollars:[[price,count]]}};
      return {market:{status:'active'}};
    }});
  vm.runInContext(source.slice(source.indexOf('async function exitComebacks('),source.indexOf('// A full discovery scan')),context);
  await context.exitComebacks(reversal?[{milestone:first.milestone,state:first.game}]:[],
    reversal?new Map([[first.market.event_ticker,{markets:[first.market]}]]):new Map(),{market_positions:[position]});
  return orders;
}
test('the live exit path never takes tennis profit at ten percent, half-profit, or higher targets',async()=>{
  for(const price of ['.74','.77','.88','.99'])
    assert.deepEqual(await runExit({price}),[],price);
  assert.deepEqual(await runExit({price:'.99',count:'5'}),[],'partial depth cannot re-enable profit taking');
});

test('other sports and combinations retain their existing profitable exits and uncertain-sell protection',async()=>{
  for(const owner of [{...original,sport:'Table tennis'},{...original,sport:'NBA'},
    {...original,combo_legs:[{sport:'Tennis'},{sport:'NBA'}]}]){
    const orders=await runExit({owner});assert.equal(orders.length,1,JSON.stringify(owner));
    assert.equal(orders[0].time_in_force,'immediate_or_cancel');
    assert.equal(orders[0].reduce_only,true);
  }
  assert.deepEqual(await runExit({owner:{...original,sport:'Soccer'}}),[]);
  assert.deepEqual(await runExit({owner:{...original,sport:'NBA'},pending:true}),[]);
});

test('tennis independently confirmed comeback protection remains available after profit exits are removed',async()=>{
  const orders=await runExit({reversal:true,price:'.73'});
  assert.equal(orders.length,1);
  assert.equal(orders[0].ticker,held.ticker);
  assert.equal(orders[0].time_in_force,'immediate_or_cancel');
  assert.equal(orders[0].reduce_only,true);
});

test('the removed tennis profit watcher cannot run alongside scans',()=>{
  assert.doesNotMatch(source,/watchTennisProfits|tennisProfitJob|tennisProfitExitEligible/);
});
