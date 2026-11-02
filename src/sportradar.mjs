// Server-only fallback. Credentials never appear in a URL or returned evidence.
const number=v=>v===null||v===undefined||v===''?NaN:Number(v);
const person=name=>String(name||'').includes(',')?String(name).split(',').reverse().map(s=>s.trim()).join(' '):name;
const aliases=t=>[t?.name,t?.alias,t?.abbreviation,`${t?.alias||t?.abbreviation||''} ${t?.name||''}`,`${t?.market||''} ${t?.name||''}`,person(t?.name)];
const clean=s=>String(person(s)||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
const nextRequest=new Map();
export async function sportradarJson(url,{fetcher=fetch,apiKey=process.env.SPORTRADAR_API_KEY,minInterval=1100}={}){
  const product=new URL(url).pathname.split('/')[1],now=Date.now(),slot=Math.max(now,nextRequest.get(product)||0);
  if(slot-now>2200)throw Error('rate limit busy');
  nextRequest.set(product,slot+minInterval);
  if(slot>now)await new Promise(resolve=>setTimeout(resolve,slot-now));
  const response=await fetcher(url,{headers:{accept:'application/json','x-api-key':apiKey},signal:AbortSignal.timeout(4000)});
  if(!response.ok)throw Error(`HTTP ${response.status}`);
  const age=Number(response.headers?.get('age')||0);
  if(!url.endsWith('/schedule.json')&&age>10)throw Error('stale response');
  return response.json();
}
export function sportradarProduct(game){
  if(/esports/.test(game.type))return null;
  if(game.type==='cricket_match')return {path:'cricket',cricket:true};
  const domestic={NBA:['nba',8],WNBA:['wnba',8],NCAAB:['ncaamb',8],NCAAW:['ncaawb',8],NFL:['nfl/official',7],CFB:['ncaafb',7]};
  if(domestic[game.sport])return {path:domestic[game.sport][0],version:domestic[game.sport][1],domestic:true};
  const family=String(game.type||'');
  const map=[[/table_tennis|tabletennis/,'tabletennis',2],[/^tennis_/,'tennis',3],[/basketball/,'basketball',2],
    [/baseball/,'baseball',2],[/football/,'americanfootball',2],[/hockey/,'icehockey',2],[/soccer/,'soccer',4],
    [/handball/,'handball',2],[/volleyball/,'volleyball',2],[/darts/,'darts',2]];
  if(/rugby/.test(family)){
    const league=String(game.competition||'');
    const kind=/sevens|\b7s\b/i.test(league)?'sevens':/NRL|Super League|rugby league/i.test(league)?'league':/union|Six Nations|Premiership|United Rugby|Top 14|Super Rugby/i.test(league)?'union':null;
    return kind?{path:`rugby-${kind}`,version:3}:null;
  }
  const found=map.find(([pattern])=>pattern.test(family));
  return found?{path:found[1],version:found[2]}:null;
}
function globalReading(row){
  const e=row?.sport_event,s=row?.sport_event_status;
  if(!e||!s)return null;
  const home=e.competitors?.find(c=>c.qualifier==='home'),away=e.competitors?.find(c=>c.qualifier==='away');
  if(!home||!away)return null;
  return {eventId:e.id,time:e.start_time,homeAliases:aliases(home),awayAliases:aliases(away),
    home:number(s.home_score),away:number(s.away_score),live:s.status==='live',
    period:number(String(s.match_status||'').match(/^(\d+)(?:st|nd|rd|th)_/)?.[1]),
    clock:s.clock?.remaining_time_in_period||(e.sport_event_context?.sport?.id==='sr:sport:1'?(s.clock?.played||s.clock?.match_time):undefined),
    periods:(s.period_scores||[]).map(p=>({number:number(p.number),home:number(p.home_score),away:number(p.away_score),type:p.type})),
    players:(row.statistics?.totals?.competitors||[]).flatMap(c=>c.players||[]),raw:row};
}
function domesticReading(g){
  const home=g.home||g.summary?.home,away=g.away||g.summary?.away;
  if(!home||!away)return null;
  return {eventId:g.id,time:g.scheduled,homeAliases:aliases(home),awayAliases:aliases(away),
    home:number(home.points),away:number(away.points),live:g.status==='inprogress',
    period:number(g.quarter||g.period),clock:g.clock,
    periods:(home.scoring||[]).map(p=>({number:number(p.number),home:number(p.points),away:number(away.scoring?.find(a=>a.number===p.number)?.points)})),
    players:[...(home.players||[]),...(away.players||[])],raw:g};
}
export function sportradarPlayerValue(reading,player){
  const group={PASSYDS:'passing',RUSHYDS:'rushing',RECYDS:'receiving'}[player.metric];
  const candidates=group?['home','away'].flatMap(side=>reading.raw?.statistics?.[side]?.[group]?.players||[]):reading.players||[];
  const found=candidates.filter(p=>clean(p.full_name||p.name)===clean(player.name));
  if(found.length!==1)return null;
  const p=found[0],s=p.statistics||p;
  const keys=group?['yards']:player.metric==='PRA'?['points','rebounds','assists']:[{PTS:'points',REB:'rebounds',AST:'assists','3PT':'three_points_made',STL:'steals',BLK:'blocks'}[player.metric]];
  const values=keys.map(k=>number(s[k]??(k==='rebounds'?s.total_rebounds:k==='three_points_made'?s.three_pointers_made:undefined)));
  return values.every(n=>Number.isInteger(n)&&n>=0)?values.reduce((a,b)=>a+b,0):null;
}
export async function loadSportradar(game,milestone,{fetcher=fetch,apiKey=process.env.SPORTRADAR_API_KEY,accessLevel=process.env.SPORTRADAR_ACCESS_LEVEL||'trial',matchFixture,unavailableReasons=[],market,minInterval}={}){
  const product=sportradarProduct(game);
  if(!apiKey||!product){unavailableReasons.push(`Sportradar: ${!apiKey?'key not configured':'no verified adapter for this sport'}`);return null;}
  if(!['trial','production'].includes(accessLevel))return null;
  const base=`https://api.sportradar.com/${product.path}/${accessLevel}/v${product.version}/en`;
  const read=path=>sportradarJson(base+path,{fetcher,apiKey,minInterval});
  try{
    if(product.cricket){
      const date=new Date(milestone.start_date).toISOString().slice(0,10);
      const cricketBase=`https://api.sportradar.com/cricket-${accessLevel==='trial'?'t':'p'}2/en`;
      const readCricket=path=>sportradarJson(cricketBase+path,{fetcher,apiKey,minInterval});
      const schedule=await readCricket(`/schedules/${date}/schedule.json`);
      const exact=(schedule.sport_events||[]).filter(e=>matchFixture(aliases(e.competitors?.find(c=>c.qualifier==='home')),aliases(e.competitors?.find(c=>c.qualifier==='away')),e.scheduled));
      if(exact.length!==1)return exact.length>1?{ambiguous:true}:null;
      const id=exact[0].id;if(!/^sr:match:\d+$/.test(id))return null;
      const detail=await readCricket(`/matches/${id}/summary.json`),e=detail.sport_event,s=detail.sport_event_status;
      if(e?.id!==id||!['odi','list_a','t20','t20i'].includes(e.tournament?.type)||!s)return null;
      const innings=s.period_scores||[];
      // Multi-innings, missing innings and mixed score units cannot establish a run total.
      if(![1,2].includes(s.current_inning)||innings.length!==s.current_inning||innings.some((p,i)=>p.type!=='inning'||p.number!==i+1||![p.home_score,p.away_score].every(Number.isInteger)))return null;
      const reading=globalReading({...detail,sport_event:{...e,start_time:e.scheduled},sport_event_status:{...s,home_score:innings.reduce((n,p)=>n+p.home_score,0),away_score:innings.reduce((n,p)=>n+p.away_score,0)}});
      if(reading)reading.period=s.current_inning;
      return reading?[reading]:null;
    }
    if(!product.domestic){
      const data=await read('/schedules/live/summaries.json');
      // Live feeds have a one-second provider cache. Do not substitute the
      // five-minute daily summaries for a fresh trade decision.
      if(!Array.isArray(data.summaries))return null;
      const generated=Date.parse(data.generated_at||'');
      if(!Number.isFinite(generated)||Date.now()-generated>10000||generated>Date.now()+5000){unavailableReasons.push('Sportradar: stale live feed');return null;}
      const readings=data.summaries.map(globalReading).filter(Boolean);
      const series=String(market?.event_ticker||'').split('-')[0];
      if(product.path==='soccer'&&/TOTAL$/.test(series)&&!/TEAMTOTAL$|[1-9](?:Q|P|H|INNING)TOTAL$/.test(series)){
        const exact=readings.filter(r=>matchFixture(r.homeAliases,r.awayAliases,r.time));
        if(exact.length===1&&/^sr:sport_event:\d+$/.test(exact[0].eventId)){
          const detail=await read(`/sport_events/${exact[0].eventId}/timeline.json`);
          if(detail.sport_event?.id!==exact[0].eventId)return null;
          const goals=(detail.timeline||[]).filter(p=>p.type==='score_change'&&p.period_type==='regular_period');
          let home=0,away=0;
          const complete=goals.every(p=>{
            const h=number(p.home_score),a=number(p.away_score),valid=h>=home&&a>=away&&h+a===home+away+1;
            home=h;away=a;return valid;
          });
          exact[0].documentedGoals=complete&&home===exact[0].home&&away===exact[0].away?home+away:NaN;
          return exact;
        }
      }
      return readings;
    }
    const start=Date.parse(milestone.start_date||'');
    if(!Number.isFinite(start))return null;
    let path;
    if(product.path==='nfl/official')path='/games/current_week/schedule.json';
    else if(product.path==='ncaafb')path=`/games/${new Date(start).getUTCFullYear()}/REG/schedule.json`;
    else{
      // US league schedules use the US Eastern calendar day.
      const date=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(start));
      path=`/games/${date.replaceAll('-','/')}/schedule.json`;
    }
    const schedule=await read(path),games=schedule.games||schedule.week?.games||schedule.weeks?.flatMap(w=>w.games||[])||[];
    const matches=games.filter(g=>matchFixture(aliases(g.home),aliases(g.away),g.scheduled));
    if(matches.length!==1)return matches.length>1?{ambiguous:true}:null;
    const id=matches[0].id;
    if(!/^[a-f0-9-]{36}$/i.test(id))return null;
    const suffix=/nfl|ncaafb/.test(product.path)?'statistics':'summary';
    const detail=await read(`/games/${id}/${suffix}.json`);
    if(detail.id!==id)return null;
    const reading=domesticReading(detail);
    return reading?[reading]:null;
  }catch(error){unavailableReasons.push(`Sportradar: ${error.name==='TimeoutError'?'timeout':/^HTTP \d+$/.test(error.message)?error.message:'request failed'}`);return null;}
}
