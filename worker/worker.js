// Cloudflare Worker: a small, safe door between the website and Gemini.
// The Gemini API key lives ONLY here (as a Worker secret), never in the website files.
//
// Request  (POST, JSON): { "system": "...", "prompt": "..." }
// Response (JSON):       { "text": "..." }      or   { "error": "..." }

const MAX_BODY_CHARS = 30000;

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const allowed = (env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
    const originOk = allowed.includes("*") || allowed.includes(origin);
    const cors = {
      "Access-Control-Allow-Origin": allowed.includes("*") ? "*" : originOk ? origin : "null",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
      Vary: "Origin",
    };
    const reply = (obj, status = 200) =>
      new Response(JSON.stringify(obj), { status, headers: { ...cors, "Content-Type": "application/json; charset=utf-8" } });

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method !== "POST") return reply({ error: "POST only" }, 405);
    if (!originOk) return reply({ error: "Origin not allowed" }, 403);
    if (!env.GEMINI_API_KEY) return reply({ error: "Server is missing the GEMINI_API_KEY secret" }, 500);

    let body;
    try {
      const raw = await request.text();
      if (raw.length > MAX_BODY_CHARS) return reply({ error: "Request too large" }, 413);
      body = JSON.parse(raw);
    } catch {
      return reply({ error: "Invalid JSON" }, 400);
    }
    const { system, prompt } = body || {};
    if (typeof system !== "string" || typeof prompt !== "string" || !system || !prompt) {
      return reply({ error: "system and prompt (strings) are required" }, 400);
    }

    const model = env.GEMINI_MODEL || "gemini-3.5-flash-lite";
    let upstream;
    try {
      upstream = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: system }] },
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.2, maxOutputTokens: 8192, responseMimeType: "application/json" },
          }),
        }
      );
    } catch {
      return reply({ error: "Could not reach Gemini" }, 502);
    }

    const data = await upstream.json().catch(() => null);
    if (!upstream.ok) {
      // pass the status through (429 = quota), but never echo anything that could contain the key
      return reply({ error: { message: data?.error?.message?.slice(0, 300) || "Gemini error" } }, upstream.status);
    }
    const cand = data?.candidates?.[0];
    const text = (cand?.content?.parts ?? []).filter((p) => !p.thought).map((p) => p.text ?? "").join("");
    if (!text) return reply({ error: data?.promptFeedback?.blockReason || cand?.finishReason || "empty response" }, 502);
    return reply({ text });
  },
};
