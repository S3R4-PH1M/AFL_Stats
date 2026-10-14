-- 010_ladder_round: the ladder after each home-and-away round (§7, task 9.8).
-- AFL rules: 4 points a win, 2 a draw; percentage = for ÷ against × 100. Ties on points are
-- broken by percentage, then points for. Rounds are Squiggle's for joined matches (Opening Round
-- = 0, decision D-a). Every team in the season has a row for every round, so byes (and teams yet
-- to play) carry their running totals. A postponed match counts in its own round.
CREATE OR REPLACE TABLE ladder_round AS
WITH results AS (
  SELECT season, round_no, home_team_id AS team_id, home_score AS f, away_score AS a
  FROM match WHERE NOT is_final
  UNION ALL
  SELECT season, round_no, away_team_id, away_score, home_score
  FROM match WHERE NOT is_final
),
grid AS (
  SELECT r.season, r.round_no, t.team_id
  FROM (SELECT DISTINCT season, round_no FROM results) r
  JOIN (SELECT DISTINCT season, team_id FROM results) t USING (season)
),
totals AS (
  SELECT
    g.season, g.round_no, g.team_id,
    count(x.f) AS played,
    count(*) FILTER (WHERE x.f > x.a) AS wins,
    count(*) FILTER (WHERE x.f < x.a) AS losses,
    count(*) FILTER (WHERE x.f = x.a) AS draws,
    coalesce(sum(x.f), 0) AS points_for,
    coalesce(sum(x.a), 0) AS points_against
  FROM grid g
  LEFT JOIN results x
    ON x.season = g.season AND x.team_id = g.team_id AND x.round_no <= g.round_no
  GROUP BY g.season, g.round_no, g.team_id
)
SELECT
  season::SMALLINT AS season,
  round_no::SMALLINT AS round_no,
  team_id,
  row_number() OVER (
    PARTITION BY season, round_no
    ORDER BY 4 * wins + 2 * draws DESC,
      points_for / nullif(points_against, 0) DESC NULLS LAST,
      points_for DESC,
      team_id
  )::TINYINT AS rank,
  played::SMALLINT AS played,
  wins::SMALLINT AS wins,
  losses::SMALLINT AS losses,
  draws::SMALLINT AS draws,
  (4 * wins + 2 * draws)::SMALLINT AS pts,
  points_for::INTEGER AS points_for,
  points_against::INTEGER AS points_against,
  round(points_for * 100.0 / nullif(points_against, 0), 2)::DECIMAL(6, 2) AS percentage
FROM totals;
