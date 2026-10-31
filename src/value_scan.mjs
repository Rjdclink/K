// Research-only entry scan. A quote is never an independent win estimate.
const clean=name=>String(name||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const dollars=value=>value==null?NaN:Number(value);

export function lateWindow(game){
  if(!game?.verifiedLive||!game.scoreKnown||!game.scoreConsistent||!game.periodConsistent||game.home===game.away)return null;
  const type=String(game.type||'');
  if(/soccer/.test(type)){
    if(game.period!==2||game.soccerExtraTime||!Number.isFinite(game.matchRemainingSeconds)||
      game.matchRemainingSeconds<=0||game.matchRemainingSeconds>300)return null;
    return {remaining:`${Math.ceil(game.matchRemainingSeconds)} seconds to regulation whistle`,kind:'clock'};
  }
  const final=/basketball/.test(type)?['NCAAB','NCAAW'].includes(game.sport)?2:4:
    /hockey/.test(type)?3:/football/.test(type)?4:NaN;
  if(Number.isFinite(final)){
    if(game.period!==final||!Number.isFinite(game.remainingSeconds)||game.remainingSeconds<=0||game.remainingSeconds>300)return null;
    return {remaining:`${Math.ceil(game.remainingSeconds)} seconds in final period`,kind:'clock'};
  }
  // Baseball, tennis, cricket and other games have no equivalent five-minute
  // countdown in this feed. A guessed time-equivalent would be misleading.
  return null;
}

export function valueCandidate(game,market,event){
  const window=lateWindow(game);
  if(!window||!['open','active'].includes(market?.status)||
    market.event_ticker!==game.mainEvent||event?.event_ticker!==game.mainEvent)return null;
  const title=`${market.title||''} ${market.yes_sub_title||''}`;
  if(/\b(?:spread|handicap|margin|by \d|total|points|goals|draw|tie)\b/i.test(title)||
    !/(?:GAME|MATCH)(?:-|$)/i.test(market.event_ticker||''))return null;
  const ids=Object.entries(market.custom_strike||{}).filter(([key,value])=>/_team$/.test(key)&&typeof value==='string');
  const id=ids.length===1?ids[0][1]:null;
  const named=side=>{
    const name=clean(side==='home'?game.homeName:game.awayName);
    return name.length>=4&&clean(title).includes(name);
  };
  let side=id&&game.homeTeamId&&id===game.homeTeamId?'home':id&&game.awayTeamId&&id===game.awayTeamId?'away':null;
  if(!side&&!id&&named('home')!==named('away'))side=named('home')?'home':'away';
  if(!side)return null;
  const ask=dollars(market.yes_ask_dollars),size=dollars(market.yes_ask_size_fp);
  if(!Number.isFinite(ask)||ask<=0||ask>=1||!Number.isFinite(size)||size<=0)return null;
  const leader=game.home>game.away?'home':'away';
  const role=side===leader?'favorite':'underdog';
  if(role==='favorite'&&ask<.85)return null;
  if(role==='underdog'&&ask>=.50)return null;
  return {ticker:market.ticker,team:side==='home'?game.homeName:game.awayName,role,
    ask,kalshiQuoteImpliedChance:ask,size,remaining:window.remaining,score:`${game.away}–${game.home}`,
    model_probability:null,fee_cents:null,edge_cents:null,
    status:'Research only · independent probability and external state pending'};
}

// Future execution integration must call this after a sport-specific model has
// passed a point-in-time, fee-aware out-of-sample replay. Missing evidence is
// never treated as a successful validation or as an estimated probability.
export function validatedValueDecision(candidate,forecast,validation,feePerShare){
  if(!candidate||!forecast||!validation||
    validation.status!=='passed'||validation.sport!==forecast.sport||
    validation.outOfSample!==true||validation.fillableQuotes!==true||validation.feesIncluded!==true||
    validation.independentData!==true||validation.positiveNetReturn!==true||
    !Number.isFinite(validation.netReturnLowerBound)||validation.netReturnLowerBound<=0||
    forecast.marketTicker!==candidate.ticker||forecast.modelVersion!==validation.modelVersion||
    forecast.usesHistoricalTeamStats!==true||forecast.usesLiveSportState!==true||
    !Number.isFinite(forecast.probability)||forecast.probability<=.90||forecast.probability>=1||
    !Number.isFinite(forecast.lowerBound)||forecast.lowerBound<=.90||forecast.lowerBound>=1||
    forecast.lowerBound>forecast.probability||
    !Number.isFinite(feePerShare)||feePerShare<0)return null;
  const edge=forecast.lowerBound-candidate.ask-feePerShare;
  return edge>0?{edge,modelProbability:forecast.probability,
    kalshiQuoteImpliedChance:candidate.kalshiQuoteImpliedChance,
    modelVsKalshi:forecast.probability-candidate.kalshiQuoteImpliedChance,
    lowerBound:forecast.lowerBound}:null;
}
