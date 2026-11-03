import {externalValueQualifies,externalScoresQualify} from './external_values.mjs';
import { alternateCheck } from './alternate_scores.mjs';
import { teamAbbreviationVariants } from './team_identity.mjs';
import { loadSportradar, sportradarPlayerValue } from './sportradar.mjs';
// ESPN and FOX publish the scoreboards used by their sites. These endpoints
// are not contractual data APIs; a changed schema or unavailable fixture must
// fail closed, never silently turn into permission to buy an over.
import { periodValue, playerOverSpec, basketballCloseoutEntry, basketballCloseoutMinimum } from './strategy.mjs';
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

function lacrosseFeed(game,milestone){
  const aliases={pll:'pll',premierlacrosseleague:'pll',nll:'nll',nationallacrosseleague:'nll',
    ncaam:'mens-college-lacrosse',ncaamlax:'mens-college-lacrosse',ncaamenslacrosse:'mens-college-lacrosse',ncaamenscollegelacrosse:'mens-college-lacrosse',menscollegelacrosse:'mens-college-lacrosse',mensncaalacrosse:'mens-college-lacrosse'};
  const labels=[game.competition,game.sport,milestone?.details?.league,milestone?.details?.competition].map(clean);
  if(labels.some(s=>/women|female|^wll$/.test(s)))return null;
  const matches=new Set(labels.map(s=>aliases[s]).filter(Boolean));
  const series={KXPLLGAME:'pll',KXNLLGAME:'nll',KXNCAAMLAXGAME:'mens-college-lacrosse'};
  for(const ticker of [game.mainEvent,...(milestone?.primary_event_tickers||[])]){
    const league=series[String(ticker||'').split('-')[0]];if(league)matches.add(league);
  }
  // One matching league is sufficient. Never borrow a different league's
  // scoreboard when metadata is absent or contradictory.
  return matches.size===1?`lacrosse/${[...matches][0]}`:null;
}
function feeds(game,milestone){
  if(/lacrosse/.test(game.type))return {espn:lacrosseFeed(game,milestone),fox:null};
  if(/soccer/.test(game.type))return {espn:'soccer/all',fox:'soccer'};
  if(/^tennis_/.test(game.type))return /^(?:ATP|WTA)$/i.test(game.tour)?{espn:`tennis/${game.tour.toLowerCase()}`,fox:null}:{espn:null,fox:null};
  const league=game.sport;
  const supported={NBA:['basketball/nba','nba'],WNBA:['basketball/wnba','wnba'],NCAAB:['basketball/mens-college-basketball','cbk'],NCAAW:['basketball/womens-college-basketball',null],NFL:['football/nfl','nfl'],CFB:['football/college-football','cfb'],NHL:['hockey/nhl','nhl'],MLB:['baseball/mlb','mlb']};
  // Explicit ESPN league feeds; team aliases still use the unchanged identity checks.
  const international={'Australia NBL':'nbl',NBL:'nbl','FIBA World Cup':'fiba',FIBA:'fiba',
    "Olympics Men's Basketball":'mens-olympics-basketball',"Olympics Women's Basketball":'womens-olympics-basketball'};
  const [espn,fox]=supported[league]||(/basketball/.test(game.type)&&international[league]?[`basketball/${international[league]}`,null]:[]);
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
function sameTeam(expected,aliases,sport){
  const key=clean(expected);
  const variants=teamAbbreviationVariants(expected,sport).map(clean);
  // Kalshi NHL milestones often use only a city, while ESPN/FOX append the
  // franchise. Map explicitly to avoid matching two clubs from one city.
  const hockey={Carolina:'Carolina Hurricanes',Columbus:'Columbus Blue Jackets',Dallas:'Dallas Stars',Montreal:'Montreal Canadiens',
    Minnesota:'Minnesota Wild','New York I':'New York Islanders','New York R':'New York Rangers',Pittsburgh:'Pittsburgh Penguins',
    Utah:'Utah Mammoth','St. Louis':'St Louis Blues',Boston:'Boston Bruins','Tampa Bay':'Tampa Bay Lightning',Winnipeg:'Winnipeg Jets'};
  const soccer={'Atletico Mineiro':'Atletico MG','Al Ahli Saudi':'Al Ahli','GA Eagles':'Go Ahead Eagles'};
  const franchise=hockey[expected]?clean(hockey[expected]):soccer[expected]?clean(soccer[expected]):null;
  const clubName=name=>clean(String(name||'').replace(/^(?:AC|FC|CF|SC|AFC)\s+/i,'').replace(/\s+(?:AC|FC|CF|SC|AFC)$/i,''));
  const stripped=clubName(expected);
  const shortCode=variants.length>1&&/^[A-Za-z]{2}$/.test(String(expected||''));
  return (key.length>=3||shortCode) && aliases.some(name=>variants.includes(clean(name))||franchise&&clean(name)===franchise||
    stripped.length>=5&&clubName(name)===stripped);
}
function teamAliases(t,fox=false,includeLocation=false){
  if(fox)return [t?.imageAltText,t?.longName,t?.stackedNameBottom,t?.abbreviation,t?.shortName,t?.name,`${t?.name||''} ${t?.longName||''}`,`${t?.stackedNameTop||''} ${t?.stackedNameBottom||''}`];
  return [t?.displayName,t?.shortDisplayName,t?.name,t?.abbreviation,`${t?.abbreviation||''} ${t?.name||''}`,`${t?.location||''} ${t?.name||''}`,
    ...(includeLocation?[t?.location]:[])];
}
function clockSeconds(clock){
  const text=String(clock||''),plain=text.match(/^(\d{1,2}):(\d{2})$/),iso=text.match(/^PT(?:(\d+)M)?([\d.]+)S$/);
  return plain&&Number(plain[2])<60?Number(plain[1])*60+Number(plain[2]):
    iso&&Number(iso[2])<60?Number(iso[1]||0)*60+Number(iso[2]):NaN;
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
    sameTeam(names.home,home,game.sport)&&sameTeam(names.away,away,game.sport);
}
export function espnMatches(data,game,milestone){
  if(!Array.isArray(data?.events))return [];
  return data.events.flatMap(e=>{
    const c=e.competitions?.[0],home=c?.competitors?.find(t=>t.homeAway==='home'),away=c?.competitors?.find(t=>t.homeAway==='away');
    const locationAliases=['CFB','NCAAB','NCAAW'].includes(game.sport)||/lacrosse/.test(game.type);
    if(!home||!away||!sameFixture(game,milestone,teamAliases(home.team,false,locationAliases),teamAliases(away.team,false,locationAliases),e.date))return [];
    const status=c.status||e.status;
    const periods=(home.linescores||[]).map((part,i)=>({number:i+1,home:score(part.value),away:score(away.linescores?.[i]?.value)}));
    // Use the last play only when scoring events account for the full score.
    const plays=Array.isArray(c.details)?c.details.filter(p=>p.scoringPlay===true):[];
    const values=plays.map(p=>Number(p.scoreValue));
    const total=score(home.score)+score(away.score);
    const documentedGoals=values.every(v=>Number.isInteger(v)&&v>0)?values.reduce((a,b)=>a+b,0):NaN;
    const lastScoringPlay=values.length&&documentedGoals===total?values.at(-1):null;
    return [{source:'ESPN',eventId:e.id,home:score(home.score),away:score(away.score),periods,period:Number(status?.period),remainingSeconds:clockSeconds(status?.displayClock),live:status?.type?.state==='in',clockOk:clockCompatible(game,status?.period,status?.displayClock),documentedGoals,lastScoringPlay}];
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
function tableTennisScoreQualifies(game,m){
  if(![m.home,m.away].every(n=>Number.isInteger(n)&&n>=0))return false;
  const home=game.home>game.away,expected=home?game.home:game.away,actual=home?m.home:m.away;
  return actual>=expected&&(home?m.home-m.away:m.away-m.home)>=Math.abs(game.home-game.away);
}
export async function verifyIndependentTableTennisLeadDecision(game,milestone,{fetcher=fetch}={}){
  if(!game.tableTennis||![3,5,7].includes(game.tableTennis.setNumber)||!game.verifiedLive)return false;
  const start=Date.parse(milestone.start_date||'');
  if(!Number.isFinite(start))return null;
  try{
    const dates=dateCandidates(start).map(s=>`${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6)}`);
    const results=await Promise.allSettled(dates.map(day=>json(`https://www.sofascore.com/api/v1/sport/table-tennis/scheduled-events/${day}`,fetcher)));
    const seen=new Set(),matches=[];
    for(const r of results.filter(r=>r.status==='fulfilled')){
      const found=tableTennisMatches(r.value,game,milestone),key=JSON.stringify(found);
      if(!seen.has(key)){seen.add(key);matches.push(...found)}
    }
    if(matches.length>1)return false;
    if(!matches.length)return null;
    const m=matches[0];
    return m.live&&tableTennisScoreQualifies(game,m)&&
      m.homeSets===(game.tableTennis.firstIsHome?game.tableTennis.firstSets:game.tableTennis.secondSets)&&
      m.awaySets===(game.tableTennis.firstIsHome?game.tableTennis.secondSets:game.tableTennis.firstSets);
  }catch{return null}
}
export async function verifyIndependentTableTennisLead(game,milestone,options={}){
  return (await verifyIndependentTableTennisLeadDecision(game,milestone,options))===true;
}
export async function verifyIndependentTableTennisMatch(game,milestone,{fetcher=fetch}={}){
  const t=game.tableTennis,start=Date.parse(milestone.start_date||'');
  if(!t||!Number.isFinite(start)||!game.verifiedLive||!Number.isInteger(t.setNumber))return false;
  try{
    const dates=dateCandidates(start).map(s=>`${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6)}`);
    const data=await Promise.allSettled(dates.map(day=>json(`https://www.sofascore.com/api/v1/sport/table-tennis/scheduled-events/${day}`,fetcher)));
    const matches=data.filter(r=>r.status==='fulfilled').flatMap(r=>tableTennisMatches(r.value,game,milestone));
    const unique=[...new Map(matches.map(m=>[JSON.stringify(m),m])).values()];
    return unique.length===1&&unique[0].live&&tableTennisScoreQualifies(game,unique[0])&&
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
    const period=String(e.statusLine||'').match(/\b([1-4])(?:ST|ND|RD|TH)\b/i);
    const reportedPeriod=period?Number(period[1]):NaN;
    const clock=String(e.statusLine||'').match(/\b\d{1,2}:\d{2}\b/)?.[0]||'';
    // A source still showing the previous period cannot veto an exact,
    // current independent scoreboard. A disagreement in the current period
    // remains a veto.
    return [{source:'FOX Sports',eventId:/^\d+$/.test(eventId)?eventId:null,home:score(home.score),away:score(away.score),period:reportedPeriod,remainingSeconds:clockSeconds(clock),live:e.eventStatus===1,clockOk:clockCompatible(game,reportedPeriod,/soccer/.test(game.type)?e.statusLine:clock),stale:Number.isFinite(game.period)&&Number.isFinite(reportedPeriod)&&reportedPeriod<game.period}];
  }));
}
export function scoreAgreement(game,bySource,market,{minimumOverValue,onOverValue}={}){
  const segment=String(market?.event_ticker||'').split('-')[0].match(/([1-9])(?:Q|P|H|INNING)(?:TEAM)?TOTAL$/);
  const tennisTotal=/^KX(?:ATP|WTA)GTOTAL$/.test(String(market?.event_ticker||'').split('-')[0]);
  const closeout=basketballCloseoutEntry(game)&&/win|winner|victory/i.test(`${market?.title||''} ${market?.rules_primary||''}`);
  let agrees=0;
  for(const matches of bySource){
    if(matches.length>1)return false; // Ambiguous fixture identity.
    if(!matches.length)continue;
    const m=matches[0];
    if(!m.live||!m.clockOk)return false;
    if(closeout&&(!Number.isFinite(m.remainingSeconds)||m.remainingSeconds<=0||
      m.remainingSeconds>=105||m.period!==game.period||Math.abs(m.remainingSeconds-game.remainingSeconds)>10))return false;
    const player=Boolean(playerOverSpec(game,market));
    let expected=game,actual=m;
    if(segment){
      expected=periodValue(game,market);
      actual=periodValue({type:game.type,sport:game.sport,periodScores:m.periods},market);
      if(!expected||!actual)continue;
    }
    if(tennisTotal&&(!Number.isInteger(m.totalGames)||m.totalGames<0))return false;
    if(!externalScoresQualify(game,m,market,{expected,actual,player,
      minimumMargin:closeout?basketballCloseoutMinimum(game):undefined,minimumOverValue,onOverValue}))return false;
    agrees++;
  }
  return agrees>=1;
}
export function playerStatValue(summary,player,{participated=false}={}){
  const matches=(summary?.boxscore?.players||[]).flatMap(team=>(team.statistics||[]).flatMap(group=>{
    const yardType={PASSYDS:'passing',RUSHYDS:'rushing',RECYDS:'receiving'}[player.metric];
    if(yardType&&!String(group.name||group.displayName||'').toLowerCase().includes(yardType))return [];
    const label={PTS:'PTS',REB:'REB',AST:'AST','3PT':'3PT',STL:'STL',BLK:'BLK',PRA:'PTS',GOALS:'G',SAVES:'SV',SOG:'SOG',HITS:'H',RBI:'RBI',HR:'HR',PASSYDS:'YDS',RUSHYDS:'YDS',RECYDS:'YDS'}[player.metric];
    const headers=group.names||group.labels;
    const index=headers?.findIndex(name=>name===label);
    if(!Number.isInteger(index)||index<0)return [];
    return (group.athletes||[]).filter(a=>clean(a.athlete?.displayName)===clean(player.name)&&
      !a.didNotPlay&&(!participated||Number(a.stats?.[headers?.indexOf(player.metric==='RECYDS'?'TGTS':'CAR')])>0)).map(a=>{
      const at=label=>headers?.indexOf(label);
      const read=label=>{const n=at(label);return n<0?NaN:score(String(a.stats?.[n]||'').split('-')[0])};
      return player.metric==='PRA'?read('PTS')+read('REB')+read('AST'):read(label);
    });
  }));
  // An absent player or statistic is unavailable, not a contrary reading.
  return matches.length===1&&Number.isInteger(matches[0])?matches[0]:null;
}
export function playerStatAgreement(summary,player){
  const value=playerStatValue(summary,player);
  return value===null?null:externalValueQualifies(value,player.value,player.line);
}
// NO requires the exact independently observed zero; the over comparison
// accepts larger values and cannot be reused for this decision.
export async function verifyIndependentYardageZero(game,milestone,player,{fetcher=fetch}={}){
  if(!['NFL','CFB'].includes(game?.sport)||game.period!==3)return false;
  const feed=game.sport==='NFL'?'football/nfl':'football/college-football';
  const start=Date.parse(milestone?.start_date||'');
  if(!Number.isFinite(start))return false;
  const read=async url=>{const response=await fetcher(url,{signal:AbortSignal.timeout(7000)});if(!response.ok)throw Error('ESPN unavailable');return response.json()};
  try{
    const fixtures=(await Promise.all(dateCandidates(start).map(day=>
      read(`https://site.api.espn.com/apis/site/v2/sports/${feed}/scoreboard?dates=${day}&limit=500${game.sport==='CFB'?'&groups=80':''}`))))
      .flatMap(data=>espnMatches(data,game,milestone));
    if(!fixtures.length||fixtures.some(match=>!match.live||!match.clockOk||match.period!==3))return false;
    const ids=[...new Set(fixtures.map(match=>match.eventId))];
    if(ids.length!==1)return false;
    const summary=await read(`https://site.api.espn.com/apis/site/v2/sports/${feed}/summary?event=${encodeURIComponent(ids[0])}`);
    return playerStatValue(summary,player,{participated:true})===0;
  }catch{return false}
}
// FOX supplies a player statistic only when ESPN cannot verify this fixture
// or stat. Parse the named player table, not a recap or similarly named rival.
export function foxPlayerStat(data,player,eventId){
  if(String(data?.header?.id)!==String(eventId))return null;
  const yardType={PASSYDS:'PASSING',RUSHYDS:'RUSHING',RECYDS:'RECEIVING'}[player.metric];
  const column=yardType?'YDS':{PTS:'PTS',REB:'REB',AST:'AST','3PT':'3FG',STL:'STL',BLK:'BLK'}[player.metric];
  if(!column&&player.metric!=='PRA')return null;
  const matches=[];
  for(const section of data?.boxscore?.boxscoreSections||[])for(const item of section.boxscoreItems||[]){
    const table=item.boxscoreTable;
    if(!table)continue;
    const headers=table.headers?.[0]?.columns||[];
    if(yardType&&!headers.some(h=>String(h.text).toUpperCase()===yardType))continue;
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
async function verifyExistingOver(game,milestone,{fetcher=fetch,cache,market,source='ESPN',unavailableReasons=[],minimumOverValue,onOverValue}={}){
  const start=Date.parse(milestone.start_date||'');
  if(!Number.isFinite(start)||!game.scoreKnown)return null;
  const {espn,fox}=feeds(game,milestone);
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
    const foxBase=`https://api.foxsports.com/bifrost/v1/${feed}`;
    const foxQuery=`apikey=${FOX_KEY}&api-version=1.1`;
    let requests;
    if(source==='ESPN')requests=dates.map(day=>`https://site.api.espn.com/apis/site/v2/sports/${feed}/scoreboard?dates=${day}&limit=500${['NCAAB','NCAAW'].includes(game.sport)?'&groups=50':''}`);
    else if(feed==='nfl'||feed==='cfb'){
      // Football score segments are season/week IDs, never calendar dates.
      // Discover the provider's current segment instead of guessing its week.
      try{
        const selection=await read(`${foxBase}/league/scores?${foxQuery}`);
        const id=String(selection?.currentSelectionId||'');
        if(!/^\d{4}-\d{1,2}-\d$/.test(id))throw Error('missing current score segment');
        requests=[`${foxBase}/league/scores-segment/${id}?${foxQuery}${feed==='cfb'?'&groupId=-4':''}`];
      }catch(error){unavailableReasons.push(`${source}: ${error.message}`);return null}
    }else requests=dates.map(day=>feed==='soccer'
      ?`${foxBase}/scoreboard/segment/c0d${day}?${foxQuery}&groupId=0`
      :`${foxBase}/league/scores-segment/${day}?${foxQuery}${feed==='cbk'?'&groupId=-4':''}`);
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
    if(!matches.length){
      const errors=results.filter(r=>r.status==='rejected').map(r=>String(r.reason?.message||'request failed'));
      unavailableReasons.push(`${source}: ${errors.length===results.length?errors.join(', '):'no exact matching fixture'}`);
      return null;
    }
    const selectedValues=[];
    if(!scoreAgreement(game,[matches],market,{minimumOverValue,onOverValue:value=>selectedValues.push(value)}))return false;
    const series=String(market?.event_ticker||'').split('-')[0];
    const soccerGameOver=source==='ESPN'&&/soccer/.test(game.type)&&/TOTAL$/.test(series)&&
      !/TEAMTOTAL$/.test(series)&&!/[1-9](?:Q|P|H|INNING)(?:TEAM)?TOTAL$/.test(series);
    if(soccerGameOver&&!(matches[0].documentedGoals>Number(market.floor_strike))){
      game.verificationIssue=`ESPN goal list confirms ${Number.isFinite(matches[0].documentedGoals)?matches[0].documentedGoals:'no reliable'} of ${game.home+game.away} displayed goals; over ${market.floor_strike} not independently established`;
      return false;
    }
    if(soccerGameOver&&minimumOverValue!==undefined&&!(matches[0].documentedGoals>=minimumOverValue))return false;
    const player=playerOverSpec(game,market);
    if(!player){for(const value of selectedValues)onOverValue?.(soccerGameOver?Math.min(value,matches[0].documentedGoals):value);if(source==='ESPN'&&Number.isInteger(matches[0].lastScoringPlay))game.lastScoringPlay=matches[0].lastScoringPlay;return true;}
    const matched=matches[0];
    if(!matched.eventId)return null;
    try{
      if(source==='ESPN'){
        const summary=await read(`https://site.api.espn.com/apis/site/v2/sports/${feed}/summary?event=${encodeURIComponent(matched.eventId)}`);
        const result=summary?.boxscore?.players?.length?playerStatAgreement(summary,player):null;
        if(result===null)unavailableReasons.push(`${source}: ${player.name} ${player.metric} statistic unavailable`);
        return result;
      }
      if(!['nba','wnba','nfl','cfb'].includes(feed)){
        unavailableReasons.push(`${source}: ${player.metric} player-stat coverage unavailable`);return null;
      }
      const box=await read(`https://api.foxsports.com/bifrost/v1/${feed}/event/${matched.eventId}/data?apikey=${FOX_KEY}&api-version=1.1`);
      const value=foxPlayerStat(box,player,matched.eventId);
      if(value===null)unavailableReasons.push(`${source}: ${player.name} ${player.metric} statistic unavailable`);
      return value===null?null:externalValueQualifies(value,player.value,player.line);
    }catch(error){unavailableReasons.push(`${source}: ${error.message}`);return null}
  };
  return source==='ESPN'?check('ESPN',espn):source==='FOX'?check('FOX Sports',fox):null;
}

const nbaAliases=t=>[`${t?.teamCity||''} ${t?.teamName||''}`,`${t?.teamTricode||''} ${t?.teamName||''}`,t?.teamTricode,t?.teamName];
export function nbaFixtures(data,game,milestone){
  return (data?.scoreboard?.games||[]).filter(g=>/^\d{10}$/.test(String(g.gameId))&&sameFixture(game,milestone,nbaAliases(g.homeTeam),nbaAliases(g.awayTeam),g.gameTimeUTC));
}
// null = unavailable; false = a positively identified statistic disagrees.
export function nbaAgreement(data,game,milestone,market,eventId,{minimumOverValue,onOverValue}={}){
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
    return values.every(n=>Number.isInteger(n)&&n>=0)?externalValueQualifies(values.reduce((a,b)=>a+b,0),player.value,player.line):null;
  }
  const home=score(g.homeTeam?.score),away=score(g.awayTeam?.score);
  if(!Number.isInteger(home)||!Number.isInteger(away))return null;
  const periods=(g.homeTeam.periods||[]).map(p=>({number:Number(p.period),home:score(p.score),away:score(g.awayTeam.periods?.find(a=>a.period===p.period)?.score)}));
  if(periodValue(game,market)&&!periodValue({...game,periodScores:periods},market))return null;
  return scoreAgreement(game,[[{home,away,periods,live:true,clockOk:true,
    period:Number(g.period),remainingSeconds:clockSeconds(g.gameClock)}]],market,{minimumOverValue,onOverValue});
}
async function verifyNbaOver(game,milestone,{fetcher=fetch,market,minimumOverValue,onOverValue}={}){
  if(game.sport!=='NBA')return null;
  try{
    const board=await json('https://cdn.nba.com/static/json/liveData/scoreboard/todaysScoreboard_00.json',fetcher);
    const fixtures=nbaFixtures(board,game,milestone);
    if(fixtures.length!==1)return null;
    const id=fixtures[0].gameId;
    const box=await json(`https://cdn.nba.com/static/json/liveData/boxscore/boxscore_${id}.json`,fetcher);
    return nbaAgreement(box,game,milestone,market,id,{minimumOverValue,onOverValue});
  }catch{return null}
}
// null means no exact independent fixture/stat was available. A definite
// contradiction remains false and must never authorize a Kalshi-only fallback.
export async function verifyIndependentOverDecision(game,milestone,options={}){
  delete game.verificationIssue;
  const unavailableReasons=[],rankedOptions={...options,unavailableReasons};
  // Start the fallback directly from ESPN's unavailable result, without
  // waiting for the parallel NBA check. Each ESPN URL is requested once.
  const nbaTask=verifyNbaOver(game,milestone,options);
  const preferred=await verifyExistingOver(game,milestone,rankedOptions);
  const sportradarTask=preferred===null?verifySportradarOver(game,milestone,rankedOptions):Promise.resolve(null);
  const [nba,sportradar]=await Promise.all([nbaTask,sportradarTask]);
  if(nba===false||preferred===false)return false;
  if(sportradar!==null)return sportradar;
  if(nba!==null)return nba;
  if(preferred!==null)return preferred;
  // Only an unavailable source advances to the next rank. An exact
  // contradiction is a failed verification, not permission to shop feeds.
  for(const source of ['CBS','Yahoo']){
    const result=await alternateCheck(source,game,milestone,options);
    if(result!==null)return result;
  }
  const fox=await verifyExistingOver(game,milestone,{...rankedOptions,source:'FOX'});
  if(fox===null&&unavailableReasons.length)game.verificationIssue='External verification unavailable: '+[...new Set(unavailableReasons)].join('; ');
  return fox;
}
export async function verifySportradarOver(game,milestone,options={}){
  const {market,minimumOverValue,onOverValue}=options;
  const readings=await loadSportradar(game,milestone,{...options,apiKey:options.sportradarApiKey??process.env.SPORTRADAR_API_KEY,
    matchFixture:(home,away,time)=>sameFixture(game,milestone,home,away,time)});
  if(readings?.ambiguous)return false;
  if(!readings)return null;
  const matches=readings.filter(r=>sameFixture(game,milestone,r.homeAliases,r.awayAliases,r.time));
  if(matches.length>1)return false;
  if(!matches.length)return null;
  const m=matches[0];
  if(!m.live)return false;
  if(game.tableTennis){
    const t=game.tableTennis,p=m.periods.find(p=>p.number===t.setNumber);
    if(!p)return null;
    return m.period===t.setNumber&&tableTennisScoreQualifies(game,p)&&
      m.home===(t.firstIsHome?t.firstSets:t.secondSets)&&m.away===(t.firstIsHome?t.secondSets:t.firstSets);
  }
  if(/^tennis_/.test(game.type)){
    if(!m.periods.length||m.periods.some(p=>![p.home,p.away].every(n=>Number.isInteger(n)&&n>=0&&n<=7)))return null;
    m.totalGames=m.periods.reduce((total,p)=>total+p.home+p.away,0);
    m.home=m.periods.at(-1).home;m.away=m.periods.at(-1).away;
  }
  if(![m.home,m.away].every(Number.isInteger))return null;
  if(game.darts&&!/leg/i.test(game.darts.format))return null;
  if(Number.isFinite(game.period)&&!Number.isFinite(m.period))return null;
  if(periodValue(game,market)&&!periodValue({...game,periodScores:m.periods},market))return null;
  m.clockOk=clockCompatible(game,m.period,m.clock);
  m.remainingSeconds=clockSeconds(m.clock);
  const values=[];
  if(!scoreAgreement(game,[[m]],market,{minimumOverValue,onOverValue:value=>values.push(value)}))return false;
  const player=playerOverSpec(game,market);
  if(player){const value=sportradarPlayerValue(m,player);return value===null?null:externalValueQualifies(value,player.value,player.line);}
  const series=String(market?.event_ticker||'').split('-')[0];
  if(/soccer/.test(game.type)&&/TOTAL$/.test(series)&&!/TEAMTOTAL$|[1-9](?:Q|P|H|INNING)TOTAL$/.test(series)&&
    (!(m.documentedGoals>Number(market.floor_strike))||minimumOverValue!==undefined&&m.documentedGoals<minimumOverValue))return false;
  for(const value of values)onOverValue?.(value);
  return true;
}
export async function verifyIndependentOver(game,milestone,options={}){
  return (await verifyIndependentOverDecision(game,milestone,options))===true;
}

