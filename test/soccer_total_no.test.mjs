import test from 'node:test';
import assert from 'node:assert/strict';
import {gameState} from '../src/strategy.mjs';
import {soccerNoMarketSpec,soccerTotalNo,independentSoccerTotalNoReading,verifyIndependentSoccerTotalNo} from '../src/soccer_total_no.mjs';

const milestone={id:'soccer-total-no',title:'Away at Home',type:'soccer_match',
  start_date:'2026-11-20T17:00:00Z',
  details:{league:'EPL',main_game_event_ticker:'KXEPLGAME-26NOV20AWAYHOME'}};
const game=(seconds=479,home=2,away=1,minute=83)=>gameState(milestone,{
  milestone_id:milestone.id,_observed_at:new Date().toISOString(),
  details:{status:'inprogress',home_score:home,away_score:away,half:'2nd',
    time:minute+"'",match_remaining_seconds:seconds,
    last_updated_ts:Date.now()/1000,home_team_name:'Home',away_team_name:'Away'}});
const market=(line=4.5)=>({
  ticker:'KXEPLTOTAL-26NOV20AWAYHOME-'+Math.ceil(line),
  event_ticker:'KXEPLTOTAL-26NOV20AWAYHOME',
  title:'Will over '+line+' goals be scored?',
  yes_sub_title:'Over '+line+' goals scored',
  floor_strike:line,strike_type:'greater',status:'active',
  rules_primary:'If over '+line+' goals are scored in the Away vs Home professional EPL soccer game originally scheduled for Nov 20, 2026 after 90 minutes plus stoppage time (does not include extra time or penalties), then the market resolves to Yes.'
});
const scoreboard=(minute="83'",home=2,away=1)=>({events:[{
  id:'espn-soccer-game',date:milestone.start_date,competitions:[{
    status:{period:2,displayClock:minute,type:{state:'in'}},
    competitors:[
      {homeAway:'home',team:{displayName:'Home',abbreviation:'HOM'},score:String(home)},
      {homeAway:'away',team:{displayName:'Away',abbreviation:'AWY'},score:String(away)}
    ]
  }]
}]});

test('soccer NO entry is strictly below 8 minutes after the initial 11-minute check',()=>{
  assert.ok(soccerNoMarketSpec(game(660,2,1,79),market(),{beforeWindow:true}));
  assert.equal(soccerNoMarketSpec(game(661,2,1,'78:59'),market(),{beforeWindow:true}),null);
  assert.equal(soccerTotalNo(game(480,2,1,82),market()),null);
  assert.equal(soccerTotalNo(game(660,2,1,79),market()),null);
  assert.ok(soccerTotalNo(game(479,2,1,83),market()));
  assert.equal(soccerTotalNo(game(0,2,1,90),market()),null);
  assert.ok(soccerTotalNo({...game(),matchRemainingSeconds:NaN},market()),'missing feed countdown must not block a verified regulation clock');
  assert.equal(soccerTotalNo(game(479,2,1,'garbled'),market()),null);
  assert.equal(soccerTotalNo({...game(),soccerExtraTime:true},market()),null);
  assert.equal(soccerTotalNo({...game(),period:1},market()),null);
  assert.equal(soccerTotalNo({...game(),sport:'Hockey'},market()),null);
  assert.equal(soccerTotalNo({...game(),observedAt:Date.now()-11000},market()),null);
});

test('soccer NO needs at least 1.5 goals above current combined live score',()=>{
  assert.equal(soccerTotalNo(game(),market(4.5))?.total,3);
  assert.equal(soccerTotalNo(game(),market(4.0)),null);
  assert.equal(soccerTotalNo(game(),market(3.5)),null);
  assert.equal(soccerTotalNo(game(479,3,1),market(5.5))?.total,4);
  assert.equal(soccerTotalNo(game(479,3,1),market(4.5)),null);
});

test('only exchange-identified whole-game 90-minutes-plus-stoppage soccer totals qualify',()=>{
  const state=game();
  assert.ok(soccerTotalNo(state,market()));
  assert.equal(soccerTotalNo(state,{...market(),title:'Will over 5.5 goals be scored?'}),null);
  assert.equal(soccerTotalNo(state,{...market(),yes_sub_title:'Over 5.5 goals scored'}),null);
  assert.equal(soccerTotalNo(state,{...market(),floor_strike:5.5}),null);
  assert.equal(soccerTotalNo(state,{...market(),rules_primary:market().rules_primary.replace('4.5','5.5')}),null);
  assert.equal(soccerTotalNo(state,{...market(),event_ticker:'KXEPLTEAMTOTAL-26NOV20AWAYHOME'}),null);
  assert.equal(soccerTotalNo(state,{...market(),event_ticker:'KXEPL1HTOTAL-26NOV20AWAYHOME'}),null);
  assert.equal(soccerTotalNo(state,{...market(),rules_primary:market().rules_primary.replace('does not include extra time or penalties','includes extra time')}),null);
  assert.equal(soccerTotalNo(state,{...market(),status:'closed'}),null);
});

test('independent ESPN proof verifies exact soccer fixture and goals without provider clock equality',async()=>{
  const state=game(),m=market(),board=scoreboard();
  const proof=independentSoccerTotalNoReading(board,state,milestone,m);
  assert.equal(proof?.source,'ESPN');
  assert.equal(proof?.elapsedMinute,83);
  assert.equal(soccerTotalNo(state,m,{external:proof})?.total,3);
  assert.equal(soccerTotalNo(state,m,{external:{...proof,away:2}}),null);
  assert.equal(soccerTotalNo(state,m,{external:{...proof,elapsedMinute:80}})?.total,3);
  assert.equal(independentSoccerTotalNoReading(scoreboard("79'"),state,milestone,m)?.home,2);
  assert.equal(independentSoccerTotalNoReading(scoreboard("83'",3,1),state,milestone,m),null);
  assert.equal(independentSoccerTotalNoReading(scoreboard("garbled"),state,milestone,m)?.away,1);
  const past=structuredClone(board);past.events[0].competitions[0].status.type.state='post';
  assert.equal(independentSoccerTotalNoReading(past,state,milestone,m)?.home,2,'provider game status is not an external score requirement');
  const duplicate=structuredClone(board);duplicate.events.push({...duplicate.events[0],id:'second-match'});
  assert.equal(independentSoccerTotalNoReading(duplicate,state,milestone,m),null);
  let urls=[];
  const fetched=await verifyIndependentSoccerTotalNo(state,milestone,m,{fetcher:async url=>{
    urls.push(url);return {ok:true,json:async()=>board};
  }});
  assert.equal(fetched?.eventId,'espn-soccer-game');
  assert.ok(urls.length>0&&urls.every(url=>url.includes('/soccer/all/scoreboard')));
});