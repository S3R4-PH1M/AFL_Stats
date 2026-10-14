# Test fixtures

Raw pages saved byte-for-byte as served, once, by hand, before any parser code existed. They're committed so CI can run the parser and SQL tests (decision F1). `.gitattributes` marks this folder `-text`, so git never rewrites line endings. **Don't edit these files.** To refresh one, download it again and update its row below.

Every file was fetched on **14 Oct 2026** with `curl`, sending the project User-Agent (`AFL_Stats (github.com/S3R4-PH1M/AFL_Stats; <contact email>)`), one request at a time with a 3 s pause between requests. Every response was HTTP 200.

## AFL Tables (`afltables/`)

| File | Source URL | Why |
|---|---|---|
| `seas-2025.html` | https://afltables.com/afl/seas/2025.html | Season page: 216 match links, finals labels (task 9.5) |
| `seas-2003.html` | https://afltables.com/afl/seas/2003.html | Oldest season in scope: 185 match links, team-name mapping (9.1, 9.5) |
| `2025-141820250511.html` | https://afltables.com/afl/stats/games/2025/141820250511.html | Normal home-and-away match, the baseline layout: R9, Richmond 11.15 (81) v West Coast 11.13 (79), M.C.G., att. 29,539 |
| `2025-010520250322.html` | https://afltables.com/afl/stats/games/2025/010520250322.html | Highest-scoring 2025 match (261 points): R2, Essendon 15.10 (100) v Adelaide 25.11 (161), M.C.G. Its time header also shows a second time in brackets: `1:20 PM (12:20 PM)` |
| `2025-091920250927.html` | https://afltables.com/afl/stats/games/2025/091920250927.html | 2025 Grand Final: Geelong 11.9 (75) v Brisbane Lions 18.14 (122), M.C.G., att. 100,022 |
| `2025-121920250511.html` | https://afltables.com/afl/stats/games/2025/121920250511.html | The only 2025 draw: R9, North Melbourne 10.11 (71) v Brisbane Lions 10.11 (71), Bellerive Oval, att. 7,395 |
| `2003-010320030629.html` | https://afltables.com/afl/stats/games/2003/010320030629.html | Oldest layout in scope, no subs: Carlton v Adelaide, 29 Jun 2003 |
| `player-Tom_Lynch1.html` | https://afltables.com/afl/stats/players/T/Tom_Lynch1.html | Player page for M2 bios. Tom Lynch (Richmond) plays in the normal match above. His ID has a numeric suffix (`T/Tom_Lynch1`), which AFL Tables uses for players with the same name |

## Squiggle (`squiggle/`)

| File | Source URL | Why |
|---|---|---|
| `teams.json` | https://api.squiggle.com.au/?q=teams | 18 teams: source of `squiggle_id` in `core/teams.ts` (9.1) |
| `games-2025.json` | https://api.squiggle.com.au/?q=games;year=2025 | 216 games, all `complete: 100`: the join to AFL Tables and `start_utc` (9.6) |
| `standings-2025.json` | https://api.squiggle.com.au/?q=standings;year=2025 | Final 2025 ladder, 18 rows: the ladder-vs-Squiggle SQL test (9.8) |

## Layout notes found while saving

These differ from the proposal's §6 and matter for the parsers in M1c:

- **No `SU` column.** All five match pages use the same 25 headings, from `#` and `Player` through `%P`. On 2025 pages a substitute is marked inside the `#` cell instead: `&uarr;` = subbed on, `&darr;` = subbed off (e.g. `27 &darr;` for Thomson Dow). Each 2025 fixture has 4 marked players (one on and one off per team). The 2003 page has none. `SU=Sub (On/Off)` appears only in the legend, which is the same in 2003 and 2025.
- **No charset declaration.** None of the AFL Tables pages has a `<meta charset>`, and every page is plain ASCII, with names written as HTML entities. The parser should decode HTML entities and fall back to a default encoding when no charset is declared (§6.4.7).
- **Match key** = the two 2-digit AFL Tables team codes in ascending order, then `YYYYMMDD`, e.g. `1418` + `20250511`. It doesn't say which team is home.
- **Player IDs** can contain digits (`B/Bailey_Williams1`, `J/Jack_Graham2`, `J/Jack_Ross3`, `L/Luke_Trainor1`, `T/Tom_Lynch1` in the normal match), so don't match IDs with `[A-Za-z_]+`.
- **Team sizes:** each match page has two "Match Statistics" tables, each ending in a "Totals" row. Every player row has a `players/…` link. There are 22 players per team in 2003 and 23 per team in 2025 (22 plus the sub).
