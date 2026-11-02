import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {espnMatches,foxMatches,foxPlayerStat,nbaFixtures,verifyIndependentOverDecision} from '../src/score_verification.mjs';
import {alternateCheck} from '../src/alternate_scores.mjs';
import {playerOverSpec} from '../src/strategy.mjs';
import {teamAbbreviationVariants} from '../src/team_identity.mjs';
const fixture=name=>JSON.parse(readFileSync(new URL('fixtures/'+name,import.meta.url),'utf8'));
const captured=fixture('phi-was-verification.json');
const summary=fixture('phi-was-espn-summary.json');
const foxBoard=fixture('phi-was-fox-board.json'),foxBox=fixture('phi-was-fox-box.json');
const market={ticker:'KXNFLRECYDS-26NOV01PHIWAS-WASCOKONKWO85-10',event_ticker:'KXNFLRECYDS-26NOV01PHIWAS',floor_strike:9.5,
  title:'Chig Okonkwo: 10+ receiving yards',yes_sub_title:'Chig Okonkwo: 10+',custom_strike:{football_player:'320ff933-d015-48c1-bc6f-13058dc633f8'}};

test('captured WAS/WSH incident matches the fixture and exact ESPN receiving statistic',async()=>{
  const game=structuredClone(captured.game),urls=[];
  assert.equal(espnMatches(captured.espn,game,captured.milestone).length,1);
  assert.equal(await verifyIndependentOverDecision(game,captured.milestone,{market,fetcher:async url=>{
    urls.push(url);assert.match(url,/espn\.com/);
    return {ok:true,json:async()=>url.includes('/summary?')?summary:captured.espn};
  }}),true);
  assert.ok(urls.some(url=>url.includes('/summary?event=401873035')));
});

test('corrected abbreviations preserve contrary scores, wrong franchises, start times and duplicate vetoes',async()=>{
  const check=(game,board=captured.espn,milestone=captured.milestone)=>verifyIndependentOverDecision(game,milestone,{market,fetcher:async url=>{
    assert.match(url,/espn\.com/);return {ok:true,json:async()=>url.includes('/summary?')?summary:board};
  }});
  assert.equal(await check({...captured.game,home:11}),false);
  const otherStat=structuredClone(captured.game);otherStat.playerStats['320ff933-d015-48c1-bc6f-13058dc633f8'].receiving_yards=12;
  assert.equal(await check(otherStat),false);
  assert.equal(espnMatches(captured.espn,{...captured.game,homeName:'WAS Eagles'},captured.milestone).length,0);
  assert.equal(espnMatches(captured.espn,captured.game,{...captured.milestone,start_date:'2026-11-03T01:20:00Z'}).length,0);
  assert.equal(await check({...captured.game},{events:[...captured.espn.events,...captured.espn.events]}),false);
});

test('FOX discovers the football week and verifies receiving yards when ESPN is unavailable',async()=>{
  const urls=[],game=structuredClone(captured.game);
  assert.equal(foxPlayerStat(foxBox,playerOverSpec(game,market),'11262'),11);
  assert.equal(await verifyIndependentOverDecision(game,captured.milestone,{market,fetcher:async url=>{
    urls.push(url);
    if(url.includes('espn.com'))throw Error('ESPN unavailable');
    assert.match(url,/foxsports\.com/);
    const data=url.includes('/league/scores?')?{currentSelectionId:'2026-8-1'}:
      url.includes('/league/scores-segment/2026-8-1?')?foxBoard:
      url.includes('/event/11262/data?')?foxBox:null;
    assert.ok(data,'only the current provider endpoints are requested');
    return {ok:true,json:async()=>data};
  }}),true);
  assert.ok(urls.some(url=>url.includes('/league/scores-segment/2026-8-1?')));
  assert.equal(foxPlayerStat(foxBox,{...playerOverSpec(game,market),metric:'RUSHYDS'},'11262'),null,'receiving yards cannot verify rushing yards');
  assert.equal(foxPlayerStat(foxBox,playerOverSpec(game,market),'wrong-event'),null);
});

