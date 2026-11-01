import { periodValue, playerOverSpec } from './strategy.mjs';

// The displayed amount is for the shares that can actually sell at the
// current bid. Exposure and paid fees come from the exchange's open position.
export function estimatedSaleProfitCents(position, sale, fallbackPrice) {
  const held=Number(position?.position_fp ?? position?.position);
  const count=Number(sale?.count),price=Number(sale?.price);
  if(!Number.isFinite(held)||held<=0||!Number.isFinite(count)||count<=0||count>held||
    !Number.isFinite(price)||price<=0||price>=1)return null;
  const fraction=count/held;
  const exposure=position?.market_exposure_dollars==null?NaN:Number(position.market_exposure_dollars);
  const paidFees=position?.fees_paid_dollars==null?NaN:Number(position.fees_paid_dollars);
  const fallback=Number(fallbackPrice);
  if((!Number.isFinite(exposure)||exposure<0)&&(!Number.isFinite(fallback)||fallback<=0)||
    !Number.isFinite(paidFees)||paidFees<0)return null;
  const basis=Number.isFinite(exposure)&&exposure>=0?exposure*100*fraction:count*fallback*100;
  const fees=paidFees*100*fraction;
  // Reserve twice the standard taker fee; the exchange may charge less.
  const saleFees=Math.ceil(14*count*price*(1-price)-1e-8);
  return Math.floor(count*price*100-basis-fees-saleFees+1e-8);
}

// Require net proceeds for the executable quantity to reach 1.5 times its
// proportional acquisition cost, including paid entry and estimated sale fees.
export function oneAndHalfExitEligible(position,sale){
  const held=Number(position?.position_fp??position?.position),count=Number(sale?.count),price=Number(sale?.price);
  const exposure=Number(position?.market_exposure_dollars),fees=Number(position?.fees_paid_dollars);
  if(position?.market_exposure_dollars==null||position?.fees_paid_dollars==null||
    !Number.isFinite(held)||held<=0||!Number.isFinite(count)||count<=0||count>held||
    !Number.isFinite(price)||price<=0||price>=1||
    !Number.isFinite(exposure)||exposure<=0||!Number.isFinite(fees)||fees<0)return false;
  const acquisitionCents=(exposure+fees)*100*count/held;
  const saleFeeCents=Math.ceil(14*count*price*(1-price)-1e-8);
  const proceedsCents=Math.floor(100*count*price-saleFeeCents+1e-8);
  return proceedsCents>=Math.ceil(1.5*acquisitionCents-1e-8);
}

// Compare a full executable cash-out, after estimated sale fees, with half
// the position's net profit if every YES share pays out at settlement.
export function halfPotentialProfitExitEligible(position,sale){
  const held=Number(position?.position_fp??position?.position),count=Number(sale?.count);
  const exposure=Number(position?.market_exposure_dollars),fees=Number(position?.fees_paid_dollars);
  if(position?.market_exposure_dollars==null||position?.fees_paid_dollars==null||
    !Number.isFinite(held)||held<=0||!Number.isFinite(count)||count<held-1e-7||count>held||
    !Number.isFinite(exposure)||exposure<0||!Number.isFinite(fees)||fees<0)return false;
  const maximumNetCents=Math.floor(held*100-(exposure+fees)*100+1e-8);
  const saleProfitCents=estimatedSaleProfitCents(position,sale);
  return maximumNetCents>0&&saleProfitCents!==null&&saleProfitCents>0&&
    saleProfitCents*2>=maximumNetCents;
}

export function profitTargetAllowed(original){
  const lead=original?.strategy==='lead'&&!/TOTAL/i.test(String(original.market_ticker||''));
  return !(lead&&(original.sport==='Soccer'||
    Array.isArray(original.combo_legs)&&original.combo_legs.some(leg=>leg.sport==='Soccer')));
}

// Compare the exact held over statistic, not a game's aggregate score, with
// its original crossed line. A reversal matters only once the line uncrosses.
export function overCorrectionAffects(original,game,market){
  if(original?.strategy!=='over'||!game?.verifiedLive||!game.scoreKnown||!game.scoreConsistent||
    !market||market.ticker!==original.market_ticker)return false;
  // An exchange-only player-stat dip is not proof that an already credited
  // stat was rescinded. Keep player props for settlement or a profitable exit.
  if(Object.keys(market.custom_strike||{}).some(key=>/_player$/.test(key)))return false;
  const series=String(market.event_ticker||'').split('-')[0];
  const cricket=game.type==='cricket_match';
  const reason=String(original.reason||'');
  const entry=cricket?reason.match(/^(.+?) has (\d+) runs; team total (\d+(?:\.\d+)?) crossed/):
    reason.match(/^(\d+(?:\.\d+)?) (scored|[A-Z0-9]+)(?: by .+?)?; line (\d+(?:\.\d+)?) already passed/);
  if(!entry)return false;
  const before=Number(entry[cricket?2:1]),line=Number(entry[3]);
  if(!Number.isFinite(before)||!Number.isFinite(line)||Number(market.floor_strike)!==line)return false;
  let current=NaN;
  if(cricket){
    if(!/TEAMTOTAL$/.test(series))return false;
    const teamId=Object.entries(market.custom_strike||{}).find(([key])=>/_team$/.test(key))?.[1];
    const home=teamId?teamId===game.homeTeamId:String(entry[1]).toLowerCase()===String(game.homeName||'').toLowerCase();
    const away=teamId?teamId===game.awayTeamId:String(entry[1]).toLowerCase()===String(game.awayName||'').toLowerCase();
    if(home===away)return false;
    current=home?game.home:game.away;
  }else{
    const player=playerOverSpec(game,market);
    const hasPlayer=Object.keys(market.custom_strike||{}).some(key=>/_player$/.test(key));
    if(hasPlayer){if(!player||player.metric!==entry[2])return false;current=player.value}
    else if(/^KX(?:ATP|WTA)GTOTAL$/.test(series))current=game.tennisTotal;
    else if(/[1-9](?:Q|P|H|INNING)(?:TEAM)?TOTAL$/.test(series)){
      const segment=periodValue(game,market);
      if(!segment)return false;
      if(/TEAMTOTAL$/.test(series)){
        const teamId=Object.entries(market.custom_strike||{}).find(([key])=>/_team$/.test(key))?.[1];
        const home=teamId&&teamId===game.homeTeamId,away=teamId&&teamId===game.awayTeamId;
        if(home===away)return false;
        current=home?segment.home:segment.away;
      }else current=segment.home+segment.away;
    }else if(/TEAMTOTAL$/.test(series)){
      const teamId=Object.entries(market.custom_strike||{}).find(([key])=>/_team$/.test(key))?.[1];
      const home=teamId&&teamId===game.homeTeamId,away=teamId&&teamId===game.awayTeamId;
      if(home===away)return false;
      current=home?game.home:game.away;
    }else if(/TOTAL$/.test(series))current=Number(game.home)+Number(game.away);
    else return false;
  }
  return Number.isFinite(current)&&current<before&&current<=line;
}

export function correctionExitTargets(rows,statesByGame,marketsByTicker){
  const affected=new Set(rows.filter(row=>overCorrectionAffects(row,statesByGame.get(row.game_id),marketsByTicker.get(row.market_ticker)))
    .map(row=>row.market_ticker));
  return new Set([...affected,...rows.filter(row=>Array.isArray(row.combo_legs)&&
    row.combo_legs.some(leg=>affected.has(leg.market_ticker))).map(row=>row.market_ticker)]);
}

