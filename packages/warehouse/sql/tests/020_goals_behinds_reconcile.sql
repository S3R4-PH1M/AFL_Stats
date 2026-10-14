-- Σ player GL = team goals, and Σ player BH + rushed behinds = team behinds (§12, M1c finding).
-- Team goals and behinds are the last quarter's cumulative score from the match header.
WITH last_quarter AS (
  SELECT match_id, team_id, cum_goals, cum_behinds
  FROM match_quarter
  QUALIFY quarter = max(quarter) OVER (PARTITION BY match_id, team_id)
),
players AS (
  SELECT match_id, team_id, sum(gl) AS gl, sum(bh) AS bh
  FROM player_match
  GROUP BY match_id, team_id
)
SELECT q.match_id, q.team_id, p.gl AS sum_gl, q.cum_goals AS team_goals,
  p.bh AS sum_bh, t.rushed_behinds, q.cum_behinds AS team_behinds
FROM last_quarter q
LEFT JOIN players p USING (match_id, team_id)
LEFT JOIN team_match_totals t USING (match_id, team_id)
WHERE p.gl IS DISTINCT FROM q.cum_goals
  OR p.bh + t.rushed_behinds IS DISTINCT FROM q.cum_behinds
