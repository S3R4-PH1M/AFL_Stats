-- Quarter scores add up (§12): quarters run 1..n with n ≥ 4, each quarter's points = 6G + B,
-- each cumulative = the previous cumulative + this quarter, and the last quarter's cumulative
-- points (Q4, or the last extra-time period) = the final score.
WITH q AS (
  SELECT
    *,
    row_number() OVER w AS n,
    max(quarter) OVER (PARTITION BY match_id, team_id) AS last_quarter,
    lag(cum_goals, 1, 0) OVER w AS prev_goals,
    lag(cum_behinds, 1, 0) OVER w AS prev_behinds,
    lag(cum_points, 1, 0) OVER w AS prev_points
  FROM match_quarter
  WINDOW w AS (PARTITION BY match_id, team_id ORDER BY quarter)
)
SELECT q.match_id, q.team_id, q.quarter, q.goals, q.behinds, q.points,
  q.cum_goals, q.cum_behinds, q.cum_points,
  CASE WHEN q.team_id = m.home_team_id THEN m.home_score ELSE m.away_score END AS final_score
FROM q
JOIN match m USING (match_id)
WHERE q.quarter <> q.n
  OR q.last_quarter < 4
  OR q.points <> 6 * q.goals + q.behinds
  OR q.cum_goals <> q.prev_goals + q.goals
  OR q.cum_behinds <> q.prev_behinds + q.behinds
  OR q.cum_points <> q.prev_points + q.points
  OR (q.quarter = q.last_quarter
    AND q.cum_points <> CASE WHEN q.team_id = m.home_team_id THEN m.home_score ELSE m.away_score END)
