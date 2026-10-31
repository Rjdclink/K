import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {page} from '../src/ui.mjs';

test('game list prioritizes preflights then available asks in descending counts',()=>{
  const element={classList:{add(){},remove(){},toggle(){}},addEventListener(){},setAttribute(){}};
  const document={getElementById:()=>element,querySelectorAll:()=>[],createElement:()=>({children:[],append(...items){this.children.push(...items)}})};
  const context=vm.createContext({document,window:{addEventListener(){}},navigator:{},localStorage:{getItem(){return null},setItem(){}},fetch:()=>new Promise(()=>{}),AbortSignal,setInterval(){}});
  vm.runInContext(page.match(/<script>([\s\S]*?)<\/script>/)[1],context);
  const compare=vm.runInContext('compareGames',context),render=vm.runInContext('item',context);
  const ask=(price,execution='Waiting 10 seconds')=>({title:'Market',ask:String(price),ask_size:'10',execution});
  const noAsk={title:'No ask',execution:'No ask liquidity'};
  const games=[
    {title:'No asks',signals:[noAsk,noAsk,noAsk]},
    {title:'One ask',signals:[ask(.75),noAsk]},
    {title:'Two asks',signals:[ask(.75),ask(.80)]},
    {title:'One preflight',signals:[ask(.85,'Awaiting score verification')]},
    {title:'Two preflights',signals:[ask(.85,'Awaiting score verification'),ask(.88,'Eligible for final verification')]}
  ];
  assert.deepEqual(games.sort(compare).map(g=>g.title),['Two preflights','One preflight','Two asks','One ask','No asks']);
  const mixed={title:'Mixed',sport:'Soccer',away:1,home:2,time_left:'4 minutes',signals:[noAsk,ask(.60),ask(.80,'Awaiting score verification'),ask(.90)]};
  const shown=render(mixed).children.slice(2).map(c=>c.textContent);
  assert.match(shown[0],/80¢ ask/);
  assert.match(shown[1],/90¢ ask/);
  assert.match(shown[2],/60¢ ask/);
  assert.match(shown[3],/No ask liquidity/);
});

