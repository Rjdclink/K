import test from 'node:test';
import assert from 'node:assert/strict';
import {gameState} from '../src/strategy.mjs';
import {nearEntryPhase,linkedEventTickers} from '../src/discovery.mjs';
import {soccerFirstHalfNoSpec,soccerFirstHalfNo,verifyIndependentSoccerFirstHalfNo,
 independentSoccerFirstHalfNoReading,soccerFirstHalfSeconds} from '../src/soccer_first_half_no.mjs';

const milestone={id:'soccer-hull-brighton',type:'soccer_match',
 title:'Hull City vs Brighton',start_date:new Date().toISOString(),
 details:{league:'EPL',main_game_event_ticker:'KXEPLGAME-26NOV22HULBRI'}};
const state=(time="41'",home=0,away=1,extra={})=>gameState(milestone,{
 milestone_id:milestone.id,_observed_at:new Date().toISOString(),
 details:{status:'live',half:'1st',period:1,time,home_score:home,away_score:away,
   home_team_name:'Hull City',away_team_name:'Brighton',
   last_updated_ts:Date.now()/1000,...extra}});
const market=(line=3.5)=>({
 ticker:'KXEPL1HTOTAL-26NOV22HULBRI-'+Math.ceil(line),
 event_ticker:'KXEPL1HTOTAL-26NOV22HULBRI',
 title:'Over '+line+' 1H goals scored',yes_sub_title:'Over '+line+' 1H goals scored',
 floor_strike:line,strike_type:'greater',status:'active',
 rules_primary:'If the total goals scored by Hull City and Brighton  is more than '+line+
 ' goals in the 1st Half of the Hull City vs Brighton professional EPL soccer game originally scheduled for Nov 22, 2026, then the market resolves to Yes.'
});
const board=(elapsed="41'",home=0,away=1,period=1)=>({events:[{
 id:'espn-1h-hulbri',date:milestone.start_date,competitions:[{
  status:{period,displayClock:elapsed,type:{state:'in'}},
  competitors:[
    {homeAway:'home',score:String(home),team:{displayName:'Hull City'}},
    {homeAway:'away',score:String(away),team:{displayName:'Brighton'}}
  ]}]
}]});

test('first half soccer NO uses strictly less than 5:00 remaining in 45-minute regulation only',()=>{
 assert.equal(soccerFirstHalfSeconds(state("41'")),240);
 assert.equal(soccerFirstHalfSeconds(state("41:30'")),210);
 assert.equal(soccerFirstHalfSeconds(state("41:31'")),209);
 assert.equal(soccerFirstHalfSeconds(state("44:59'")),1);
 assert.equal(soccerFirstHalfSeconds(state("45'")),0);
 assert.equal(soccerFirstHalfSeconds(state("45+4'")),0);
 assert.equal(soccerFirstHalfSeconds(state("48'")),0);
 assert.equal(soccerFirstHalfSeconds(state("garbled")),null);
 assert.equal(soccerFirstHalfSeconds(state("41'",0,1,{match_remaining_seconds:10})),240);
 assert.equal(soccerFirstHalfSeconds(state("41'",0,1,{half:'2nd',period:2})),null);
});

test('initial independent check begins at 6:00 remaining; entry strictly under 5:00',()=>{
 assert.equal(soccerFirstHalfNoSpec(state("38:59'"),market(),{beforeWindow:true}),null);
 assert.ok(soccerFirstHalfNoSpec(state("39'"),market(),{beforeWindow:true}));
 assert.ok(soccerFirstHalfNoSpec(state("40'"),market(),{beforeWindow:true}));
 assert.equal(soccerFirstHalfNo(state("40'"),market()),null);
 assert.equal(soccerFirstHalfNo(state("40:01'"),market())?.total,1);
 assert.equal(soccerFirstHalfNo(state("44:59'"),market())?.total,1);
 assert.equal(soccerFirstHalfNo(state("45'"),market()),null);
 assert.equal(soccerFirstHalfNo(state("45+2'"),market()),null);
 assert.equal(soccerFirstHalfNo(state("42'",0,1,{status:'final'}),market()),null);
 assert.equal(soccerFirstHalfNo(state("42'",0,1,{half:'2nd',period:2}),market()),null);
});

test('soccer 1H total NO requires 2.5 goals at 0–3 scored and 3.5 from four',()=>{
 assert.equal(soccerFirstHalfNo(state("42'",0,1),market(3.5))?.total,1);
 assert.equal(soccerFirstHalfNo(state("42'",0,1),market(2.0)),null);
 assert.equal(soccerFirstHalfNo(state("42'",1,2),market(5.5))?.total,3);
 assert.equal(soccerFirstHalfNo(state("42'",1,2),market(3.5)),null);
});

