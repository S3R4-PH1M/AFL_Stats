/**
 * Raw page bytes → string (proposal §6.4.7).
 *
 * AFL Tables pages declare no charset and are plain ASCII with HTML entities, so the fallback is
 * `windows-1252` (a superset of latin1). Entities are left for cheerio to decode.
 */
import { TextDecoder } from 'node:util';

const FALLBACK_ENCODING = 'windows-1252';
const META_CHARSET = /<meta\b[^>]*\bcharset\s*=\s*["']?\s*([\w.:-]+)/i;

export function decodeHtml(body: Uint8Array): string {
  const head = new TextDecoder('latin1').decode(body.subarray(0, 1024));
  const declared = META_CHARSET.exec(head)?.[1];
  return decoderFor(declared).decode(body);
}

function decoderFor(label: string | undefined): TextDecoder {
  if (label) {
    try {
      return new TextDecoder(label);
    } catch {
      // Unknown label: use the fallback.
    }
  }
  return new TextDecoder(FALLBACK_ENCODING);
}

/** Unicode NFC, with runs of whitespace (including non-breaking spaces) collapsed and trimmed. */
export function cleanText(text: string): string {
  return text.normalize('NFC').replace(/\s+/g, ' ').trim();
}
