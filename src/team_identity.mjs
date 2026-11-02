// Provider codes describe the same franchise only within the selected league.
// Keep the remainder of the name intact: an alias never changes a mascot or city.
const groups={
  NBA:[['GSW','GS'],['NYK','NY'],['SAS','SA'],['NOP','NO'],['PHX','PHO'],['WAS','WSH'],['UTA','UTAH']],
  WNBA:[['NYL','NY'],['LAS','LA'],['LVA','LV'],['CON','CONN'],['WAS','WSH']],
  NFL:[['WAS','WSH'],['JAC','JAX'],['LA','LAR'],['LV','LVR'],['GB','GNB'],['KC','KAN'],['NE','NWE'],['NO','NOR'],['SF','SFO'],['TB','TAM']],
  MLB:[['ARI','AZ'],['CHW','CWS'],['KC','KCR'],['SD','SDP'],['SF','SFG'],['TB','TBR'],['WAS','WSH','WSN'],['ATH','OAK']],
  NHL:[['LA','LAK'],['NJ','NJD'],['SJ','SJS'],['TB','TBL'],['MON','MTL']],
  CFB:[['UCONN','CONN'],['UMASS','MASS'],['SJSU','SJS'],['NMSU','NMS']],
  NCAAB:[['UCONN','CONN']],NCAAW:[['UCONN','CONN']]
};
export function teamAbbreviationVariants(name,sport){
  const text=String(name||'').trim(),match=text.match(/^([A-Za-z]{2,5})(\s+.*)?$/);
  if(!match)return [text];
  const group=groups[String(sport||'').toUpperCase()]?.find(codes=>codes.includes(match[1].toUpperCase()));
  return group?[...new Set([text,...group.map(code=>code+(match[2]||''))])]:[text];
}