test('crossed player props show the actual statistic, ask, and execution blocker',()=>{
  const element={classList:{add(){},remove(){},toggle(){}},addEventListener(){},setAttribute(){}};
  const document={getElementById:()=>element,querySelectorAll:()=>[],createElement:()=>({children:[],append(...items){this.children.push(...items)}})};
  const context=vm.createContext({document,window:{addEventListener(){}},navigator:{},localStorage:{getItem(){return null},setItem(){}},fetch:()=>new Promise(()=>{}),AbortSignal,setInterval(){}});
  vm.runInContext(page.match(/<script>([\s\S]*?)<\/script>/)[1],context);
  const make=vm.runInContext('propItem',context);
  const row=make({title:'Cleveland at Atlanta'},{ticker:'KXNBAREB-26OCT29-PLAYER-4',title:'Okongwu over 3.5 rebounds',reason:'4 REB; line 3.5 already passed',ask:'0.9800',ask_size:'25.00',execution:'Awaiting independent score confirmation'});
  assert.equal(row.children[0].textContent,'Okongwu over 3.5 rebounds');
  assert.match(row.children[1].textContent,/4 REB; line 3.5 already passed/);
  assert.match(row.children[2].textContent,/98.00¢ ask · 25 available · Awaiting independent score confirmation/);
  assert.match(page,/id="props"/);
});

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
  assert.match(page,/Tennis: <strong>5–4 or 6–5<\/strong>/);
  const tennis=order({...base,sport:'Tennis',sport_family:'tennis_tournament_singles',game_title:'Berrettini vs de Minaur',strategy:'lead',selected_name:'Alex de Minaur'});
  assert.equal(tennis.children[0].children[0].className,'chosen-name');
  assert.match(tennis.children[0].children[0].textContent,/Alex de Minaur/);
  const soccer=order({...base,sport:'Soccer',game_title:'Metz vs Pau',strategy:'lead',selected_name:'Pau'});
  assert.equal(soccer.children[0].children[0].textContent,'Pau');
  const cricket={...base,sport:'ODI (M)',sport_family:'cricket_match',game_title:'United Arab Emirates vs Netherlands',
    strategy:'lead',reason:'Restricted 20% cricket final innings 2; verified match totals 9–263 runs (254 ahead)',
    home_score:136,away_score:263,score_scanned_at:new Date(start).toISOString()};
  const cricketRow=order(cricket);
  assert.equal(cricketRow.children[0].children[0].textContent,'Netherlands');
  paintScore(chosen,cricket,start);
  assert.match(chosen.innerHTML,/Away <strong class="chosen-score">263<\/strong> · Home 136/);
  const propBase={...base,sport:'Basketball',sport_family:'basketball_game',strategy:'over',game_title:'CHA Hornets at WAS Wizards',market_ticker:'KXNBASTL-26OCT30CHAWAS-WASKGEORGE18-1',reason:'1 STL by Kyshawn George; line 0.5 already passed',score_scanned_at:new Date(start).toISOString()};
  const homeProp=order(propBase);
  assert.equal(homeProp.children[0].textContent,'Basketball · OVER · Kyshawn George 1+ STL');
  assert.match(homeProp.children[3].textContent,/OVER TICKET · Kyshawn George: 1 STL recorded at entry · contract line 0.5/);
  assert.equal(homeProp.children[1].children[1].textContent,'WAS Wizards');
  assert.equal(homeProp.children[1].children[1].className,'chosen-name');
  const overScore={};paintScore(overScore,propBase,start);
  assert.equal(overScore.textContent,'Game score (context only) · Away 71 · Home 79');
  assert.equal(overScore.innerHTML,undefined);
  const awayProp={...propBase,market_ticker:'KXNBASTL-26OCT30CHAWAS-CHANREID0-1',reason:'1 STL by Naz Reid; line 0.5 already passed'};
  assert.equal(order(awayProp).children[1].children[1].textContent,'CHA Hornets');
  paintScore(overScore,awayProp,start);
  assert.equal(overScore.textContent,'Game score (context only) · Away 71 · Home 79');
  const abbreviated={...propBase,game_title:'NY Knicks at CHI Bulls',market_ticker:'KXNBAAST-26OCT28NYKCHI-CHICWILSON8-4'};
  assert.equal(order(abbreviated).children[1].children[1].textContent,'CHI Bulls');
  const shortAway={...propBase,game_title:'GS Warriors at MIN Timberwolves',market_ticker:'KXNBAREB-26OCT28GSWMIN-GSWDGREEN23-8'};
  assert.equal(order(shortAway).children[1].children[1].textContent,'GS Warriors');
  paintScore(overScore,shortAway,start);
  assert.equal(overScore.textContent,'Game score (context only) · Away 71 · Home 79');
  const unknownProp={...propBase,market_ticker:'KXNBASTL-26OCT30CHAWAS-OTHERPLAYER-1'};
  assert.match(order(unknownProp).children[1].textContent,/^CHA Hornets at WAS Wizards/);
  paintScore(overScore,unknownProp,start);
  assert.equal(overScore.textContent,'Game score (context only) · Away 71 · Home 79');
  assert.equal(order({...propBase,reason:'90 scored; line 80.5 already passed'}).children[1].textContent,'CHA Hornets at WAS Wizards');
  assert.match(page,/\.chosen-name\{color:#26f5ae/);
  assert.doesNotMatch(page,/Combination unavailable: Kalshi has no all-YES collection for these held legs/);
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
  assert.match(over.children[3].textContent,/OVER TICKET · Live combined total 2 goals · contract line 1.5/);
  assert.equal(over.children.at(-1).textContent,'OVER ticket · manual selling disabled');
  assert.ok(!over.children.some(el=>el.ariaLabel==='Sell position'));
  assert.ok(!over.children.some(el=>String(el.textContent||'').includes('KXDFBPOKALTOTAL')));
  assert.equal(overDescription({...live,home_score:1}).detail,'Hamburg vs Frankfurt · 1.5 goals above the line');
  const team=order({...live,market_ticker:'KXNHLTEAMTOTAL-26OCT27CBJPHI-PHI2',sport:'Hockey',sport_family:'hockey_match',reason:'2 scored by Philadelphia; line 1.5 already passed',game_title:'Columbus at Philadelphia',home_score:2,away_score:3});
  assert.equal(team.children[0].textContent,'Hockey · Philadelphia over 1.5 goals');
  assert.equal(team.children[1].textContent,'Columbus at Philadelphia · team total');
  const cricket=order({...live,sport:'Baseball',sport_family:'baseball_game',reason:'Boston has 6 runs; team total 5.5 crossed'});
  assert.equal(cricket.children[0].textContent,'Baseball · Boston over 5.5 runs');
  assert.match(cricket.children[3].textContent,/Boston: 6 runs recorded at entry · contract line 5.5/);
  assert.equal(overDescription({...live,score_scanned_at:new Date(0).toISOString()}).detail,'Hamburg vs Frankfurt');
  const lead=order({...live,market_ticker:'KXFIBAECUPGAME-...',sport:'FIBA Europe Cup',sport_family:'basketball_game',strategy:'lead',game_title:'BK Levicki Patrioti at CS Dinamo Bucuresti'});
  assert.equal(lead.children[0].textContent,'Basketball · BK Levicki Patrioti at CS Dinamo Bucuresti');
  assert.equal(lead.children[1].textContent,'Commanding lead');
});

