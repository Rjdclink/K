import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {page} from '../src/ui.mjs';

test('score possession and net sale result refresh with the order display',()=>{
  const refresh={classList:{add(){},remove(){},toggle(){}},addEventListener(){},setAttribute(){}};
  const document={getElementById:()=>refresh,querySelectorAll:()=>[],createElement:()=>({children:[],append(...items){this.children.push(...items)}})};
  const context=vm.createContext({document,window:{addEventListener(){}},navigator:{},localStorage:{getItem(){return null},setItem(){}},fetch:()=>new Promise(()=>{}),AbortSignal,setInterval(){}});
  vm.runInContext(page.match(/<script>([\s\S]*?)<\/script>/)[1],context);
  const order=vm.runInContext('order',context),score=vm.runInContext('scoreDisplay',context);
  const base={game_status:'live',score_scanned_at:new Date().toISOString(),home_score:4,away_score:6,possession_side:'away',sport:'Baseball',strategy:'lead',reason:'Away leads 4–6',market_ticker:'M',sell_quote:{count:10,price:.92},sell_profit_cents:149};
  assert.match(score(base),/Away 6\* · Home 4/);
  assert.match(score({...base,possession_side:'home'}),/Away 6 · Home 4\*/);
  const gain=order(base).children.at(-1);
  assert.equal(gain.textContent,'↗ +$1.49');
  assert.match(gain.className,/sell-gain/);
  const loss=order({...base,sell_profit_cents:-90}).children.at(-1);
  assert.equal(loss.textContent,'↗ −$0.90');
  assert.match(loss.className,/sell-loss/);
  assert.equal(order({...base,sell_profit_cents:null}).children.at(-1).textContent,'↗ —');
});

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
  assert.equal(clock({...base,time_left:'04:38 remaining'},start+31000),'Last exchange clock 04:38 · delayed');
  assert.equal(clock({...base,clock_seconds:11,time_left:'00:11 remaining'},start+21000),'Last exchange clock 00:11 · delayed');
  assert.equal(clock({...base,clock_seconds:9.2,clock_label:'Quarter 4 left · paused'},start+5000),'00:09 · paused');
  assert.equal(clock({...base,clock_seconds:9.2,clock_label:'Quarter 4 left · paused'},start+12000),'00:09 · paused');
  assert.equal(clock({game_status:'live',clock_seconds:null,clock_label:'Stoppage time'}),'Stoppage time · live');
  assert.equal(clock({game_status:'live',clock_seconds:null,clock_label:'Inning progress',time_left:'Inning 9 · 2 outs'}),'Inning 9 · 2 outs');
  assert.equal(clock({...base,game_status:'final'},start+12000),'Final · awaiting settlement');
  assert.equal(scoreDisplay(base,start),'Away 71 · Home 79');
  assert.equal(scoreDisplay({...base,home_score:0,away_score:0},start),'Away 0 · Home 0');
  assert.equal(scoreDisplay({...base,sport:'Tennis',home_score:5,away_score:3},start),'Away 3 · Home 5 games');
  assert.equal(scoreDisplay({...base,home_score:null},start),'Score unavailable');
  assert.equal(scoreDisplay({...base,game_status:'inactive'},start),'Last score · Away 71 · Home 79');
  assert.equal(scoreDisplay({...base,game_status:'final'},start+91000),'Final · Away 71 · Home 79');
  assert.equal(scoreDisplay(base,start+91000),'Last score · Away 71 · Home 79');
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
  const paintScore=vm.runInContext('paintScore',context),chosen={};
  paintScore(chosen,{...base,strategy:'lead',reason:'New York leads 79–71 points (8 points ahead)',score_scanned_at:new Date(start).toISOString()},start);
  assert.match(chosen.innerHTML,/Away 71 · Home <strong class="chosen-score">79<\/strong>/);
  paintScore(chosen,{...base,strategy:'lead',reason:'Boston leads 71–79 points (8 points ahead)',score_scanned_at:new Date(start).toISOString()},start);
  assert.match(chosen.innerHTML,/Away <strong class="chosen-score">71<\/strong> · Home 79/);
  assert.match(page,/\.chosen-score\{color:#26f5ae/);
  assert.match(page,/Tennis: <strong>5–2 or better<\/strong>/);
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
  const team=order({...live,market_ticker:'KXNHLTEAMTOTAL-26OCT27CBJPHI-PHI2',sport:'Hockey',sport_family:'hockey_match',reason:'2 scored by Philadelphia; line 1.5 already passed',game_title:'Columbus at Philadelphia',home_score:2,away_score:3});
  assert.equal(team.children[0].textContent,'Hockey · Philadelphia over 1.5 goals');
  assert.equal(team.children[1].textContent,'Columbus at Philadelphia · team total');
  assert.equal(overDescription({...live,score_scanned_at:new Date(0).toISOString()}).detail,'Hamburg vs Frankfurt');
  const lead=order({...live,market_ticker:'KXFIBAECUPGAME-...',sport:'FIBA Europe Cup',sport_family:'basketball_game',strategy:'lead',game_title:'BK Levicki Patrioti at CS Dinamo Bucuresti'});
  assert.equal(lead.children[0].textContent,'Basketball · BK Levicki Patrioti at CS Dinamo Bucuresti');
  assert.equal(lead.children[1].textContent,'Commanding lead');
});

