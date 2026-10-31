export function selectedTeamName(order){
  if(order.strategy!=='lead')return null;
  const title=String(order.game_title||'');
  const teams=title.split(/\s+(?:vs|at)\s+/i).map(s=>s.trim());
  const named=String(order.reason||'').match(/(?:^|: )([^;:]+?) leads(?:\s+\d|;)/i)?.[1]?.trim();
  if(teams.length!==2)return named||null;
  if(named){
    const exact=teams.find(team=>team.toLowerCase()===named.toLowerCase());
    if(exact)return exact;
  }
  const signal=(order.game_signals||[]).find(s=>s.ticker===order.market_ticker);
  const winner=String(signal?.title||'').match(/^(.+?) wins$/i)?.[1]?.trim();
  const exact=teams.find(team=>team.toLowerCase()===winner?.toLowerCase());
  if(exact)return exact;
  if(/tennis/i.test(order.sport_family||order.sport||'')&&winner){
    const suffix=teams.filter(team=>winner.toLowerCase().endsWith(' '+team.toLowerCase()));
    if(suffix.length===1)return suffix[0];
  }
  if(named)return named;
  const side=selectedTeamSide(order);
  return side?(title.includes(' at ')?teams[side==='home'?1:0]:teams[side==='home'?0:1]):null;
}
export function selectedTeamSide(order){
  if(order.strategy!=='lead')return null;
  if(/tennis/i.test(order.sport_family||order.sport||''))return selectedTennisSide(order);
  const reason=String(order.reason||'');
  const match=reason.match(/verified match totals (\d+)[–-](\d+) runs/i)||reason.match(/\bleads\s+(\d+(?:\.\d+)?)[–-](\d+(?:\.\d+)?)/i);
  if(match&&Number(match[1])!==Number(match[2]))return Number(match[1])>Number(match[2])?'home':'away';
  const name=String(reason.match(/(?:^|: )([^;:]+?) leads;/i)?.[1]||'').trim();
  const teams=String(order.game_title||'').split(/\s+(?:vs|at)\s+/i).map(s=>s.trim());
  if(name&&teams.length===2){const at=teams.findIndex(team=>team.toLowerCase()===name.toLowerCase());
    if(at>=0)return order.game_title.includes(' at ')?at===1?'home':'away':at===0?'home':'away';}
  return null;
}
export function selectedTennisSide(order){
  if(order.strategy!=='lead'||!/tennis/i.test(order.sport_family||order.sport||''))return null;
  const games=String(order.reason||'').match(/Tennis match-clinching set (\d+)[–-](\d+)/i);
  if(!games)return null;
  const leader=Number(games[1]),trailer=Number(games[2]);
  const home=Number(order.purchase_home),away=Number(order.purchase_away);
  if(!Number.isFinite(home)||!Number.isFinite(away)||leader<=trailer)return null;
  return home===leader&&away===trailer?'home':away===leader&&home===trailer?'away':null;
}
