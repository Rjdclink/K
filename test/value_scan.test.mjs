import test from 'node:test';
import assert from 'node:assert/strict';
import {lateWindow,valueCandidate,validatedValueDecision} from '../src/value_scan.mjs';

const game={verifiedLive:true,scoreKnown:true,scoreConsistent:true,periodConsistent:true,
  type:'soccer_match',sport:'Soccer',period:2,matchRemainingSeconds:280,
  home:2,away:1,homeName:'Home FC',awayName:'Away FC',homeTeamId:'H',awayTeamId:'A',mainEvent:'KXSOCCERGAME-1'};
const event={event_ticker:'KXSOCCERGAME-1'};
const market=(id,ask)=>({ticker:'KXSOCCERGAME-1-'+id,event_ticker:event.event_ticker,
  status:'active',title:id==='H'?'Home FC':'Away FC',custom_strike:{soccer_team:id},
  yes_ask_dollars:String(ask),yes_ask_size_fp:'42'});

test('five-minute window only lists winning teams at favorite or underdog prices',()=>{
  assert.equal(lateWindow(game)?.kind,'clock');
  assert.equal(valueCandidate(game,market('H',.85),event)?.role,'favorite');
  assert.equal(valueCandidate(game,market('H',.85),event)?.kalshiQuoteImpliedChance,.85);
  assert.equal(valueCandidate(game,market('H',.19),event)?.role,'leading underdog');
  assert.equal(valueCandidate(game,market('A',.01),event),null);
  const awayLeads={...game,home:1,away:2};
  assert.equal(valueCandidate(awayLeads,market('A',.19),event)?.role,'leading underdog');
  assert.equal(valueCandidate(awayLeads,market('H',.01),event),null);
  assert.equal(valueCandidate(game,market('H',.84),event),null);
  assert.equal(valueCandidate(game,market('A',.51),event),null);
  assert.equal(valueCandidate(game,market('H',.51),event),null);
});

test('unknown or stale endgame state cannot qualify',()=>{
  assert.equal(lateWindow({...game,matchRemainingSeconds:301}),null);
  assert.equal(lateWindow({...game,matchRemainingSeconds:NaN}),null);
  assert.equal(lateWindow({...game,verifiedLive:false}),null);
  assert.equal(lateWindow({...game,soccerExtraTime:true}),null);
  assert.equal(lateWindow({...game,period:1}),null);
  assert.equal(lateWindow({...game,type:'cricket_match',period:2}),null);
  assert.equal(lateWindow({...game,type:'tennis_match',period:2}),null);
  assert.equal(lateWindow({...game,type:'basketball_game',sport:'NBA',period:4,remainingSeconds:295})?.kind,'clock');
  assert.equal(lateWindow({...game,type:'hockey_match',sport:'NHL',period:3,remainingSeconds:295})?.kind,'clock');
});

test('unrelated and ambiguous contracts do not enter research list',()=>{
  assert.equal(valueCandidate(game,{...market('H',.90),custom_strike:{soccer_team:'unknown'}},event),null);
  assert.equal(valueCandidate(game,{...market('H',.90),title:'Home FC by 2 goals'},event),null);
  assert.equal(valueCandidate(game,{...market('H',.90),event_ticker:'OTHERGAME-1'},event),null);
  assert.equal(valueCandidate(game,{...market('H',.90),yes_ask_size_fp:'0'},event),null);
});

test('entry gate needs independent model and positive out-of-sample lower bound',()=>{
  const candidate=valueCandidate(game,market('H',.85),event);
  const forecast={marketTicker:candidate.ticker,sport:'Soccer',modelVersion:'v1',
    usesHistoricalTeamStats:true,usesLiveSportState:true,probability:.96,lowerBound:.92};
  const validation={status:'passed',sport:'Soccer',modelVersion:'v1',outOfSample:true,
    fillableQuotes:true,feesIncluded:true,independentData:true,positiveNetReturn:true,netReturnLowerBound:.01};
  assert.equal(validatedValueDecision(candidate,null,validation,.01),null);
  assert.equal(validatedValueDecision(candidate,forecast,null,.01),null);
  assert.equal(validatedValueDecision(candidate,forecast,{...validation,netReturnLowerBound:-.01},.01),null);
  assert.equal(validatedValueDecision(candidate,{...forecast,lowerBound:.85},validation,.01),null);
  assert.equal(validatedValueDecision(candidate,{...forecast,probability:.90},validation,.01),null);
  assert.equal(validatedValueDecision(candidate,{...forecast,usesHistoricalTeamStats:false},validation,.01),null);
  assert.ok(validatedValueDecision(candidate,forecast,validation,.01).edge>.06);
  assert.ok(Math.abs(validatedValueDecision(candidate,forecast,validation,.01).modelVsKalshi-.11)<1e-10);
});
