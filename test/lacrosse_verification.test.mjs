import test from 'node:test';
import assert from 'node:assert/strict';
import {gameState} from '../src/strategy.mjs';
import {verifyIndependentOverDecision} from '../src/score_verification.mjs';

const start='2026-08-01T16:30:00Z';
const milestone=league=>({type:'lacrosse_match',title:'Denver at Maryland',start_date:start,details:{league}});
const state=m=>gameState(m,{details:{status:'live',home_score:13,away_score:15,period:4,clock:'02:00',home_team_name:'Maryland',away_team_name:'Denver'}});
const market={event_ticker:'KXLAXTOTAL-TEST',floor_strike:27.5};
const board=()=>({events:[{id:'401867221',date:start,status:{period:4,displayClock:'02:00',type:{state:'in'}},competitions:[{competitors:[
  {homeAway:'home',score:'13',team:{displayName:'Maryland Whipsnakes',location:'Maryland',name:'Whipsnakes'},linescores:[5,5,2,1].map(value=>({value}))},
  {homeAway:'away',score:'15',team:{displayName:'Denver Outlaws',location:'Denver',name:'Outlaws'},linescores:[4,4,4,3].map(value=>({value}))}
]}]}]});

for(const [league,feed] of [['PLL','pll'],['National Lacrosse League','nll'],["NCAA Men's Lacrosse",'mens-college-lacrosse']]){
  test(`${league}: one matching ESPN scoreboard satisfies lacrosse verification without a key`,async()=>{
    const m=milestone(league),calls=[];
    const result=await verifyIndependentOverDecision(state(m),m,{market,fetcher:async(url,options)=>{
      calls.push(url);assert.equal(options.headers['x-api-key'],undefined);assert.equal(options.headers.authorization,undefined);
      assert.equal(url,`https://site.api.espn.com/apis/site/v2/sports/lacrosse/${feed}/scoreboard?dates=20260801&limit=500`);
      return {ok:true,json:async()=>board()};
    }});
    assert.equal(result,true);assert.equal(calls.length,1,'no other league/provider is required after success');
  });
}
test('lacrosse rejects conflicting scores, wrong fixtures, non-live data and ambiguous fixtures',async()=>{
  const m=milestone('Premier Lacrosse League');
  const check=async data=>verifyIndependentOverDecision(state(m),m,{market,fetcher:async()=>({ok:true,json:async()=>data})});
  let data=board();data.events[0].competitions[0].competitors[0].score='12';assert.equal(await check(data),false);
  data=board();data.events[0].date='2026-07-30T16:30:00Z';assert.equal(await check(data),null);
  data=board();data.events[0].competitions[0].competitors[0].team={displayName:'Utah Archers',location:'Utah'};assert.equal(await check(data),null);
  data=board();data.events[0].status.type.state='post';assert.equal(await check(data),false);
  data=board();data.events.push(structuredClone(data.events[0]));assert.equal(await check(data),false);
});
test('unavailable lacrosse ESPN feed is requested once, not retried or replaced with another league',async()=>{
  const m=milestone('NLL'),calls=[];
  assert.equal(await verifyIndependentOverDecision(state(m),m,{market,fetcher:async url=>{calls.push(url);throw Error('unavailable')}}),null);
  assert.equal(calls.length,1);assert.match(calls[0],/lacrosse\/nll\//);
});
test('unknown, contradictory and women’s lacrosse labels cannot authorize a men’s league check',async()=>{
  for(const [league,competition] of [['Unknown',null],['PLL','NLL'],["NCAA Women's Lacrosse",null],['WLL',null]]){
    const m=milestone(league);m.details.competition=competition;
    assert.equal(await verifyIndependentOverDecision(state(m),m,{market,fetcher:async()=>{assert.fail('must not query a guessed league')}}),null);
  }
});
test('explicit Kalshi men’s-college series identifies the feed when the label is generic',async()=>{
  const m=milestone('Lacrosse');m.primary_event_tickers=['KXNCAAMLAXGAME-26MAY25NDPRIN'];
  assert.equal(await verifyIndependentOverDecision(state(m),m,{market,fetcher:async url=>{
    assert.match(url,/lacrosse\/mens-college-lacrosse\//);return {ok:true,json:async()=>board()};
  }}),true);
});