test('first-half soccer NO never attempts any source other than ESPN',async()=>{
 const urls=[],g=state("42'"),m=market();
 const proof=await verifyIndependentSoccerFirstHalfNo(g,milestone,m,{fetcher:async url=>{
  urls.push(url);return {ok:true,headers:{get:()=>null},json:async()=>({events:[]})};
 }});
 assert.equal(proof,null);
 assert.ok(urls.length>0);
 assert.ok(urls.every(url=>url.startsWith('https://site.api.espn.com/')));
});
test('only the exact Kalshi first-half total identity, strike and settlement count as an entry',()=>{
 const g=state("42'"),m=market(2.5);
 assert.ok(soccerFirstHalfNoSpec(g,m));
 const variations=[
  {event_ticker:m.event_ticker.replace('1HTOTAL','TOTAL')},
  {event_ticker:m.event_ticker.replace('HULBRI','OTHGAM')},
  {title:'Over 2.5 goals scored'},
  {yes_sub_title:'Over 4.5 1H goals scored'},
  {floor_strike:4.5},
  {rules_primary:m.rules_primary.replace('1st Half','2nd Half')},
  {rules_primary:m.rules_primary.replace('soccer game','team total soccer game')},
  {status:'closed'}
 ];
 for(const variant of variations)assert.equal(soccerFirstHalfNoSpec(g,{...m,...variant}),null,JSON.stringify(variant));
});

test('independent ESPN check verifies teams and scores, never independent period or elapsed minute',async()=>{
 const g=state("42'",0,1),m=market(),scoreboard=board("42'");
 const proof=independentSoccerFirstHalfNoReading(scoreboard,g,milestone,m);
 assert.equal(proof?.source,'ESPN');
 assert.equal(proof?.period,1);
 assert.equal(soccerFirstHalfNo(g,m,{external:proof})?.total,1);
 assert.equal(independentSoccerFirstHalfNoReading(board("40'"),g,milestone,m)?.away,1);
 assert.equal(independentSoccerFirstHalfNoReading(board("42'",1,1),g,milestone,m)?.home,1,'external score controls eligibility');
 assert.equal(independentSoccerFirstHalfNoReading(board("42'",0,1,2),g,milestone,m)?.away,1);
 const duplicate=structuredClone(scoreboard);duplicate.events.push({...duplicate.events[0],id:'other'});
 assert.equal(independentSoccerFirstHalfNoReading(duplicate,g,milestone,m),null);
 const final=structuredClone(scoreboard);final.events[0].competitions[0].status.type.state='post';
 assert.equal(independentSoccerFirstHalfNoReading(final,g,milestone,m)?.away,1);
 let requests=[];
 const matched=await verifyIndependentSoccerFirstHalfNo(g,milestone,m,{fetcher:async url=>{
   requests.push(url);return {ok:true,json:async()=>scoreboard};
 }});
 assert.equal(matched?.eventId,'espn-1h-hulbri');
 assert.ok(requests.length>0&&requests.every(u=>u.includes('/soccer/all/scoreboard')));
});

test('first-half soccer market discovery and fast priority include the preflight window',()=>{
 assert.ok(linkedEventTickers(milestone).includes(market().event_ticker));
 for(const t of ["40:30'","41'","41:30'","42'","44:59'"]){
  assert.equal(nearEntryPhase(state(t)),true,t);
 }
 assert.equal(nearEntryPhase(state("30'")),false);
 assert.equal(nearEntryPhase(state("45'")),false);
 assert.equal(nearEntryPhase(state("46'")),false);
});
test('soccer first-half NO at four or more goals requires a 3.5-goal cushion',()=>{
  const large=market(6.5),proof={source:'ESPN',eventId:'matched-first-half',home:2,away:2};
  assert.equal(soccerFirstHalfNo(state("42'",1,2),large)?.total,3);
  assert.equal(soccerFirstHalfNo(state("42'",2,2),large),null,'exact four first-half goals need Over 7.5');
  assert.equal(soccerFirstHalfNo(state("42'",3,2),large),null,'five goals need Over 8.5');
  assert.equal(soccerFirstHalfNo(state("40'",2,2),large,{beforeWindow:true}),null,'early check requires same cushion');
  assert.equal(soccerFirstHalfNo(state("42'",1,2),large,{external:proof}),null,'independent four goals require Over 7.5');
  assert.equal(soccerFirstHalfNo(state("42'",2,2),market(5.5),{external:{...proof,away:1}})?.total,3,'external three-goal reading stays authoritative');
});
