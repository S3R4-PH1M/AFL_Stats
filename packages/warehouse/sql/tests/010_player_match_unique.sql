-- One row per (match, player) (§12). The primary key enforces it at load; this guards models and
-- any future loader that bypasses it.
SELECT match_id, player_id, count(*) AS row_count
FROM player_match
GROUP BY match_id, player_id
HAVING count(*) > 1
