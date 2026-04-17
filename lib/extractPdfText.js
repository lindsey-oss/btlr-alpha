/**
 * PDF text extractor using pdfjs-dist.
 * Handles any digitally-created PDF regardless of font encoding.
 * Works in Next.js API routes on Vercel (Node.js serverless environment).
 */

// Polyfill DOM APIs that pdfjs-dist needs but Node.js doesn't have
function installPolyfills() {
  if (typeof globalThis.DOMMatrix === "undefined") {
    class DOMMatrix {
      constructor() {
        this.a=1; this.b=0; this.c=0; this.d=1; this.e=0; this.f=0;
        this.m11=1; this.m12=0; this.m13=0; this.m14=0;
        this.m21=0; this.m22=1; this.m23=0; this.m24=0;
        this.m31=0; this.m32=0; this.m33=1; this.m34=0;
        this.m41=0; this.m42=0; this.m43=0; this.m44=1;
        this.is2D = true; this.isIdentity = true;
      }
      multiply()        { return new DOMMatrix(); }
      translate()       { return new DOMMatrix(); }
      scale()           { return new DOMMatrix(); }
      rotate()          { return new DOMMatrix(); }
      inverse()         { return new DOMMatrix(); }
      transformPoint(p) { return { x: p?.x || 0, y: p?.y || 0 }; }
    }
    globalThis.DOMMatrix = DOMMatrix;
  }
  if (typeof globalThis.ImageData === "undefined") {
    globalThis.ImageData = class {
      constructor(w, h) {
        this.width = w; this.height = h;
        this.data = new Uint8ClampedArray(w * h * 4);
      }
    };
  }
  if (typeof globalThis.Path2D === "undefined") {
    globalThis.Path2D = class { constructor() {} };
  }
}

let _pdfjsLib = null;

async function getPdfJs() {
  if (_pdfjsLib) return _pdfjsLib;

  installPolyfills();

  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");

  // Try multiple strategies to locate the worker file
  const workerCandidates = [
    // Vercel serverless: /var/task is the root
    `/var/task/node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs`,
    // Local / standard Node: process.cwd() is the project root
    `${process.cwd()}/node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs`,
  ];

  let workerSet = false;
  for (const candidate of workerCandidates) {
    try {
      const { existsSync } = await import("fs");
      if (existsSync(candidate)) {
        pdfjsLib.GlobalWorkerOptions.workerSrc = `file://${candidate}`;
        workerSet = true;
        break;
      }
    } catch {}
  }

  // Last resort: try require.resolve
  if (!workerSet) {
    try {
      const { createRequire } = await import("module");
      const req = createRequire(import.meta.url);
      const resolved = req.resolve("pdfjs-dist/legacy/build/pdf.worker.mjs");
      pdfjsLib.GlobalWorkerOptions.workerSrc = `file://${resolved}`;
    } catch (e) {
      console.warn("extractPdfText: could not locate pdf.worker.mjs —", e.message);
    }
  }

  _pdfjsLib = pdfjsLib;
  return pdfjsLib;
}

/**
 * Extract all text from a PDF buffer.
 * @param {Buffer|ArrayBuffer|Uint8Array} buffer
 * @returns {Promise<string>}
 */
export async function extractPdfText(buffer) {
  const pdfjsLib = await getPdfJs();
  const data = new Uint8Array(Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer));

  const pdf = await pdfjsLib.getDocument({ data, verbosity: 0 }).promise;

  const pageTexts = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items.map((item) => item.str).join(" ");
    pageTexts.push(pageText);
  }

  return pageTexts.join("\n").replace(/[ \t]+/g, " ").trim();
}
