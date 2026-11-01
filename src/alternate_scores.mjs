import {playerOverSpec} from './strategy.mjs';
const clean=s=>String(s||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
const clubs={ATL:'atlanta-hawks',BOS:'boston-celtics',BKN:'brooklyn-nets',CHA:'charlotte-hornets',CHI:'chicago-bulls',CLE:'cleveland-cavaliers',DAL:'dallas-mavericks',DEN:'denver-nuggets',DET:'detroit-pistons',GSW:'golden-state-warriors',HOU:'houston-rockets',IND:'indiana-pacers',LAC:'los-angeles-clippers',LAL:'los-angeles-lakers',MEM:'memphis-grizzlies',MIA:'miami-heat',MIL:'milwaukee-bucks',MIN:'minnesota-timberwolves',NOP:'new-orleans-pelicans',NYK:'new-york-knicks',OKC:'oklahoma-city-thunder',ORL:'orlando-magic',PHI:'philadelphia-76ers',PHX:'phoenix-suns',POR:'portland-trail-blazers',SAC:'sacramento-kings',SAS:'san-antonio-spurs',TOR:'toronto-raptors',UTA:'utah-jazz',WAS:'washington-wizards'};
const club=name=>Object.keys(clubs).find(k=>String(name).startsWith(k+' ')||clean(name)===clean(clubs[k]));
const text=s=>s.replace(/<[^>]*>/g,'').replace(/&nbsp;/g,' ').trim();
export function cbsPlayerValue(html,player){
 const values=[];
 for(const table of html.match(/<table\b[^>]*class="stats-table"[^>]*>[\s\S]*?<\/table>/g)||[]){
  const rows=table.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/g)||[],headers=(rows[0]?.match(/<td\b[^>]*>[\s\S]*?<\/td>/g)||[]).map(text);
  const keys=player.metric==='PRA'?['PTS','REB','AST']:[player.metric];const indexes=keys.map(k=>headers.indexOf(k));if(indexes.some(i=>i<0))continue;
  for(const row of rows.slice(1)){
   const slug=row.match(/\/nba\/players\/\d+\/([^/"?]+)\//)?.[1];if(clean(slug)!==clean(player.name))continue;
   const cells=(row.match(/<td\b[^>]*>[\s\S]*?<\/td>/g)||[]).map(text),nums=indexes.map(i=>/^\d+(?:\/\d+)?$/.test(cells[i]||'')?Number(cells[i].split('/')[0]):NaN);
   if(nums.every(Number.isInteger))values.push(nums.reduce((a,b)=>a+b,0));
  }
 }
 return values.length&&values.every(n=>n===values[0])?values[0]:null;
}
export function yahooGames(html){
 let flight='';for(const m of html.matchAll(/self\.__next_f\.push\(\[1,("(?:\\.|[^"\\])*")\]\)/g))try{flight+=JSON.parse(m[1])}catch{}
 const games=[];const walk=v=>{if(!v||typeof v!=='object')return;if(v.gameId&&v.playerStats)games.push(v);for(const x of Object.values(v))walk(x)};
 for(const line of flight.split('\n'))try{walk(JSON.parse(line.slice(line.indexOf(':')+1)))}catch{}
 return games;
}
export function yahooPlayerValue(game,player){
 const values=[],keys=player.metric==='PRA'?['POINTS','TOTAL_REBOUNDS','ASSISTS']:[{PTS:'POINTS',REB:'TOTAL_REBOUNDS',AST:'ASSISTS',STL:'STEALS',BLK:'BLOCKS','3PT':'THREE_POINTS_MADE_ATTEMPTED'}[player.metric]];
 for(const table of [...(game.playerStats?.homeTables||[]),...(game.playerStats?.awayTables||[])])for(const row of table.tableStats||[]){
  if(clean(row.player?.displayName)!==clean(player.name))continue;
  const stats=row.player.playerGameStats0?.[0]?.stats;
  if(!Array.isArray(stats))continue;
  const nums=keys.map(k=>{const v=stats.find(s=>s.statId===k)?.value;return typeof v==='string'&&/^\d+(?:-\d+)?$/.test(v)?Number(v.split('-')[0]):NaN});
  if(nums.every(Number.isInteger))values.push(nums.reduce((a,b)=>a+b,0));
 }
 return values.length&&values.every(n=>n===values[0])?values[0]:null;
}
export async function alternateCheck(source,game,milestone,{fetcher=fetch,market}={}){
 if(game.sport!=='NBA')return null;
 const home=club(game.homeName),away=club(game.awayName),player=playerOverSpec(game,market);
 if(!home||!away)return null;
 const date=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(milestone.start_date)).replaceAll('-','');
 const read=async url=>{const r=await fetcher(url,{headers:{accept:'text/html'},signal:AbortSignal.timeout(7000)});if(!r.ok)throw Error('Unavailable');return r.text()};
 try{
  if(source==='CBS'){
   if(!player)return null;
   const codes={NYK:'NY',GSW:'GS',NOP:'NO',SAS:'SA',UTA:'UTA',PHX:'PHO'};
   const path=`/nba/gametracker/boxscore/NBA_${date}_${codes[away]||away}@${codes[home]||home}/`;
   const html=await read('https://www.cbssports.com'+path);
   if(!html.includes('https://www.cbssports.com'+path))return null;
   const value=cbsPlayerValue(html,player);return value===null?null:value===player.value;
  }
  const board=await read(`https://sports.yahoo.com/nba/scoreboard/?date=${date.slice(0,4)}-${date.slice(4,6)}-${date.slice(6)}`);
  const prefix=`https://sports.yahoo.com/nba/${clubs[away]}-${clubs[home]}-${date}`;
  const urls=[...new Set(board.match(new RegExp(prefix+'[0-9]+/','g'))||[])];if(urls.length!==1)return null;
  const html=await read(urls[0]),id=urls[0].match(/-(\d+)\/$/)[1];
  const matches=yahooGames(html).filter(g=>g.gameId==='nba.g.'+id&&Math.abs(Date.parse(g.startTime)-Date.parse(milestone.start_date))<3*3600000);
  if(matches.length!==1)return null;const g=matches[0];
  if(player){const value=yahooPlayerValue(g,player);return value===null?null:value===player.value}
  if(/[1-9](?:Q|P|H|INNING)(?:TEAM)?TOTAL/.test(market?.event_ticker||''))return null;
  return Number.isInteger(g.homeScore)&&Number.isInteger(g.awayScore)?g.homeScore===game.home&&g.awayScore===game.away:null;
 }catch{return null}
}