test('dashboard refresh carries alerts, with fallback only when alerts stop arriving',async()=>{
  const intervals=[],requests=[],stored=new Map();
  const element={classList:{add(){},remove(){},toggle(){}},addEventListener(){},setAttribute(){}};
  const document={getElementById:()=>element,querySelectorAll:()=>[]};
  const script=page.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  const context=vm.createContext({document,window:{addEventListener(){}},navigator:{},localStorage:{getItem:key=>stored.get(key)||null,setItem:(key,value)=>stored.set(key,value)},fetch:url=>{
    requests.push(url);
    if(url.startsWith('/api/state'))return new Promise(()=>{});
    return Promise.resolve({ok:true,json:async()=>({alerts:[{id:3}]})});
  },AbortSignal,setInterval:(fn,ms)=>intervals.push({fn,ms})});
  vm.runInContext(script,context);
  assert.match(requests[0],/^\/api\/state\?at=\d+&since=0$/);
  const sounds=[];context.soundProbe=()=>sounds.push('ching');
  vm.runInContext('ching=soundProbe;consumeAlerts([{id:1}]);consumeAlerts([{id:2}])',context);
  assert.deepEqual(sounds,['ching']);
  assert.equal(stored.get('kAlertCursor'),'2');
  await vm.runInContext('pollAlertsFallback()',context);
  assert.equal(requests.length,1);
  vm.runInContext('lastAlertSuccess=Date.now()-6000',context);
  await vm.runInContext('pollAlertsFallback()',context);
  assert.equal(requests[1],'/api/alerts?since=2');
  vm.runInContext('consumeAlerts([{id:3}])',context);
  assert.deepEqual(sounds,['ching','ching']);
  assert.equal(stored.get('kAlertCursor'),'3');
  assert.ok(intervals.some(({ms})=>ms===30000));
  assert.ok(intervals.some(({ms})=>ms===5000));
});

test('a successful dashboard refresh consumes alerts without a separate request',async()=>{
  const requests=[],stored=new Map();
  const element={children:[],classList:{add(){},remove(){},toggle(){}},addEventListener(){},setAttribute(){},replaceChildren(...items){this.children=items}};
  const document={getElementById:()=>element,querySelectorAll:()=>[]};
  const script=page.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  const context=vm.createContext({document,window:{addEventListener(){}},navigator:{},localStorage:{getItem:key=>stored.get(key)||null,setItem:(key,value)=>stored.set(key,value)},fetch:async url=>{
    requests.push(url);
    return {status:200,ok:true,json:async()=>({live:false,exitOnly:false,credentials:false,aiConfigured:false,balance:null,games:[],orders:[],scan:{scanned:0,signals:0},alerts:[{id:8}]})};
  },AbortSignal,setInterval(){}});
  vm.runInContext(script,context);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(stored.get('kAlertCursor'),'8');
  assert.equal(requests.length,1);
  await vm.runInContext('pollAlertsFallback()',context);
  assert.equal(requests.length,1);
});
