import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {page} from '../src/ui.mjs';

test('ask counter excludes watch rows, missing depth, terminal prices, and already-filled signals',async()=>{
  const elements=new Map();
  const element=()=>({children:[],style:{},classList:{add(){},remove(){},toggle(){}},addEventListener(){},setAttribute(){},append(...x){this.children.push(...x)},replaceChildren(...x){this.children=x}});
  const document={getElementById:id=>{if(!elements.has(id))elements.set(id,element());return elements.get(id)},querySelectorAll:()=>[],createElement:element};
  const valid={strategy:'lead',ticker:'M',ask:'.97',ask_size:'60',execution:'Awaiting score verification'};
  const signals=[valid,{...valid,ticker:'N',execution:'Below profit floor'},
    {strategy:'watch',execution:'Tracking'}, {...valid,strategy:'watch'},
    {...valid,ask_size:'0'},{...valid,ask:'1.00'},{...valid,execution:'Already filled'},{...valid,ask_size:undefined}];
  const context=vm.createContext({document,window:{addEventListener(){}},navigator:{},localStorage:{getItem(){return null},setItem(){}},
    fetch:async()=>({ok:true,status:200,json:async()=>({games:[{title:'Game',signals}],orders:[],alerts:[],scan:{}})}),AbortSignal,URLSearchParams,setInterval(){}});
  vm.runInContext(page.match(/<script>([\s\S]*?)<\/script>/)[1],context);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(elements.get('askCount').textContent,2,'a real ask can exist even when a different gate blocks the trade');
  assert.equal(elements.get('gamesCount').textContent,1);
});

test('bankroll displays a recent verified balance with its age status',async()=>{
  const elements=new Map();
  const element=()=>({children:[],style:{},classList:{add(){},remove(){},toggle(){}},addEventListener(){},setAttribute(){},append(...x){this.children.push(...x)},replaceChildren(...x){this.children=x}});
  const document={getElementById:id=>{if(!elements.has(id))elements.set(id,element());return elements.get(id)},querySelectorAll:()=>[],createElement:element};
  const state={games:[],orders:[],alerts:[],scan:{},balance:{balance:1200,portfolio_value:345},
    balanceStale:true,balanceAsOf:'2026-10-31T21:00:00Z',credentials:true};
  const context=vm.createContext({document,window:{addEventListener(){}},navigator:{},localStorage:{getItem(){return null},setItem(){}},
    fetch:async()=>({ok:true,status:200,json:async()=>state}),AbortSignal,URLSearchParams,setInterval(){}});
  vm.runInContext(page.match(/<script>([\s\S]*?)<\/script>/)[1],context);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(elements.get('balance').textContent,'$15.45');
  assert.match(elements.get('connection').textContent,/^Recent · /);
});

test('game summary puts preflight and available-ask counts above other metrics',()=>{
  const names=['Preflight candidates','Signals with an ask','Score rule matches','Catalog milestones discovered','Weather scan'];
  const positions=names.map(name=>page.indexOf('<span>'+name));
  assert.ok(positions.every(position=>position>=0));
  assert.deepEqual([...positions].sort((a,b)=>a-b),positions);
});
test('weather card reports a paused scan without stale candidate counts',async()=>{
  const elements=new Map();
  const element=()=>({children:[],style:{},classList:{add(){},remove(){},toggle(){}},addEventListener(){},setAttribute(){},replaceChildren(...x){this.children=x}});
  const document={getElementById:id=>{if(!elements.has(id))elements.set(id,element());return elements.get(id)},querySelectorAll:()=>[],createElement:element};
  const context=vm.createContext({document,window:{addEventListener(){}},navigator:{},localStorage:{getItem(){return null},setItem(){}},
    fetch:async()=>({ok:true,status:200,json:async()=>({games:[],orders:[],alerts:[],scan:{},weather:{disabled:true,series:209,eligible:46}})}),AbortSignal,URLSearchParams,setInterval(){}});
  vm.runInContext(page.match(/<script>([\s\S]*?)<\/script>/)[1],context);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(elements.get('weatherSeries').textContent,'Paused');
  assert.equal(elements.get('weatherEligible').textContent,'—');
});

test('deferred football cards retain their last check time without claiming a current market scan',()=>{
  assert.match(page,/Market last checked/);
  assert.doesNotMatch(page,/Last seen .* · rechecking/);
});

