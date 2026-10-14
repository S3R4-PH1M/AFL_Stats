-- DI = KI + HB (§12), where all three are recorded.
SELECT match_id, player_id, ki, hb, di
FROM player_match
WHERE di <> ki + hb
