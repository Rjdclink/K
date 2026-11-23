import {scoreFeedAgeMs} from './score_feed_freshness.mjs';

const whole=n=>Number.isInteger(n)&&n>=0;
const dates=start=>{
  const hour=new Date(start).getUTCHours();
  return [start,...(hour<6?[start-86400000]:[]),...(hour>=21?[start+86400000]:[])]
    .map(ms=>new Date(ms).toISOString().slice(0,10));
};
const clockSeconds=value=>{
  const m=String(value||'').match(/^(\d{1,2}):([0-5]\d)$/);
  return m?Number(m[1])*60+Number(m[2]):NaN;
};
export function officialFallbackSport(game){
  const type=String(game?.type||'');
  return game?.sport==='NHL'&&type.startsWith('hockey_')?'NHL':
    type.startsWith('soccer_')?'BBC Sport':
    game?.sport==='NFL'&&type.startsWith('football_')?'NFL':null;
}
async function read(url,fetcher,format){
  const response=await fetcher(url,{cache:'no-store',headers:{accept:format==='json'?'application/json':'text/html'},
    signal:AbortSignal.timeout(7000)});
  const age=scoreFeedAgeMs(response);
  if(!response.ok||age===null)throw Error('Official score source unavailable or stale');
  return {body:format==='json'?await response.json():await response.text(),age};
}