test('recent live scores remain counted while the market check is delayed',async()=>{
  const elements=new Map();
  const element=()=>({children:[],style:{},classList:{add(){},remove(){},toggle(){}},addEventListener(){},setAttribute(){},append(...x){this.children.push(...x)},replaceChildren(...x){this.children=x}});
  const document={getElementById:id=>{if(!elements.has(id))elements.set(id,element());return elements.get(id)},querySelectorAll:()=>[],createElement:element};
  const game={title:'Live football',sport:'CFB',home:49,away:9,signals:[],stale:true,scoreStale:false,scanned_at:new Date(Date.now()-180000).toISOString()};
  const context=vm.createContext({document,window:{addEventListener(){}},navigator:{},localStorage:{getItem(){return null},setItem(){}},
    fetch:async()=>({ok:true,status:200,json:async()=>({games:[game],orders:[],alerts:[],scan:{}})}),AbortSignal,URLSearchParams,setInterval(){}});
  vm.runInContext(page.match(/<script>([\s\S]*?)<\/script>/)[1],context);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(elements.get('gamesCount').textContent,1);
  assert.equal(elements.get('games').children[0].children[2].textContent.startsWith('Market last checked'),true);
});

test('combo controls show live buy and sell liquidity separately',()=>{
  const element={classList:{add(){},remove(){},toggle(){}},addEventListener(){},setAttribute(){}};
  const document={getElementById:()=>element,querySelectorAll:()=>[],createElement:()=>({children:[],append(...items){this.children.push(...items)}})};
  const context=vm.createContext({document,window:{addEventListener(){}},navigator:{},localStorage:{getItem(){return null},setItem(){}},fetch:()=>new Promise(()=>{}),AbortSignal,setInterval(){}});
  vm.runInContext(page.match(/<script>([\s\S]*?)<\/script>/)[1],context);
  const render=vm.runInContext('order',context);
  const base={strategy:'over',market_ticker:'KXMVE',combo_legs:[{sport:'Soccer',title:'A vs B'},{sport:'Rugby',title:'C vs D'}],
    combo_buy_quote:{price:.78,count:10,max_cost_cents:800},sell_quote:{price:.7,count:4},sell_profit_cents:-50};
  const controls=render(base).children.at(-1).children;
  assert.equal(controls[0].disabled,false);
  assert.match(controls[0].textContent,/Buy more/);
  assert.equal(controls[1].disabled,false);
  assert.match(controls[1].textContent,/Sell/);
  const unavailable=render({...base,combo_buy_quote:null,combo_buy_status:'No YES seller is available',sell_quote:null}).children.at(-1).children;
  assert.equal(unavailable[0].disabled,true);
  assert.match(unavailable[0].className,/combo-unavailable/);
  assert.equal(unavailable[1].disabled,true);
  assert.match(unavailable[1].textContent,/No bid/);
});

test('a filled combo shows each leg’s teams and score, with honest stale and missing labels',()=>{
 const element=()=>({children:[],classList:{add(){},remove(){},toggle(){}},addEventListener(){},setAttribute(){},append(...x){this.children.push(...x)}});
 const document={getElementById:()=>element(),querySelectorAll:()=>[],createElement:element};
 const ctx=vm.createContext({document,window:{addEventListener(){}},navigator:{},localStorage:{getItem(){return null}},fetch:()=>new Promise(()=>{}),AbortSignal,setInterval(){}});
 vm.runInContext(page.match(/<script>([\s\S]*?)<\/script>/)[1],ctx);
 const render=vm.runInContext('order',ctx),at=new Date().toISOString();
 const legs=[{sport:'Soccer',title:'Umea at Sollentuna',score:{away:3,home:0,status:'live',observed_at:at}},
  {sport:'Hockey',title:'Panther vs Grizzlys',home_name:'Panther',away_name:'Grizzlys',score:{away:4,home:1,status:'final',observed_at:at}},
  {sport:'Rugby',title:'C vs D',score:null}];
 const detail=render({strategy:'lead',market_ticker:'COMBO',combo_legs:legs}).children[1].textContent;
 assert.match(detail,/Umea 3 · Sollentuna 0/);
 assert.match(detail,/Final · Panther vs Grizzlys · Grizzlys 4 · Panther 1/);
 assert.match(detail,/C vs D · Score unavailable/);
 const old=render({strategy:'lead',combo_legs:[{...legs[0],score:{...legs[0].score,observed_at:new Date(Date.now()-120000).toISOString()}}]}).children[1].textContent;
 assert.match(old,/Last score · Umea 3 · Sollentuna 0/);
});
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
  assert.equal(gain.textContent,'Sell · +$1.49');
  assert.match(gain.className,/sell-gain/);
  const loss=order({...base,sell_profit_cents:-90}).children.at(-1);
  assert.equal(loss.textContent,'Sell · −$0.90');
  assert.match(loss.className,/sell-loss/);
  assert.equal(order({...base,sell_profit_cents:null}).children.at(-1).textContent,'Sell · 92.0¢');
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
  paintScore(chosen,{...base,sport:'Soccer',sport_family:'soccer_match',strategy:'lead',
    game_title:'Puskas Akademia vs Debreceni',selected_name:'Debreceni',selected_side:'away',
    home_score:1,away_score:3,score_scanned_at:new Date(start).toISOString()},start+91000);
  assert.match(chosen.innerHTML,/Last score · <strong class="chosen-score">Debreceni 3<\/strong> · Puskas Akademia 1/);
  paintScore(chosen,{...base,sport:'Soccer',strategy:'lead',game_title:'Basaksehir vs Samsunspor',
    selected_name:'Basaksehir',selected_side:'home',home_score:3,away_score:1,
    game_status:'inactive',score_scanned_at:new Date(start).toISOString()},start);
  assert.match(chosen.innerHTML,/Last score · <strong class="chosen-score">Basaksehir 3<\/strong> · Samsunspor 1/);

  assert.match(page,/Tennis retains its deciding-set match-clinching service game/);
  const tennis=order({...base,sport:'Tennis',sport_family:'tennis_tournament_singles',game_title:'Berrettini vs de Minaur',strategy:'lead',selected_name:'Alex de Minaur'});
  assert.equal(tennis.children[0].children[0].className,'chosen-name');
  assert.match(tennis.children[0].children[0].textContent,/Alex de Minaur/);
  paintScore(chosen,{...base,sport:'Tennis',sport_family:'tennis_tournament_singles',game_title:'Sonego vs Munar',
    strategy:'lead',selected_name:'Sonego',selected_side:'home',home_score:5,away_score:4,
    score_scanned_at:new Date(start).toISOString()},start);
  assert.match(chosen.innerHTML,/Current set · <strong class="chosen-score">Sonego 5<\/strong> · Munar 4 games/);
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
  assert.equal(over.children.at(-1).ariaLabel,'Sell position');
  assert.equal(over.children.at(-1).disabled,true);
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

