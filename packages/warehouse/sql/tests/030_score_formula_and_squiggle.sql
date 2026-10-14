-- Each side's score = 6 × goals + behinds (from the last quarter), and for a joined, complete
-- Squiggle game the score, goals and behinds equal Squiggle's (§12).
WITH last_quarter AS (
  SELECT match_id, team_id, cum_goals, cum_behinds
  FROM match_quarter
  QUALIFY quarter = max(quarter) OVER (PARTITION BY match_id, team_id)
),
sides AS (
  SELECT m.match_id, 'home' AS side, m.home_team_id AS team_id, m.home_score AS score,
    g.home_goals AS sq_goals, g.home_behinds AS sq_behinds, g.home_score AS sq_score, g.complete
  FROM match m LEFT JOIN squiggle_game g USING (squiggle_id)
  UNION ALL
  SELECT m.match_id, 'away', m.away_team_id, m.away_score,
    g.away_goals, g.away_behinds, g.away_score, g.complete
  FROM match m LEFT JOIN squiggle_game g USING (squiggle_id)
)
SELECT s.match_id, s.side, s.team_id, s.score, q.cum_goals AS goals, q.cum_behinds AS behinds,
  s.sq_score, s.sq_goals, s.sq_behinds
FROM sides s
LEFT JOIN last_quarter q USING (match_id, team_id)
WHERE s.score IS DISTINCT FROM 6 * q.cum_goals + q.cum_behinds
  OR (s.complete = 100 AND (
    s.sq_score IS DISTINCT FROM s.score
    OR s.sq_goals IS DISTINCT FROM q.cum_goals
    OR s.sq_behinds IS DISTINCT FROM q.cum_behinds
  ))
