import test from 'node:test';
import assert from 'node:assert/strict';
import {discoverCurrentMilestones,scanMilestones,eligibleForMarkets,linkedEventTickers,gameTimeLabel,storedClockSeconds,mapBatches} from '../src/discovery.mjs';
import {gameState,overSignal,sportName} from '../src/strategy.mjs';

test('bounded parallel live batches cover every milestone without losing result order',async()=>{
  const ids=Array.from({length:1570},(_,i)=>i);
  const groups=Array.from({length:Math.ceil(ids.length/20)},(_,i)=>ids.slice(i*20,(i+1)*20));
  let active=0,peak=0;
  const results=await mapBatches(groups,12,async(group,i)=>{
    active++;peak=Math.max(peak,active);
    await new Promise(resolve=>setTimeout(resolve,1+i%3));
    active--;
    return group;
  });
  assert.deepEqual(results.flat(),ids);
  assert.equal(peak,12);
});

test('sports discovery traverses pages and includes esports and older live tournaments',async()=>{
  const now=Date.parse('2026-10-30T13:00:00Z'),at=days=>new Date(now+days*86400000).toISOString();
  const requests=[];
  const get=async path=>{
    const query=new URL(path,'https://kalshi.test').searchParams,category=query.get('category'),cursor=query.get('cursor');
    requests.push([category,cursor,query.get('minimum_start_date')]);
    if(category==='Sports'&&!cursor)return {milestones:[{id:'old-golf',start_date:at(-5),end_date:at(1)},
      {id:'finished',start_date:at(-2),end_date:at(-2)},
      {id:'completed-with-future-end',start_date:at(-2),end_date:at(1),details:{status:'completed'}}],cursor:'next'};
    if(category==='Sports'&&cursor==='future')return {milestones:[{id:'later',start_date:at(3)}],cursor:'unused'};
    if(category==='Sports')return {milestones:[{id:'live-baseball',start_date:at(-.1)},
      {id:'upcoming',start_date:at(2)}],cursor:'future'};
    return {milestones:[{id:'live-esports',start_date:at(-.1)}],cursor:''};
  };
  const games=await discoverCurrentMilestones(get,now);
  assert.deepEqual(games.map(m=>m.id),['old-golf','live-baseball','live-esports']);
  assert.deepEqual(requests.map(([category,cursor])=>[category,cursor]).sort(),[['Sports',null],['Sports','next'],['Sports','future'],['Esports',null]].sort());
  assert.ok(requests.every(([, ,min])=>min===at(-7)));
});

test('live scan omits old inactive milestones while retaining active and long-running events',()=>{
  const now=Date.parse('2026-10-31T18:00:00Z'),at=hours=>new Date(now+hours*3600000).toISOString();
  const games=[
    {id:'old-idle',type:'football_game',start_date:at(-72),details:{status:'scheduled'}},
    {id:'new',type:'football_game',start_date:at(-2),details:{status:'scheduled'}},
    {id:'old-inactive',type:'football_game',start_date:at(-12),details:{status:'scheduled'}},
    {id:'long-live',type:'baseball_game',start_date:at(-12),details:{status:'scheduled'}},
    {id:'old-live-flag',type:'football_game',start_date:at(-50),details:{status:'live'}},
    {id:'previously-live',type:'soccer_game',start_date:at(-48),details:{status:'scheduled'}},
    {id:'golf',type:'golf_tournament',start_date:at(-96),details:{status:'scheduled'}},
    {id:'cricket',type:'cricket_match',start_date:at(-96),details:{status:'scheduled'}}
  ];
  assert.deepEqual(scanMilestones(games,new Set(['previously-live','long-live']),now).map(m=>m.id),
    ['new','long-live','previously-live','golf','cricket']);
});

test('find game and both total families from a game-only milestone',()=>{
  const m={type:'basketball_game',related_event_tickers:['KXNBAGAME-26OCT28BOSBKN']};
  const discovered=linkedEventTickers(m);
  assert.ok(discovered.includes('KXNBATOTAL-26OCT28BOSBKN'));
  assert.ok(discovered.includes('KXNBATEAMTOTAL-26OCT28BOSBKN'));
  assert.ok(discovered.includes('KXNBA3QTOTAL-26OCT28BOSBKN'));
  assert.ok(discovered.includes('KXNBA1HTEAMTOTAL-26OCT28BOSBKN'));
  assert.equal(new Set(discovered).size,discovered.length);
  assert.deepEqual(linkedEventTickers({...m,related_event_tickers:[...m.related_event_tickers,'KXNBATOTAL-26OCT28BOSBKN']}),discovered);
});

