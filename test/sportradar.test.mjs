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
test('captured soccer aliases resolve only the exact live fixture from Sportradar',async()=>{
  const at='2026-11-05T17:45:00Z',cases=[
    ['Milan vs Ferencvarosi','AC Milan','Ferencvarosi Budapest'],
    ['Mjallby vs Banja Luka','Mjallby AIF','FK Borac Banja Luka'],
    ['Anderlecht vs Salzburg','RSC Anderlecht','FC Salzburg'],
    ['Nijmegen vs Omonia Nicosia','NEC Nijmegen','AC Omonia Nicosia']
  ];
  const make=(home,away)=>({sport_event:{id:'sr:sport_event:74173022',start_time:at,
    competitors:[{qualifier:'home',name:home},{qualifier:'away',name:away}]},
    sport_event_status:{status:'live',match_status:'2nd_half',clock:{played:'89:36'},home_score:0,away_score:2}});
  for(const [title,home,away] of cases){
    const game={sport:'Soccer',type:'soccer_tournament_multi_leg',scoreKnown:true,home:0,away:2,period:2,soccerMinute:89.6};
    const milestone={title,start_date:at};
    const run=summary=>verifyIndependentOverDecision({...game},milestone,{market:{event_ticker:'KXUELGAME-X'},
      minInterval:0,sportradarApiKey:'test-secret',fetcher:async url=>reply(url.includes('sportradar.com')?
        live([summary]):{events:[],sectionList:[]})});
    assert.equal(await run(make(home,away)),true,title);
    assert.equal(await run(make(home,'Different Club')),null,`${title}: wrong opponent must fail closed`);
    assert.equal(await run({...make(home,away),sport_event:{...make(home,away).sport_event,start_time:'2026-11-04T17:45:00Z'}}),null,
      `${title}: wrong date must fail closed`);
  }
});
test('Sportradar domestic team code and intact nickname resolve the captured NBA fixture',async()=>{
  const at='2026-11-05T03:00:00Z',id='5b1e5d96-fc41-4b09-9bb6-187c1713dd3a';
  const game={sport:'NBA',type:'basketball_game',scoreKnown:true,home:105,away:108,period:4,
    homeName:'SAC Kings',awayName:'LA Lakers'};
  const fixture={id,scheduled:at,home:{name:'Sacramento Kings',alias:'SAC'},away:{name:'Los Angeles Lakers',alias:'LAL'}};
  const run=(row=fixture)=>verifyIndependentOverDecision({...game},{title:'LA Lakers at SAC Kings',start_date:at},{
    market:{event_ticker:'KXNBAGAME-X'},minInterval:0,sportradarApiKey:'test-secret',
    fetcher:async url=>url.includes('nba.com')?{ok:false,status:403}:
      reply(url.includes('espn.com')?{events:[]}:url.endsWith('schedule.json')?{games:[row]}:
        url.includes('sportradar.com')?{...row,status:'inprogress',quarter:4,clock:'1:41',
          home:{...row.home,points:105},away:{...row.away,points:108}}:{sectionList:[]})});
  assert.equal(await run(),true);
  assert.equal(await run({...fixture,home:{name:'Sacramento Warriors',alias:'SAC'}}),null,
    'matching provider code with a wrong mascot cannot authorize a trade');
});
test('soccer totals still require a complete independent goal timeline',async()=>{
  const at='2026-11-05T17:45:00Z',milestone={title:'Anderlecht vs Salzburg',start_date:at};
  const game={sport:'Soccer',type:'soccer_tournament_multi_leg',scoreKnown:true,home:2,away:0,period:2,soccerMinute:80};
  const summary={sport_event:{id:'sr:sport_event:74173036',start_time:at,
    competitors:[{qualifier:'home',name:'RSC Anderlecht'},{qualifier:'away',name:'FC Salzburg'}]},
    sport_event_status:{status:'live',match_status:'2nd_half',clock:{played:'80:00'},home_score:2,away_score:0}};
  const run=goals=>verifySportradarOver({...game},milestone,{market:{event_ticker:'KXUELTOTAL-X',floor_strike:1.5},
    minInterval:0,sportradarApiKey:'test-secret',fetcher:async url=>reply(url.endsWith('timeline.json')?
      {sport_event:{id:summary.sport_event.id},timeline:goals}:live([summary]))});
  assert.equal(await run([{type:'score_change',period_type:'regular_period',home_score:1,away_score:0},
    {type:'score_change',period_type:'regular_period',home_score:2,away_score:0}]),true);
  assert.equal(await run([{type:'score_change',period_type:'regular_period',home_score:1,away_score:0}]),false);
});
test('an unavailable fixture names the attempted Sportradar source',async()=>{
  const game={...row(),sport:'Soccer',type:'soccer_match',scoreKnown:true,home:1,away:0,
    homeName:'Alpha',awayName:'Beta',period:2};
  const decision=await verifyIndependentOverDecision(game,{title:'Alpha vs Beta',start_date:start},{
    market:{event_ticker:'KXSOCCERGAME-X'},minInterval:0,sportradarApiKey:'test-secret',
    fetcher:async url=>reply(url.includes('sportradar.com')?live([]):{events:[],sectionList:[]})});
  assert.equal(decision,null);
  assert.match(game.verificationIssue,/Sportradar: no exact matching fixture/);
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
