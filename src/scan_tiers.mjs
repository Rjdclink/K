import {supportedScannerSport,internationalBasketball,eligibleForMarkets} from './discovery.mjs';

// A queue clock is scheduling metadata, not a source of scores or trade permission.
// Only independently verified evidence authorizes a purchase.
export const SCAN_TIER_MS={fast:10000,near:30000,discovery:120000};
export function priorityAfterPromotion(previous,next){
 return Math.min([10,30,120].includes(previous)?previous:120,next);
}
export function scanTier(game,{held=false,watched=false,now=Date.now()}={}){
 if(!supportedScannerSport(game)||internationalBasketball(game))return null;
 // Terminal fixtures no longer qualify for any active scanner tier.
 if(/^(?:final|finished|completed|complete|closed|ended|cancelled|canceled)$/i.test(String(game?.status||'')))return null;
 if(!game?.verifiedLive){
  const start=Date.parse(game.start_date||'');
  return Number.isFinite(start)&&start>=now-1800000&&start<=now+1800000?30:120;
 }
 if(held||watched)return 10;
 const type=String(game.type||''),period=Number(game.period),secs=game.remainingSeconds;
 const clock=Number.isFinite(secs)&&secs>=0?secs:Infinity;
 if(type.startsWith('football_'))return (
  period>=4&&clock<=720||game.sport==='CFB'&&period===2&&clock<=480)?10:30;
 if(type.startsWith('hockey_'))return period>=3&&clock<=1200||
  [1,2].includes(period)&&clock<=420?10:30;
 if(type.startsWith('soccer_'))return period===1&&Number.isFinite(game.soccerMinute)&&
  game.soccerMinute>=38||period>=2&&Number.isFinite(game.soccerMinute)&&
  game.soccerMinute>=73.5?10:30;
 return 30;
}
// One urgent candidate queue serves game-level football, hockey and soccer only.
// Kalshi live-data presence is a screening input, never independent trading proof.
export function fastEntryCandidates(games,allowsEntry=()=>true){
 return games.filter(g=>supportedScannerSport(g.milestone)&&
  eligibleForMarkets(g.state)&&allowsEntry(g.state));
}

// Spread initial checks across the three enabled sports; no single crowded league
// may consume all of the thirty-second worker's bounded catalog capacity.
export function prioritizeNearCheckGames(games,limit=8,cycle=Math.floor(Date.now()/30000)){
 const groups=new Map(['football','hockey','soccer'].map(f=>[f,[]]));
 for(const g of games){const family=String(g?.state?.type||'').split('_')[0];
  if(groups.has(family)&&supportedScannerSport(g.state))groups.get(family).push(g);}
 const active=[...groups.values()].filter(g=>g.length);
 const budget=Math.max(0,Math.floor(limit));
 if(!budget||!active.length)return [];
 const per=Math.max(1,Math.floor(budget/active.length));
 const chosen=[];
 for(const family of active){const start=family.length?(Math.floor(cycle)*per)%family.length:0;
  for(let i=0;i<Math.min(per,family.length);i++)chosen.push(family[(start+i)%family.length]);}
 if(chosen.length>=budget)return chosen.slice(0,budget);
 const selected=new Set(chosen);
 for(const group of active)for(const g of group)if(!selected.has(g)){
  chosen.push(g);selected.add(g);if(chosen.length===budget)return chosen;}
 return chosen;
}
export async function runScanTierWindow(tier,job,{until,now=Date.now,sleep=ms=>new Promise(r=>setTimeout(r,ms))}={}){
 const interval=SCAN_TIER_MS[tier];
 if(!interval||!Number.isFinite(until))throw Error('Invalid scan tier window');
 let cycles=0;
 while(now()<until){
  const started=now();
  await job();cycles++;
  const remaining=Math.min(interval,Math.max(0,until-now()),Math.max(0,started+interval-now()));
  if(remaining>0)await sleep(remaining);
  else if(now()<=started)await sleep(1);
 }
 return cycles;
}

