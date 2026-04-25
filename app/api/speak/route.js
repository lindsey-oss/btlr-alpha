// BTLR TTS — OpenAI HD voice (onyx) for Butler speech output
// Returns audio/mpeg stream

import OpenAI from "openai";

export async function POST(req) {
  try {
    const { text } = await req.json();
    if (!text?.trim()) return new Response("No text", { status: 400 });

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const response = await openai.audio.speech.create({
      model: "tts-1-hd",   // HD quality
      voice: "onyx",        // Deep, authoritative, composed — closest to Jarvis
      input: text.slice(0, 4096),
      speed: 0.92,          // Slightly measured — composed, not rushed
    });

    const buffer = Buffer.from(await response.arrayBuffer());

    return new Response(buffer, {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": String(buffer.length),
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("[speak] error:", err.message);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