export function parseBbcScores(html){
  const raw=String(html||'').match(/window\.__INITIAL_DATA__=("(?:\\.|[^"\\])*")/);
  if(!raw)return [];
  let root;
  try{root=JSON.parse(JSON.parse(raw[1]))}catch{return []}
  const fixtures=Object.entries(root?.data||{}).filter(([key])=>key.startsWith('sport-data-scores-fixtures?'));
  return fixtures.flatMap(([,value])=>(value?.data?.eventGroups||[])
    .flatMap(group=>(group.secondaryGroups||[]).flatMap(section=>(section.events||[])
      .flatMap(event=>{
        const homeRaw=event.home?.score,awayRaw=event.away?.score;
        const home=Number(homeRaw),away=Number(awayRaw);
        const status=String(event.status||''),label=String(event.periodLabel?.value||'');
        const minute=label.match(/^(\d{1,3})(?:\+(\d{1,2}))?'$/);
        const elapsedMinute=minute?Number(minute[1])+Number(minute[2]||0):NaN;
        if(!event.id||!event.startDateTime||!event.home?.fullName||
          !event.away?.fullName||!/^\d+$/.test(String(homeRaw||''))||
          !/^\d+$/.test(String(awayRaw||''))||!whole(home)||!whole(away)||
          status!=='MidEvent'||Number.isFinite(elapsedMinute)&&
          (elapsedMinute<0||elapsedMinute>180))return [];
        const period=minute?(Number(minute[1])<=45?1:2):null;
        return [{source:'BBC Sport',eventId:String(event.id),time:event.startDateTime,
          homeAliases:[event.home.fullName,event.home.shortName].filter(Boolean),
          awayAliases:[event.away.fullName,event.away.shortName].filter(Boolean),
          home,away,period,seconds:NaN,elapsedMinute,periods:[],live:true}];
      }))));
}

export function parseNhlScore(game){
  const home=game?.homeTeam,away=game?.awayTeam;
  if(!game?.id||!game?.startTimeUTC||!home?.abbrev||!away?.abbrev||
    !whole(home.score)||!whole(away.score))return null;
  return {source:'NHL',eventId:String(game.id),time:game.startTimeUTC,
    homeAliases:[home.placeName?.default,home.commonName?.default,home.name?.default,
      home.abbrev,[home.placeName?.default,home.commonName?.default||home.name?.default].filter(Boolean).join(' ')].filter(Boolean),
    awayAliases:[away.placeName?.default,away.commonName?.default,away.name?.default,
      away.abbrev,[away.placeName?.default,away.commonName?.default||away.name?.default].filter(Boolean).join(' ')].filter(Boolean),
    home:home.score,away:away.score,period:game.periodDescriptor?.number,
    seconds:game.clock?.secondsRemaining,elapsedMinute:NaN,live:game.gameState==='LIVE',periods:[]};
}
export function parseNhlLanding(landing,expected){
  if(String(landing?.id)!==expected.eventId||landing.gameState!=='LIVE'||
    landing.homeTeam?.score!==expected.home||landing.awayTeam?.score!==expected.away||
    landing.periodDescriptor?.number!==expected.period||
    (landing.clock?.secondsRemaining!=null&&
      (!whole(landing.clock.secondsRemaining)||landing.clock.secondsRemaining>1200||
       whole(expected.seconds)&&landing.clock.secondsRemaining>expected.seconds))||
    landing.clock?.inIntermission===true)return null;
  const scoring=landing.summary?.scoring;
  if(!Array.isArray(scoring))return null;
  const periods=[];
  for(const section of scoring){
    const number=section.periodDescriptor?.number;
    if(!Number.isInteger(number)||number<1||number>4||number!==periods.length+1||
      !Array.isArray(section.goals))return null;
    const home=section.goals.filter(goal=>goal.teamAbbrev?.default===landing.homeTeam?.abbrev).length;
    const away=section.goals.filter(goal=>goal.teamAbbrev?.default===landing.awayTeam?.abbrev).length;
    if(home+away!==section.goals.length)return null;
    periods.push({number,home,away});
  }
  if(periods.reduce((n,p)=>n+p.home,0)!==expected.home||
    periods.reduce((n,p)=>n+p.away,0)!==expected.away)return null;
  return {...expected,seconds:landing.clock?.secondsRemaining??NaN,periods};
}

// The NFL's public scores page embeds structured game cards in its own HTML.
// Unknown page shapes, hidden scores and non-live phases never authorize entry.
export function parseNflScores(html){
  const chunks=[...String(html||'').matchAll(/self\.__next_f\.push\(\[1,("(?:\\.|[^"\\])*")\]\)/g)];
  const results=[];
  for(const [,raw] of chunks){
    let data;
    try{
      const line=JSON.parse(raw);
      if(!line.includes('carouselCardPropsList'))continue;
      const root=JSON.parse(line.slice(line.indexOf(':')+1));
      data=root?.[3]?.state?.queries?.[0]?.state?.data?.data;
    }catch{continue}
    for(const card of data?.carouselCardPropsList||[]){
      const summary=card?.gameSummary,home=card?.homeTeam,away=card?.awayTeam;
      const homeScore=summary?.homeTeam?.score?.total??home?.summary?.score?.total;
      const awayScore=summary?.awayTeam?.score?.total??away?.summary?.score?.total;
      const q=String(summary?.quarter||'').match(/^Q([1-4])$/);
      const seconds=clockSeconds(summary?.clock);
      if(!card?.gameId||!card?.gameTime||!home?.abbreviation||!away?.abbreviation||
        !whole(homeScore)||!whole(awayScore)||!q||!Number.isFinite(seconds)||
        summary.phase!=='LIVE')continue;
      results.push({source:'NFL',eventId:card.gameId,time:card.gameTime,
        homeAliases:[home.abbreviation,home.abbreviationScreenReaderText,home.standings?.team?.fullName].filter(Boolean),
        awayAliases:[away.abbreviation,away.abbreviationScreenReaderText,away.standings?.team?.fullName].filter(Boolean),
        home:homeScore,away:awayScore,period:Number(q[1]),seconds,elapsedMinute:NaN,
        periods:[],live:true});
    }
  }
  return results;
}

export async function loadOfficialScores(game,milestone,{fetcher=fetch,matchFixture=()=>true}={}){
  const sport=officialFallbackSport(game),start=Date.parse(milestone?.start_date||'');
  if(!sport||!Number.isFinite(start))return null;
  try{
    if(sport==='NFL'){
      const {body,age}=await read('https://www.nfl.com/scores/',fetcher,'html');
      return parseNflScores(body).filter(matchFixture).map(item=>({...item,sourceAgeMs:age}));
    }
    const urls=dates(start).map(date=>sport==='NHL'?`https://api-web.nhle.com/v1/score/${date}`:
      `https://www.bbc.com/sport/football/scores-fixtures/${date}`);
    const replies=await Promise.allSettled(urls.map(url=>read(url,fetcher,sport==='NHL'?'json':'html')));
    const successful=replies.filter(result=>result.status==='fulfilled').map(result=>result.value);
    if(!successful.length)return null;
    if(sport==='BBC Sport')return successful.flatMap(({body,age})=>parseBbcScores(body)
      .filter(matchFixture).map(item=>({...item,sourceAgeMs:age})));
    const matches=successful.flatMap(({body,age})=>(body?.games||[])
      .map(parseNhlScore).filter(Boolean).filter(matchFixture).map(item=>({...item,sourceAgeMs:age})));
    const unique=[...new Map(matches.map(item=>[item.eventId,item])).values()];
    if(matches.some(item=>unique.find(other=>other.eventId===item.eventId&&
      (other.home!==item.home||other.away!==item.away||other.period!==item.period))))return false;
    if(unique.length!==1)return unique;
    const selected=unique[0];
    const {body,age}=await read(`https://api-web.nhle.com/v1/gamecenter/${selected.eventId}/landing`,fetcher,'json');
    const exact=parseNhlLanding(body,selected);
    return exact?[{...exact,sourceAgeMs:Math.max(selected.sourceAgeMs,age)}]:false;
  }catch{return null}
}