test('over ticket shows the contract and has no manual sell control',()=>{
  const refresh={classList:{add(){},remove(){},toggle(){}},addEventListener(){},setAttribute(){}};
  const document={getElementById:()=>refresh,querySelectorAll:()=>[],createElement:()=>({children:[],append(...items){this.children.push(...items)}})};
  const context=vm.createContext({document,window:{addEventListener(){}},navigator:{},localStorage:{getItem(){return null},setItem(){}},fetch:()=>new Promise(()=>{}),AbortSignal,setInterval(){}});
  vm.runInContext(page.match(/<script>([\s\S]*?)<\/script>/)[1],context);
  const order=vm.runInContext('order',context),overReadout=vm.runInContext('overReadout',context);
  const prop={strategy:'over',sport:'Basketball',game_title:'HOU Rockets at DAL Mavericks',reason:'6 REB by Fred VanVleet; line 5.5 already passed',game_status:'live',score_scanned_at:new Date().toISOString(),home_score:114,away_score:111,sell_quote:{count:29,price:.12},sell_profit_cents:-2461};
  assert.equal(overReadout(prop),'OVER TICKET · Fred VanVleet: 6 REB recorded at entry · contract line 5.5');
  const row=order(prop);
  assert.equal(row.children.at(-1).textContent,'OVER ticket · manual selling disabled');
  assert.ok(!row.children.some(el=>el.ariaLabel==='Sell position'));
  assert.ok(!row.children.some(el=>String(el.textContent||'').includes('$24.61')));
  assert.match(overReadout({...prop,reason:'225 scored; line 207.5 already passed'}),/Live combined total 225 points · contract line 207.5/);
  assert.match(overReadout({...prop,reason:'225 scored; line 207.5 already passed',score_scanned_at:new Date(0).toISOString()}),/225 points recorded at entry · contract line 207.5/);
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
  assert.ok(intervals.some(({ms})=>ms===10000));
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
  },AbortSignal,URLSearchParams,setInterval(){}});
  vm.runInContext(script,context);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(stored.get('kAlertCursor'),'8');
  assert.equal(requests.length,1);
  await vm.runInContext('pollAlertsFallback()',context);
  assert.equal(requests.length,1);
});

test('dashboard renders positions before delayed sell quotes and updates them afterward',async()=>{
  const elements=new Map(),requests=[];
  const element=()=>({children:[],style:{},classList:{add(){},remove(){},toggle(){}},addEventListener(){},setAttribute(){},append(...items){this.children.push(...items)},replaceChildren(...items){this.children=items}});
  const document={getElementById:id=>{if(!elements.has(id))elements.set(id,element());return elements.get(id)},querySelectorAll:()=>[],createElement:element};
  let releaseQuote;
  const quote=new Promise(resolve=>{releaseQuote=resolve});
  const context=vm.createContext({document,window:{addEventListener(){}},navigator:{},localStorage:{getItem(){return null},setItem(){}},fetch:url=>{
    requests.push(url);
    if(url.startsWith('/api/sell-quotes'))return quote;
    return Promise.resolve({ok:true,status:200,json:async()=>({live:false,exitOnly:false,credentials:false,aiConfigured:false,balance:null,games:[],orders:[{market_ticker:'M',strategy:'lead',sport:'Soccer',reason:'Home leads 2–0',game_title:'Away vs Home'}],scan:{scanned:0,signals:0},alerts:[]})});
  },AbortSignal,URLSearchParams,setInterval(){}});
  vm.runInContext(page.match(/<script>([\s\S]*?)<\/script>/)[1],context);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(elements.get('orders').children.length,1,JSON.stringify({error:elements.get('error')?.textContent,requests}));
  assert.equal(elements.get('orders').children[0].children.at(-1).disabled,true);
  assert.equal(requests.filter(url=>url.startsWith('/api/sell-quotes')).length,1);
  releaseQuote({ok:true,json:async()=>({quotes:[{ticker:'M',sell_quote:{count:10,price:.92},sell_profit_cents:149}]})});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(elements.get('orders').children[0].children.at(-1).disabled,false);
  assert.equal(elements.get('orders').children[0].children.at(-1).textContent,'↗ +$1.49');
});

