export function selectedTeamName(order){
  if(order.strategy!=='lead')return null;
  const named=String(order.reason||'').match(/(?:^|: )([^;:]+?) leads \d/i)?.[1]?.trim();
  if(named)return named;
  const title=String(order.game_title||'');
  const teams=title.split(/\s+(?:vs|at)\s+/i).map(s=>s.trim());
  if(teams.length!==2)return null;
  const signal=(order.game_signals||[]).find(s=>s.ticker===order.market_ticker);
  const winner=String(signal?.title||'').match(/^(.+?) wins$/i)?.[1]?.trim();
  return teams.find(team=>team.toLowerCase()===winner?.toLowerCase())||null;
}
