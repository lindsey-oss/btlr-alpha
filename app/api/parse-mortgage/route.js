import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";
import { inflateRawSync, inflateSync, unzipSync } from "zlib";

export const maxDuration = 60;

function extractTextFromPdf(buffer) {
  const raw = buffer.toString("latin1");
  const chunks = [];
  const streamRe = /stream[\r\n]+([\s\S]*?)[\r\n]+endstream/g;
  let m;
  while ((m = streamRe.exec(raw)) !== null) {
    const bytes = Buffer.from(m[1], "latin1");
    let content = "";
    for (const fn of [
      () => inflateRawSync(bytes).toString("utf8"),
      () => inflateSync(bytes).toString("utf8"),
      () => unzipSync(bytes).toString("utf8"),
      () => m[1],
    ]) { try { content = fn(); break; } catch {} }
    const textRe = /\(([^)\\]*(?:\\.[^)\\]*)*)\)\s*(?:Tj|'|")|(\[(?:[^[\]]*(?:\([^)]*\)[^[\]]*)*)\])\s*TJ/g;
    let t;
    while ((t = textRe.exec(content)) !== null) {
      if (t[1]) chunks.push(t[1].replace(/\\n/g,"\n").replace(/\\\\/g,"\\").replace(/\\([0-7]{1,3})/g,(_,o)=>String.fromCharCode(parseInt(o,8))).replace(/\\(.)/g,"$1"));
      else if (t[2]) { const inner = t[2].match(/\(([^)\\]*(?:\\.[^)\\]*)*)\)/g); if (inner) chunks.push(inner.map(s=>s.slice(1,-1)).join("")); }
    }
  }
  const streamText = chunks.join(" ").replace(/\s+/g," ").trim();
  if (streamText.length >= 200) return streamText;
  // Fallback: raw strings scan
  const runs = raw.match(/[ -~]{5,}/g) || [];
  return runs.filter(s => (s.match(/[A-Za-z0-9 ,.;:$]/g)||[]).length/s.length > 0.6).join(" ").replace(/\s+/g," ").trim();
}

export async function POST(req) {
  const authHeader = req.headers.get("authorization") || "";
  const userToken = authHeader.replace("Bearer ", "").trim();
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    userToken ? { global: { headers: { Authorization: `Bearer ${userToken}` } } } : {}
  );

  try {
    const contentType = req.headers.get("content-type") || "";
    let text = "";

    if (contentType.includes("application/json")) {
      // Manual save — just store the data directly
      const body = await req.json();
      if (body.manual) {
        const updateData = {
          mortgage_lender:      body.lender        || null,
          mortgage_balance:     body.balance        ? Number(body.balance)  : null,
          mortgage_payment:     body.payment        ? Number(body.payment)  : null,
          mortgage_due_day:     body.due_day        ? Number(body.due_day)  : null,
          mortgage_rate:        body.rate           ? Number(body.rate)     : null,
          mortgage_updated_at:  new Date().toISOString(),
        };
        const { data: existing } = await supabase.from("properties").select("id").limit(1).maybeSingle();
        if (existing?.id) {
          await supabase.from("properties").update(updateData).eq("id", existing.id);
        } else {
          await supabase.from("properties").insert({ address: "My Home", ...updateData });
        }
        return Response.json({ success: true, ...updateData });
      }
      // Signed URL for PDF
      const { signedUrl, storagePath } = body;
      if (signedUrl) {
        const res = await fetch(signedUrl);
        const buf = Buffer.from(await res.arrayBuffer());
        text = extractTextFromPdf(buf).slice(0, 12000);
        if (storagePath) { try { await supabase.storage.from("documents").remove([storagePath]); } catch {} }
      }
    }

    if (!text) return Response.json({ error: "No content" }, { status: 400 });

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `Extract mortgage data from this statement. Return ONLY valid JSON:
{
  "lender": "string or null",
  "balance": number or null,
  "payment": number or null (monthly payment amount),
  "due_day": number or null (day of month payment is due, e.g. 1 for the 1st),
  "rate": number or null (interest rate as decimal, e.g. 0.065 for 6.5%),
  "next_payment_date": "YYYY-MM-DD or null",
  "loan_number": "string or null"
}`
        },
        { role: "user", content: `Mortgage statement:\n\n${text}` }
      ],
      max_tokens: 400,
    });

    const raw = completion.choices[0]?.message?.content || "{}";
    let parsed = {};
    try { parsed = JSON.parse(raw.replace(/^```(?:json)?\s*/i,"").replace(/\s*```$/,"").trim()); } catch {}

    // Save to DB
    if (Object.keys(parsed).length) {
      const updateData = {
        mortgage_lender:     parsed.lender           || null,
        mortgage_balance:    parsed.balance           || null,
        mortgage_payment:    parsed.payment           || null,
        mortgage_due_day:    parsed.due_day           || null,
        mortgage_rate:       parsed.rate              || null,
        mortgage_updated_at: new Date().toISOString(),
      };
      const { data: existing } = await supabase.from("properties").select("id").limit(1).maybeSingle();
      if (existing?.id) await supabase.from("properties").update(updateData).eq("id", existing.id);
    }

    return Response.json({ success: true, ...parsed });
  } catch (err) {
    console.error("parse-mortgage error:", err?.message);
    return Response.json({ error: err.message }, { status: 500 });
  }
}
