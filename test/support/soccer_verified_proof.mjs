import {SOCCER_NO_EXTERNAL_POLICY} from '../../src/soccer_no_external_proof.mjs';
// Synthetic TWO-provider proof for scanner/cushion tests. Production obtains
// these independently using the strict external-score module.
export function soccerVerifiedProof(game,{home=game.home,away=game.away,
  eventId='espn-verified-soccer',minute=game.soccerMinute}={}){
 const now=Date.now(),period=game.period;
 const whole=Math.floor(minute),seconds=Math.round((minute-whole)*60);
 const sourceClock=whole+':'+String(seconds).padStart(2,'0')+"'";
 const first={source:'ESPN',eventId,gameId:game.id,
  home,away,period,live:true,sourceClock};
 const second={source:'FOX Sports',eventId:'12345',gameId:game.id,
  home,away,period,live:true,sourceClock};
 return {...first,elapsedMinute:minute,checkedAt:now,
  sourcePolicy:SOCCER_NO_EXTERNAL_POLICY,
  verifiedProviders:['ESPN','FOX Sports'],independentReadings:[first,second]};
}
