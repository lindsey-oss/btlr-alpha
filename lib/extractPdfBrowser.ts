/**
 * Client-side PDF text extraction using PDF.js loaded from CDN.
 *
 * Runs entirely in the browser via dynamic <script> injection — no npm import,
 * no webpack involvement, no server round-trip.
 *
 * Worker strategy: browsers block cross-origin Worker scripts, so we create a
 * tiny blob: URL that calls importScripts() pointing at the CDN worker.
 * The blob is same-origin (passes the browser check); importScripts() inside
 * a worker IS allowed to load cross-origin URLs.
 *
 * Usage:
 *   const text = await extractPdfTextInBrowser(file);
 */

const PDFJS_VERSION = "3.11.174";
const PDFJS_CDN = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}`;

/** Injects the PDF.js main script once and resolves when it's ready. */
function loadPdfjsScript(): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if ((window as any).pdfjsLib) return Promise.resolve();

  return new Promise((resolve, reject) => {
    // If the tag was already injected (e.g. HMR), just wait for the load event.
    const existing = document.querySelector(
      `script[data-pdfjs="${PDFJS_VERSION}"]`
    );
    if (existing) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((window as any).pdfjsLib) { resolve(); return; }
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () =>
        reject(new Error("PDF.js script failed to load"))
      );
      return;
    }

    const script = document.createElement("script");
    script.src = `${PDFJS_CDN}/pdf.min.js`;
    script.setAttribute("data-pdfjs", PDFJS_VERSION);
    script.onload = () => resolve();
    script.onerror = () =>
      reject(new Error(`Failed to load PDF.js from CDN (${PDFJS_CDN}/pdf.min.js)`));
    document.head.appendChild(script);
  });
}

/** Cached blob: URL for the pdfjs worker — created once per page load. */
let _workerBlobUrl: string | null = null;

function getWorkerBlobUrl(): string {
  if (!_workerBlobUrl) {
    const cdnWorker = `${PDFJS_CDN}/pdf.worker.min.js`;
    const blob = new Blob(
      [`importScripts("${cdnWorker}");`],
      { type: "application/javascript" }
    );
    _workerBlobUrl = URL.createObjectURL(blob);
  }
  return _workerBlobUrl;
}

/**
 * Extracts all text from a PDF File object using PDF.js (browser-side).
 * Returns raw joined text. Caller is responsible for truncating.
 *
 * @throws if the file is unreadable or PDF.js fails to load
 */
export async function extractPdfTextInBrowser(file: File): Promise<string> {
  await loadPdfjsScript();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdfjsLib = (window as any).pdfjsLib;
  if (!pdfjsLib) throw new Error("PDF.js failed to initialize");

  // Blob URL worker bypasses the browser's cross-origin Worker restriction.
  pdfjsLib.GlobalWorkerOptions.workerSrc = getWorkerBlobUrl();

  const arrayBuffer = await file.arrayBuffer();

  // cMapUrl tells pdfjs where to load Character Map files from.
  // Without this, CIDFont PDFs (the majority of inspection reports) return
  // near-zero text because pdfjs can't translate glyph IDs to Unicode.
  const pdf = await pdfjsLib.getDocument({
    data: arrayBuffer,
    cMapUrl: `${PDFJS_CDN}/cmaps/`,
    cMapPacked: true,
  }).promise;

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
