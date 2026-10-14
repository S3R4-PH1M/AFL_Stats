import { describe, expect, it } from 'vitest';
import { cleanText, decodeHtml } from '../src/afltables/decode.ts';
import { readFixtureBytes } from './helpers.ts';

describe('decodeHtml', () => {
  it('falls back to windows-1252 when there is no meta charset (§6.4.7)', () => {
    const bytes = Buffer.from([0x3c, 0x70, 0x3e, 0xe9, 0x92, 0x80, 0x3c, 0x2f, 0x70, 0x3e]);
    expect(decodeHtml(bytes)).toBe('<p>é’€</p>');
  });

  it('honours a declared meta charset', () => {
    const html = '<html><head><meta charset="utf-8"></head><body>Zoë</body></html>';
    expect(decodeHtml(Buffer.from(html, 'utf8'))).toBe(html);
    const legacy = '<meta http-equiv="Content-Type" content="text/html; charset=UTF-8"><b>é</b>';
    expect(decodeHtml(Buffer.from(legacy, 'utf8'))).toBe(legacy);
  });

  it('ignores an unknown charset label and uses the fallback', () => {
    const bytes = Buffer.concat([Buffer.from('<meta charset="x-bogus">'), Buffer.from([0xe9])]);
    expect(decodeHtml(bytes)).toBe('<meta charset="x-bogus">é');
  });

  it('decodes a fixture page unchanged (the fixtures are plain ASCII)', () => {
    const bytes = readFixtureBytes('afltables/2025-141820250511.html');
    expect(decodeHtml(bytes)).toBe(bytes.toString('latin1'));
  });
});

describe('cleanText', () => {
  it('normalises to NFC and collapses whitespace, including non-breaking spaces', () => {
    expect(cleanText('  Zoë   Smith\t\n')).toBe('Zoë Smith');
    expect(cleanText(' ')).toBe('');
  });
});
