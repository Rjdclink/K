// Compare evidence only after the provider's fixture/player identity is resolved.
export function externalValueQualifies(actual,expected,line){
  return Number.isFinite(actual)&&actual>=0&&Number.isFinite(expected)&&
    (actual>=expected||Number.isFinite(line)&&actual>line);
}
const clean=s=>String(s||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
export function selectedTeamSide(game,market){
  const id=Object.entries(market?.custom_strike||{}).find(([key,value])=>/_team$/.test(key)&&typeof value==='string')?.[1];
  if(id)return id===game.homeTeamId?'home':id===game.awayTeamId?'away':null;
  const title=clean(`${market?.title||''} ${market?.yes_sub_title||''}`),home=clean(game.homeName),away=clean(game.awayName);
  const h=home.length>=3&&title.includes(home),a=away.length>=3&&title.includes(away);
  return h!==a?h?'home':'away':null;
}
export function externalScoresQualify(game,reading,market,{expected=game,actual=reading,player=false,minimumMargin,minimumOverValue,onOverValue}={}){
  if(![actual?.home,actual?.away].every(n=>Number.isInteger(n)&&n>=0))return false;
  if(player)return true; // The independently read named statistic is checked next.
  const series=String(market?.event_ticker||'').split('-')[0],line=Number(market?.floor_strike);
  const hasLine=market?.floor_strike!=null&&Number.isFinite(line);
  const qualifies=(value,baseline)=>{const passed=(minimumOverValue===undefined||value>=minimumOverValue)&&externalValueQualifies(value,baseline,line);if(passed)onOverValue?.(value);return passed};
  if(/TOTAL$/.test(series)&&hasLine){
    if(/^KX(?:ATP|WTA)GTOTAL$/.test(series))return qualifies(reading.totalGames,game.tennisTotal);
    if(/TEAMTOTAL$/.test(series)){
      const side=selectedTeamSide(game,market);
      return Boolean(side)&&qualifies(actual[side],expected[side]);
    }
    return qualifies(actual.home+actual.away,expected.home+expected.away);
  }
  if(minimumOverValue!==undefined)return false;
  if(actual.home===expected.home&&actual.away===expected.away)return true;
  if(/^(?:draw|tie)(?:\b|\/)/i.test(String(market?.title||market?.yes_sub_title||'')))
    return expected.home===expected.away&&actual.home===actual.away;
  if(!/win|winner|victory/i.test(`${market?.title||''} ${market?.rules_primary||''}`))return false;
  const side=selectedTeamSide(game,market);
  if(!side)return false;
  const sign=side==='home'?1:-1,baseline=minimumMargin??sign*(expected.home-expected.away);
  return baseline>0&&sign*(actual.home-actual.away)>=baseline;
}