test('retain actual linked period total markets plus primary winner and tennis match',()=>{
  const m={type:'basketball_game',related_event_tickers:['KXNBA1QGAME-DATE','KXNBASPREAD-DATE','KXNBAGAME-DATE','KXNBA1HTOTAL-DATE'],primary_event_tickers:['KXNBAGAME-DATE'],details:{main_game_event_ticker:'KXNBAGAME-DATE'}};
  const discovered=linkedEventTickers(m);
  assert.deepEqual(discovered.slice(0,4),['KXNBAGAME-DATE','KXNBA1HTOTAL-DATE','KXNBATOTAL-DATE','KXNBATEAMTOTAL-DATE']);
  assert.ok(discovered.includes('KXNBA4QTOTAL-DATE'));
  assert.equal(discovered.filter(t=>t==='KXNBA1HTOTAL-DATE').length,1);
  assert.deepEqual(linkedEventTickers({type:'tennis_tournament_singles',details:{main_game_event_ticker:'KXATPMATCH-DATE'}}),['KXATPMATCH-DATE']);
});
test('retain directly linked player score markets without treating their game score as a player stat',()=>{
  const m={type:'basketball_game',related_event_tickers:['KXNBAGAME-DATE','KXNBAPTS-DATE','KXNBAPRA-DATE','KXNBASPREAD-DATE']};
  const found=linkedEventTickers(m);
  assert.ok(found.includes('KXNBAPTS-DATE'));assert.ok(found.includes('KXNBAPRA-DATE'));
  assert.ok(!found.includes('KXNBASPREAD-DATE'));
});
test('retain linked ATP and WTA full-match game totals',()=>{
  const found=linkedEventTickers({type:'tennis_tournament_singles',related_event_tickers:['KXWTAMATCH-DATE','KXWTAGTOTAL-DATE','KXWTASETWINNER-DATE']});
  assert.ok(found.includes('KXWTAGTOTAL-DATE'));
  assert.ok(!found.includes('KXWTASETWINNER-DATE'));
});
test('esports match event discovers only live exchange-confirmed whole-match total candidates',()=>{
  const tickers=linkedEventTickers({type:'esports_match',related_event_tickers:['KXESOCCMATCH-DATE']});
  assert.ok(tickers.includes('KXESOCCMATCH-DATE'));
  assert.ok(tickers.includes('KXESOCCTOTAL-DATE'));
  assert.ok(tickers.includes('KXESOCCTEAMTOTAL-DATE'));
});
test('limited-over cricket discovers team-run markets from match events without a game clock',()=>{
  const milestone={id:'ipl',type:'cricket_match',title:'Ajman vs Abu Dhabi',details:{league:'IPL'},related_event_tickers:['KXIPLGAME-DATE']};
  const game=gameState(milestone,{details:{status:'live',home_score:170,away_score:0,inning:1}});
  assert.equal(eligibleForMarkets(game),true);
  assert.ok(linkedEventTickers(milestone).includes('KXIPLTEAMTOTAL-DATE'));
  assert.ok(linkedEventTickers({...milestone,related_event_tickers:['KXCPLMATCH-DATE']}).includes('KXCPLTEAMTOTAL-DATE'));
  assert.equal(gameTimeLabel(game),'Innings 1');
  const shield=gameState({...milestone,details:{league:'Sheffield Shield'}},{details:{status:'live',home_score:170,away_score:0,inning:1}});
  assert.equal(eligibleForMarkets(shield),false);
});

test('unsupported feeds keep the scan active but do not fetch markets',()=>{
  const board=(type)=>gameState({id:type,type,title:'Away at Home'},{details:{status:'live',home_score:9,away_score:3}});
  assert.equal(eligibleForMarkets(board('esports_match')),false);
  assert.equal(eligibleForMarkets(board('cricket_match')),false);
  assert.equal(eligibleForMarkets(board('basketball_game')),true);
  assert.equal(sportName({type:'esports_soccer_game'}),'eSoccer');
  assert.equal(sportName({type:'football_game',details:{league:'NCAAFB'}}),'CFB');
  assert.equal(sportName({type:'basketball_game',details:{league:'NCAAW'}}),'NCAAW');
  assert.equal(gameTimeLabel(board('esports_match')),'period scores unavailable');
  assert.equal(gameTimeLabel(board('cricket_match')),'Innings unavailable');
  assert.equal(gameTimeLabel({...board('cricket_match'),period:2}),'Innings 2');
});

