-- The Squiggle join is complete and consistent (9.6): every match in a season with Squiggle data
-- is joined, no Squiggle game is joined twice, and a joined game has the match's date and teams.
SELECT m.match_id, m.season, m.squiggle_id, 'not joined' AS problem
FROM match m
WHERE m.squiggle_id IS NULL
  AND m.season IN (SELECT DISTINCT season FROM squiggle_game)
UNION ALL
SELECT min(match_id), any_value(season), squiggle_id, 'joined to ' || count(*) || ' matches'
FROM match
WHERE squiggle_id IS NOT NULL
GROUP BY squiggle_id
HAVING count(*) > 1
UNION ALL
SELECT m.match_id, m.season, m.squiggle_id,
  CASE WHEN g.squiggle_id IS NULL THEN 'no such Squiggle game' ELSE 'date or teams differ' END
FROM match m
LEFT JOIN squiggle_game g USING (squiggle_id)
WHERE m.squiggle_id IS NOT NULL
  AND (g.squiggle_id IS NULL
    OR g.local_date <> m.local_date
    OR g.home_team_id <> m.home_team_id
    OR g.away_team_id <> m.away_team_id)
