/**
 * PDF text extractor — BTLR
 *
 * Primary:  pdf-parse  (handles font encoding, CIDFonts, ToUnicode maps)
 * Fallback: zlib stream extraction (works for simple unencoded PDFs)
 *
 * The async export is used by all API routes. The sync export is retained
 * only as an emergency fallback for non-async call sites.
 */
import { inflateRawSync, inflateSync, unzipSync } from "zlib";

// ─────────────────────────────────────────────────────────────────────────────
// TEXT QUALITY CHECK
// Detects garbage output (e.g. raw glyph bytes from CIDFont streams) by
// checking ratio of printable ASCII word characters. Returns false for garbage.
// ─────────────────────────────────────────────────────────────────────────────
function isUsableText(text) {
  if (!text || text.length < 50) return false;
  const sample = text.slice(0, 2000);
  const wordChars  = (sample.match(/[A-Za-z0-9 ,.;:!?'"\-\n]/g) || []).length;
  const ratio      = wordChars / sample.length;
  const hasWords   = /[A-Za-z]{3,}/.test(sample);
  return ratio > 0.45 && hasWords;
}

// ─────────────────────────────────────────────────────────────────────────────
// SYNC FALLBACK — zlib stream extraction
// Works for simple PDFs where text is stored as literal (text) Tj commands
// DOES NOT work for CIDFont / custom-encoded PDFs
// ─────────────────────────────────────────────────────────────────────────────
function extractViaStreams(buffer) {
  const raw    = buffer.toString("latin1");
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
    // Standard parenthesis-encoded text: (text) Tj
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

// ─────────────────────────────────────────────────────────────────────────────
// ASYNC PRIMARY — pdf-parse
// Handles font encoding tables (CIDFont, ToUnicode maps) that the stream
// extractor cannot decode. Required for real-world inspection reports.
// ─────────────────────────────────────────────────────────────────────────────
async function extractViaPdfParse(buffer) {
  // Dynamic import so the module doesn't crash if pdf-parse isn't installed yet
  try {
    // pdf-parse ships a direct entry point to avoid test file side-effects
    const mod = await import("pdf-parse/lib/pdf-parse.js").catch(
      () => import("pdf-parse")          // fallback to default export
    );
    const pdfParse = mod.default ?? mod;
    const data = await pdfParse(buffer, { max: 0 }); // max:0 = parse all pages
    return (data.text || "").trim();
  } catch (err) {
    console.warn("[extractPdfText] pdf-parse unavailable:", err?.message?.slice(0, 80));
    return "";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC ASYNC EXPORT  (use this in API routes)
// ─────────────────────────────────────────────────────────────────────────────
export async function extractPdfTextAsync(buffer) {
  // 1. Try pdf-parse (handles any well-formed PDF)
  const parsed = await extractViaPdfParse(buffer);
  if (isUsableText(parsed)) {
    console.log(`[extractPdfText] pdf-parse OK — ${parsed.length} chars`);
    return parsed;
  }

  // 2. Fallback: zlib stream extraction (works for simple/unencoded PDFs)
  const streamed = extractViaStreams(buffer);
  if (isUsableText(streamed)) {
    console.log(`[extractPdfText] stream fallback OK — ${streamed.length} chars`);
    return streamed;
  }

  // 3. Both failed — return empty string so the caller can return a clean error
  // rather than sending garbage text to OpenAI (which causes 0 findings)
  console.warn("[extractPdfText] Both methods produced low-quality text — " +
    `pdf-parse: ${parsed.length} chars, stream: ${streamed.length} chars. ` +
    "This is likely a scanned/image PDF or pdf-parse is not yet installed.");
  return "";
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC SYNC EXPORT  (legacy — avoid using in new code)
// ─────────────────────────────────────────────────────────────────────────────
export function extractPdfText(buffer) {
  const result = extractViaStreams(buffer);
  if (isUsableText(result)) return result;
  return result; // caller must handle empty/garbage
}
