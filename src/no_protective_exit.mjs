import {periodValue} from './strategy.mjs';
import {bestYesAsk} from './orderbook.mjs';

export function noNearLossScore(game,market){
 if(!game?.verifiedLive||!game.scoreKnown||!game.scoreConsistent||!game.periodConsistent||
   !Number.isFinite(game.observedAt)||game.observedAt>Date.now()||
   Date.now()-game.observedAt>10000||
   !['active','open'].includes(market?.status)||
   market.result&&!['','not_determined'].includes(market.result))return null;
 if(!['Soccer','NHL','NBA','WNBA','NCAAB','NCAAW','NFL','CFB'].includes(game.sport))return null;
 const series=String(market.event_ticker||'').split('-')[0];
 if(!/^KX[A-Z0-9]+TOTAL$/.test(series)||/TEAMTOTAL$/.test(series)||
   Object.keys(market.custom_strike||{}).some(k=>/_player$|_team$/.test(k)))return null;
 const line=Number(market.floor_strike);
 if(market.floor_strike==null||!Number.isFinite(line)||line<.5||
   Math.abs(line-Math.floor(line)-.5)>1e-7)return null;
 const segment=series.match(/([1-9])(Q|P|H|INNING)TOTAL$/);
 let score;
 if(segment){
   const part=periodValue(game,market);
   if(part)score=part;
   else if(/soccer/.test(game.type)&&segment[1]==='1'&&segment[2]==='H'&&game.period===1)
     score=game;
   else return null;
 }else{
   if(/soccer/.test(game.type)&&(game.soccerExtraTime||game.soccerOvertime)&&
     /does not include extra time|90 minutes plus stoppage/i.test(market.rules_primary||''))return null;
   score=game;
 }
 if(!Number.isInteger(score.home)||score.home<0||
   !Number.isInteger(score.away)||score.away<0)return null;
 const total=score.home+score.away;
 return Math.abs(line-total-.5)<1e-7?total:null;
}

// A held NO is a negative YES position. The only safe reduction is a YES
// buy from resting NO bids, priced so the whole executable fill nets a profit.
export function profitableNoReductionQuote(position,book,market,{feeMultiplier=2,minimumCount=.01}={}){
 const signed=Number(position?.position_fp??position?.position);
 const held=-signed;
 const exposure=position?.market_exposure_dollars==null?NaN:Number(position.market_exposure_dollars);
 const fees=position?.fees_paid_dollars==null?NaN:Number(position.fees_paid_dollars);
 if(!Number.isFinite(held)||held<=0||!Number.isFinite(exposure)||exposure<0||
   !Number.isFinite(fees)||fees<0||!Number.isFinite(feeMultiplier)||feeMultiplier<2)return null;
 const offer=bestYesAsk(book);
 if(!offer||!Number.isFinite(offer.price)||offer.price<=0||offer.price>=1)return null;
 const whole=market?.fractional_trading_enabled===false;
 const count=Math.floor(Math.min(held,offer.size)*(whole?1:100)+1e-7)/(whole?1:100);
 if(!Number.isFinite(count)||count<Math.max(minimumCount,whole?1:.01))return null;
 const noBid=Number((1-offer.price).toFixed(4));
 const exitFees=Math.ceil(7*feeMultiplier*count*offer.price*(1-offer.price)-1e-8);
 const netProfitCents=Math.floor(100*count*noBid-100*(exposure+fees)*count/held-exitFees+1e-8);
 return Number.isFinite(netProfitCents)&&netProfitCents>0?
   {yesPrice:offer.price,noBid,count,netProfitCents,exitFeeReserveCents:exitFees}:null;
}
