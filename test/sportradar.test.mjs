import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyIndependentOverDecision,verifySportradarOver} from '../src/score_verification.mjs';
import {sportradarProduct,sportradarPlayerValue} from '../src/sportradar.mjs';
import {verifyGolfDecision,verifySportradarGolf} from '../src/golf.mjs';
const start='2026-11-02T19:00:00Z';
const milestone={start_date:start,title:'Boston Celtics at Chicago Bulls'};
const game={sport:'International',type:'basketball_game',scoreKnown:true,home:70,away:60,homeName:'Chicago Bulls',awayName:'Boston Celtics',period:3};
const market={event_ticker:'KXNBATOTAL-X',floor_strike:129.5};
const row=()=>({sport_event:{id:'sr:sport_event:123',start_time:start,competitors:[{qualifier:'home',name:'Chicago Bulls'},{qualifier:'away',name:'Boston Celtics'}]},sport_event_status:{status:'live',match_status:'3rd_quarter',home_score:70,away_score:60,period_scores:[{number:1,home_score:25,away_score:20}]}});
const reply=data=>({ok:true,json:async()=>data});
const live=items=>({generated_at:new Date().toISOString(),summaries:items});
test('Sportradar requires a unique live fixture and fresh complete score',async()=>{
  const run=data=>verifySportradarOver({...game},milestone,{market,minInterval:0,sportradarApiKey:'test-secret',fetcher:async(url,opts)=>{
    assert.equal(url.includes('test-secret'),false);assert.equal(opts.headers['x-api-key'],'test-secret');return reply(data);
  }});
  assert.equal(await run(live([row()])),true);
  assert.equal(await run(live([])),null);
  assert.equal(await run(live([row(),row()])),false);
  const wrong=row();wrong.sport_event.start_time='2026-11-01T19:00:00Z';assert.equal(await run(live([wrong])),null);
  const contrary=row();contrary.sport_event_status.home_score=60;assert.equal(await run(live([contrary])),false);
  const final=row();final.sport_event_status.status='closed';assert.equal(await run(live([final])),false);
  const stale=live([row()]);stale.generated_at='2020-01-01T00:00:00Z';assert.equal(await run(stale),null);
  const missing=row();delete missing.sport_event_status.home_score;assert.equal(await run(live([missing])),null);
});
test('ESPN success or contradiction never calls Sportradar; unavailable ESPN calls it once without retries',async()=>{
  for(const mode of ['success','conflict','failure']){
    const calls=[];
    const g={...game,sport:'WNBA'};
    const espn={events:[{id:'1',date:start,competitions:[{status:{period:3,type:{state:'in'}},competitors:[{homeAway:'home',score:mode==='conflict'?60:70,team:{displayName:'Chicago Bulls'}},{homeAway:'away',score:60,team:{displayName:'Boston Celtics'}}]}]}]};
    const result=await verifyIndependentOverDecision(g,milestone,{market,minInterval:0,sportradarApiKey:'test-secret',fetcher:async url=>{
      calls.push(url);
      if(url.includes('espn.com')){if(mode==='failure')throw Error('unavailable');return reply(espn);}
      assert.ok(url.includes('sportradar.com'),'Sportradar must be the next provider');
      if(url.endsWith('schedule.json'))return reply({games:[{id:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',scheduled:start,home:{name:'Chicago Bulls'},away:{name:'Boston Celtics'}}]});
      return reply({id:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',scheduled:start,status:'inprogress',quarter:3,home:{name:'Chicago Bulls',points:70},away:{name:'Boston Celtics',points:60}});
    }});
    assert.equal(result,mode!=='conflict');
    assert.equal(calls.filter(u=>u.includes('espn.com')).length,1);
    assert.equal(calls.some(u=>u.includes('sportradar.com')),mode==='failure');
  }
});
test('Sportradar starts immediately when ESPN fails even while the NBA check is pending',async()=>{
  let releaseNba;const pendingNba=new Promise(resolve=>releaseNba=resolve),calls=[];
  let fallbackStarted;const started=new Promise(resolve=>fallbackStarted=resolve);
  const task=verifyIndependentOverDecision({...game,sport:'NBA'},milestone,{market,minInterval:0,sportradarApiKey:'test-secret',fetcher:async url=>{
    calls.push(url);
    if(url.includes('nba.com')){await pendingNba;return reply({});}
    if(url.includes('espn.com'))throw Error('unavailable');
    if(url.includes('sportradar.com')){fallbackStarted();return reply({games:[]});}
    throw Error('unavailable');
  }});
  await started;assert.equal(calls.filter(u=>u.includes('espn.com')).length,1);releaseNba();assert.equal(await task,null);
});
test('exact player identity and absent statistics cannot become zero or another player',()=>{
  const reading={players:[{name:'Doe, Jane',statistics:{points:20,total_rebounds:5,assists:3}}]};
  assert.equal(sportradarPlayerValue(reading,{name:'Jane Doe',metric:'PRA'}),28);
  assert.equal(sportradarPlayerValue(reading,{name:'Janet Doe',metric:'PTS'}),null);
  assert.equal(sportradarPlayerValue(reading,{name:'Jane Doe',metric:'BLK'}),null);
  assert.equal(sportradarPlayerValue({...reading,players:[...reading.players,...reading.players]},{name:'Jane Doe',metric:'PTS'}),null);
});
test('specialized sport feeds cannot be substituted for virtual sports or ambiguous rugby formats',()=>{
  assert.equal(sportradarProduct({type:'esports_basketball',sport:'NBA'}),null);
  assert.equal(sportradarProduct({type:'rugby_game',competition:'unknown'}),null);
  assert.equal(sportradarProduct({type:'rugby_game',competition:'NRL'}).path,'rugby-league');
  assert.equal(sportradarProduct({type:'table_tennis_match'}).path,'tabletennis');
});
test('a missing selected period never falls back to whole-game points',async()=>{
 const g={...game,periodScores:[{number:2,home:40,away:30}]};
 assert.equal(await verifySportradarOver(g,milestone,{market:{event_ticker:'KXNBA2QTOTAL-X',floor_strike:65.5},minInterval:0,sportradarApiKey:'test-secret',fetcher:async()=>reply(live([row()]))}),null);
});
test('cricket accepts only complete single-innings team run totals',async()=>{
 const g={...game,type:'cricket_match',sport:'Cricket',period:2,home:160,away:150};
 const e={id:'sr:match:123',scheduled:start,tournament:{type:'t20'},competitors:row().sport_event.competitors};
 const summary={sport_event:e,sport_event_status:{status:'live',current_inning:2,period_scores:[{type:'inning',number:1,home_score:160,away_score:0},{type:'inning',number:2,home_score:0,away_score:150}]}};
 const run=()=>verifySportradarOver(g,milestone,{market:{event_ticker:'KXCRICKETTOTAL-X',floor_strike:300.5},minInterval:0,sportradarApiKey:'test-secret',fetcher:async url=>reply(url.endsWith('schedule.json')?{sport_events:[e]}:summary)});
 assert.equal(await run(),true);
 e.tournament.type='test';assert.equal(await run(),null);
 e.tournament.type='t20';delete summary.sport_event_status.period_scores[1].away_score;assert.equal(await run(),null);
});
test('golf unavailability is distinct from contradiction; Sportradar requires all named golfers and final-round holes',async()=>{
 const g={golf:{board:[{competitor_id:'a',total_score:-20,current_round_thru:17},{competitor_id:'b',total_score:-15,current_round_thru:17}]},tour:'pga',period:4};
 const m={title:'Test Open',start_date:'2026-11-01T00:00:00Z'};
 const event={markets:[{custom_strike:{golf_competitor:'a'},yes_sub_title:'Jane Doe'},{custom_strike:{golf_competitor:'b'},yes_sub_title:'Jo Smith'}]};
 assert.equal(await verifyGolfDecision(g,m,event,async()=>({ok:false,status:503})),null);
 const id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
 const board={id,name:m.title,start_date:m.start_date,status:'inprogress',event_type:'stroke',rounds:[{number:4,status:'inprogress'}],leaderboard:[{first_name:'Jane',last_name:'Doe',score:-20,rounds:[{sequence:4,thru:17}]},{first_name:'Jo',last_name:'Smith',score:-15,rounds:[{sequence:4,thru:17}]}]};
 const run=()=>verifySportradarGolf(g,m,event,{apiKey:'test-secret',minInterval:0,fetcher:async url=>reply(url.endsWith('schedule.json')?{tournaments:[board]}:board)});
 assert.equal(await run(),true);
 board.leaderboard[1].score=-19;assert.equal(await run(),false);
 board.leaderboard[1].score=-15;board.leaderboard[1].rounds[0].thru=16;assert.equal(await run(),false);
 board.leaderboard[1].score=null;assert.equal(await run(),null);
});
