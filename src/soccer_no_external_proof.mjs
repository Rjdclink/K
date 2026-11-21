import {fetchIndependentMatchScore,scorePairMatches} from './independent_match_score.mjs';

// Require independently current scores from two different providers for each
// soccer NO checkpoint. An unverified ESPN HTTP 200 is never proof of freshness.
export function soccerElapsedMinute(value){
  const text=String(value||'').trim().replace(/[′’]/g,"'");
  const chunks=[...text.matchAll(/(\d{1,3})(?::([0-5]\d))?'?(?:\+(\d{1,2}))?'?/g)];
  const clock=chunks.filter(m=>m[0].includes("'")||m[0].includes(':')||m[0].includes('+')).at(-1);
  const exact=!clock&&text.match(/^\d{1,3}$/);
  const found=clock||(exact?chunks[0]:null);
  if(!found)return NaN;
  return Number(found[1])+Number(found[2]||0)/60+Number(found[3]||0);
}
export const SOCCER_NO_EXTERNAL_POLICY='two-live-soccer-providers-v1';
const SOURCE_SET=['ESPN','FOX Sports','Sportradar'];
const maxClockDrift=2;
export function validSoccerNoSource(game,proof,now=Date.now()){
  if(!scorePairMatches(proof,game)||proof.live!==true||
    !Number.isFinite(game.soccerMinute)||!Number.isInteger(game.period)||
    proof.home<game.home||proof.away<game.away)return false;
  const minute=soccerElapsedMinute(proof.sourceClock);
  const hasClock=Number.isFinite(minute);
  if(proof.source==='Sportradar'){
    const published=Date.parse(proof.publishedAt||'');
    // Sportradar's 10-second generated_at bound is enforced at the fetch
    // boundary AND again here so a test or future caller cannot bypass it.
    if(!Number.isFinite(published)||now-published>10000||published-now>5000)return false;
    if(hasClock&&Math.abs(minute-game.soccerMinute)>maxClockDrift)return false;
    return proof.period===game.period;
  }
  // ESPN/FOX public scoreboards have no reliable per-score update timestamp.
  // Their live status, current period and near-current clock are mandatory;
  // if unavailable, this provider cannot authorize a trading decision.
  if(!hasClock||Math.abs(minute-game.soccerMinute)>maxClockDrift)return false;
  const period=Number.isInteger(proof.period)?proof.period:
    proof.source==='FOX Sports'?(minute>=46?2:1):null;
  return period===game.period;
}
// This is the actual entry-order gate, not merely a scoreboard parser. A
// standalone ESPN observation may never impersonate multi-provider proof.
// Versioned first checks prevent a pre-deployment, ESPN-only database row
// from being reused as the first independent proof for a new order.
export function validSoccerNoPreflightProof(proof){
  if(proof?.sourcePolicy!==SOCCER_NO_EXTERNAL_POLICY||
    !Number.isFinite(proof.checkedAt)||
    !Array.isArray(proof.verifiedProviders)||proof.verifiedProviders.length<2||
    !Array.isArray(proof.independentReadings)||
    proof.independentReadings.length!==proof.verifiedProviders.length||
    new Set(proof.verifiedProviders).size!==proof.verifiedProviders.length||
    !proof.verifiedProviders.includes(proof.source))return false;
  return proof.independentReadings.every((reading,i)=>
    reading.source===proof.verifiedProviders[i]&&reading.live===true&&
    reading.home===proof.home&&reading.away===proof.away&&
    reading.gameId===proof.gameId);
}
export function validCorroboratedSoccerNoProof(game,proof,now=Date.now()){
  if(!scorePairMatches(proof,game)||!validSoccerNoPreflightProof(proof)||
    proof.checkedAt>now||now-proof.checkedAt>10000)return false;
  return proof.independentReadings.every((reading,i)=>
    reading.source===proof.verifiedProviders[i]&&
    reading.home===proof.home&&reading.away===proof.away&&
    validSoccerNoSource(game,reading,now));
}
export async function verifyCorroboratedSoccerNo(game,milestone,{
  fetcher=fetch,sportradarLoad,fixtureCache
}={}){
  if(!game?.verifiedLive||!game?.scoreKnown||!game?.scoreConsistent||
    !game?.periodConsistent||game.clockRunning===false||
    game.soccerExtraTime||!Number.isFinite(game.soccerMinute))return null;
  const options={espnFeed:'soccer/all',foxFeed:'soccer',fetcher};
  if(sportradarLoad!==undefined)options.sportradarLoad=sportradarLoad;
  if(fixtureCache!==undefined)options.fixtureCache=fixtureCache;
  const [espn,fox]=await Promise.all(SOURCE_SET.slice(0,2).map(sourceOnly=>
    fetchIndependentMatchScore(game,milestone,{...options,sourceOnly})));
  const checked=[espn,fox];
  // Any matched but invalid, stale, finished or contradictory source fails
  // closed. A missing league in FOX is not validation; try authenticated radar.
  const observedAt=Date.now();
  if(checked.some(x=>x===false||x&&!validSoccerNoSource(game,x,observedAt)))return false;
  let accepted=checked.filter(Boolean);
  if(accepted.length<2){
    const radar=await fetchIndependentMatchScore(game,milestone,{
      ...options,sourceOnly:'Sportradar'});
    if(radar===false||radar&&!validSoccerNoSource(game,radar,Date.now()))return false;
    if(radar)accepted.push(radar);
  }
  if(accepted.length<2)return null;
  if(new Set(accepted.map(x=>x.source)).size<2||accepted.some(x=>
    x.home!==accepted[0].home||x.away!==accepted[0].away))return false;
  const preferred=accepted.find(x=>x.source==='ESPN')||accepted[0];
  return {...preferred,checkedAt:Date.now(),sourcePolicy:SOCCER_NO_EXTERNAL_POLICY,
    verifiedProviders:accepted.map(x=>x.source),
    independentReadings:accepted.map(x=>({
      source:x.source,eventId:x.eventId,gameId:x.gameId,home:x.home,away:x.away,
      period:x.period,live:x.live,sourceClock:x.sourceClock||null,
      publishedAt:x.publishedAt||null
    }))};
}