test('over ticket offers manual selling only at an available bid with an explicit confirmation',()=>{
  const refresh={classList:{add(){},remove(){},toggle(){}},addEventListener(){},setAttribute(){}};
  const document={getElementById:()=>refresh,querySelectorAll:()=>[],createElement:()=>({children:[],append(...items){this.children.push(...items)}})};
  const confirmations=[];const context=vm.createContext({document,window:{addEventListener(){}},navigator:{},localStorage:{getItem(){return null},setItem(){}},fetch:()=>new Promise(()=>{}),AbortSignal,setInterval(){},confirm:message=>{confirmations.push(message);return false}});
  vm.runInContext(page.match(/<script>([\s\S]*?)<\/script>/)[1],context);
  const order=vm.runInContext('order',context),overReadout=vm.runInContext('overReadout',context);
  const prop={strategy:'over',sport:'Basketball',game_title:'HOU Rockets at DAL Mavericks',reason:'6 REB by Fred VanVleet; line 5.5 already passed',game_status:'live',score_scanned_at:new Date().toISOString(),home_score:114,away_score:111,sell_quote:{count:29,price:.12},sell_profit_cents:-2461};
  assert.equal(overReadout(prop),'OVER TICKET · Fred VanVleet: 6 REB recorded at entry · contract line 5.5');
  const row=order(prop);
  assert.equal(row.children.at(-1).ariaLabel,'Sell position');
  assert.equal(row.children.at(-1).disabled,false);
  assert.match(row.children.at(-1).textContent,/\$24\.61/);
  row.children.at(-1).onclick();
  assert.match(confirmations[0],/Are you sure you want to sell this OVER/);
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
  assert.equal(elements.get('orders').children[0].children.at(-1).textContent,'Sell · +$1.49');
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


test('sell quote refresh covers every filled card beyond the first twenty and exposes failures',async()=>{
 const elements=new Map(),requests=[];
 const element=()=>({children:[],style:{},classList:{add(){},remove(){},toggle(){}},addEventListener(){},setAttribute(){},append(...x){this.children.push(...x)},replaceChildren(...x){this.children=x}});
 const document={getElementById:id=>{if(!elements.has(id))elements.set(id,element());return elements.get(id)},querySelectorAll:()=>[],createElement:element};
 const context=vm.createContext({document,window:{addEventListener(){}},navigator:{},localStorage:{getItem(){return null}},AbortSignal,URLSearchParams,setInterval(){},
  fetch:async url=>{if(!url.startsWith('/api/sell-quotes'))return new Promise(()=>{});requests.push(url);const tickers=new URL(url,'https://k.test').searchParams.getAll('ticker');return {ok:true,json:async()=>({quotes:tickers.map(ticker=>({ticker,sell_quote:{price:.9,count:1},sell_profit_cents:-10}))})}}});
 vm.runInContext(page.match(/<script>([\s\S]*?)<\/script>/)[1],context);
 await vm.runInContext("currentOrders=Array.from({length:25},(_,i)=>({market_ticker:'M'+i,strategy:'over',sport:'NBA'}));refreshSellQuotes()",context);
 assert.equal(requests.length,2);assert.equal(elements.get('orders').children.length,25);
 assert.equal(elements.get('orders').children.at(-1).children.at(-1).disabled,false);
 assert.equal(elements.get('orders').children.at(-1).children.at(-1).textContent,'Sell · −$0.10');
});
