import { alternateCheck } from './alternate_scores.mjs';
// ESPN and FOX publish the scoreboards used by their sites. These endpoints
// are not contractual data APIs; a changed schema or unavailable fixture must
// fail closed, never silently turn into permission to buy an over.
import { periodValue, playerOverSpec } from './strategy.mjs';
const FOX_KEY='jE7yBJVRNAwdDesMgTzTXUUSx1It41Fq'; // Public key in foxsports.com scoreboard URLs.
const clean=s=>String(s||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/&/g,' and ').replace(/[^a-z0-9]/g,'');
const score=v=>v===null||v===undefined||v===''?NaN:Number(v);
const dateKey=ms=>new Date(ms).toISOString().slice(0,10).replaceAll('-','');
const dateCandidates=ms=>{
  const hour=new Date(ms).getUTCHours();
  const days=[ms];
  if(hour<6)days.push(ms-86400000);
  if(hour>=21)days.push(ms+86400000);
  return days.map(dateKey);
};

function feeds(game){
  if(/soccer/.test(game.type))return {espn:'soccer/all',fox:'soccer'};
  if(/^tennis_/.test(game.type))return /^(?:ATP|WTA)$/i.test(game.tour)?{espn:`tennis/${game.tour.toLowerCase()}`,fox:null}:{espn:null,fox:null};
  const league=game.sport;
  const supported={NBA:['basketball/nba','nba'],WNBA:['basketball/wnba','wnba'],NCAAB:['basketball/mens-college-basketball','cbk'],NCAAW:['basketball/womens-college-basketball',null],NFL:['football/nfl','nfl'],CFB:['football/college-football','cfb'],NHL:['hockey/nhl','nhl'],MLB:['baseball/mlb','mlb']};
  const [espn,fox]=supported[league]||[];
  return {espn,fox};
}
function expectedNames(game,milestone){
  const title=String(milestone.title||'');
  const at=title.split(/\s+at\s+/i),versus=title.split(/\s+vs\.?\s+/i);
  const fallback=at.length===2?{away:at[0],home:at[1]}:versus.length===2?{home:versus[0],away:versus[1]}:{};
  // The live feed sometimes omits names; use the milestone title only when
  // its home/away order is explicit.
  return {home:game.homeName||fallback.home||'',away:game.awayName||fallback.away||''};
}
function sameTeam(expected,aliases){
  const key=clean(expected);
  const alias={NOP:'NO',NYK:'NY',GSW:'GS',SAS:'SA',PHX:'PHO'};
  // Kalshi NHL milestones often use only a city, while ESPN/FOX append the
  // franchise. Map explicitly to avoid matching two clubs from one city.
  const hockey={Carolina:'Carolina Hurricanes',Columbus:'Columbus Blue Jackets',Dallas:'Dallas Stars',Montreal:'Montreal Canadiens',
    Minnesota:'Minnesota Wild','New York I':'New York Islanders','New York R':'New York Rangers',Pittsburgh:'Pittsburgh Penguins',
    Utah:'Utah Mammoth','St. Louis':'St Louis Blues',Boston:'Boston Bruins','Tampa Bay':'Tampa Bay Lightning',Winnipeg:'Winnipeg Jets'};
  const soccer={'Atletico Mineiro':'Atletico MG'};
  const parts=String(expected||'').match(/^([A-Z]{2,3})\s+(.+)$/);
  const alternate=parts&&alias[parts[1]]?clean(alias[parts[1]]+' '+parts[2]):null;
  const franchise=hockey[expected]?clean(hockey[expected]):soccer[expected]?clean(soccer[expected]):null;
  return key.length>=3 && aliases.some(name=>clean(name)===key||alternate&&clean(name)===alternate||franchise&&clean(name)===franchise);
}
function teamAliases(t,fox=false){
  if(fox)return [t?.imageAltText,t?.longName,t?.stackedNameBottom,`${t?.name||''} ${t?.longName||''}`,`${t?.stackedNameTop||''} ${t?.stackedNameBottom||''}`];
  return [t?.displayName,t?.shortDisplayName,t?.name,`${t?.abbreviation||''} ${t?.name||''}`,`${t?.location||''} ${t?.name||''}`];
}
function clockCompatible(game,period,clock){
  if(Number.isFinite(game.period)&&Number.isFinite(Number(period))&&Number(period)>0&&game.period!==Number(period))return false;
  if(/soccer/.test(game.type)){
    const minute=Number(String(clock||'').match(/^(\d{1,3})/)?.[1]);
    return !Number.isFinite(game.soccerMinute)||!Number.isFinite(minute)||Math.abs(game.soccerMinute-minute)<=5;
  }
  const parts=String(clock||'').match(/^(\d{1,2}):(\d{2})$/);
  return !Number.isFinite(game.remainingSeconds)||!parts||Math.abs(game.remainingSeconds-Number(parts[1])*60-Number(parts[2]))<=180;
}
function sameFixture(game,milestone,home,away,time){
  const names=expectedNames(game,milestone),start=Date.parse(milestone.start_date||'');
  const other=Date.parse(time||'');
  return Number.isFinite(start)&&Number.isFinite(other)&&Math.abs(start-other)<=3*3600000&&
    sameTeam(names.home,home)&&sameTeam(names.away,away);
}
export function espnMatches(data,game,milestone){
  if(!Array.isArray(data?.events))return [];
  return data.events.flatMap(e=>{
    const c=e.competitions?.[0],home=c?.competitors?.find(t=>t.homeAway==='home'),away=c?.competitors?.find(t=>t.homeAway==='away');
    if(!home||!away||!sameFixture(game,milestone,teamAliases(home.team),teamAliases(away.team),e.date))return [];
    const status=c.status||e.status;
    const periods=(home.linescores||[]).map((part,i)=>({number:i+1,home:score(part.value),away:score(away.linescores?.[i]?.value)}));
    return [{source:'ESPN',eventId:e.id,home:score(home.score),away:score(away.score),periods,live:status?.type?.state==='in',clockOk:clockCompatible(game,status?.period,status?.displayClock)}];
  });
}
export function tennisMatches(data,game,milestone){
  if(!Array.isArray(data?.events))return [];
  const names=expectedNames(game,milestone);
  const nameMatches=(expected,actual)=>{
    const key=clean(expected),full=clean(actual);
    return key.length>=4&&(full===key||full.endsWith(key));
  };
  return data.events.flatMap(e=>(e.groupings||[]).flatMap(group=>(group.competitions||[]).flatMap(c=>{
    const first=c.competitors?.find(x=>x.homeAway==='home'),second=c.competitors?.find(x=>x.homeAway==='away');
    const firstName=first?.athlete?.displayName||first?.roster?.displayName;
    const secondName=second?.athlete?.displayName||second?.roster?.displayName;
    const start=Date.parse(milestone.start_date||''),time=Date.parse(c.date||'');
    if(!first||!second||!Number.isFinite(start)||!Number.isFinite(time)||Math.abs(start-time)>3*3600000||
      !nameMatches(names.home,firstName)||!nameMatches(names.away,secondName))return [];
    const homeSets=(first.linescores||[]).map(part=>score(part.value)),awaySets=(second.linescores||[]).map(part=>score(part.value));
    if(!homeSets.length||homeSets.length!==awaySets.length||[...homeSets,...awaySets].some(n=>!Number.isInteger(n)||n<0||n>7))return [];
    return [{source:'ESPN',home:homeSets.at(-1),away:awaySets.at(-1),totalGames:[...homeSets,...awaySets].reduce((a,b)=>a+b,0),live:c.status?.type?.state==='in',clockOk:true}];
  })));
}
export function tableTennisMatches(data,game,milestone){
  if(!Array.isArray(data?.events))return [];
  const names=expectedNames(game,milestone),start=Date.parse(milestone.start_date||'');
  return data.events.flatMap(e=>{
    const time=Number(e.startTimestamp)*1000;
    if(!Number.isFinite(start)||!Number.isFinite(time)||Math.abs(start-time)>3*3600000||
      !sameTeam(names.home,[e.homeTeam?.name])||!sameTeam(names.away,[e.awayTeam?.name]))return [];
    const set=game.tableTennis?.setNumber;
    const home=score(e.homeScore?.['period'+set]),away=score(e.awayScore?.['period'+set]);
    return [{home,away,homeSets:score(e.homeScore?.current),awaySets:score(e.awayScore?.current),live:e.status?.type==='inprogress'}];
  });
}
export async function verifyIndependentTableTennisLead(game,milestone,{fetcher=fetch}={}){
  if(!game.tableTennis||![3,5,7].includes(game.tableTennis.setNumber)||!game.verifiedLive)return false;
  const start=Date.parse(milestone.start_date||'');
  if(!Number.isFinite(start))return false;
  try{
    const dates=dateCandidates(start).map(s=>`${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6)}`);
    const results=await Promise.allSettled(dates.map(day=>json(`https://www.sofascore.com/api/v1/sport/table-tennis/scheduled-events/${day}`,fetcher)));
    const seen=new Set(),matches=[];
    for(const r of results.filter(r=>r.status==='fulfilled')){
      const found=tableTennisMatches(r.value,game,milestone),key=JSON.stringify(found);
      if(!seen.has(key)){seen.add(key);matches.push(...found)}
    }
    if(matches.length!==1)return false;
    const m=matches[0];
    return m.live&&m.home===game.home&&m.away===game.away&&
      m.homeSets===(game.tableTennis.firstIsHome?game.tableTennis.firstSets:game.tableTennis.secondSets)&&
      m.awaySets===(game.tableTennis.firstIsHome?game.tableTennis.secondSets:game.tableTennis.firstSets);
  }catch{return false}
}
export async function verifyIndependentTableTennisMatch(game,milestone,{fetcher=fetch}={}){
  const t=game.tableTennis,start=Date.parse(milestone.start_date||'');
  if(!t||!Number.isFinite(start)||!game.verifiedLive||!Number.isInteger(t.setNumber))return false;
  try{
    const dates=dateCandidates(start).map(s=>`${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6)}`);
    const data=await Promise.allSettled(dates.map(day=>json(`https://www.sofascore.com/api/v1/sport/table-tennis/scheduled-events/${day}`,fetcher)));
    const matches=data.filter(r=>r.status==='fulfilled').flatMap(r=>tableTennisMatches(r.value,game,milestone));
    const unique=[...new Map(matches.map(m=>[JSON.stringify(m),m])).values()];
    return unique.length===1&&unique[0].live&&unique[0].home===game.home&&unique[0].away===game.away&&
      unique[0].homeSets===(t.firstIsHome?t.firstSets:t.secondSets)&&
      unique[0].awaySets===(t.firstIsHome?t.secondSets:t.firstSets);
  }catch{return false}
}
export function foxMatches(data,game,milestone){
  if(!Array.isArray(data?.sectionList))return [];
  return data.sectionList.flatMap(section=>(section.events||[]).flatMap(e=>{
    // The visual row order varies by sport; use the explicit team URIs.
    const homeUri=e.entityLink?.layout?.tokens?.homeUri,awayUri=e.entityLink?.layout?.tokens?.awayUri;
    const teams=[e.upperTeam,e.lowerTeam];
    const home=teams.find(t=>homeUri&&t?.uri===homeUri),away=teams.find(t=>awayUri&&t?.uri===awayUri);
    if(!homeUri||!awayUri||homeUri===awayUri||home===away)return [];
    if(!home||!away||!sameFixture(game,milestone,teamAliases(home,true),teamAliases(away,true),e.eventTime))return [];
    const eventId=String(e.entityLink?.layout?.tokens?.id||'');
    const endOfPeriod=String(e.statusLine||'').match(/\bEND\s+(\d+)(?:ST|ND|RD|TH)\b/i);
    const reportedPeriod=endOfPeriod?Number(endOfPeriod[1]):NaN;
    // A source still showing the previous period cannot veto an exact,
    // current independent scoreboard. A disagreement in the current period
    // remains a veto.
    return [{source:'FOX Sports',eventId:/^\d+$/.test(eventId)?eventId:null,home:score(home.score),away:score(away.score),live:e.eventStatus===1,clockOk:clockCompatible(game,reportedPeriod,e.statusLine),stale:Number.isFinite(game.period)&&Number.isFinite(reportedPeriod)&&reportedPeriod<game.period}];
  }));
}
export function scoreAgreement(game,bySource,market){
  const segment=String(market?.event_ticker||'').split('-')[0].match(/([1-9])(?:Q|P|H|INNING)(?:TEAM)?TOTAL$/);
  const tennisTotal=/^KX(?:ATP|WTA)GTOTAL$/.test(String(market?.event_ticker||'').split('-')[0]);
  let agrees=0;
  for(const matches of bySource){
    if(matches.length>1)return false; // Ambiguous fixture identity.
    if(!matches.length)continue;
    const m=matches[0];
    if(!m.live||!m.clockOk||!Number.isInteger(m.home)||!Number.isInteger(m.away)||m.home!==game.home||m.away!==game.away)return false;
    if(tennisTotal&&(!Number.isInteger(m.totalGames)||m.totalGames!==game.tennisTotal))return false;
    if(segment){
      const expected=periodValue(game,market);
      const actual=periodValue({type:game.type,sport:game.sport,periodScores:m.periods},market);
      if(!expected||!actual||actual.home!==expected.home||actual.away!==expected.away)continue;
    }
    agrees++;
  }
  return agrees>=1;
}
export function playerStatAgreement(summary,player){
  const matches=(summary?.boxscore?.players||[]).flatMap(team=>(team.statistics||[]).flatMap(group=>{
    const yardType={PASSYDS:'passing',RUSHYDS:'rushing',RECYDS:'receiving'}[player.metric];
    if(yardType&&!String(group.name||group.displayName||'').toLowerCase().includes(yardType))return [];
    const label={PTS:'PTS',REB:'REB',AST:'AST','3PT':'3PT',STL:'STL',BLK:'BLK',PRA:'PTS',GOALS:'G',SAVES:'SV',SOG:'SOG',HITS:'H',RBI:'RBI',HR:'HR',PASSYDS:'YDS',RUSHYDS:'YDS',RECYDS:'YDS'}[player.metric];
    const headers=group.names||group.labels;
    const index=headers?.findIndex(name=>name===label);
    if(!Number.isInteger(index)||index<0)return [];
    return (group.athletes||[]).filter(a=>clean(a.athlete?.displayName)===clean(player.name)&&!a.didNotPlay).map(a=>{
      const at=label=>headers?.indexOf(label);
      const read=label=>{const n=at(label);return n<0?NaN:score(String(a.stats?.[n]||'').split('-')[0])};
      return player.metric==='PRA'?read('PTS')+read('REB')+read('AST'):read(label);
    });
  }));
  // An absent player or statistic is unavailable, not a contrary reading.
  return matches.length===1&&Number.isInteger(matches[0])?matches[0]===player.value:null;
}
// FOX supplies a player statistic only when ESPN cannot verify this fixture
// or stat. Parse the named player table, not a recap or similarly named rival.
export function foxPlayerStat(data,player,eventId){
  if(String(data?.header?.id)!==String(eventId))return null;
  const column={PTS:'PTS',REB:'REB',AST:'AST','3PT':'3FG',STL:'STL',BLK:'BLK'}[player.metric];
  if(!column&&player.metric!=='PRA')return null;
  const matches=[];
  for(const section of data?.boxscore?.boxscoreSections||[])for(const item of section.boxscoreItems||[]){
    const table=item.boxscoreTable;
    if(!table)continue;
    const headers=table.headers?.[0]?.columns||[];
    const indexes=(player.metric==='PRA'?['PTS','REB','AST']:[column]).map(label=>headers.find(h=>h.text===label)?.index);
    if(indexes.some(n=>!Number.isInteger(n)))continue;
    for(const row of table.rows||[]){
      if(clean(row.entityLink?.title)!==clean(player.name))continue;
      const values=indexes.map(n=>score(String(row.columns?.find(c=>c.index===n)?.text||'').split('/')[0]));
      if(values.every(Number.isInteger))matches.push(values.reduce((a,b)=>a+b,0));
    }
  }
  // Starters and bench are separate tables; duplicate player entries are
  // ambiguous unless their values agree.
  return matches.length&&matches.every(n=>n===matches[0])?matches[0]:null;
}
async function json(url,fetcher){
  const response=await fetcher(url,{headers:{accept:'application/json'},signal:AbortSignal.timeout(7000)});
  if(!response.ok)throw Error(`Scoreboard ${response.status}`);
  return response.json();
}
async function verifyExistingOver(game,milestone,{fetcher=fetch,cache,market,source='ESPN'}={}){
  const start=Date.parse(milestone.start_date||'');
  if(!Number.isFinite(start)||!game.scoreKnown)return false;
  const {espn,fox}=feeds(game);
  if(!espn&&!fox)return null;
  const dates=dateCandidates(start);
  const read=url=>{
    const cached=cache?.get(url);
    if(cached&&Date.now()-cached.at<3000)return cached.value;
    const value=json(url,fetcher);
    cache?.set(url,{at:Date.now(),value});
    return value;
  };
  const check=async(source,feed)=>{
    if(!feed)return null;
    const requests=dates.map(day=>source==='ESPN'
      ?`https://site.api.espn.com/apis/site/v2/sports/${feed}/scoreboard?dates=${day}&limit=500`
      :`https://api.foxsports.com/bifrost/v1/${feed}/scoreboard/segment/${feed==='soccer'?'c0d'+day:day}?apikey=${FOX_KEY}&api-version=1.1${feed==='soccer'?'&groupId=0':''}`);
    const results=await Promise.allSettled(requests.map(read));
    const seen=new Set(),matches=[];
    for(const result of results){
      if(result.status!=='fulfilled')continue;
      const found=source==='ESPN'?/^tennis_/.test(game.type)?tennisMatches(result.value,game,milestone):espnMatches(result.value,game,milestone):foxMatches(result.value,game,milestone);
      const signature=JSON.stringify(found);
      if(seen.has(signature))continue;
      seen.add(signature);matches.push(...found.filter(m=>!m.stale));
    }
    if(matches.length>1)return false;
    if(!matches.length)return null;
    if(!scoreAgreement(game,[matches],market))return false;
    const player=playerOverSpec(game,market);
    if(!player)return true;
    const matched=matches[0];
    if(!matched.eventId)return null;
    try{
      if(source==='ESPN'){
        const summary=await read(`https://site.api.espn.com/apis/site/v2/sports/${feed}/summary?event=${encodeURIComponent(matched.eventId)}`);
        return summary?.boxscore?.players?.length?playerStatAgreement(summary,player):null;
      }
      if(feed!=='nba')return null;
      const box=await read(`https://api.foxsports.com/bifrost/v1/${feed}/event/${matched.eventId}/data?apikey=${FOX_KEY}&api-version=1.1`);
      const value=foxPlayerStat(box,player,matched.eventId);
      return value===null?null:value===player.value;
    }catch{return null}
  };
  return source==='ESPN'?check('ESPN',espn):source==='FOX'?check('FOX Sports',fox):null;
}