test('show verified phase and parsed clock without fabricating remaining time',()=>{
  const m={id:'a',type:'basketball_game',title:'Away at Home'};
  const state=d=>gameState(m,{details:{status:'live',home_score:73,away_score:65,...d}});
  assert.equal(gameTimeLabel(state({quarter:4,period_remaining_time:'1:07'})),'Quarter 4 · 01:07 remaining');
  assert.equal(gameTimeLabel(state({quarter:4,period_remaining_time:'00:09.20',clock_running:false})),'Quarter 4 · 00:09 paused');
  assert.equal(storedClockSeconds(9.2,false),9);
  assert.equal(storedClockSeconds(16.97,true),17);
  assert.equal(storedClockSeconds(NaN),null);
  assert.equal(gameTimeLabel(state({quarter:2,period_remaining_time:'8:22'})),'Quarter 2 · 08:22 remaining');
  assert.equal(gameTimeLabel(state({quarter:4})),'Live clock unavailable');
  assert.equal(gameTimeLabel({...state({}),status:'final'}),'Final');
  assert.equal(gameTimeLabel({type:'soccer_match',matchRemainingSeconds:44,soccerMinute:89.5}),'00:44 match time remaining');
  const over={status:'active',event_ticker:'KXNBATOTAL-DATE',title:'Combined total points over 130.5',rules_primary:'Combined total points scored in the game',floor_strike:130.5,yes_ask_dollars:'0.98'};
  assert.equal(overSignal(state({quarter:4}),over)?.strategy,'over');
  assert.equal(overSignal(state({quarter:4,period_remaining_time:'0:59'}),over)?.strategy,'over');
});

test('table tennis live set points come from period_scores with competitor orientation',()=>{
  const milestone={id:'ping',type:'table_tennis_match',title:'Priakhin Vadim vs Davlitshin Ildar'};
  const details={status:'live',competitor1_is_home:true,competitor1_overall_score:0,competitor2_overall_score:0,period_scores:[{competitor1_score:3,competitor2_score:7,number:1,type:'set'}]};
  const first=gameState(milestone,{details});
  assert.equal(first.home,3);assert.equal(first.away,7);assert.equal(first.scoreKnown,true);
  assert.equal(gameTimeLabel(first),'Set 1 · no countdown clock');
  const reversed=gameState(milestone,{details:{...details,competitor1_is_home:false}});
  assert.equal(reversed.home,7);assert.equal(reversed.away,3);
  assert.equal(eligibleForMarkets(first),true);
  const missing=gameState(milestone,{details:{status:'live',period_scores:[]}});
  assert.equal(missing.scoreKnown,false);
});

test('darts overall scores and esports phase display without an invented clock',()=>{
  const darts=gameState({id:'dart',type:'darts_match',title:'Tricole vs Lovely'},{details:{status:'live',competitor1_is_home:true,competitor1_overall_score:1,competitor2_overall_score:2,match_status:'1st set',period_scores:[]}});
  assert.equal(darts.sport,'Darts');assert.equal(darts.home,1);assert.equal(darts.away,2);
  assert.equal(gameTimeLabel(darts),'1st set · no countdown clock');
  assert.equal(eligibleForMarkets(darts),true);
  const esports=gameState({id:'esports',type:'esports_match',title:'Fede vs Eder',details:{league:'eSoccer'}},{details:{status:'live',home_score:3,away_score:3,period_unit:'half',home_periods:{period_1:3,period_2:0},away_periods:{period_1:2,period_2:1}}});
  assert.equal(gameTimeLabel(esports),'Half 2 · score periods verified');
  assert.equal(esports.scoreKnown,true);assert.equal(eligibleForMarkets(esports),true);
  const bad=gameState({id:'bad',type:'esports_match',details:{league:'eSoccer'}},{details:{status:'live',home_score:4,away_score:3,period_unit:'half',home_periods:{period_1:3,period_2:0},away_periods:{period_1:2,period_2:1}}});
  assert.equal(eligibleForMarkets(bad),false);
});

