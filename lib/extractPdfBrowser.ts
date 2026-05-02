/**
 * Client-side PDF text extraction using pdfjs-dist (npm package).
 *
 * Runs entirely in the browser — no server round-trip, no upload of the file
 * for text extraction. Loaded lazily via dynamic import on first call.
 *
 * Usage:
 *   const text = await extractPdfTextInBrowser(file);
 */

// Cached module reference so we only dynamic-import once per session.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pdfjsModule: any = null;

async function loadPdfjs() {
  if (pdfjsModule) return pdfjsModule;

  // Dynamic import keeps this browser-only (never runs during SSR).
  pdfjsModule = await import("pdfjs-dist");

  // Point the worker at the bundled worker file.
  // Next.js / webpack 5 handles `new URL(pkg, import.meta.url)` natively —
  // it emits the worker as a separate chunk with the correct public URL.
  pdfjsModule.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url
  ).toString();

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
