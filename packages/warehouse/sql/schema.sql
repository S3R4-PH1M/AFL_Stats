-- Warehouse schema (proposal §7, task 9.8). `data/afl.duckdb` is rebuilt from scratch by
-- `db:build` every time, so there are no migrations. Stats are stored wide, one column per
-- `stat_definition` row, in AFL Tables column order (`core/stats.ts`).
--
-- Differences from §7 (M1d):
-- - `team.afltables_names` is a list: a club can have several AFL Tables names (Kangaroos).
-- - `match.local_date` is the venue-local date, the Squiggle join key.
-- - `team_match_totals` keeps each match page's Totals row and rushed behinds for reconciliation.
-- - `squiggle_game` and `squiggle_standing` hold the Squiggle data the SQL tests check against.
-- - `ladder_round` is built by `sql/models/010_ladder_round.sql`, not declared here.

CREATE TABLE team (
  team_id TEXT PRIMARY KEY,               -- slug, e.g. 'brisbane-lions'
  name TEXT NOT NULL,
  abbrev TEXT NOT NULL,
  squiggle_id INTEGER NOT NULL,
  afltables_names VARCHAR[] NOT NULL,
  lineage_of TEXT                         -- predecessor club (M7)
);

CREATE TABLE stat_definition (
  code TEXT PRIMARY KEY,                  -- AFL Tables heading, e.g. '1%'
  column_name TEXT NOT NULL UNIQUE,       -- player_match column, e.g. 'one_pct'
  label TEXT NOT NULL,
  description TEXT NOT NULL,
  first_season SMALLINT NOT NULL,         -- blank = 0 from this season, NULL before (§6.4.1)
  higher_is_better BOOLEAN NOT NULL,
  display_order SMALLINT NOT NULL
);

CREATE TABLE player (
  player_id TEXT PRIMARY KEY,             -- AFL Tables path, e.g. 'T/Tom_Lynch1'
  first_name TEXT,
  surname TEXT,
  display_name TEXT NOT NULL,
  dob DATE,                               -- bio fields come from player pages (M2)
  height_cm SMALLINT,
  weight_kg SMALLINT,
  debut_date DATE
);

CREATE TABLE match (
  match_id TEXT PRIMARY KEY,              -- AFL Tables key, e.g. '141820250511'
  squiggle_id INTEGER,                    -- uniqueness is a data test (070)
  season SMALLINT NOT NULL,
  round_label TEXT NOT NULL,              -- Squiggle's for joined home-and-away matches (D-a)
  round_no SMALLINT,                      -- NULL for finals
  is_final BOOLEAN NOT NULL,
  is_grand_final BOOLEAN NOT NULL,
  start_utc TIMESTAMPTZ,                  -- Squiggle unixtime, else the page time
  local_date DATE NOT NULL,
  local_time TEXT NOT NULL,
  venue TEXT NOT NULL,
  attendance INTEGER,
  home_team_id TEXT NOT NULL REFERENCES team (team_id),
  away_team_id TEXT NOT NULL REFERENCES team (team_id),
  home_score SMALLINT NOT NULL,
  away_score SMALLINT NOT NULL,
  source_fetched_at TIMESTAMPTZ NOT NULL  -- raw-cache fetch time of the match page
);

CREATE TABLE match_quarter (
  match_id TEXT NOT NULL REFERENCES match (match_id),
  team_id TEXT NOT NULL REFERENCES team (team_id),
  quarter TINYINT NOT NULL,               -- 1..4, 5+ = extra time
  goals SMALLINT NOT NULL,                -- this quarter only
  behinds SMALLINT NOT NULL,
  points SMALLINT NOT NULL,
  cum_goals SMALLINT NOT NULL,
  cum_behinds SMALLINT NOT NULL,
  cum_points SMALLINT NOT NULL,
  PRIMARY KEY (match_id, team_id, quarter)
);

