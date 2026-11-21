import {randomUUID} from 'node:crypto';

// A completed second independent score check is a verified fact, NOT a trade
// authorization. Order submission always requires a fresh provider score.
const signature=game=>JSON.stringify([game.home,game.away,game.period,
  Array.isArray(game.periodScores)?game.periodScores.map(p=>[p.number,p.home,p.away]):null]);
export function createNoFinalCheckpoint(query){
  let ready;
  const ensure=()=>{
    ready??=query(`CREATE TABLE IF NOT EXISTS no_final_preflight_checks (
      market_ticker text NOT NULL,game_id text NOT NULL,
      first_at timestamptz NOT NULL,score_key text NOT NULL,
      final_at timestamptz NOT NULL,final_evidence jsonb NOT NULL,
      PRIMARY KEY(market_ticker,game_id))`).catch(e=>{ready=null;throw e});
    return ready;
  };
  return async({market,game,first,verify,approve,validate,forceFresh=false})=>{
    const ticker=String(market?.ticker||''),gameId=String(game?.id||'');
    const firstAt=new Date(first?.first_at).getTime();
    if(!ticker||!gameId||!Number.isFinite(firstAt)||firstAt>Date.now()||
      typeof verify!=='function'||typeof approve!=='function'||typeof validate!=='function')
      return {ok:false,attempted:false,reason:'Missing valid initial score verification'};
    await ensure();
    const scoreKey=signature(game);
    const {rows:[prior]}=await query(`SELECT first_at,score_key,final_at,final_evidence
      FROM no_final_preflight_checks WHERE market_ticker=$1 AND game_id=$2`,[ticker,gameId]);
    if(!forceFresh&&prior&&new Date(prior.first_at).getTime()===firstAt&&prior.score_key===scoreKey){
      return {ok:true,at:new Date(prior.final_at).getTime(),proof:prior.final_evidence,
        newCheck:false,scoreKey};
    }
    const proof=await verify();
    if(!proof||!approve(first.first_evidence,proof,game)||!validate(proof))return {
      ok:false,attempted:true,reason:proof===false?'Independent fixture score differs':
        'Final independent fixture and score not verified'};
    const now=new Date();
    const args=[ticker,gameId,new Date(firstAt).toISOString(),scoreKey,JSON.stringify(proof),now.toISOString()];
    await query(`INSERT INTO no_final_preflight_checks
      (market_ticker,game_id,first_at,score_key,final_evidence,final_at)
      VALUES($1,$2,$3,$4,$5,$6)
      ON CONFLICT(market_ticker,game_id) DO UPDATE SET
      first_at=EXCLUDED.first_at,score_key=EXCLUDED.score_key,
      final_evidence=EXCLUDED.final_evidence,final_at=EXCLUDED.final_at`,args);
    await query('INSERT INTO verification_records(id,market_ticker,passed,evidence) VALUES($1,$2,true,$3)',[
      randomUUID(),ticker,JSON.stringify({mode:'independent_no_final_preflight_checkpoint',
        gameId,scoreKey,firstAt:new Date(firstAt).toISOString(),finalAt:now.toISOString(),
        firstExternal:first.first_evidence,finalExternal:proof,
        entryAuthorized:false})]);
    return {ok:true,at:now.getTime(),proof,newCheck:true,scoreKey};
  };
}