test('a temporary positions timeout keeps the last displayed filled order',async()=>{
  const elements=new Map();let calls=0;
  const element=()=>({children:[],style:{},classList:{add(){},remove(){},toggle(){}},addEventListener(){},setAttribute(){},append(...items){this.children.push(...items)},replaceChildren(...items){this.children=items}});
  const document={getElementById:id=>{if(!elements.has(id))elements.set(id,element());return elements.get(id)},querySelectorAll:()=>[],createElement:element};
  const context=vm.createContext({document,window:{addEventListener(){}},navigator:{},localStorage:{getItem(){return null},setItem(){}},fetch:url=>{
    if(url.startsWith('/api/sell-quotes'))return Promise.resolve({ok:true,json:async()=>({quotes:[]})});
    calls++;
    return Promise.resolve({ok:true,status:200,json:async()=>({live:false,exitOnly:false,credentials:true,aiConfigured:false,balance:null,games:[],orders:calls===1?[{market_ticker:'M',strategy:'lead',sport:'Soccer',reason:'Home leads',game_title:'Away vs Home',potential_profit_cents:25}]:[],positionsError:calls===2?'Live positions delayed':null,scan:{scanned:0,signals:0},alerts:[]})});
  },AbortSignal,URLSearchParams,setInterval(){}});
  vm.runInContext(page.match(/<script>([\s\S]*?)<\/script>/)[1],context);
  await new Promise(resolve=>setImmediate(resolve));
  await vm.runInContext('load()',context);
  assert.equal(elements.get('ordersCount').textContent,1);
  assert.equal(elements.get('orders').children.length,1);
  assert.equal(elements.get('ordersProfit').textContent,'$0.25');
});

test('filled card sums possible net profit across open positions and refreshes after settlement',async()=>{
  const elements=new Map();let calls=0;
  const element=()=>({children:[],style:{},classList:{add(){},remove(){},toggle(){}},addEventListener(){},setAttribute(){},append(...items){this.children.push(...items)},replaceChildren(...items){this.children=items}});
  const document={getElementById:id=>{if(!elements.has(id))elements.set(id,element());return elements.get(id)},querySelectorAll:()=>[],createElement:element};
  const held=[{market_ticker:'A',strategy:'lead',sport:'Soccer',game_title:'A vs B',potential_profit_cents:110},{market_ticker:'B',strategy:'over',sport:'Soccer',game_title:'C vs D',potential_profit_cents:104}];
  const context=vm.createContext({document,window:{addEventListener(){}},navigator:{},localStorage:{getItem(){return null},setItem(){}},fetch:url=>{
    if(url.startsWith('/api/sell-quotes'))return Promise.resolve({ok:true,json:async()=>({quotes:[]})});
    calls++;
    return Promise.resolve({ok:true,status:200,json:async()=>({live:false,exitOnly:false,credentials:true,aiConfigured:false,balance:null,games:[],orders:calls===1?held:held.slice(0,1),comboIssue:calls===1?{status:'insufficient_cash',detail:'Only $0.03 available cash; this scanner needs at least $1.00',checked_at:new Date().toISOString(),leg_names:['A vs B','C vs D']}:null,scan:{scanned:0,signals:0},alerts:[]})});
  },AbortSignal,URLSearchParams,setInterval(){}});
  assert.match(page,/Total possible profit/);
  assert.match(page,/profit-summary/);
  vm.runInContext(page.match(/<script>([\s\S]*?)<\/script>/)[1],context);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(elements.get('ordersCount').textContent,2);
  assert.equal(elements.get('ordersProfit').textContent,'$2.14');
  assert.match(elements.get('comboIssue').textContent,/Combination cash unavailable: Only \$0\.03 available cash/);
  await vm.runInContext('load()',context);
  assert.equal(elements.get('ordersCount').textContent,1);
  assert.equal(elements.get('ordersProfit').textContent,'$1.10');
});

