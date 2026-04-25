import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

const SUPABASE_URL  = "https://yrzswipabeyrmjaqzsxw.supabase.co";
const ANON_KEY      = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlyenN3aXBhYmV5cm1qYXF6c3h3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwMzc0MTksImV4cCI6MjA4ODYxMzQxOX0.OTmhmXh_YFjBix5stgXY6oL8cYYnyU9lyfqN4hcWmGU";
const LIVE_URL      = "https://btlr-alpha.vercel.app";

const supabase = createClient(SUPABASE_URL, ANON_KEY);

const PDF_PATH = "/sessions/inspiring-blissful-hamilton/mnt/uploads/FullReportForUploadorPrintWithPictures copy-762ce5cb.pdf";
const pdfBuffer = readFileSync(PDF_PATH);

console.log(`PDF size: ${(pdfBuffer.length / 1024).toFixed(1)} KB`);

// Step 1 — sign in anonymously to get a session token for storage + API
const { data: authData, error: authErr } = await supabase.auth.signInAnonymously();
if (authErr) { console.error("Auth failed:", authErr.message); process.exit(1); }
const token = authData.session.access_token;
const userId = authData.user.id;
console.log(`Signed in as temp user: ${userId.slice(0,8)}...`);

// Step 2 — upload PDF to Supabase storage
const storagePath = `${userId}/test-inspection-${Date.now()}.pdf`;
const { error: uploadErr } = await supabase.storage
  .from("documents")
  .upload(storagePath, pdfBuffer, { contentType: "application/pdf", upsert: true });
if (uploadErr) { console.error("Storage upload failed:", uploadErr.message); process.exit(1); }
console.log(`Uploaded to storage: ${storagePath}`);

// Step 3 — get signed URL
const { data: signed } = await supabase.storage
  .from("documents")
  .createSignedUrl(storagePath, 600);
if (!signed?.signedUrl) { console.error("Could not get signed URL"); process.exit(1); }
console.log("Got signed URL ✓");

// Step 4 — call live parse-inspection API
console.log("\nCalling parse-inspection API (may take up to 60s)...");
const res = await fetch(`${LIVE_URL}/api/parse-inspection`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${token}`,
  },
  body: JSON.stringify({ signedUrl: signed.signedUrl, filename: "inspection.pdf", storagePath }),
});

const result = await res.json();

// Step 5 — print results
console.log("\n════════════════════════════════════════════");
console.log("PARSE-INSPECTION RESULTS");
console.log("════════════════════════════════════════════");
console.log(`roof_year:  ${result.roof_year ?? "null (not found)"}`);
console.log(`hvac_year:  ${result.hvac_year ?? "null (not found)"}`);
console.log(`findings:   ${result.findings?.length ?? 0} total`);

if (result.findings?.length > 0) {
  console.log("\nFINDINGS:");
  result.findings.forEach((f, i) => {
    const cost = f.estimated_cost ? ` — $${f.estimated_cost.toLocaleString()}` : "";
    console.log(`  ${i+1}. [${f.severity.toUpperCase()}] ${f.category}: ${f.description.slice(0,80)}${cost}`);
  });
}

if (result.home_health_report) {
  const r = result.home_health_report;
  console.log("\nHOME HEALTH REPORT:");
  console.log(`  Score:       ${r.home_health_score}/100 (${r.score_band})`);
  console.log(`  Safety:      ${r.safety_score}`);
  console.log(`  Readiness:   ${r.readiness_score}`);
  console.log(`  Maintenance: ${r.maintenance_score}`);
  console.log(`  Confidence:  ${r.confidence_score}`);
  console.log(`  Summary:     ${r.summary_for_user}`);
  if (r.priority_actions?.length) {
    console.log("\n  TOP PRIORITIES:");
    r.priority_actions.slice(0,5).forEach(a => {
      console.log(`    ${a.priority}. ${a.issue} (${a.urgency})`);
    });
  }
}

if (result.findings?.length === 0) {
  console.log("\n⚠️  ZERO findings returned — likely a scanned/image PDF that needs OCR");
}

// Cleanup
await supabase.storage.from("documents").remove([storagePath]);
console.log("\nTest storage file cleaned up ✓");