const aliases=[
  ['NBA','GS Warriors','GSW','Warriors'],['NBA','NY Knicks','NYK','Knicks'],['NBA','SA Spurs','SAS','Spurs'],
  ['NBA','NO Pelicans','NOP','Pelicans'],['NBA','PHO Suns','PHX','Suns'],['NBA','WAS Wizards','WSH','Wizards'],['NBA','UTAH Jazz','UTA','Jazz'],
  ['WNBA','NYL Liberty','NY','Liberty'],['WNBA','LAS Sparks','LA','Sparks'],['WNBA','LVA Aces','LV','Aces'],['WNBA','CONN Sun','CON','Sun'],['WNBA','WSH Mystics','WAS','Mystics'],
  ['NFL','WAS Commanders','WSH','Commanders'],['NFL','JAC Jaguars','JAX','Jaguars'],['NFL','LAR Rams','LA','Rams'],
  ['NFL','GNB Packers','GB','Packers'],['NFL','SFO 49ers','SF','49ers'],['NFL','TAM Buccaneers','TB','Buccaneers'],
  ['NFL','LVR Raiders','LV','Raiders'],['NFL','KAN Chiefs','KC','Chiefs'],['NFL','NWE Patriots','NE','Patriots'],['NFL','NOR Saints','NO','Saints'],
  ['MLB','CHW White Sox','CWS','White Sox'],['MLB','KCR Royals','KC','Royals'],['MLB','SDP Padres','SD','Padres'],
  ['MLB','SFG Giants','SF','Giants'],['MLB','TBR Rays','TB','Rays'],['MLB','WSN Nationals','WSH','Nationals'],
  ['MLB','AZ Diamondbacks','ARI','Diamondbacks'],['MLB','OAK Athletics','ATH','Athletics'],
  ['NHL','LA Kings','LAK','Kings'],['NHL','NJ Devils','NJD','Devils'],['NHL','SJ Sharks','SJS','Sharks'],
  ['NHL','TB Lightning','TBL','Lightning'],['NHL','MON Canadiens','MTL','Canadiens'],
  ['CFB','UCONN Huskies','CONN','Huskies'],['CFB','UMASS Minutemen','MASS','Minutemen'],['CFB','SJSU Spartans','SJS','Spartans'],['CFB','NMSU Aggies','NMS','Aggies'],
  ['NCAAB','UCONN Huskies','CONN','Huskies'],['NCAAW','UCONN Huskies','CONN','Huskies']
];
test('league-scoped abbreviation variants work for ESPN and FOX across supported team sports',()=>{
  for(const [sport,expected,code,nickname] of aliases){
    const game={...captured.game,sport,homeName:expected,awayName:'Boston Celtics'};
    const board={events:[{date:captured.milestone.start_date,competitions:[{competitors:[
      {homeAway:'home',team:{abbreviation:code,name:nickname,displayName:code+' '+nickname}},
      {homeAway:'away',team:{displayName:'Boston Celtics'}}]}]}]};
    assert.equal(espnMatches(board,game,captured.milestone).length,1,`${sport}: ${expected}/${code}`);
    for(const variant of teamAbbreviationVariants(expected,sport))assert.equal(espnMatches(board,{...game,homeName:variant},captured.milestone).length,1,`${sport}: ${variant}`);
    const event={eventTime:captured.milestone.start_date,entityLink:{layout:{tokens:{homeUri:'home',awayUri:'away'}}},
      upperTeam:{uri:'away',imageAltText:'Boston Celtics'},lowerTeam:{uri:'home',name:code,longName:nickname}};
    assert.equal(foxMatches({sectionList:[{events:[event]}]},game,captured.milestone).length,1,`${sport}: FOX ${expected}/${code}`);
    assert.equal(espnMatches(board,{...game,homeName:expected+' Rival'},captured.milestone).length,0);
    assert.equal(espnMatches(board,{...game,homeName:code},captured.milestone).length,1,'bare provider code remains usable');
  }
  assert.deepEqual(teamAbbreviationVariants('NYL Liberty','NBA'),['NYL Liberty'],'WNBA codes cannot be borrowed by NBA');
  assert.deepEqual(teamAbbreviationVariants('NO Saints','MLB'),['NO Saints'],'NFL codes cannot be borrowed by baseball');
  assert.equal(espnMatches({events:[{date:captured.milestone.start_date,competitions:[{competitors:[{homeAway:'home',team:{name:'Li'}},{homeAway:'away',team:{name:'Beta'}}]}]}]},
    {...captured.game,homeName:'Li',awayName:'Beta'},captured.milestone).length,0,'unknown two-letter names do not become abbreviation exceptions');
});

