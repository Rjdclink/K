import {basketballTotalNoSupported,basketballNoOnlyInternational} from './basketball_no_leagues.mjs';
import {playerOverSpec} from './strategy.mjs';

// Kalshi's event market title may say "Full Game: Over ..." or include "1H";
// the outcome subtitle carries the exact binary threshold when available.
const totalLine=market=>{
  const read=text=>Number(String(text||'')
    .match(/^(?:(?:Full Game|1st Half):\s*)?Over\s+(\d+(?:\.\d+)?)\s+(?:1H\s+)?points\b/i)?.[1]);
  const subtitle=read(market.yes_sub_title),title=read(market.title);
  if(market.yes_sub_title&&market.title&&(!Number.isFinite(subtitle)||!Number.isFinite(title)||subtitle!==title))return NaN;
  return market.yes_sub_title?subtitle:title;
};

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

// Football total NO: Q4 full-game contracts only. CFB needs a 20-point
// cushion and NFL needs a 15-point cushion; the first check precedes 5:00.
export function collegeFootballTotalNo(game,market,{beforeWindow=false}={}){
  if(!['CFB','NFL'].includes(game?.sport)||game.type!=='football_game'||!game.verifiedLive||
    !game.scoreKnown||!game.scoreConsistent||!game.periodConsistent||game.feedId!==game.id||
    !Number.isFinite(game.observedAt)||Date.now()-game.observedAt>10000||
    game.period!==4||!Number.isFinite(game.remainingSeconds)||
    game.remainingSeconds<=0||game.remainingSeconds>=(beforeWindow?360:300)||
    !['active','open'].includes(market?.status)||
    market.result&&!['','not_determined'].includes(String(market.result)))return null;
  const series=String(market.event_ticker||'').split('-')[0];
  if(series!==(game.sport==='CFB'?'KXNCAAFTOTAL':'KXNFLTOTAL')||
    market.strike_type&&!['greater','greater_than'].includes(market.strike_type))return null;
  const line=Number(market.floor_strike),displayed=totalLine(market);
  const rules=String(market.rules_primary||'');
  const gap=game.sport==='CFB'?20:15;
  if(!Number.isFinite(line)||line!==displayed||line-(game.home+game.away)<gap||
    !(/collectively score more than|combined total points scored/i.test(rules)||
      game.sport==='NFL'&&/over\s+\d+(?:\.\d+)?\s+total points are scored/i.test(rules))||
    /\b(?:1st|first|2nd|second)\s+half\b|quarter|team total/i.test(rules))return null;
  return {strategy:'no',period:'full_game',line,total:game.home+game.away,
    reason:game.sport+' full-game NO over '+line+'; '+(game.home+game.away)+' scored, '+game.remainingSeconds+'s left in Q4'};
}

export function collegeBasketballTotalNo(game,market,{beforeWindow=false}={}){
  const collegeMen=game?.sport==='NCAAB',collegeWomen=game?.sport==='NCAAW';
  const firstHalf=(collegeMen&&game?.period===1)||(collegeWomen&&game?.period===2);
  const fullGame=game?.period===(collegeMen?2:4);
  const expandedFullGame=fullGame&&['NBA','WNBA','NCAAB','NCAAW'].includes(game?.sport);
  const entrySeconds=expandedFullGame?420:90;
  if(!basketballTotalNoSupported(game?.sport)||game.type!=='basketball_game'||!game.verifiedLive||
    !game.scoreKnown||!game.scoreConsistent||!game.periodConsistent||game.feedId!==game.id||
    !Number.isFinite(game.observedAt)||Date.now()-game.observedAt>10000||
    !Number.isFinite(game.remainingSeconds)||game.remainingSeconds<=0||
    game.remainingSeconds>=(beforeWindow?(expandedFullGame?481:300):entrySeconds)||
    !['active','open'].includes(market?.status)||
    market.result&&!['','not_determined'].includes(String(market.result)))return null;
  if(!firstHalf&&!fullGame)return null;
  let prefix=collegeMen?'KXNCAAMB':collegeWomen?'KXNCAAWB':
    game.sport==='NBA'?'KXNBA':game.sport==='WNBA'?'KXWNBA':null;
  if(!prefix&&basketballNoOnlyInternational(game.sport)){
    // Do not invent a sports series. Its matching whole-game GAME ticker is
    // the only authority for deriving a candidate TOTAL series.
    const wholeGame=String(game.mainEvent||'').split('-')[0];
    if(!/^KX[A-Z0-9]+GAME$/.test(wholeGame))return null;
    prefix=wholeGame.slice(0,-4);
  }
  if(!prefix||String(market.event_ticker||'').split('-')[0]!==prefix+(firstHalf?'1HTOTAL':'TOTAL')||
    market.strike_type&&!['greater','greater_than'].includes(market.strike_type))return null;
  const displayed=totalLine(market);
  const line=Number(market.floor_strike),rules=String(market.rules_primary||'');
  const cushion=firstHalf?12:expandedFullGame?(game.sport==='NBA'?45:40):20;
  if(!Number.isFinite(line)||line!==displayed||line-(game.home+game.away)<cushion||
    !(/over\s+\d+(?:\.\d+)?\s+total points are scored/i.test(rules)||
      /collectively score more than|combined total points scored/i.test(rules))||
    (firstHalf?!/1st half|first half/i.test(rules):
      /\b(?:1st|first|2nd|second)\s+half\b|quarter|team total/i.test(rules)))return null;
  const period=firstHalf?'first_half':'full_game';
  const reason=collegeMen||collegeWomen?
    'College basketball '+(firstHalf?'first-half':'full-game')+' NO over '+line+'; '+(game.home+game.away)+' scored, '+game.remainingSeconds+'s left in '+(collegeMen?'half':'Q')+game.period:
    'Basketball total NO ('+game.sport+') full-game over '+line+'; '+(game.home+game.away)+' scored, '+game.remainingSeconds+'s left in Q4';
  return {strategy:'no',period,line,total:game.home+game.away,reason};
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