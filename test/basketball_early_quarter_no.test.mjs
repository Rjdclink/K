import test from 'node:test';
import assert from 'node:assert/strict';
import {gameState} from '../src/strategy.mjs';
import {nearEntryPhase,linkedEventTickers} from '../src/discovery.mjs';
import {basketballEarlyQuarterNoSpec,basketballEarlyQuarterNo,
  independentBasketballEarlyQuarterNoReading,verifyIndependentBasketballEarlyQuarterNo}
  from '../src/basketball_early_quarter_no.mjs';

const fixture=(sport='NBA')=>({id:'bb-q-no-'+sport,title:'Away at Home',type:'basketball_game',
 start_date:new Date().toISOString(),
 details:{league:sport,main_game_event_ticker:'KX'+sport+'GAME-TEST'}});
const contract=(sport='NBA',quarter=2,line=61.5)=>({
 ticker:'KX'+sport+quarter+'QTOTAL-TEST-'+Math.ceil(line),
 event_ticker:'KX'+sport+quarter+'QTOTAL-TEST',
 title:['1st','2nd','3rd'][quarter-1]+' Quarter: Over '+line+' points scored',
 yes_sub_title:'Over '+line+' points',floor_strike:line,strike_type:'greater',status:'active',
 rules_primary:sport==='NBA'?'If over '+line+' total points are scored in the '+
  ['1st','2nd','3rd'][quarter-1]+' quarter of the Away vs Home Pro Basketball game originally scheduled for Nov 20, 2026, then the market resolves to Yes.':
  'If the teams in the game collectively score more than '+line+' points in the '+
  ['1st','2nd','3rd'][quarter-1]+
  ' quarter of the Away vs Home women\'s Pro Basketball game originally scheduled for Nov 20, 2026, then the market resolves to Yes.'
});
const game=(sport='NBA',quarter=2,clock='2:00',scores=[{number:1,home_score:25,away_score:22},{number:2,home_score:15,away_score:15}])=>{
 const m=fixture(sport),current=scores.slice(0,quarter);
 const home=current.reduce((sum,p)=>sum+p.home_score,0),away=current.reduce((sum,p)=>sum+p.away_score,0);
 return gameState(m,{milestone_id:m.id,_observed_at:new Date().toISOString(),
  details:{status:'live',period:quarter,clock,
    home_score:home,away_score:away,period_scores:current,
    home_team_name:'Home',away_team_name:'Away',last_updated_ts:Date.now()/1000}});
};
const board=(sport,quarter,clock,parts)=>{
 const m=fixture(sport);
 return {events:[{id:'espn-'+sport+'-q',date:m.start_date,competitions:[{
  status:{period:quarter,displayClock:clock,type:{state:'in'}},
  competitors:[{
   homeAway:'home',team:{displayName:'Home'},score:String(parts.reduce((n,p)=>n+p.home,0)),
   linescores:parts.map(p=>({value:p.home}))
  },{
   homeAway:'away',team:{displayName:'Away'},score:String(parts.reduce((n,p)=>n+p.away,0)),
   linescores:parts.map(p=>({value:p.away}))
  }]
 }]}]};
};
test('NBA/WNBA first three quarters have a 12-point cushion and strict under-1:30 entry',()=>{
 for(const sport of ['NBA','WNBA'])for(const quarter of [1,2,3]){
  const scores=[1,2,3].slice(0,quarter).map(n=>({number:n,home_score:n===quarter?12:22,away_score:n===quarter?10:19}));
  const g=t=>game(sport,quarter,t,scores);
  const m=contract(sport,quarter,34.5);
  assert.ok(basketballEarlyQuarterNoSpec(g('2:30'),m,{beforeWindow:true}));
  assert.equal(basketballEarlyQuarterNoSpec(g('2:31'),m,{beforeWindow:true}),null);
  assert.equal(basketballEarlyQuarterNo(g('1:30'),m),null);
  assert.equal(basketballEarlyQuarterNo(g('1:29'),m)?.total,22);
  assert.equal(basketballEarlyQuarterNo(g('0:00'),m),null);
  assert.equal(basketballEarlyQuarterNo(g('1:29'),contract(sport,quarter,33.5)),null);
  assert.equal(basketballEarlyQuarterNo(g('1:29'),contract(sport,quarter,34.0))?.total,22,
    'an exact 12-point cushion qualifies');
  assert.equal(basketballEarlyQuarterNo(g('1:29'),contract(sport,quarter,35.5))?.total,22);
  assert.equal(basketballEarlyQuarterNo(g('1:29'),contract(sport,4,34.5)),null);
 }
});
test('quarterly score is not the combined game score after quarter one',()=>{
 const g=game('NBA',2,'1:29');
 assert.equal(g.home+g.away,77);
 assert.equal(basketballEarlyQuarterNo(g,contract('NBA',2,42.5))?.total,30);
 assert.equal(basketballEarlyQuarterNo(g,contract('NBA',2,41.5)),null);
});
test('exact quarter contract, strike, title and rules must match',()=>{
 const g=game('NBA',2,'1:29'),m=contract('NBA',2,42.5);
 assert.ok(basketballEarlyQuarterNoSpec(g,m));
 for(const invalid of [
  {event_ticker:'KXNBA3QTOTAL-TEST'},
  {event_ticker:'KXNBA2QTEAMTOTAL-TEST'},
  {title:'Full Game: Over 42.5 points scored'},
  {title:'1st Quarter: Over 42.5 points scored'},
  {yes_sub_title:'Over 45.5 points'},
  {floor_strike:43.5},
  {rules_primary:m.rules_primary.replace('2nd quarter','3rd quarter')},
  {rules_primary:m.rules_primary.replace('Pro Basketball game','team total basketball game')},
  {status:'closed'},
 ])assert.equal(basketballEarlyQuarterNoSpec(g,{...m,...invalid}),null,JSON.stringify(invalid));
});
test('ESPN quarter proof requires the exact game and scores, not provider clock or period',async()=>{
 const g=game('NBA',2,'1:29'),m=contract('NBA',2,42.5),milestone=fixture('NBA');
 const parts=[{home:25,away:22},{home:15,away:15}];
 const score=board('NBA',2,'1:29',parts);
 const proof=independentBasketballEarlyQuarterNoReading(score,g,milestone,m);
 assert.equal(proof?.source,'ESPN');
 assert.equal(proof?.quarter,2);
 assert.equal(proof?.currentQuarter?.home,15);
 assert.equal(basketballEarlyQuarterNo(g,m,{external:proof})?.total,30);
 assert.equal(independentBasketballEarlyQuarterNoReading(board('NBA',2,'1:29',[{home:25,away:22},{home:14,away:15}]),g,milestone,m)?.home,39,'external team score controls quarter cushion');
 assert.equal(independentBasketballEarlyQuarterNoReading(board('NBA',2,'1:45',parts),g,milestone,m)?.home,40);
 assert.equal(independentBasketballEarlyQuarterNoReading(board('NBA',1,'1:29',parts),g,milestone,m)?.away,37);
 const dup=structuredClone(score);dup.events.push({...dup.events[0],id:'duplicate'});
 assert.equal(independentBasketballEarlyQuarterNoReading(dup,g,milestone,m),null);
 let seen=[];
 const fetched=await verifyIndependentBasketballEarlyQuarterNo(g,milestone,m,{fetcher:async url=>{
  seen.push(url);return {ok:true,json:async()=>score};
 }});
 assert.equal(fetched?.eventId,'espn-NBA-q');
 assert.ok(seen.every(s=>s.includes('/basketball/nba/scoreboard')));
});
test('NBA and WNBA quarter markets remain historically identifiable but never receive fast scanner priority',()=>{
 for(const sport of ['NBA','WNBA'])for(const quarter of [1,2,3]){
  const g=game(sport,quarter,'2:30');
  assert.equal(nearEntryPhase(g),false);
  assert.ok(linkedEventTickers(fixture(sport)).includes(contract(sport,quarter).event_ticker));
 }
 assert.equal(nearEntryPhase(game('NBA',2,'9:00')),false);
});