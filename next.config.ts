import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep pdfjs-dist as an external package so its worker file stays
  // accessible on disk at runtime (required for file:// worker path)
  serverExternalPackages: ["pdfjs-dist", "pdf-parse"],
};

export default nextConfig;
