import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {page} from '../src/ui.mjs';

test('filled order timer is bright red, advances each second and reanchors to live score',()=>{
  const intervals=[],elements=[];
  const refresh={classList:{add(){},remove(){},toggle(){}},addEventListener(){},setAttribute(){}};
  const document={
    getElementById:()=>refresh,
    querySelectorAll:selector=>elements.filter(el=>'.'+el.className===selector),
    createElement:()=>({children:[],append(...items){this.children.push(...items)}})
  };
  const script=page.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script);
  const localStorage={getItem(){return null},setItem(){}};
  const context=vm.createContext({document,window:{addEventListener(){}},navigator:{},localStorage,fetch:()=>new Promise(()=>{}),AbortSignal,setInterval:(fn,ms)=>intervals.push({fn,ms})});
  vm.runInContext(script,context);
  const clock=vm.runInContext('clockDisplay',context),scoreDisplay=vm.runInContext('scoreDisplay',context),order=vm.runInContext('order',context);
  const start=1_000_000,base={market_ticker:'GAME',sport:'Basketball',allocated_cents:100,potential_profit_cents:25,clock_seconds:278,clock_observed_at:new Date(start).toISOString(),game_status:'live',clock_label:'Quarter 4 left',home_score:79,away_score:71,score_scanned_at:new Date(start).toISOString()};
  assert.equal(clock(base,start),'04:38');
  assert.equal(clock(base,start+1000),'04:37');
  assert.equal(clock(base,start+2000),'04:36');
  assert.equal(clock({...base,clock_seconds:276,clock_observed_at:new Date(start+2000).toISOString()},start+2000),'04:36');
  assert.equal(clock({...base,clock_seconds:2},start+6000),'00:00');
  assert.equal(clock({...base,time_left:'04:38 remaining'},start+31000),'04:38 remaining');
  assert.equal(clock({game_status:'live',clock_seconds:null,clock_label:'Stoppage time'}),'Stoppage time · live');
  assert.equal(clock({game_status:'live',clock_seconds:null,clock_label:'Inning progress',time_left:'Inning 9 · 2 outs'}),'Inning 9 · 2 outs');
  assert.equal(scoreDisplay(base,start),'Away 71 · Home 79');
  assert.equal(scoreDisplay({...base,home_score:0,away_score:0},start),'Away 0 · Home 0');
  assert.equal(scoreDisplay({...base,sport:'Tennis',home_score:5,away_score:3},start),'Away 3 · Home 5 games');
  assert.equal(scoreDisplay({...base,home_score:null},start),'Score updating');
  assert.equal(scoreDisplay({...base,game_status:'inactive'},start),'Score updating');
  assert.equal(scoreDisplay(base,start+91000),'Score updating');
  const row=order({...base,clock_observed_at:new Date(Date.now()).toISOString(),score_scanned_at:new Date(Date.now()).toISOString()});
  const timer=row.children[3].children[0],score=row.children[3].children[1];
  elements.push(timer,score);
  assert.equal(timer.className,'live-timer');
  assert.equal(timer.textContent,'04:38');
  assert.equal(score.textContent,'Away 71 · Home 79');
  timer.clock.clock_observed_at=new Date(Date.now()-2000).toISOString();
  score.game.home_score=81;
  intervals.find(i=>i.ms===1000).fn();
  assert.equal(timer.textContent,'04:36');
  assert.equal(score.textContent,'Away 71 · Home 81');
  assert.match(page,/\.live-timer\{[^}]*color:#ff465c/);
  assert.match(page,/\.score-timer\{[^}]*display:flex/);
});

test('filled position names describe the sport, matchup and current over margin without showing ticker codes',()=>{
  const refresh={classList:{add(){},remove(){},toggle(){}},addEventListener(){},setAttribute(){}};
  const document={getElementById:()=>refresh,querySelectorAll:()=>[],createElement:()=>({children:[],append(...items){this.children.push(...items)}})};
  const script=page.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  const context=vm.createContext({document,window:{addEventListener(){}},navigator:{},localStorage:{getItem(){return null},setItem(){}},fetch:()=>new Promise(()=>{}),AbortSignal,setInterval(){}});
  vm.runInContext(script,context);
  const order=vm.runInContext('order',context),overDescription=vm.runInContext('overDescription',context);
  const live={game_status:'live',score_scanned_at:new Date().toISOString(),market_ticker:'KXDFBPOKALTOTAL-26OCT27HSVSGE-2',game_title:'Hamburg vs Frankfurt',sport:'Soccer',sport_family:'soccer_match',strategy:'over',reason:'2 scored; line 1.5 already passed',home_score:0,away_score:2,allocated_cents:5421,potential_profit_cents:94};
  const over=order(live);
  assert.equal(over.children[0].textContent,'Soccer · Over 1.5 goals');
  assert.equal(over.children[1].textContent,'Hamburg vs Frankfurt · 0.5 goals above the line');
  assert.equal(over.children[2].textContent,'Funds allocated $54.21 · Potential profit $0.94');
  assert.ok(!over.children.some(el=>String(el.textContent||'').includes('KXDFBPOKALTOTAL')));
  assert.equal(overDescription({...live,home_score:1}).detail,'Hamburg vs Frankfurt · 1.5 goals above the line');
  assert.equal(overDescription({...live,score_scanned_at:new Date(0).toISOString()}).detail,'Hamburg vs Frankfurt');
  const lead=order({...live,market_ticker:'KXFIBAECUPGAME-...',sport:'FIBA Europe Cup',sport_family:'basketball_game',strategy:'lead',game_title:'BK Levicki Patrioti at CS Dinamo Bucuresti'});
  assert.equal(lead.children[0].textContent,'Basketball · BK Levicki Patrioti at CS Dinamo Bucuresti');
  assert.equal(lead.children[1].textContent,'Commanding lead');
});
