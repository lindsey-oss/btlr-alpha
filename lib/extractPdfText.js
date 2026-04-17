/**
 * PDF text extractor — no external dependencies.
 * Uses the same three-strategy approach as parse-inspection and parse-repair.
 */
import { inflateRawSync, inflateSync, unzipSync } from "zlib";

function extractViaStreams(buffer) {
  const raw = buffer.toString("latin1");
  const chunks = [];
  const streamRe = /stream[\r\n]+([\s\S]*?)[\r\n]+endstream/g;
  let m;
  while ((m = streamRe.exec(raw)) !== null) {
    const bytes = Buffer.from(m[1], "latin1");
    let content = "";
    const tries = [
      () => inflateRawSync(bytes).toString("utf8"),
      () => inflateSync(bytes).toString("utf8"),
      () => unzipSync(bytes).toString("utf8"),
      () => m[1],
    ];
    for (const fn of tries) {
      try { content = fn(); break; } catch {}
    }
    const textRe = /\(([^)\\]*(?:\\.[^)\\]*)*)\)\s*(?:Tj|'|")|(\[(?:[^[\]]*(?:\([^)]*\)[^[\]]*)*)\])\s*TJ/g;
    let t;
    while ((t = textRe.exec(content)) !== null) {
      if (t[1]) {
        chunks.push(t[1]
          .replace(/\\n/g, "\n").replace(/\\r/g, "\r")
          .replace(/\\t/g, "\t").replace(/\\\\/g, "\\")
          .replace(/\\([0-7]{1,3})/g, (_, o) => String.fromCharCode(parseInt(o, 8)))
          .replace(/\\(.)/g, "$1"));
      } else if (t[2]) {
        const inner = t[2].match(/\(([^)\\]*(?:\\.[^)\\]*)*)\)/g);
        if (inner) chunks.push(inner.map(s => s.slice(1, -1)).join(""));
      }
    }
  }
  return chunks.join(" ").replace(/\s+/g, " ").trim();
}

function extractViaStrings(buffer) {
  const raw = buffer.toString("latin1");
  const runs = raw.match(/[ -~]{5,}/g) || [];
  const useful = runs.filter(s => {
    const wordChars = (s.match(/[A-Za-z0-9 ,.;:!?'"-]/g) || []).length;
    return wordChars / s.length > 0.6 && /[A-Za-z]{2,}/.test(s);
  });
  return useful.join(" ").replace(/\s+/g, " ").trim();
}

function extractViaUtf16(buffer) {
  try {
    const text = buffer.toString("utf16le");
    const runs = text.match(/[ -~\u00A0-\u00FF]{5,}/g) || [];
    return runs.join(" ").replace(/\s+/g, " ").trim();
  } catch { return ""; }
}

/**
 * Extract text from a PDF buffer synchronously.
 * @param {Buffer} buffer
 * @returns {string}
 */
export function extractPdfText(buffer) {
  const streamText = extractViaStreams(buffer);
  if (streamText.length >= 200) return streamText;

  const stringsText = extractViaStrings(buffer);
  if (stringsText.length >= 100) return stringsText;

  const utf16Text = extractViaUtf16(buffer);
  if (utf16Text.length >= 100) return utf16Text;

  return [streamText, stringsText, utf16Text].sort((a, b) => b.length - a.length)[0];
}