const nbaAliases=t=>[`${t?.teamCity||''} ${t?.teamName||''}`,`${t?.teamTricode||''} ${t?.teamName||''}`,t?.teamName];
export function nbaFixtures(data,game,milestone){
  return (data?.scoreboard?.games||[]).filter(g=>/^\d{10}$/.test(String(g.gameId))&&sameFixture(game,milestone,nbaAliases(g.homeTeam),nbaAliases(g.awayTeam),g.gameTimeUTC));
}
// null = unavailable; false = a positively identified statistic disagrees.
export function nbaAgreement(data,game,milestone,market,eventId){
  const g=data?.game;
  if(!g||String(g.gameId)!==String(eventId)||!sameFixture(game,milestone,nbaAliases(g.homeTeam),nbaAliases(g.awayTeam),g.gameTimeUTC))return null;
  if(![2,3].includes(g.gameStatus))return null;
  const player=playerOverSpec(game,market);
  if(player){
    const players=[...(g.homeTeam?.players||[]),...(g.awayTeam?.players||[])].filter(p=>clean(p.name||`${p.firstName||''} ${p.familyName||''}`)===clean(player.name));
    if(players.length!==1)return null;
    const stats=players[0].statistics||{};
    const keys=player.metric==='PRA'?['points','reboundsTotal','assists']:[{PTS:'points',REB:'reboundsTotal',AST:'assists','3PT':'threePointersMade',STL:'steals',BLK:'blocks'}[player.metric]];
    const values=keys.map(k=>score(stats[k]));
    return values.every(n=>Number.isInteger(n)&&n>=0)?values.reduce((a,b)=>a+b,0)===player.value:null;
  }
  const home=score(g.homeTeam?.score),away=score(g.awayTeam?.score);
  if(!Number.isInteger(home)||!Number.isInteger(away))return null;
  const segment=periodValue(game,market);
  if(segment){
    const periods=(g.homeTeam.periods||[]).map(p=>({number:Number(p.period),home:score(p.score),away:score(g.awayTeam.periods?.find(a=>a.period===p.period)?.score)}));
    const official=periodValue({...game,periodScores:periods},market);
    if(!official||!Number.isFinite(official.home)||!Number.isFinite(official.away))return null;
    return segment.home===official.home&&segment.away===official.away;
  }
  return home===game.home&&away===game.away;
}
async function verifyNbaOver(game,milestone,{fetcher=fetch,market}={}){
  if(game.sport!=='NBA')return null;
  try{
    const board=await json('https://cdn.nba.com/static/json/liveData/scoreboard/todaysScoreboard_00.json',fetcher);
    const fixtures=nbaFixtures(board,game,milestone);
    if(fixtures.length!==1)return null;
    const id=fixtures[0].gameId;
    const box=await json(`https://cdn.nba.com/static/json/liveData/boxscore/boxscore_${id}.json`,fetcher);
    return nbaAgreement(box,game,milestone,market,id);
  }catch{return null}
}
// null means no exact independent fixture/stat was available. A definite
// contradiction remains false and must never authorize a Kalshi-only fallback.
export async function verifyIndependentOverDecision(game,milestone,options={}){
  const [preferred,nba]=await Promise.all([verifyExistingOver(game,milestone,options),verifyNbaOver(game,milestone,options)]);
  if(nba===false||preferred===false)return false;
  if(nba!==null)return nba;
  if(preferred!==null)return preferred;
  // Only an unavailable source advances to the next rank. An exact
  // contradiction is a failed verification, not permission to shop feeds.
  for(const source of ['CBS','Yahoo']){
    const result=await alternateCheck(source,game,milestone,options);
    if(result!==null)return result;
  }
  const fox=await verifyExistingOver(game,milestone,{...options,source:'FOX'});
  return fox;
}
export async function verifyIndependentOver(game,milestone,options={}){
  return (await verifyIndependentOverDecision(game,milestone,options))===true;
}

