import {playerOverSpec} from './strategy.mjs';

// Fixed binary yardage thresholds only. Scalar ladders and protected markets
// have different payouts, and short count props can turn on one play.
export function thirdQuarterYardageNo(game,market){
  if(!game?.verifiedLive||game.feedId!==game.id||!game.periodConsistent||
    !Number.isInteger(game.period)||game.period<3||!Number.isFinite(game.observedAt)||Date.now()-game.observedAt>30000||
    !['NFL','CFB'].includes(game.sport)||!['active','open'].includes(market?.status)||
    market?.result&&!['','not_determined'].includes(String(market.result))||
    /prot|ladder|escalator|slingshot/i.test(String(market?.event_ticker||'')+' '+String(market?.rules_primary||'')))return null;
  const player=playerOverSpec(game,market);
  if(!player||!['RECYDS','RUSHYDS'].includes(player.metric)||player.value!==0||
    player.line+.5<100||!/resolves yes if/i.test(String(market.rules_primary||'')))return null;
  return player;
}

// These are distinct settlement periods: Q2 for a first-half total and Q4
// for a full-game total. A numeric yardline alone does not identify the side.
export function collegeFootballTotalNo(game,market,{beforeWindow=false}={}){
  if(game?.sport!=='CFB'||game.type!=='football_game'||!game.verifiedLive||
    !game.scoreKnown||!game.scoreConsistent||!game.periodConsistent||game.feedId!==game.id||
    !Number.isFinite(game.observedAt)||Date.now()-game.observedAt>10000||
    ![2,4].includes(game.period)||!Number.isFinite(game.remainingSeconds)||
    game.remainingSeconds<=0||game.remainingSeconds>=(beforeWindow?180:120)||
    !['active','open'].includes(market?.status)||
    market.result&&!['','not_determined'].includes(String(market.result)))return null;
  const situation=game.footballSituation;
  if(!situation?.possessionTeamId||situation.possessionTeamId!==situation.sideTeamId||
    ![game.homeTeamId,game.awayTeamId].includes(situation.possessionTeamId)||
    !Number.isInteger(situation.yardline)||situation.yardline<0||situation.yardline>=50||
    game.possessionSide!==(situation.possessionTeamId===game.homeTeamId?'home':'away'))return null;
  const firstHalf=game.period===2,series=String(market.event_ticker||'').split('-')[0];
  if(series!==(firstHalf?'KXNCAAF1HTOTAL':'KXNCAAFTOTAL')||
    !/^Over\s+(\d+(?:\.\d+)?)\s+points\b/i.test(String(market.title||market.yes_sub_title||''))||
    market.strike_type&&!['greater','greater_than'].includes(market.strike_type))return null;
  const line=Number(market.floor_strike),displayed=Number(String(market.title||market.yes_sub_title).match(/^Over\s+(\d+(?:\.\d+)?)\s+points\b/i)?.[1]);
  const rules=String(market.rules_primary||'');
  if(!Number.isFinite(line)||line!==displayed||line-(game.home+game.away)<10||
    !/collectively score more than|combined total points scored/i.test(rules)||
    (firstHalf?!/1st half|first half/i.test(rules):/\b(?:1st|first|2nd|second)\s+half\b|quarter|team total/i.test(rules)))return null;
  return {strategy:'no',period:firstHalf?'first_half':'full_game',line,total:game.home+game.away,
    reason:`CFB ${firstHalf?'first-half':'full-game'} NO over ${line}; ${game.home+game.away} scored, ${game.remainingSeconds}s left in Q${game.period}, possession at own ${situation.yardline}`};
}

export function highestYardageNos(candidates){
  const best=new Map();
  for(const c of candidates){
    const key=`${c.game.id}:${c.player.id}:${c.player.metric}`;
    const prior=best.get(key);
    if(!prior||c.player.line>prior.player.line)best.set(key,c);
  }
  return [...best.values()].sort((a,b)=>Number(a.market.no_ask_dollars)-Number(b.market.no_ask_dollars));
}

export function bestNoAsk(orderbook){
  const levels=(orderbook?.yes_dollars||[]).map(([price,size])=>({bid:Number(price),size:Number(size)}))
    .filter(x=>Number.isFinite(x.bid)&&x.bid>0&&x.bid<1&&Number.isFinite(x.size)&&x.size>0)
    .sort((a,b)=>b.bid-a.bid);
  if(!levels.length)return null;
  const best=levels[0],size=levels.filter(x=>Math.round(x.bid*10000)===Math.round(best.bid*10000))
    .reduce((sum,x)=>sum+x.size,0);
  return {price:Number((1-best.bid).toFixed(4)),size:Math.floor(size*100+1e-7)/100};
}

export function noDepthAtAsk(orderbook,ask,size){
  const price=Number(ask),advertised=Number(size);
  if(!Array.isArray(orderbook?.yes_dollars)||!Number.isFinite(price)||price<=0||price>=1||
    !Number.isFinite(advertised)||advertised<=0)return 0;
  const depth=orderbook.yes_dollars.reduce((sum,[bid,count])=>
    Number.isFinite(Number(bid))&&Number.isFinite(Number(count))&&Number(count)>0&&
    10000-Math.round(Number(bid)*10000)<=Math.round(price*10000)?sum+Number(count):sum,0);
  return Math.max(0,Math.floor(Math.min(depth,advertised)*100+1e-7)/100);
}
