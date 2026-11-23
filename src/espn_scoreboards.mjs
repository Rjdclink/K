// ESPN has separate soccer scoreboard feeds for only a subset of Kalshi's
// leagues. These slugs were checked against ESPN's November 22, 2026 boards.
// Unknown leagues remain on soccer/all; never substitute another league.
const soccerLeagueSlugs={
 'bundesliga':'ger.1','german bundesliga':'ger.1',
 'epl':'eng.1','premier league':'eng.1','english premier league':'eng.1',
 'serie a':'ita.1','italian serie a':'ita.1',
 'serie b':'ita.2','italian serie b':'ita.2',
 'ligue 1':'fra.1','french ligue 1':'fra.1',
 'eredivisie':'ned.1','dutch eredivisie':'ned.1',
 'la liga':'esp.1','laliga':'esp.1','spanish la liga':'esp.1',
 'spanish liga f':'esp.w.1',
 'la liga 2':'esp.2','laliga 2':'esp.2','spanish segunda division':'esp.2',
 'austrian bundesliga':'aut.1',
 'greece super league':'gre.1','greek super league':'gre.1',
 'eliteserien':'nor.1','norwegian eliteserien':'nor.1',
 'danish superliga':'den.1',
 'allsvenskan':'swe.1','swedish allsvenskan':'swe.1',
 'belgian pro league':'bel.1',
 'indian super league':'ind.1',
 'english championship':'eng.2','efl championship':'eng.2',
 '2. bundesliga':'ger.2','german 2. bundesliga':'ger.2',
 'russian premier league':'rus.1',
 'mls':'usa.1','major league soccer':'usa.1',
 // Exact Kalshi league labels whose current games exist on ESPN's small
 // league boards. A missing fixture may still fall back to ESPN's all board;
 // team identity, kickoff, score, period, and CDN freshness remain mandatory.
 'chile liga de primera':'chi.1',
 'argentine nacional b':'arg.2',
 'argentina primera division':'arg.1',
 'liga mx':'mex.1',
 'bolivia premier division':'bol.1'
};
export function espnSoccerLeagueFeed(milestone){
 const league=String(milestone?.details?.league||'').trim().toLowerCase();
 const slug=soccerLeagueSlugs[league];
 return slug?'soccer/'+slug:null;
}
// ESPN's default college scoreboard is a subset, even with a large limit.
// Respect college divisions, and never treat a soccer league slug as another sport.
export function espnScoreboardUrls(feed,game,milestone,dates,{forceAll=false}={}){
  const actual=feed==='soccer/all'&&!forceAll?espnSoccerLeagueFeed(milestone)||feed:feed;
  const division=String(milestone?.details?.division||'').toUpperCase();
  const groups=game.sport==='CFB'?(division==='FBS'?['80']:division==='FCS'?['81']:['80','81']):
    ['NCAAB','NCAAW'].includes(game.sport)?['50']:[''];
  return [...new Set(dates)].flatMap(day=>groups.map(group=>
    'https://site.api.espn.com/apis/site/v2/sports/'+actual+'/scoreboard?dates='+day+
    '&limit=500'+(group?'&groups='+group:'')));
}