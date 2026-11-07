// ESPN's default college scoreboard is a subset, even with a large limit.
// Use the declared football division when known; otherwise inspect both D-I
// divisions. Fixture identity and score agreement still gate every decision.
export function espnScoreboardUrls(feed,game,milestone,dates){
  const division=String(milestone?.details?.division||'').toUpperCase();
  const groups=game.sport==='CFB'?(division==='FBS'?['80']:division==='FCS'?['81']:['80','81']):
    ['NCAAB','NCAAW'].includes(game.sport)?['50']:[''];
  return [...new Set(dates)].flatMap(day=>groups.map(group=>
    `https://site.api.espn.com/apis/site/v2/sports/${feed}/scoreboard?dates=${day}&limit=500${group?'&groups='+group:''}`));
}
