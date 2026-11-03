import {sportsContractKey,independentEntryValid} from './entry_verification.mjs';
import {basketballCloseoutEntry} from './strategy.mjs';
import {selectedTeamSide} from './external_values.mjs';

// This selects background work, never a purchase or a projected game state.
export function preparingWinner(game,market){
  if(!game?.verifiedLive||!game.scoreKnown||!game.scoreConsistent||!game.periodConsistent||
    !['active','open'].includes(market?.status))return false;
  if(game.golf)return true;
  if(!/(?:GAME|MATCH)$/.test(String(market.event_ticker||'').split('-')[0]))return false;
  if(game.tennis||game.tableTennis)return true;
  if(game.home===game.away)return /^(?:draw|tie)(?:\b|\/)/i.test(String(market.yes_sub_title||market.title||''));
  return selectedTeamSide(game,market)===(game.home>game.away?'home':'away');
}

function evidenceKey(game,milestone,market){
  const fields=['id','feedId','type','sport','home','away','homeUnits','awayUnits','homeName','awayName',
    'homeTeamId','awayTeamId','period','periodScores','playerStats','tennis','tableTennis','volleyball',
    'cricket','golf','darts','tennisTotal','competition','tour','mainEvent','phase','scoreKnown','scoreConsistent','periodConsistent','verifiedLive',
    'possessionSide','clockRunning','soccerExtraTime','soccerOvertime','inningHalf','outs'];
  return JSON.stringify([sportsContractKey(game,market),milestone,
    fields.map(key=>game[key]),basketballCloseoutEntry(game)]);
}

// Short-lived preparation is shared by the scan and fast watcher in this
// instance. Its original request time is retained; reuse never renews proof.
export function createEntryPreparation(verify,now=Date.now){
  const entries=new Map();
  return async(game,milestone,options)=>{
    const key=evidenceKey(game,milestone,options.market),ticker=options.market.ticker,at=now();
    let entry=entries.get(ticker);
    const clockCompatible=entry&&['remainingSeconds','matchRemainingSeconds'].every(field=>
      Object.is(game[field],entry.game[field])||Number.isFinite(game[field])&&Number.isFinite(entry.game[field])&&
        game[field]<=entry.game[field]&&entry.game[field]-game[field]<=10)&&
      (Object.is(game.soccerMinute,entry.game.soccerMinute)||Number.isFinite(game.soccerMinute)&&
        game.soccerMinute>=entry.game.soccerMinute&&game.soccerMinute-entry.game.soccerMinute<=1);
    if(!entry||entry.key!==key||!clockCompatible||at<entry.at||at-entry.at>=10000&&!entry.pending){
      for(const [id,item] of entries)if(at-item.at>30000&&!item.pending)entries.delete(id);
      entry={key,at,game:structuredClone(game),pending:true};
      entries.set(ticker,entry);
      entry.task=Promise.resolve().then(()=>verify(entry.game,milestone,options))
        .finally(()=>{entry.pending=false});
    }
    let decision;
    try{decision=await entry.task}catch(error){if(entries.get(ticker)===entry)entries.delete(ticker);throw error}
    delete game.independentEntry;
    if(entries.get(ticker)!==entry||now()-entry.at>=30000)return null;
    if(decision===true&&independentEntryValid(entry.game,options.market,now())){
      game.verificationId=entry.game.verificationId;
      game.independentEntry=entry.game.independentEntry;
      if(Number.isInteger(entry.game.lastScoringPlay))game.lastScoringPlay=entry.game.lastScoringPlay;
    }else if(decision===true)return null;
    if(entry.game.verificationIssue)game.verificationIssue=entry.game.verificationIssue;
    else delete game.verificationIssue;
    return decision;
  };
}
