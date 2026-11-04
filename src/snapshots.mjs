// A score observation and a market scan are different clocks. All score
// writers share this ordering rule; a lower countdown is not proof of freshness.
export async function writeScoreSnapshots(query, rows) {
  for (let i = 0; i < rows.length; i += 100) {
    const batch = rows.slice(i, i + 100).map(row => [...row, row[12]]);
    if (!batch.length) continue;
    const values = batch.map((_, n) => '(' + Array.from({length:19}, (_, j) => '$' + (n * 19 + j + 1)).join(',') + ')').join(',');
    await query(`INSERT INTO game_snapshots
      (id,title,sport,sport_family,home,away,status,progress,period,time_left,clock_seconds,clock_label,clock_observed_at,scanned_at,signals,possession_side,home_team_id,away_team_id,score_observed_at)
      VALUES ${values} ON CONFLICT(id) DO UPDATE SET
      title=EXCLUDED.title,sport=EXCLUDED.sport,sport_family=EXCLUDED.sport_family,
      home=EXCLUDED.home,away=EXCLUDED.away,status=EXCLUDED.status,progress=EXCLUDED.progress,
      period=EXCLUDED.period,time_left=EXCLUDED.time_left,clock_seconds=EXCLUDED.clock_seconds,clock_label=EXCLUDED.clock_label,
      clock_observed_at=CASE WHEN game_snapshots.clock_seconds IS NOT DISTINCT FROM EXCLUDED.clock_seconds
        AND game_snapshots.period IS NOT DISTINCT FROM EXCLUDED.period
        AND game_snapshots.status=EXCLUDED.status AND game_snapshots.clock_label IS NOT DISTINCT FROM EXCLUDED.clock_label
        AND game_snapshots.time_left IS NOT DISTINCT FROM EXCLUDED.time_left
        THEN game_snapshots.clock_observed_at ELSE EXCLUDED.clock_observed_at END,
      score_observed_at=EXCLUDED.score_observed_at,
      signals=CASE WHEN EXCLUDED.status='live' THEN game_snapshots.signals ELSE '[]'::jsonb END,
      possession_side=EXCLUDED.possession_side,home_team_id=EXCLUDED.home_team_id,away_team_id=EXCLUDED.away_team_id
      WHERE COALESCE(game_snapshots.score_observed_at,game_snapshots.clock_observed_at,'epoch'::timestamptz)<=EXCLUDED.score_observed_at`, batch.flat());
  }
}

// Save terminal/stale observations for tracked games before filtering the
// executable universe. Missing feed entries are not evidence of completion.
export function observedSnapshotGames(games, liveMap, trackedIds) {
  return games.filter(g => liveMap.has(g.milestone.id) &&
    (g.state.verifiedLive && g.state.scoreKnown || trackedIds.has(g.milestone.id)));
}