test('NBA official, CBS and Yahoo matching reuse the same league-scoped abbreviation normalization',async()=>{
  const game={...captured.game,sport:'NBA',type:'basketball_game',homeName:'WSH Wizards',awayName:'PHO Suns',playerStats:{p:{rebounds:5}}};
  const nba={scoreboard:{games:[{gameId:'0022600001',gameTimeUTC:captured.milestone.start_date,
    homeTeam:{teamCity:'Washington',teamName:'Wizards',teamTricode:'WAS'},awayTeam:{teamCity:'Phoenix',teamName:'Suns',teamTricode:'PHX'}}]}};
  assert.equal(nbaFixtures(nba,game,captured.milestone).length,1);
  const prop={event_ticker:'KXNBAREB-TEST',floor_strike:3.5,yes_sub_title:'John Player: 4+',custom_strike:{basketball_player:'p'}};
  const cbsUrl='https://www.cbssports.com/nba/gametracker/boxscore/NBA_20261101_PHO@WAS/';
  const html=cbsUrl+'<table class="stats-table"><tr><td>Player</td><td>REB</td></tr><tr><td><a href="/nba/players/1/john-player/">J. Player</a></td><td>5</td></tr></table>';
  assert.equal(await alternateCheck('CBS',game,captured.milestone,{market:prop,fetcher:async url=>{assert.equal(url,cbsUrl);return {ok:true,text:async()=>html}}}),true);
  let yahooReached=false;
  assert.equal(await alternateCheck('Yahoo',game,captured.milestone,{market:prop,fetcher:async url=>{yahooReached=true;assert.match(url,/sports\.yahoo\.com\/nba\/scoreboard/);return {ok:true,text:async()=>''}}}),null);
  assert.equal(yahooReached,true,'recognized abbreviation variants reach the independent Yahoo source');
});

test('FOX fallback uses league calendar segments, football week segments and the separate soccer route',async()=>{
  for(const [sport,feed,type,period] of [['NBA','nba','basketball_game',2],['WNBA','wnba','basketball_game',2],
    ['NFL','nfl','football_game',2],['CFB','cfb','football_game',2],['NHL','nhl','hockey_match',3],
    ['MLB','mlb','baseball_game',2],['NCAAB','cbk','basketball_game',2],['Soccer','soccer','soccer_match',2]]){
    const game={...captured.game,sport,type,period,homeName:'Alpha',awayName:'Beta',soccerMinute:75};
    const board={sectionList:[{events:[{eventTime:captured.milestone.start_date,eventStatus:1,statusLine:feed==='soccer'?"75'":`${period}ND 2:31`,
      entityLink:{layout:{tokens:{homeUri:'a',awayUri:'b'}}},upperTeam:{uri:'b',imageAltText:'Beta',score:10},lowerTeam:{uri:'a',imageAltText:'Alpha',score:10}}]}]};
    const urls=[];
    const result=await verifyIndependentOverDecision(game,captured.milestone,{fetcher:async url=>{
      if(!url.includes('foxsports.com'))throw Error('preferred provider unavailable');
      urls.push(url);
      if(url.includes('/league/scores?'))return {ok:true,json:async()=>({currentSelectionId:'2026-8-1'})};
      assert.ok(url.includes(feed==='soccer'?'/soccer/scoreboard/segment/c0d':'/'+feed+'/league/scores-segment/'));
      return {ok:true,json:async()=>board};
    }});
    assert.equal(result,true,sport);assert.ok(urls.length>0);
  }
});

test('missing providers name the failing source and FOX clocks still reject delayed current-period scores',async()=>{
  const game=structuredClone(captured.game);
  assert.equal(await verifyIndependentOverDecision(game,captured.milestone,{market,fetcher:async()=>({ok:false,status:404})}),null);
  assert.match(game.verificationIssue,/ESPN: Scoreboard 404/);assert.match(game.verificationIssue,/FOX Sports: Scoreboard 404/);
  const event=foxBoard.sectionList[0].events[0];
  assert.equal(foxMatches({sectionList:[{events:[{...event,statusLine:'2ND 12:00'}]}]},captured.game,captured.milestone)[0].clockOk,false);
  assert.equal(foxMatches({sectionList:[{events:[{...event,statusLine:'1ST 2:31'}]}]},captured.game,captured.milestone)[0].stale,true);
});
