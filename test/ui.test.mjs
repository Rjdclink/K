import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {page} from '../src/ui.mjs';

test('filled order timer is bright red, advances each second and reanchors to live score',()=>{
  const intervals=[],elements=[];
  const refresh={classList:{add(){},remove(){},toggle(){}},addEventListener(){},setAttribute(){}};
  const document={
    getElementById:()=>refresh,
    querySelectorAll:()=>elements,
    createElement:()=>({children:[],append(...items){this.children.push(...items)}})
  };
  const script=page.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script);
  const localStorage={getItem(){return null},setItem(){}};
  const context=vm.createContext({document,window:{addEventListener(){}},navigator:{},localStorage,fetch:()=>new Promise(()=>{}),AbortSignal,setInterval:(fn,ms)=>intervals.push({fn,ms})});
  vm.runInContext(script,context);
  const clock=vm.runInContext('clockDisplay',context),order=vm.runInContext('order',context);
  const start=1_000_000,base={market_ticker:'GAME',allocated_cents:100,potential_profit_cents:25,clock_seconds:278,clock_observed_at:new Date(start).toISOString(),game_status:'live',clock_label:'Quarter 4 left'};
  assert.equal(clock(base,start),'04:38');
  assert.equal(clock(base,start+1000),'04:37');
  assert.equal(clock(base,start+2000),'04:36');
  assert.equal(clock({...base,clock_seconds:276,clock_observed_at:new Date(start+2000).toISOString()},start+2000),'04:36');
  assert.equal(clock({...base,clock_seconds:2},start+6000),'00:00');
  assert.equal(clock({...base,time_left:'04:38 remaining'},start+31000),'04:38 remaining');
  assert.equal(clock({game_status:'live',clock_seconds:null,clock_label:'Stoppage time'}),'Stoppage time · live');
  assert.equal(clock({game_status:'live',clock_seconds:null,clock_label:'Inning progress',time_left:'Inning 9 · 2 outs'}),'Inning 9 · 2 outs');
  const timer=order({...base,clock_observed_at:new Date(Date.now()).toISOString()}).children[2];
  elements.push(timer);
  assert.equal(timer.className,'live-timer');
  assert.equal(timer.textContent,'04:38');
  timer.clock.clock_observed_at=new Date(Date.now()-2000).toISOString();
  intervals.find(i=>i.ms===1000).fn();
  assert.equal(timer.textContent,'04:36');
  assert.match(page,/\.live-timer\{[^}]*color:#ff465c/);
});
