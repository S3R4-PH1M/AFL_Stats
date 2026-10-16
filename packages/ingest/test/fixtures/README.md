# Test fixtures

Raw pages saved byte-for-byte as served, once, by hand, before any parser code existed. They're committed so CI can run the parser and SQL tests (decision F1). `.gitattributes` marks `afltables/` and `squiggle/` as `-text`, so git never rewrites their line endings, and `biome.json` excludes both folders from lint and format. This README is outside both rules and is checked normally. **Don't edit the fixture files.** To refresh one, download it again and update its row below.

Every file was fetched on **14 Oct 2026** with `curl`, sending the project User-Agent (`AFL_Stats (github.com/S3R4-PH1M/AFL_Stats; <contact email>)`), one request at a time with a 3 s pause between requests. Every response was HTTP 200.

## AFL Tables (`afltables/`)

| File | Source URL | Why |
|---|---|---|
| `seas-2025.html` | https://afltables.com/afl/seas/2025.html | Season page: 216 match links, finals labels (task 9.5) |
| `seas-2003.html` | https://afltables.com/afl/seas/2003.html | Oldest season in scope: 185 match links, team-name mapping (9.1, 9.5). 16 clubs. North Melbourne is listed as **`Kangaroos`**, which isn't a Squiggle name, so `core/teams.ts` needs it as an alias. The other 15 names match Squiggle exactly |
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
| `games-2025.json` | https://api.squiggle.com.au/?q=games;year=2025 | 216 games, all `complete: 100`: the join to AFL Tables and `start_utc` (9.6). Join on **local date + home + away**, not on time. Start times don't always agree: R23, Fremantle v Brisbane Lions on 15 Aug 2025 at Perth Stadium is `6:35 PM (8:35 PM)` on AFL Tables (10:35 UTC) but `unixtime` 10:20 UTC on Squiggle. The other 215 agree. Prefer Squiggle's `unixtime` |
| `standings-2025.json` | https://api.squiggle.com.au/?q=standings;year=2025 | Final 2025 ladder, 18 rows: the ladder-vs-Squiggle SQL test (9.8) |

## Layout notes found while saving

These differ from the proposal's §6 and matter for the parsers in M1c:

- **No `SU` column.** All five match pages use the same 25 headings, from `#` and `Player` through `%P`. On 2025 pages a substitute is marked inside the `#` cell instead: `&uarr;` = subbed on, `&darr;` = subbed off (e.g. `27 &darr;` for Thomson Dow). Each 2025 fixture has 4 marked players (one on and one off per team). The 2003 page has none. `SU=Sub (On/Off)` appears only in the legend, which is the same in 2003 and 2025.
- **No charset declaration.** None of the AFL Tables pages has a `<meta charset>`, and every page is plain ASCII, with names written as HTML entities. The parser should decode HTML entities and fall back to a default encoding when no charset is declared (§6.4.7).
- **Times:** the main time is the venue's local time. A bracketed second time is the same moment in AEST (UTC+10, no daylight saving), shown only when it differs: MCG in March `4:15 PM (3:15 PM)`, Perth in July `6:10 PM (8:10 PM)`, Adelaide in July `4:10 PM (4:40 PM)`. Queensland matches never have one. This holds on both the 2003 and 2025 season pages, so `start_utc` = AEST time − 10 h. **The bracket carries no date, so the AEST time can fall on the next calendar day.** In Perth (2 h behind AEST in winter), a 10:10 PM local start or later shows an AEST time after midnight. Compute from the local time and the venue's UTC offset, or add a day when the AEST time is earlier than the local time and the venue is behind AEST. Applying the bracketed time to the local date would land 24 h early. No fixture covers this.
- **Match key** = the two 2-digit AFL Tables team codes in ascending order, then `YYYYMMDD`, e.g. `1418` + `20250511`. It doesn't say which team is home.
- **Player IDs** can contain **digits** (`B/Bailey_Williams1`, `J/Jack_Graham2`, `J/Jack_Ross3`, `L/Luke_Trainor1`, `T/Tom_Lynch1` in the normal match) and **hyphens** (`A/Alex_Neal-Bullen` in `2025-010520250322.html`, `L/Luke_Davies-Uniacke` in `2025-121920250511.html`). Don't whitelist characters. Take everything between `players/` and `.html` (e.g. `/players\/([A-Z]\/[^/"]+)\.html/`), and assert 22 or 23 IDs per team.
- **Team sizes:** each match page has two "Match Statistics" tables, each ending in a "Totals" row. Every player row has a `players/…` link. There are 22 players per team in 2003 and 23 per team in 2025 (22 plus the sub).

## Findings while building (M1c–M1d)

Checked against these fixtures with the parsers and the warehouse. Each is covered by a test.

**AFL Tables**
- **Round numbers:** AFL Tables numbers 2025's Opening Round as Round 1, so most of its 2025 rounds are Squiggle's + 1 (the R9 Richmond v West Coast page says `Round: 10`). Postponed games break the rule (see Squiggle below): AFL Tables' Round 1 holds 4 games, but Squiggle files two of them under rounds 3 and 24. The warehouse uses Squiggle's round for **home-and-away** matches joined to Squiggle; finals keep the AFL Tables label with `round_no` NULL (decision D-a).
- **Season page rows:** each match table has two team rows, with the **home team first** (216 of 216 agree with Squiggle). The date is written `Fri 15-Aug-2025 6:35 PM`, with no comma after the weekday; match pages write `Sat, 22-Mar-2025`.
- **Postponed games** stay in their original round's block on the season page, so page order is round order, not date order.
- **Rushed behinds:** each Match Statistics footer has a "Rushed" row, present only when above 0. The Totals row's BH includes rushed behinds, so Σ player BH + rushed = team behinds, and Σ player GL = team goals.
- **Brownlow votes:** every 2025 home-and-away fixture's BR column sums to 6 (3-2-1); the Grand Final has none. A page cached before the count shows BR blank (read as 0), so the loader stores BR as NULL until the page is re-fetched after the count.

**Squiggle**
- **`date` is Melbourne time** (in the game's `tz`, `+10:00` or `+11:00`); **`localtime` is the venue's local time**. They differ for 64 of the 216 games. Join on the date part of `localtime`, so a late Perth game can't land on the next day.
- **`is_final`** is a number: 0 home-and-away, 2 elimination, 3 qualifying, 4 semi, 5 preliminary, 6 Grand Final. `is_grand_final` is 0 or 1.
- **`winner` and `winnerteamid`** are null for a draw (R9 North Melbourne v Brisbane Lions).
- **Postponed games are filed under the round they were played in.** Two 2025 Opening Round games were postponed: Brisbane Lions v Geelong (29 Mar) is Squiggle round 3, and Gold Coast v Essendon (27 Aug) is Squiggle round 24. AFL Tables keeps both in its Opening Round block (its Round 1). Squiggle's round 0 therefore has only 2 games, Sydney v Hawthorn and GWS v Collingwood.
- **Finals before their teams are known** may be listed with null teams (assumed; the fixtures only hold completed games). They're accepted while not started and never joined.
- **Standings `percentage`** is unrounded; the ladder derived from `games-2025.json` (4 points a win, 2 a draw, then percentage) reproduces `standings-2025.json` exactly.
