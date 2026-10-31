import test from 'node:test';
import assert from 'node:assert/strict';
import {comboGroupRejection,plannedComboGroups,comboExclusionKey,exchangeComboExclusion} from '../src/combos.mjs';

const leg=(line,team='USF',event='KXNCAAFTEAMTOTAL-GAME')=>({event:{event_ticker:event},
  market:{ticker:`${event}-${team}${line+.5}`,event_ticker:event,status:'active',strike_type:'greater',floor_strike:line,
    custom_strike:{football_team:team},rules_primary:`If ${team} scores over ${line} points in the game, then Yes.`,rules_secondary:'Official final result.'},
  signal:{strategy:'over'},milestone:{id:'game'},state:{sport:'CFB'}});
const collection={collection_ticker:'COLLECTION',is_all_yes:true,is_single_market_per_event:false,size_min:2,size_max:0,
  associated_event_tickers:['KXNCAAFTEAMTOTAL-GAME','OTHER']};
test('redundant same-team thresholds are excluded without dropping independent teams or events',()=>{
  const a=leg(24.5),b=leg(23.5),c=leg(23.5,'UAB'),d=leg(23.5,'USF','OTHER');
  assert.equal(comboGroupRejection([a,b]),'redundant_legs');
  assert.equal(comboGroupRejection([a,c]),null);assert.equal(comboGroupRejection([a,d]),null);
  const plans=plannedComboGroups([collection],[a,b,c,d]);
  assert.ok(plans.length>0);assert.ok(plans.every(p=>!p.legs.includes(a)||!p.legs.includes(b)));
  assert.ok(plans.some(p=>p.legs.includes(a)&&p.legs.includes(c)));
  assert.equal(comboGroupRejection([a,{...b,market:{...b.market,rules_secondary:'First half only.'}}]),null);
});
test('decided contracts fail preflight and exchange-only decided notices block exact contract terms',()=>{
  const a=leg(24.5),b=leg(23.5,'UAB');
  assert.equal(comboGroupRejection([{...a,market:{...a.market,result:'yes'}},b]),'already_decided');
  const error=Error(`Kalshi 400 POST /multivariate_event_collections/C: South Florida has already been decided, so it can't be added to a combo. details="${a.market.ticker}"`);
  const rejected=exchangeComboExclusion(error,[a,b]);
  assert.equal(rejected.status,'already_decided');assert.equal(rejected.key,comboExclusionKey([a]));
  assert.equal(comboGroupRejection([{...a,comboExcluded:true},b]),'already_decided');
  assert.notEqual(comboExclusionKey([{...a,market:{...a.market,rules_primary:'Corrected contract rules'}}]),rejected.key);
  assert.equal(exchangeComboExclusion(Error('Kalshi 429 POST /multivariate_event_collections/C: rate limited'),[a,b]),null);
  assert.equal(exchangeComboExclusion(Error('Kalshi 400 POST /multivariate_event_collections/C: already decided details="OTHER"'),[a,b]),null);
});
test('an exchange-rejected pair is excluded from larger plans, preserving other combinations',()=>{
  const a=leg(24.5),b=leg(23.5,'UAB'),c=leg(22.5,'OTHER');
  const error=Error(`Kalshi 400 POST /multivariate_event_collections/C: one already guarantees another details="${a.market.ticker},${b.market.ticker}"`);
  const exclusion=exchangeComboExclusion(error,[a,b]);
  const plans=plannedComboGroups([collection],[a,b,c],12,0,new Set([exclusion.key]));
  assert.ok(plans.length);assert.ok(plans.every(p=>!p.legs.includes(a)||!p.legs.includes(b)));
  assert.equal(comboExclusionKey([a,b]),comboExclusionKey([b,a]));
});
