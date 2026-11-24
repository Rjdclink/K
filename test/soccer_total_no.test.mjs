import test from 'node:test';
import assert from 'node:assert/strict';
import {gameState} from '../src/strategy.mjs';
import {soccerNoMarketSpec,soccerTotalNo,independentSoccerTotalNoReading,verifyIndependentSoccerTotalNo} from '../src/soccer_total_no.mjs';

const milestone={id:'soccer-total-no',title:'Away at Home',type:'soccer_match',
  start_date:'2026-11-20T17:00:00Z',
  details:{league:'EPL',main_game_event_ticker:'KXEPLGAME-26NOV20AWAYHOME'}};
const game=(seconds=240,home=2,away=1,minute=86)=>gameState(milestone,{
  milestone_id:milestone.id,_observed_at:new Date().toISOString(),
  details:{status:'inprogress',home_score:home,away_score:away,half:'2nd',
    time:minute+"'",match_remaining_seconds:seconds,
    last_updated_ts:Date.now()/1000,home_team_name:'Home',away_team_name:'Away'}});
const market=(line=5.5)=>({
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

test('soccer NO 2.5 cushion enters strictly below 8 minutes after an initial 9-minute check',()=>{
  assert.ok(soccerNoMarketSpec(game(540,2,1,81),market(),{beforeWindow:true}));
  assert.equal(soccerNoMarketSpec(game(541,2,1,'80:59'),market(),{beforeWindow:true}),null);
  assert.equal(soccerTotalNo(game(480,2,1,82),market()),null);
  assert.equal(soccerTotalNo(game(540,2,1,81),market()),null);
  assert.ok(soccerTotalNo(game(479,2,1,83),market()));
  assert.equal(soccerTotalNo(game(0,2,1,90),market()),null);
  assert.ok(soccerTotalNo({...game(),matchRemainingSeconds:NaN},market()),'missing feed countdown must not block a verified regulation clock');
  assert.equal(soccerTotalNo(game(299,2,1,'garbled'),market()),null);
  assert.equal(soccerTotalNo({...game(),soccerExtraTime:true},market()),null);
  assert.equal(soccerTotalNo({...game(),period:1},market()),null);
  assert.equal(soccerTotalNo({...game(),sport:'Hockey'},market()),null);
  assert.equal(soccerTotalNo({...game(),observedAt:Date.now()-11000},market()),null);
});

test('a full-game NO 2.5 line with two scored is excluded even in the eight-minute window',()=>{
 assert.equal(soccerTotalNo(game(420,2,0,83),market(2.5)),null);
 assert.equal(soccerTotalNo(game(120,2,0,88),market(2.5)),null);
 assert.equal(soccerTotalNo(game(480,1,0,82),market(2.5)),null);
 assert.ok(soccerTotalNo(game(420,1,0,83),market(2.5)),
  'one more goal can be scored while NO 2.5 still wins');
 assert.ok(soccerTotalNo(game(420,2,0,83),market(4.5)),
  'the same game still qualifies for a genuine 2.5-goal cushion');
});

test('soccer NO blocks the exact 3.5 no-cushion line at three goals, while four goals still require a later 1.5 window',()=>{
  assert.equal(soccerTotalNo(game(),market(5.5))?.total,3);
  assert.equal(soccerTotalNo(game(),market(4.0)),null);
  assert.equal(soccerTotalNo(game(),market(3.5)),null);
  assert.equal(soccerTotalNo(game(299,3,1),market(5.5)),null,'four-goal games need 3.5 cushion, not 1.5');
  assert.equal(soccerTotalNo(game(299,3,1),market(4.5)),null);
});

test('soccer total NO checks BBC Sport after ESPN is unavailable',async()=>{
 const urls=[],g=game(),m=market();
 const proof=await verifyIndependentSoccerTotalNo(g,milestone,m,{fetcher:async url=>{
  urls.push(url);return {ok:true,headers:{get:()=>null},json:async()=>({events:[]})};
 }});
 assert.equal(proof,null);
 assert.ok(urls.length>0);
 assert.ok(urls.some(url=>url.startsWith('https://site.api.espn.com/')));
 assert.ok(urls.some(url=>url.startsWith('https://www.bbc.com/')));
 assert.ok(urls.every(url=>/espn\.com|bbc\.com/.test(url)));
});
test('only exchange-identified whole-game 90-minutes-plus-stoppage soccer totals qualify',()=>{
  const state=game();
  assert.ok(soccerTotalNo(state,market()));
  assert.equal(soccerTotalNo(state,{...market(),title:'Will over 6.5 goals be scored?'}),null);
  assert.equal(soccerTotalNo(state,{...market(),yes_sub_title:'Over 6.5 goals scored'}),null);
  assert.equal(soccerTotalNo(state,{...market(),floor_strike:6.5}),null);
  assert.equal(soccerTotalNo(state,{...market(),rules_primary:market().rules_primary.replace('5.5','6.5')}),null);
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
  assert.equal(soccerTotalNo(state,m,{external:{...proof,away:2}}),null,'authoritative external score can eliminate the required goal cushion');
  assert.equal(soccerTotalNo(state,m,{external:{...proof,elapsedMinute:80}})?.total,3);
  assert.equal(independentSoccerTotalNoReading(scoreboard("79'"),state,milestone,m)?.home,2);
  assert.equal(independentSoccerTotalNoReading(scoreboard("83'",3,1),state,milestone,m)?.home,3);
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
  assert.ok(urls.length>0&&urls.some(url=>url.includes('/soccer/eng.1/scoreboard')));
});
test('soccer full-game NO admits 4+ goals only with a full 3.5-goal cushion',()=>{
  const large=market(8.5),proof={source:'ESPN',eventId:'matched-soccer',home:2,away:2};
  assert.equal(soccerTotalNo(game(299,2,1),large)?.total,3);
  assert.equal(soccerTotalNo(game(299,2,2),large)?.total,4,'four scored with 4.5 cushion qualifies');
  assert.equal(soccerTotalNo(game(299,3,2),large)?.total,5,'five scored can enter late');
  assert.equal(soccerTotalNo(game(299,2,2),large,{beforeWindow:true})?.total,4,'preflight applies same cushion');
  assert.equal(soccerTotalNo(game(299,2,1),large,{external:proof})?.total,4,'independent score chooses actual four-goal cushion');
  assert.equal(soccerTotalNo(game(299,2,2),market(5.5),{external:{...proof,away:1}})?.total,3,'independent score remains authoritative');
});

test('full-game NO entry uses the independently verified ESPN clock, not a more favorable Kalshi clock',async()=>{
  const g=game(299,2,1,86),m=market(5.5);
  const check=async(minute)=>verifyIndependentSoccerTotalNo(g,milestone,m,{
    fetcher:async()=>({ok:true,headers:{get:name=>name.toLowerCase()==='age'?'0':null},json:async()=>scoreboard(minute,2,1)})
  });
  const early=await check("77'"),late=await check("87'");
  assert.equal(early?.elapsedMinute,77);
  assert.equal(late?.elapsedMinute,87);
  assert.equal(soccerTotalNo(g,m,{external:early}),null,'ESPN says 13 minutes remain, so no live NO entry');
  assert.equal(soccerTotalNo(g,m,{external:late})?.total,3);
  assert.match(soccerTotalNo(g,m,{external:late})?.reason||'',/180s/);
});
