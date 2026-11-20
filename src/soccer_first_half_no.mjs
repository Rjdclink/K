import {espnMatches} from './score_verification.mjs';
import {espnScoreboardUrls} from './espn_scoreboards.mjs';

// Exactly the first 45 minutes of regulation, with NO assumed added time.
export function soccerFirstHalfSeconds(game){
  if(game?.sport!=='Soccer'||!String(game.type||'').startsWith('soccer_')||
    game.period!==1||game.soccerExtraTime||!Number.isFinite(game.soccerMinute)||
    game.soccerMinute<0)return null;
  return Math.max(0,Math.round((45-game.soccerMinute)*60));
}
const readClock=value=>{
  const m=String(value||'').trim().match(/^(\d{1,3})(?::([0-5]\d))?(?:\+(\d{1,2}))?['′]?$/);
  return m?Number(m[1])+Number(m[2]||0)/60+Number(m[3]||0):NaN;
};
const lineFrom=text=>{
  const match=String(text||'').trim().match(/^Over (\d+(?:\.\d+)?) 1H goals scored$/i);
  return match?Number(match[1]):NaN;
};
const externalCurrent=(reading,game)=>Boolean(
  reading?.source==='ESPN'&&reading.eventId&&reading.live===true&&reading.period===1&&
  reading.home===game.home&&reading.away===game.away&&
  Number.isFinite(reading.elapsedMinute)&&Number.isFinite(game.soccerMinute)&&
  Math.abs(reading.elapsedMinute-game.soccerMinute)<=1
);

export function soccerFirstHalfNoSpec(game,market,{beforeWindow=false}={}){
  const seconds=soccerFirstHalfSeconds(game);
  if(seconds===null||seconds<=0||(beforeWindow?seconds>240:seconds>=210)||
    !game.verifiedLive||!game.scoreKnown||!game.scoreConsistent||!game.periodConsistent||
    game.feedId!==game.id||game.clockRunning===false||
    !Number.isFinite(game.observedAt)||game.observedAt>Date.now()||
    Date.now()-game.observedAt>10000||
    !Number.isInteger(game.home)||game.home<0||!Number.isInteger(game.away)||game.away<0||
    !['active','open'].includes(market?.status)||
    market.result&&!['','not_determined'].includes(String(market.result)))return null;
  const [series,...suffix]=String(market.event_ticker||'').split('-'),
    [main,...mainSuffix]=String(game.mainEvent||'').split('-');
  if(!/^KX[A-Z0-9]+1HTOTAL$/.test(series)||
    !/^KX[A-Z0-9]+GAME$/.test(main)||!suffix.length||
    series!==main.slice(0,-4)+'1HTOTAL'||suffix.join('-')!==mainSuffix.join('-')||
    !['greater','greater_than'].includes(market.strike_type))return null;
  const line=Number(market.floor_strike),title=lineFrom(market.title),
    subtitle=lineFrom(market.yes_sub_title),rules=String(market.rules_primary||'');
  const rulesLine=rules.match(/^If the total goals scored by .+ is more than (\d+(?:\.\d+)?) goals in the 1st Half of the .+ professional .+ soccer game originally scheduled for .+, then the market resolves to Yes\.$/i);
  if(!Number.isFinite(line)||line!==title||line!==subtitle||!rulesLine||
    line!==Number(rulesLine[1])||
    /\b(?:team total|second half|2nd half|extra time|penalties)\b/i.test(rules))return null;
  return {strategy:'no',period:'first_half',periodNumber:1,line};
}

export function soccerFirstHalfNo(game,market,{beforeWindow=false,external=null}={}){
  const spec=soccerFirstHalfNoSpec(game,market,{beforeWindow});
  if(!spec||external&&!externalCurrent(external,game))return null;
  const total=game.home+game.away;
  if(spec.line-total<1.5)return null;
  return {...spec,total,reason:'Soccer first-half total NO over '+spec.line+'; '+
    total+' first-half goals, '+soccerFirstHalfSeconds(game)+
    's to the 45-minute regulation clock'};
}

export function independentSoccerFirstHalfNoReading(scoreboard,game,milestone,market){
  if(!soccerFirstHalfNoSpec(game,market,{beforeWindow:true}))return null;
  const matches=espnMatches(scoreboard,game,milestone);
  if(matches.length!==1)return null;
  const match=matches[0],event=scoreboard.events.find(e=>e.id===match.eventId);
  const status=event?.competitions?.[0]?.status||event?.status;
  const elapsedMinute=readClock(status?.displayClock);
  const reading={source:'ESPN',eventId:match.eventId,home:match.home,away:match.away,
    period:match.period,elapsedMinute,live:match.live};
  return match.clockOk&&externalCurrent(reading,game)?reading:null;
}

export async function verifyIndependentSoccerFirstHalfNo(game,milestone,market,{fetcher=fetch}={}){
  if(!soccerFirstHalfNoSpec(game,market,{beforeWindow:true}))return null;
  const start=Date.parse(milestone?.start_date||'');
  if(!Number.isFinite(start))return null;
  const dates=[start,start-86400000,start+86400000]
    .map(ms=>new Date(ms).toISOString().slice(0,10).replaceAll('-',''));
  for(const day of new Set(dates)){
    const results=await Promise.allSettled(espnScoreboardUrls('soccer/all',game,milestone,[day])
      .map(async url=>{
        const response=await fetcher(url,{signal:AbortSignal.timeout(6000),cache:'no-store'});
        return response.ok?await response.json():null;
      }));
    const boards=results.filter(r=>r.status==='fulfilled'&&r.value).map(r=>r.value);
    const matches=boards.flatMap(b=>espnMatches(b,game,milestone));
    if(matches.length){
      if(matches.length!==1)return null;
      return independentSoccerFirstHalfNoReading(
        boards.find(b=>espnMatches(b,game,milestone).some(m=>m.eventId===matches[0].eventId)),
        game,milestone,market);
    }
  }
  return null;
}