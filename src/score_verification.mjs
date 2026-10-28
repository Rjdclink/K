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
  return key.length>=3 && aliases.some(alias=>clean(alias)===key);
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
export function foxMatches(data,game,milestone){
  if(!Array.isArray(data?.sectionList))return [];
  return data.sectionList.flatMap(section=>(section.events||[]).flatMap(e=>{
    // The visual row order varies by sport; use the explicit team URIs.
    const homeUri=e.entityLink?.layout?.tokens?.homeUri,awayUri=e.entityLink?.layout?.tokens?.awayUri;
    const teams=[e.upperTeam,e.lowerTeam];
    const home=teams.find(t=>homeUri&&t?.uri===homeUri),away=teams.find(t=>awayUri&&t?.uri===awayUri);
    if(!homeUri||!awayUri||homeUri===awayUri||home===away)return [];
    if(!home||!away||!sameFixture(game,milestone,teamAliases(home,true),teamAliases(away,true),e.eventTime))return [];
    return [{source:'FOX Sports',home:score(home.score),away:score(away.score),live:e.eventStatus===1,clockOk:clockCompatible(game,NaN,e.statusLine)}];
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
    const index=group.names?.findIndex(name=>name===({PTS:'PTS',REB:'REB',AST:'AST','3PT':'3PT',STL:'STL',BLK:'BLK',PRA:'PTS'}[player.metric]));
    if(index<0)return [];
    return (group.athletes||[]).filter(a=>clean(a.athlete?.displayName)===clean(player.name)&&!a.didNotPlay).map(a=>{
      const at=label=>group.names?.indexOf(label);
      const read=label=>{const n=at(label);return n<0?NaN:score(String(a.stats?.[n]||'').split('-')[0])};
      return player.metric==='PRA'?read('PTS')+read('REB')+read('AST'):read(player.metric);
    });
  }));
  return matches.length===1&&Number.isInteger(matches[0])&&matches[0]===player.value;
}
async function json(url,fetcher){
  const response=await fetcher(url,{headers:{accept:'application/json'},signal:AbortSignal.timeout(7000)});
  if(!response.ok)throw Error(`Scoreboard ${response.status}`);
  return response.json();
}
export async function verifyIndependentOver(game,milestone,{fetcher=fetch,cache,market}={}){
  const start=Date.parse(milestone.start_date||'');
  if(!Number.isFinite(start)||!game.scoreKnown)return false;
  const {espn,fox}=feeds(game);
  if(!espn&&!fox)return false;
  const dates=dateCandidates(start);
  // The UTC date may differ from the league's local scoreboard date.
  const requests=[];
  if(espn)for(const day of dates)requests.push({source:'ESPN',url:`https://site.api.espn.com/apis/site/v2/sports/${espn}/scoreboard?dates=${day}&limit=500`});
  if(fox)for(const day of dates){
    const segment=fox==='soccer'?'c0d'+day:day;
    const group=fox==='soccer'?'&groupId=0':'';
    requests.push({source:'FOX Sports',url:`https://api.foxsports.com/bifrost/v1/${fox}/scoreboard/segment/${segment}?apikey=${FOX_KEY}&api-version=1.1${group}`});
  }
  const read=url=>{
    const cached=cache?.get(url);
    if(cached&&Date.now()-cached.at<3000)return cached.value;
    const value=json(url,fetcher);
    cache?.set(url,{at:Date.now(),value});
    return value;
  };
  const results=await Promise.allSettled(requests.map(async request=>({source:request.source,data:await read(request.url)})));
  const bySource=['ESPN','FOX Sports'].map(source=>{
    const seen=new Set();return results.flatMap(result=>{
      if(result.status!=='fulfilled'||result.value.source!==source)return [];
      const matches=source==='ESPN'?/^tennis_/.test(game.type)?tennisMatches(result.value.data,game,milestone):espnMatches(result.value.data,game,milestone):foxMatches(result.value.data,game,milestone);
      const signature=JSON.stringify(matches);
      if(seen.has(signature))return [];
      seen.add(signature);return matches;
    });
  });
  if(!scoreAgreement(game,bySource,market))return false;
  const player=playerOverSpec(game,market);
  if(!player)return true;
  const matches=bySource[0].filter(m=>m.live&&m.clockOk&&m.home===game.home&&m.away===game.away&&m.eventId);
  if(matches.length!==1)return false;
  try{
    const summary=await read(`https://site.api.espn.com/apis/site/v2/sports/${espn}/summary?event=${encodeURIComponent(matches[0].eventId)}`);
    return playerStatAgreement(summary,player);
  }catch{return false}
}