CREATE TABLE player_match (
  match_id TEXT NOT NULL REFERENCES match (match_id),
  player_id TEXT NOT NULL REFERENCES player (player_id),
  team_id TEXT NOT NULL REFERENCES team (team_id),
  jumper SMALLINT,
  sub_status TEXT,                        -- 'on', 'off' or NULL
  ki SMALLINT, mk SMALLINT, hb SMALLINT, di SMALLINT, gl SMALLINT, bh SMALLINT,
  ho SMALLINT, tk SMALLINT, rb SMALLINT, if50 SMALLINT, cl SMALLINT, cg SMALLINT,
  ff SMALLINT, fa SMALLINT, br SMALLINT, cp SMALLINT, up SMALLINT, cm SMALLINT,
  mi SMALLINT, one_pct SMALLINT, bo SMALLINT, ga SMALLINT, pct_played DECIMAL(4,1),
  PRIMARY KEY (match_id, player_id)
);

-- The Totals row of each Match Statistics table, with the Rushed row (§6.4, M1c). Source data,
-- reconciled against the generated `team_match` view (Σ player_match) by the data tests.
CREATE TABLE team_match_totals (
  match_id TEXT NOT NULL REFERENCES match (match_id),
  team_id TEXT NOT NULL REFERENCES team (team_id),
  rushed_behinds SMALLINT NOT NULL,
  ki SMALLINT, mk SMALLINT, hb SMALLINT, di SMALLINT, gl SMALLINT, bh SMALLINT,
  ho SMALLINT, tk SMALLINT, rb SMALLINT, if50 SMALLINT, cl SMALLINT, cg SMALLINT,
  ff SMALLINT, fa SMALLINT, br SMALLINT, cp SMALLINT, up SMALLINT, cm SMALLINT,
  mi SMALLINT, one_pct SMALLINT, bo SMALLINT, ga SMALLINT, pct_played DECIMAL(4,1),
  PRIMARY KEY (match_id, team_id)
);

CREATE TABLE squiggle_game (
  squiggle_id INTEGER PRIMARY KEY,
  season SMALLINT NOT NULL,
  round_no SMALLINT NOT NULL,             -- Squiggle round: 0 = Opening Round
  round_label TEXT NOT NULL,
  is_final BOOLEAN NOT NULL,
  is_grand_final BOOLEAN NOT NULL,
  home_team_id TEXT NOT NULL REFERENCES team (team_id),
  away_team_id TEXT NOT NULL REFERENCES team (team_id),
  home_goals SMALLINT, home_behinds SMALLINT, home_score SMALLINT,
  away_goals SMALLINT, away_behinds SMALLINT, away_score SMALLINT,
  venue TEXT NOT NULL,
  local_date DATE NOT NULL,               -- date part of Squiggle `localtime`
  start_utc TIMESTAMPTZ NOT NULL,
  complete TINYINT NOT NULL               -- 100 = final
);

CREATE TABLE squiggle_standing (
  season SMALLINT NOT NULL,
  team_id TEXT NOT NULL REFERENCES team (team_id),
  rank TINYINT NOT NULL,
  played SMALLINT NOT NULL, wins SMALLINT NOT NULL, losses SMALLINT NOT NULL, draws SMALLINT NOT NULL,
  pts SMALLINT NOT NULL,
  points_for INTEGER NOT NULL,
  points_against INTEGER NOT NULL,
  percentage DOUBLE NOT NULL,             -- unrounded
  PRIMARY KEY (season, team_id)
);

-- How completely each season with Squiggle data is loaded. A season is fully loaded when every
-- Squiggle home-and-away game is complete and joined to a loaded match; only then can its derived
-- final ladder be compared with Squiggle's standings (test 090).
CREATE VIEW season_load AS
SELECT
  g.season,
  count(*) FILTER (WHERE NOT g.is_final) AS squiggle_games,
  count(*) FILTER (WHERE NOT g.is_final AND g.complete = 100) AS squiggle_complete,
  count(m.match_id) FILTER (WHERE NOT g.is_final) AS loaded,
  coalesce(bool_and(g.complete = 100 AND m.match_id IS NOT NULL) FILTER (WHERE NOT g.is_final), false)
    AS fully_loaded
FROM squiggle_game g
LEFT JOIN match m ON m.squiggle_id = g.squiggle_id
GROUP BY g.season;
