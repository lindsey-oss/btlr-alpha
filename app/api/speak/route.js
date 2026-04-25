// BTLR TTS — OpenAI streaming TTS (echo voice — warm, conversational)
// Streams audio/mpeg directly so client starts playing immediately

import OpenAI from "openai";

export async function POST(req) {
  try {
    const { text } = await req.json();
    if (!text?.trim()) return new Response("No text", { status: 400 });

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const response = await openai.audio.speech.create({
      model: "tts-1-hd",
      voice: "echo",       // Warm, natural, conversational male voice
      input: text.slice(0, 4096),
      speed: 0.97,         // Near-natural pace — not rushed, not plodding
    });

    // Stream body directly to client — first bytes play before full generation completes
    return new Response(response.body, {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Transfer-Encoding": "chunked",
        "Cache-Control": "no-store",
        "X-Accel-Buffering": "no",
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
