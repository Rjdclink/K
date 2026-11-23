import { teamScorePosition } from './strategy.mjs';

// Highest credible score of one conventional play or possession capable of
// tying a team-winner lead. Only a positively identified selected team qualifies.
const SINGLE_SCORE_MARGINS=Object.freeze({
 football:8, basketball:4, baseball:4, rugby:7, cricket:6,
 soccer:1, hockey:1, lacrosse:1, handball:1, volleyball:1,
 water_polo:1, field_hockey:1, tennis:1, table_tennis:1, esports:1
});
export function singleScoreTieMargin(game){
 const type=String(game?.type||'').toLowerCase();
 if(type.startsWith('tennis_tournament_'))return null;
 const family=type.startsWith('table_tennis_')?'table_tennis':
  type.startsWith('field_hockey_')?'field_hockey':
  type.startsWith('water_polo_')?'water_polo':type.split('_')[0];
 return SINGLE_SCORE_MARGINS[family]??null;
}

// A past commanding leader that is now one legal play from a tie (or tied or
// behind) enters permanent first-profit watch. A missing or inconsistent
// provider score never enables an automatic exit.
export function threatenedLead(game,market){
 const margin=singleScoreTieMargin(game);
 if(!game||!market||margin===null||
   game.feedId!==game.id||game.verifiedLive!==true||game.scoreKnown!==true||
   game.scoreConsistent!==true||game.periodConsistent!==true||
   !Number.isFinite(game.home)||!Number.isFinite(game.away))return false;
 const side=teamScorePosition(game,market);
 return side!==null&&(side<=0||Math.abs(game.home-game.away)<=margin);
}


// An exit-only watch is independent of purchase allowlists. Retain actively
// held legacy basketball, baseball, rugby, cricket, etc., but never poll
// obviously completed, weeks-old fixtures as if they remained live.
export function leadExitMonitorable(row,now=Date.now()){
 if(row?.strategy!=='lead'||Array.isArray(row.combo_legs)&&row.combo_legs.length>1||
   /^(?:final|finished|complete|completed|closed|ended|canceled|cancelled)$/i.test(
     String(row.game_status||'')))return false;
 const scan=Date.parse(row.game_scanned_at||'');
 if(row.game_status==='live'&&Number.isFinite(scan)&&now>=scan&&now-scan<=30*60000)
  return true;
 const scheduled=Date.parse(row.held_milestone?.start_date||row.milestone?.start_date||'');
 const multiDay=/^(?:cricket_)/i.test(String(row.sport_family||row.game_family||''));
 if(Number.isFinite(scheduled)&&now>=scheduled-3600000&&
   now-scheduled<=(multiDay?7*86400000:24*3600000))return true;
 const filled=Date.parse(row.created_at||'');
 return Number.isFinite(filled)&&now>=filled&&now-filled<=8*3600000;
}
