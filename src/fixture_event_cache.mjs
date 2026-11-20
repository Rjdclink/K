// Persist previously confirmed *identity*, never a reusable score. Each
// preflight must still fetch a live provider response and compare both scores.
// The provider event ID is stable for a single Kalshi fixture and source.
export function createFixtureEventCache(query){
  let ready;
  const ensure=()=>{
    ready??=query(`CREATE TABLE IF NOT EXISTS independent_fixture_links (
      game_id text NOT NULL, source text NOT NULL, kickoff timestamptz NOT NULL,
      league text NOT NULL, provider_event_id text NOT NULL,
      confirmed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      PRIMARY KEY(game_id,source))`).catch(e=>{ready=null;throw e});
    return ready;
  };
  const context=(game,milestone,source)=>{
    const date=Date.parse(milestone?.start_date||'');
    if(!game?.id||game.id!==milestone?.id||
      !['ESPN','FOX Sports'].includes(source)||!Number.isFinite(date)||
      !String(milestone?.details?.league||'').trim())return null;
    return [String(game.id),source,new Date(date).toISOString(),String(milestone.details.league)];
  };
  const get=async(game,milestone,source)=>{
    const args=context(game,milestone,source);if(!args)return null;
    await ensure();
    const {rows}=await query(`SELECT provider_event_id FROM independent_fixture_links
      WHERE game_id=$1 AND source=$2 AND kickoff=$3 AND league=$4`,args);
    return rows.length===1?String(rows[0].provider_event_id):null;
  };
  const put=async(game,milestone,source,eventId)=>{
    const args=context(game,milestone,source),id=String(eventId||'').trim();
    if(!args||!id)return false;
    await ensure();
    // Never silently replace a proven ESPN/FOX event with another event ID.
    const {rows}=await query(`INSERT INTO independent_fixture_links
      (game_id,source,kickoff,league,provider_event_id)
      VALUES($1,$2,$3,$4,$5) ON CONFLICT(game_id,source) DO UPDATE SET
      confirmed_at=CASE WHEN independent_fixture_links.provider_event_id=EXCLUDED.provider_event_id
        AND independent_fixture_links.kickoff=EXCLUDED.kickoff
        AND independent_fixture_links.league=EXCLUDED.league
        THEN clock_timestamp() ELSE independent_fixture_links.confirmed_at END
      RETURNING provider_event_id,kickoff,league`,[...args,id]);
    return rows.length===1&&String(rows[0].provider_event_id)===id&&
      Date.parse(rows[0].kickoff)===Date.parse(args[2])&&rows[0].league===args[3];
  };
  return {get,put};
}