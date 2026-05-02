/**
 * Client-side PDF text extraction using pdfjs-dist (npm package).
 *
 * Runs entirely in the browser — no server round-trip, no upload of the file
 * for text extraction. Loaded lazily via dynamic import on first call.
 *
 * Worker strategy: we point workerSrc at the matching CDN build but wrap it
 * in a blob: URL that calls importScripts(). Browsers block cross-origin
 * Worker scripts directly, but importScripts() inside a same-origin blob
 * worker is allowed to fetch cross-origin — this is the standard workaround.
 *
 * Usage:
 *   const text = await extractPdfTextInBrowser(file);
 */

// Cached after first load.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pdfjsModule: any = null;
let workerBlobUrl: string | null = null;

async function loadPdfjs() {
  if (pdfjsModule) return pdfjsModule;

  // Dynamic import keeps this browser-only (never runs during SSR).
  // We do NOT use `new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url)`
  // because webpack tries to bundle that at build time, which crashes the build
  // for large packages like pdfjs. Use CDN + blob: URL instead.
  pdfjsModule = await import("pdfjs-dist");

  // Build a blob: URL for the worker. This satisfies the browser's same-origin
  // check for Worker scripts, while importScripts() fetches the actual code
  // from the CDN (cross-origin fetches are allowed inside workers).
  if (!workerBlobUrl) {
    const workerCdnUrl = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsModule.version}/pdf.worker.min.js`;
    const blob = new Blob(
      [`importScripts("${workerCdnUrl}");`],
      { type: "application/javascript" }
    );
    workerBlobUrl = URL.createObjectURL(blob);
  }

  pdfjsModule.GlobalWorkerOptions.workerSrc = workerBlobUrl;
  return pdfjsModule;
}

/**
 * Extracts all text from a PDF File object using PDF.js (browser-side).
 * Returns raw joined text. Caller is responsible for truncating to desired length.
 *
 * @throws if the file is unreadable or PDF.js fails to initialize
 */
export async function extractPdfTextInBrowser(file: File): Promise<string> {
  const lib = await loadPdfjs();

  const arrayBuffer = await file.arrayBuffer();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdf = await lib.getDocument({ data: arrayBuffer }).promise;

  const pageTexts: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const content = await page.getTextContent();
    const line = content.items
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((item: any) => ("str" in item ? item.str : ""))
      .join(" ");
    pageTexts.push(line);
  }

  return pageTexts.join("\n");
}
