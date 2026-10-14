-- Brownlow votes (decision D-b, M1d). Inside BR's coverage:
-- - a home-and-away match has 6 votes (3-2-1) with BR recorded for every player, or BR NULL for
--   every player while the votes are unpublished (a page cached before the count);
-- - an unpublished match fails once the season's Grand Final is loaded, because the count is the
--   week before it: re-fetch with `npm run ingest -- --season Y --force`;
-- - a final has no votes.
WITH gf_seasons AS (
  SELECT DISTINCT season FROM match WHERE is_grand_final
),
per_match AS (
  SELECT m.match_id, m.season, m.is_final,
    count(*) AS players,
    count(pm.br) AS players_with_br,
    coalesce(sum(pm.br), 0) AS votes,
    m.season IN (SELECT season FROM gf_seasons) AS grand_final_loaded
  FROM match m
  JOIN player_match pm USING (match_id)
  JOIN stat_definition d ON d.column_name = 'br'
  WHERE m.season >= d.first_season
  GROUP BY m.match_id, m.season, m.is_final
)
SELECT *,
  CASE
    WHEN is_final THEN 'final with votes or NULL BR'
    WHEN players_with_br = 0 THEN 'votes unpublished after the Grand Final: ingest --force'
    ELSE 'expected 6 votes with BR for every player'
  END AS problem
FROM per_match
WHERE (is_final AND (players_with_br <> players OR votes <> 0))
  OR (NOT is_final AND players_with_br = 0 AND grand_final_loaded)
  OR (NOT is_final AND players_with_br > 0 AND (players_with_br <> players OR votes <> 6))
