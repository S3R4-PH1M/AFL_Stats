/**
 * AFL Tables season page → match links in round order (proposal §6.2, task 9.5).
 *
 * Each home-and-away round is headed "Round N" and each final by its name ("Qualifying Final",
 * …, "Grand Final"); the match tables follow, each with a "Match stats" link to
 * `../stats/games/{year}/{matchKey}.html`. Page order is round order: postponed games stay in
 * their original round's block, so this never sorts by date.
 */
import { load } from 'cheerio';
import { cleanText } from './decode.ts';
import { normaliseRound, UnknownRoundError } from './rounds.ts';

export interface SeasonMatchLink {
  matchKey: string;
  url: string;
  roundLabel: string;
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
      links.set(matchKey, { matchKey, url: `${base}/${year}/${matchKey}.html`, roundLabel });
    }
  }

  if (links.size === 0) throw new SeasonPageError('no match links found', season);
  return [...links.values()];
}
