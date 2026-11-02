import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {gameState,overSignal,PLAYER_PROP_MAX_FRACTION,orderSize,estimatedCostCents,profitableCount,minimumProfitCents,netSettlementProfitCents} from '../src/strategy.mjs';
import {overContractKey,timedOverEntryValid,assertTimedOverEntry,sameSportsContract} from '../src/over_verification.mjs';
import {verifiedOverFraction} from '../src/lead_allocation.mjs';
import {remainingVerifiedOverCents,upgradeEligible} from '../src/upgrades.mjs';
import {singleSpendableCash} from '../src/combos.mjs';
import {filledOrderGateCount} from '../src/entry_floor.mjs';

const source=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
test('a held player prop tops up within 25% only when the new purchase meets its quarter profit floor',async()=>{
  for(const [period,price,exposure,allowed] of [[1,.89,24,true],[1,.90,24,false],[2,.93,24,true],[2,.94,24,false],[1,.89,25,false]]){
    const now=Date.now(),milestone={id:'g',type:'basketball_game',details:{league:'NBA'}};
    const market={ticker:'KXNBAREB-TEST-P',event_ticker:'KXNBAREB-TEST',status:'active',floor_strike:5.5,
      custom_strike:{basketball_player:'p'},yes_sub_title:'Pat: 6+',title:'Pat: 6+ rebounds',
      yes_ask_dollars:String(price),yes_ask_size_fp:'100',fractional_trading_enabled:false};
    const state=gameState(milestone,{milestone_id:'g',_observed_at:new Date(now).toISOString(),details:{
      status:'live',home_score:30,away_score:20,period,clock:'08:00',player_stats:{p:{rebounds:7}}}});
    state.verificationId='verified';
    state.overVerification={route:'seller_cushion',contractKey:overContractKey(state,market),sellerAt:now};
    const position={ticker:market.ticker,position_fp:'24',market_exposure_dollars:String(exposure),fees_paid_dollars:'0'};
    const original={id:'original',status:'filled',strategy:'over',market_ticker:market.ticker,event_ticker:market.event_ticker,game_id:'g'};
    const sent=[];
    const client={query:async sql=>({rows:sql.includes('pg_try_advisory_xact_lock')?[{acquired:true}]:[]}),release(){}};
    const context=vm.createContext({console,setTimeout,PLAYER_PROP_MAX_FRACTION,overSignal,timedOverEntryValid,assertTimedOverEntry,
      sameSportsContract,verifiedOverFraction,remainingVerifiedOverCents,upgradeEligible,estimatedCostCents,profitableCount,
      minimumProfitCents,netSettlementProfitCents,filledOrderGateCount,singleSpendableCash,randomUUID:()=> 'upgrade',
      upgradeTables:async()=>{},recoverSummaryAsk:async m=>m,hasAsk:()=>true,executableQuote:async m=>m,
      accountBalance:async()=>({balance:10000,portfolio_value:0}),allOpenPositions:async()=>({market_positions:[position]}),
      marketShard:()=>0,shardCash:()=>10000,feeReserve:()=>2,confirmedSingleFill:async()=>{},
      contractCount:(cash,m,fraction,bankroll,budget,fees)=>Math.floor(orderSize(cash,m.yes_ask_dollars,m.yes_ask_size_fp,fraction,1,bankroll,budget,fees)),
      pool:{connect:async()=>client,query:async sql=>({rows:[],rowCount:sql.includes('INSERT INTO position_upgrades')?1:0})},
      kalshi:async(path,options)=>{
        if(path.startsWith('/markets/'))return {market};
        options.beforeDispatch();sent.push(options.body);return {fill_count_fp:'1',order_id:'exchange-order'};
      }});
    vm.runInContext(source.slice(source.indexOf('async function withEntryProfitFloor('),source.indexOf('async function milestones(')),context);
    vm.runInContext(source.slice(source.indexOf('async function upgradeHeldOver('),source.indexOf('async function immediatelyUpgradeFilledOver(')),context);
    const result=await context.upgradeHeldOver({state,market,milestone,event:{event_ticker:market.event_ticker}},
      {state,kalshiOnly:false},original);
    assert.equal(result.verified,true);
    assert.equal(result.filled,allowed,`Q${period}, price ${price}, held $${exposure}`);
    assert.equal(sent.length,allowed?1:0);
    if(allowed){
      const count=Number(sent[0].count);
      assert.ok(estimatedCostCents(count,price,2)+exposure*100<=2500);
      assert.ok(netSettlementProfitCents(count,price,2)>=(period===1?9:6));
    }
  }
});
