// Only independently confirmed ESPN coverage gaps are eligible for Flashscore.
// This is an undocumented public site feed, not a contracted API: failures
// remain unavailable and must never authorize a Kalshi-only trade.
const hockey=Object.freeze({
  AHL:['/hockey/usa/ahl/'],
  'Czech Extraliga':['/hockey/czech-republic/extraliga/'],
  'Finland Liiga':['/hockey/finland/liiga/'],
  'Germany DEL':['/hockey/germany/del/'],
  KHL:['/hockey/russia/khl/'],
  'Ligue Magnus':['/hockey/france/ligue-magnus/'],
  'Polska Hokej Liga':['/hockey/poland/polish-hockey-league/'],
  SHL:['/hockey/sweden/shl/'],
  'Switzerland National League':['/hockey/switzerland/national-league/']
});
const soccer=Object.freeze({
  'Japan J2 League':['/football/japan/j2-league/'],
  'Korea K League 1':['/football/south-korea/k-league-1/'],
  'Korea K-League 2':['/football/south-korea/k-league-2/'],
  'German 3. Liga':['/football/germany/3-liga/'],
  'Serie C':['/football/italy/serie-c-group-a/','/football/italy/serie-c-group-b/','/football/italy/serie-c-group-c/']
});
export function flashscoreCompetition(game,milestone){
  const type=String(game?.type||milestone?.type||'');
  if(/esports/i.test(type)||/esports/i.test(String(game?.sport||'')))return null;
  const league=String(milestone?.details?.league||game?.competition||'');
  if(type.startsWith('hockey_')&&hockey[league])return {sportId:4,paths:hockey[league]};
  if(type.startsWith('soccer_')&&soccer[league])return {sportId:1,paths:soccer[league]};
  return null;
}
// Exact, competition-scoped aliases observed on the public match listings.
// Never infer a team's identity from a score or an unrelated league.
const hockeyAliases=Object.freeze({
  'Polska Hokej Liga':{'GKS Tychy':'Tychy','TMH Polonia Bytom':'Bytom','KH Energa Torun':'Torun'},
  'Germany DEL':{'Fischtown Pinguins':'Bremerhaven','Nuremberg Ice Tigers':'Nurnberg Ice Tigers',
    'Red Bull Munich':'Munchen','Kolner Haie':'Kolner'},
  KHL:{'Ak Bars Kazan':'Bars Kazan','HK Avangard Omsk':'Avangard Omsk'},
  'Czech Extraliga':{'BK Mlada Boleslav':'Mlada Boleslav','Bili Tygri Liberec':'Liberec',
    'HC Verva Litvinov':'Litvinov','HC Rytiri Kladno':'Kladno'}
});
// Kalshi tournament titles place the away club first. These are solely
// fixture-identity hints; the score and goals must come from Flashscore.
export function flashscoreFixture(game,milestone){
  if(!flashscoreCompetition(game,milestone))return game;
  let fixture=game;
  if(game?.type==='hockey_tournament'&&!game.homeName&&!game.awayName){
    const parts=String(milestone?.title||'').split(/\s+vs\.?\s+/i);
    if(parts.length===2)fixture={...game,homeName:parts[1],awayName:parts[0]};
  }
  const names=hockeyAliases[String(milestone?.details?.league||game?.competition||'')];
  return names?{...fixture,homeName:names[fixture.homeName]||fixture.homeName,
    awayName:names[fixture.awayName]||fixture.awayName}:fixture;
}
const fields=text=>Object.fromEntries(String(text).split('¬').map(part=>{
  const divider=part.indexOf('÷');return divider>0?[part.slice(0,divider),part.slice(divider+1)]:[];
}).filter(pair=>pair.length===2));
const whole=value=>/^(?:0|[1-9]\d*)$/.test(String(value??''))?Number(value):NaN;
function periods(row,sportId,home,away){
  const list=[];
  for(let i=0;i<(sportId===4?3:2);i++){
    const h=whole(row[['BA','BC','BE'][i]]),a=whole(row[['BB','BD','BF'][i]]);
    if(!Number.isInteger(h)||!Number.isInteger(a))break;
    list.push({number:i+1,home:h,away:a});
  }
  return list.length&&list.reduce((n,p)=>n+p.home,0)===home&&
    list.reduce((n,p)=>n+p.away,0)===away?list:[];
}
export function parseFlashscoreFeed(content,competition){
  if(!competition||!String(content).startsWith('SA÷'+competition.sportId+'¬'))return [];
  const matches=[];
  for(const section of content.split('~ZA÷').slice(1)){
    const [league,...games]=section.split('~AA÷');
    if(!competition.paths.includes(fields(league).ZL))continue;
    for(const text of games){
      const v=fields('AA÷'+text),home=whole(v.AG),away=whole(v.AH),start=whole(v.AD);
      if(!/^[a-zA-Z0-9]{8}$/.test(v.AA||'')||!v.AE||!v.AF||
        ![home,away,start].every(Number.isSafeInteger)||![1,2,3].includes(Number(v.AB)))continue;
      const phase=Number(v.AC),period=competition.sportId===4?
        ({14:1,15:2,16:3}[phase]??NaN):({12:1,13:2}[phase]??NaN);
      matches.push({source:'Flashscore',eventId:v.AA,time:new Date(start*1000).toISOString(),
        homeAliases:[v.AE,v.FH].filter(Boolean),awayAliases:[v.AF,v.FK].filter(Boolean),
        home,away,period,periods:periods(v,competition.sportId,home,away),
        live:v.AB==='2',seconds:NaN,elapsedMinute:NaN,documentedGoals:NaN});
    }
  }
  return matches;
}
export async function loadFlashscore(game,milestone,{fetcher=fetch,now=Date.now()}={}){
  const competition=flashscoreCompetition(game,milestone);
  if(!competition)return null;
  const start=Date.parse(milestone?.start_date||'');
  if(!Number.isFinite(start))return null;
  // Flashscore serves a separate scoreboard for each UTC-5 calendar day.
  const day=ms=>Date.parse(new Date(ms-5*3600000).toISOString().slice(0,10)+'T00:00:00Z');
  const offset=Math.round((day(start)-day(now))/86400000);
  if(Math.abs(offset)>2)return null;
  // The default CDN scoreboard can be minutes old despite no-store; request
  // the current public snapshot and still reject any provider age >10 seconds.
  const url=`https://global.flashscore.ninja/2/x/feed/f_${competition.sportId}_${offset}_-5_en_1?t=${Math.floor(now/1000)}`;
  try{
    const response=await fetcher(url,{cache:'no-store',headers:{accept:'text/plain',referer:'https://www.flashscore.com/','x-fsign':'SW9D1eZo'},signal:AbortSignal.timeout(7000)});
    if(!response.ok||Number(response.headers?.get?.('age')||0)>10)return null;
    const data=await response.text();
    if(data.length>3000000)return null;
    return parseFlashscoreFeed(data,competition);
  }catch{return null}
}
