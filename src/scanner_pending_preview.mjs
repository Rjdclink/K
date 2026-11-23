import {supportedScannerSport} from './discovery.mjs';

// Pre-live fixture observations are informational only. Kalshi's scheduled
// 0-0 is not a confirmed score and cannot authorize any order or preflight.
const PRELIVE=new Set(['scheduled','not_started','unplayed','pregame','pre_game','created']);

export async function publishPendingSportsPreview(games,query,observedAt=new Date()){
  const pending=(Array.isArray(games)?games:[]).filter(({milestone,state}={})=>
    milestone?.id&&milestone?.title&&supportedScannerSport(milestone)&&
    state&&!state.verifiedLive&&PRELIVE.has(String(state.status||'').toLowerCase()));
  for(let i=0;i<pending.length;i+=100){
    const batch=pending.slice(i,i+100);
    const values=batch.map((_,n)=>'('+Array.from({length:5},(_,j)=>'$'+(n*5+j+1)).join(',')+
      ",'inactive','[]'::jsonb)").join(',');
    const sql='INSERT INTO game_snapshots '+
      '(id,title,sport,sport_family,scanned_at,status,signals) VALUES '+values+
      ' ON CONFLICT(id) DO UPDATE SET '+
      'title=EXCLUDED.title,sport=EXCLUDED.sport,'+
      'sport_family=EXCLUDED.sport_family,scanned_at=EXCLUDED.scanned_at,'+
      "home=NULL,away=NULL,progress=NULL,period=NULL,time_left=NULL,"+
      "score_observed_at=NULL,clock_seconds=NULL,clock_label=NULL,"+
      "clock_observed_at=NULL,signals='[]'::jsonb "+
      "WHERE game_snapshots.status='inactive' "+
      'AND game_snapshots.scanned_at<=EXCLUDED.scanned_at';
    await query(sql,batch.flatMap(({milestone,state})=>[
      milestone.id,milestone.title,state.sport||milestone.details?.league||'Sports',
      milestone.type,observedAt
    ]));
  }
  return pending.length;
}
