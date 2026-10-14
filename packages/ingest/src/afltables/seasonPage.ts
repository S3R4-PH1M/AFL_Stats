/**
 * AFL Tables season page → match links in round order (proposal §6.2, task 9.5).
 *
 * Each home-and-away round is headed "Round N" and each final by its name ("Qualifying Final",
 * …, "Grand Final"); the match tables follow, each with a "Match stats" link to
 * `../stats/games/{year}/{matchKey}.html`. Page order is round order: postponed games stay in
 * their original round's block, so this never sorts by date.
 *
 * Each match table has two team rows: home first (verified against Squiggle for all 216 games of
 * 2025), with the venue-local date and time in the home row and the link in the away row. These
 * give the Squiggle join key (local date, home, away) without fetching the match page (M1d).
 */
import { teamByAfltablesName } from '@afl/core';
import { type CheerioAPI, load } from 'cheerio';
import { cleanText } from './decode.ts';
import { normaliseRound, UnknownRoundError } from './rounds.ts';
import { parsePageDateTime } from './time.ts';

export interface SeasonMatchLink {
  matchKey: string;
  url: string;
  roundLabel: string;
  homeTeamId: string;
  awayTeamId: string;
  /** Venue-local date, `YYYY-MM-DD`. */
  date: string;
  /** Venue-local date and time as shown, without the bracketed AEST time. */
  localTime: string;
  /** Start from the page's own time (§6.4.6); Squiggle `unixtime` is preferred when joined. */
  startUtc: string;
}

export class SeasonPageError extends Error {
  constructor(message: string, season: number) {
    super(`Season page ${season}: ${message}`);
    this.name = 'SeasonPageError';
  }
}

/** A match link; a trailing query or fragment is tolerated and dropped from the URL. */
const MATCH_HREF = /games\/(\d{4})\/(\d{12})\.html(?:[?#].*)?$/;
/** Bold text that claims to be a round or final heading. */
const LOOKS_LIKE_ROUND = /^Round\b|\bFinal\b/;

export function parseSeasonPage(html: string, season: number): SeasonMatchLink[] {
  const $ = load(html);
  const base = 'https://afltables.com/afl/stats/games';
  const links = new Map<string, SeasonMatchLink>();
  let roundLabel: string | undefined;

  // Headings and links in one pass, so cheerio returns them in document order.
  for (const el of $('td > b, a[href*="stats/games/"]').toArray()) {
    if (el.tagName === 'b') {
      // Only the bold text itself: 2025 Round 1 nests a "* see notes" link we don't need.
      const text = cleanText($(el).contents().first().text());
      try {
        const round = normaliseRound(text);
        // Headings always say "Round N" here; a bare bold number (e.g. in the ladder) is not one.
        if (round.isFinal || text.startsWith('Round ')) roundLabel = round.roundLabel;
      } catch (error) {
        if (!(error instanceof UnknownRoundError)) throw error;
        // Other bold cells (the "Finals" banner, ladder headings, winners) aren't rounds, but an
        // unrecognised round or final heading must fail rather than inherit the previous label.
        if (LOOKS_LIKE_ROUND.test(text)) {
          throw new SeasonPageError(`unrecognised round heading "${text}"`, season);
        }
      }
      continue;
    }
    const href = $(el).attr('href') ?? '';
    const [, year, matchKey] = MATCH_HREF.exec(href) ?? [];
    if (!year || !matchKey) throw new SeasonPageError(`unexpected match link "${href}"`, season);
    if (Number(year) !== season) {
      throw new SeasonPageError(`link to season ${year} ("${href}")`, season);
    }
    if (!roundLabel) throw new SeasonPageError(`match ${matchKey} before any round`, season);
    if (!links.has(matchKey)) {
      links.set(matchKey, {
        matchKey,
        url: `${base}/${year}/${matchKey}.html`,
        roundLabel,
        ...matchRows($, el, season, matchKey),
      });
    }
  }

  if (links.size === 0) throw new SeasonPageError('no match links found', season);
  return [...links.values()];
}

/** A DOM node, typed without importing cheerio's `domhandler` dependency directly. */
type Node = Parameters<CheerioAPI['contains']>[0];

/** Home and away teams and the start from the link's match table (home row first). */
function matchRows(
  $: CheerioAPI,
  link: Node,
  season: number,
  matchKey: string,
): Pick<SeasonMatchLink, 'homeTeamId' | 'awayTeamId' | 'date' | 'localTime' | 'startUtc'> {
  const fail = (message: string): never => {
    throw new SeasonPageError(`${matchKey}: ${message}`, season);
  };
  const rows = $(link).closest('table').find('tr');
  if (rows.length !== 2) fail(`expected 2 team rows, found ${rows.length}`);
  const [home, away] = rows.toArray().map((tr) => {
    const name = cleanText($(tr).children('td').first().text());
    try {
      return teamByAfltablesName(name, season).teamId;
    } catch (error) {
      return fail((error as Error).message);
    }
  }) as [string, string];

  // "Fri 15-Aug-2025 6:35 PM (8:35 PM) Att: 54,302 Venue: Perth Stadium"
  const text = cleanText($(rows[0]).children('td').last().text());
  const dateText = text.replace(/\s+(?:Att|Venue):.*$/, '');
  let when: ReturnType<typeof parsePageDateTime>;
  try {
    when = parsePageDateTime(dateText);
  } catch (error) {
    return fail((error as Error).message);
  }
  if (when.date.replaceAll('-', '') !== matchKey.slice(4)) {
    fail(`date ${when.date} does not match the match key`);
  }
  return {
    homeTeamId: home,
    awayTeamId: away,
    date: when.date,
    localTime: when.localTime,
    startUtc: when.startUtc,
  };
}
