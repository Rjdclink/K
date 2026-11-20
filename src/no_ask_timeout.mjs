// Persist liquidity decisions across concurrent scanner instances. Missing YES
// asks and missing NO asks are independent markets on the same Kalshi ticker.
// A still-empty candidate has 30 real seconds from first observation, after
// which it is retired for that exact game/contract/side (never another game).
export const NO_ASK_GRACE_MS=30_000;
export const NO_ASK_RETIRED='No executable ask after 30 seconds; candidate skipped';

const clean=(c,side)=>({
  ticker:String(c?.market_ticker||c?.ticker||c?.market?.ticker||'').trim(),
  game_id:String(c?.game_id||c?.gameId||c?.game?.id||c?.state?.id||c?.milestone?.id||'').trim(),
  side
});
const valid=(c,side)=>c.ticker&&c.game_id&&['yes','no'].includes(side);
export function createNoAskTimeout(query){
  let ready;
  const ensure=()=>{
    ready??=query(`CREATE TABLE IF NOT EXISTS no_ask_timeouts (
      market_ticker text NOT NULL, game_id text NOT NULL,
      side text NOT NULL CHECK (side IN ('yes','no')),
      first_missing_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      PRIMARY KEY(market_ticker,game_id,side))`)
      .catch(e=>{ready=null;throw e});
    return ready;
  };
  const rowsFor=(candidates,side)=>{
    const seen=new Set(),rows=[];
    for(const item of candidates){
      const c=clean(item,side),key=c.ticker+'\u0000'+c.game_id;
      if(!valid(c,side)||seen.has(key))continue;
      seen.add(key);rows.push(c);
    }
    return rows;
  };
  // A single read filters a complete scanner batch before quotes or stats.
  const retired=async(candidates,side)=>{
    const rows=rowsFor(candidates,side);
    if(!rows.length)return new Set();
    await ensure();
    const result=await query(`SELECT t.market_ticker,t.game_id FROM no_ask_timeouts t
      JOIN jsonb_to_recordset($1::jsonb) AS x(ticker text,game_id text)
      ON x.ticker=t.market_ticker AND x.game_id=t.game_id
      WHERE t.side=$2 AND t.first_missing_at<=clock_timestamp()-interval '30 seconds'`,
      [JSON.stringify(rows),side]);
    return new Set(result.rows.map(r=>r.market_ticker+'\u0000'+r.game_id));
  };
  // Do not reset a first-missing timestamp on every repeated empty quote.
  const missing=async(candidates,side)=>{
    const rows=rowsFor(candidates,side);
    if(!rows.length)return new Map();
    await ensure();
    const result=await query(`INSERT INTO no_ask_timeouts(market_ticker,game_id,side)
      SELECT ticker,game_id,$2 FROM jsonb_to_recordset($1::jsonb)
      AS x(ticker text,game_id text) ORDER BY ticker,game_id
      ON CONFLICT(market_ticker,game_id,side) DO UPDATE SET
      first_missing_at=no_ask_timeouts.first_missing_at
      RETURNING market_ticker,game_id,
      EXTRACT(EPOCH FROM clock_timestamp()-first_missing_at)*1000 >= 30000 AS retired,
      LEAST(30000,GREATEST(0,EXTRACT(EPOCH FROM clock_timestamp()-first_missing_at)*1000)) AS elapsed_ms`,
      [JSON.stringify(rows),side]);
    return new Map(result.rows.map(r=>[r.market_ticker+'\u0000'+r.game_id,
      {retired:r.retired===true,elapsedMs:Number(r.elapsed_ms)}]));
  };
  // A recovered executable quote during the 30s window cancels the timer.
  // Quotes arriving after retirement do not resurrect a skipped candidate.
  const available=async(candidates,side)=>{
    const rows=rowsFor(candidates,side);
    if(!rows.length)return;
    await ensure();
    await query(`DELETE FROM no_ask_timeouts t USING
      jsonb_to_recordset($1::jsonb) AS x(ticker text,game_id text)
      WHERE t.market_ticker=x.ticker AND t.game_id=x.game_id AND
      t.side=$2 AND t.first_missing_at>clock_timestamp()-interval '30 seconds'`,
      [JSON.stringify(rows),side]);
  };
  const isRetired=async(candidate,side)=>Boolean((await retired([candidate],side)).size);
  const observeMissing=async(candidate,side)=>(await missing([candidate],side))
    .get(clean(candidate,side).ticker+'\u0000'+clean(candidate,side).game_id)||null;
  return {retired,missing,available,isRetired,observeMissing};
}