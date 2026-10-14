-- requires: SELECT coalesce(bool_or(fully_loaded), false) FROM season_load
-- The derived final ladder (after the last home-and-away round) equals Squiggle's standings for
-- every fully loaded season (§7, §12). Skipped when no season is fully loaded, e.g. the fixtures.
WITH seasons AS (
  SELECT season FROM season_load WHERE fully_loaded
),
derived AS (
  SELECT l.*
  FROM ladder_round l
  JOIN seasons USING (season)
  QUALIFY l.round_no = max(l.round_no) OVER (PARTITION BY l.season)
),
squiggle AS (
  SELECT q.* FROM squiggle_standing q JOIN seasons USING (season)
)
SELECT coalesce(d.season, s.season) AS season, coalesce(d.team_id, s.team_id) AS team_id,
  d.rank, s.rank AS sq_rank, d.played, s.played AS sq_played,
  d.wins, s.wins AS sq_wins, d.losses, s.losses AS sq_losses, d.draws, s.draws AS sq_draws,
  d.pts, s.pts AS sq_pts, d.points_for, s.points_for AS sq_for,
  d.points_against, s.points_against AS sq_against,
  d.percentage, round(s.percentage, 2)::DECIMAL(6, 2) AS sq_percentage
FROM derived d
FULL JOIN squiggle s ON s.season = d.season AND s.team_id = d.team_id
WHERE d.team_id IS NULL OR s.team_id IS NULL
  OR d.rank <> s.rank OR d.played <> s.played OR d.wins <> s.wins OR d.losses <> s.losses
  OR d.draws <> s.draws OR d.pts <> s.pts OR d.points_for <> s.points_for
  OR d.points_against <> s.points_against
  OR d.percentage IS DISTINCT FROM round(s.percentage, 2)::DECIMAL(6, 2)
