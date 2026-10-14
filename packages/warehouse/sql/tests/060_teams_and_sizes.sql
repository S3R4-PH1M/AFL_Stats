-- Each match has exactly 2 teams in player_match, its home and away teams, with 22–23 players
-- each: 22 before the substitute rule, 22 plus the sub in 2025 (§12, M1a finding).
WITH sides AS (
  SELECT match_id, team_id, count(*) AS players
  FROM player_match
  GROUP BY match_id, team_id
)
SELECT m.match_id, m.home_team_id, m.away_team_id,
  list(s.team_id ORDER BY s.team_id) AS teams,
  list(s.players ORDER BY s.team_id) AS players
FROM match m
LEFT JOIN sides s USING (match_id)
GROUP BY m.match_id, m.home_team_id, m.away_team_id
HAVING count(s.team_id) <> 2
  OR coalesce(bool_or(s.team_id NOT IN (m.home_team_id, m.away_team_id)), false)
  OR coalesce(bool_or(s.players NOT BETWEEN 22 AND 23), false)
