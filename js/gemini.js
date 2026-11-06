// Everything that talks to Gemini lives here: the prompts, the transport and the cache.
//
// Ways to reach Gemini (first one that exists is used):
//   1) a personal key the visitor pastes in Settings        -> called directly from the browser
//   2) SITE_KEY (GitHub secret injected at deploy time)     -> called directly from the browser
//   3) CONFIG.WORKER_URL (optional proxy server)            -> key stays on the server
import { CONFIG } from "./config.js";
import { SITE_KEY } from "./site-key.js";

const KEY_STORE = "qm_gemini_key";
const CACHE_STORE = "qm_roman_v2"; // {id: {r: roman urdu, u: same text in Urdu script (for speech)}}
const CACHE_MAX = 600;

// ---------- key handling ----------
export const getUserKey = () => { try { return localStorage.getItem(KEY_STORE) || ""; } catch { return ""; } };
export const setUserKey = (k) => { try { k ? localStorage.setItem(KEY_STORE, k.trim()) : localStorage.removeItem(KEY_STORE); } catch { /* private mode */ } };
const activeKey = () => getUserKey() || SITE_KEY || "";
export const isReady = () => Boolean(activeKey() || CONFIG.WORKER_URL);
export const mode = () => (getUserKey() ? "own-key" : SITE_KEY ? "site-key" : CONFIG.WORKER_URL ? "worker" : "none");

function fail(code, userMessage) {
  const e = new Error(code);
  e.code = code;
  e.userMessage = userMessage;
  return e;
}

// ---------- transport ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RETRY_STATUS = new Set([500, 502, 503, 504]); // temporary Google-side problems
const shortMsg = (data) => String(data?.error?.message ?? data?.error ?? "").replace(/\s+/g, " ").slice(0, 140);

function postDirect(model, key, system, prompt, signal, schema) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  return fetch(url, {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 16384, // thinking models count their "thinking" tokens in here too
        responseMimeType: "application/json",
        ...(schema ? { responseSchema: schema } : {}),
      },
    }),
  });
}

function postWorker(system, prompt, signal, schema) {
  return fetch(CONFIG.WORKER_URL, {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ system, prompt, ...(schema ? { schema } : {}) }),
  });
}

// Worker answers {text}; Gemini answers {candidates:[...]}
function extractText(data) {
  if (typeof data?.text === "string") return data.text;
  const cand = data?.candidates?.[0];
  const text = (cand?.content?.parts ?? []).filter((p) => !p.thought).map((p) => p.text ?? "").join("");
  if (!text) {
    const why = data?.promptFeedback?.blockReason || cand?.finishReason || "empty";
    throw fail("EMPTY", `Gemini ne jawab nahi diya (${why}). Sawal thora badal kar dekhein.`);
  }
  return text;
}

function httpError(last, usingOwnKey) {
  const { status, msg } = last;
  if (status === 429) return fail("QUOTA", "Gemini ki limit poori ho gayi hai. Thori der baad dobara koshish karein.");
  if (status === 400 && /api key/i.test(msg)) return fail("BAD_KEY", "Gemini API key galat hai. Settings me sahi key daalein.");
  if (status === 401 || status === 403) {
    return fail("DENIED", usingOwnKey
      ? `Gemini ne is key ko qubool nahi kiya (${status}). Key check karein; agar key par website restriction hai to wahan sahi website likhi ho. ${msg}`.trim()
      : "Server ne is website ko ijazat nahi di (ALLOWED_ORIGINS check karein).");
  }
  if (RETRY_STATUS.has(status)) return fail("BUSY", `Gemini abhi masroof hai (${status}). Thori der baad dobara koshish karein. ${msg}`.trim());
  return fail("HTTP_" + status, `Gemini se jawab nahi aaya (${status}). ${msg}`.trim());
}

async function callGemini({ system, prompt, signal, schema }) {
  const key = activeKey();
  if (!key && !CONFIG.WORKER_URL) throw fail("NO_KEY", "Gemini abhi set nahi hai. Settings me apni Gemini API key daalein.");

  const models = key ? CONFIG.GEMINI_MODELS : [null]; // the Worker picks its own model
  let withSchema = Boolean(schema); // if a model rejects the schema (400) we drop it and ask again without
  let last = null;
  for (const model of models) {
    let retried = false, dropped = false;
    for (;;) {
      const sch = withSchema ? schema : null;
      let res;
      try {
        res = key ? await postDirect(model, key, system, prompt, signal, sch) : await postWorker(system, prompt, signal, sch);
      } catch (e) {
        if (e.name === "AbortError") throw e;
        throw fail("NETWORK", "Internet ya server se rabta nahi ho saka. Connection check karke dobara koshish karein.");
      }
      let data = null;
      try { data = await res.json(); } catch { /* not json */ }
      if (res.ok) return extractText(data);

      last = { status: res.status, msg: shortMsg(data) };
      if (RETRY_STATUS.has(res.status) && !retried) { retried = true; await sleep(1200); continue; } // one quick retry
      if (res.status === 400 && withSchema && !dropped && !/api key/i.test(last.msg)) { withSchema = false; dropped = true; continue; }
      break;
    }
    // A wrong or refused key will fail on every model: stop. Anything else (503, 429, 404...): try the next model.
    if (last.status === 401 || last.status === 403 || (last.status === 400 && /api key/i.test(last.msg))) break;
  }
  throw httpError(last, Boolean(key));
}

function parseJson(text) {
  const clean = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try { return JSON.parse(clean); } catch { /* try to cut the object out */ }
  const a = clean.indexOf("{"), b = clean.lastIndexOf("}");
  if (a !== -1 && b > a) {
    try { return JSON.parse(clean.slice(a, b + 1)); } catch { /* fall through */ }
  }
  throw fail("BAD_JSON", "Gemini ka jawab samajh nahi aaya.");
}

// Small complete {...} objects inside a damaged / cut-off answer. Lets us keep what is usable.
function looseObjects(text) {
  const out = [];
  for (const piece of text.match(/\{[^{}]*\}/g) ?? []) {
    try { out.push(JSON.parse(piece)); } catch { /* skip */ }
  }
  return out;
}
const looseString = (text, field) => {
  const m = text.match(new RegExp(`"${field}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`));
  try { return m ? JSON.parse(`"${m[1]}"`) : ""; } catch { return m ? m[1] : ""; }
};

/** Ask Gemini for JSON. Retries once if the answer is unusable; salvage(text) may rescue a damaged answer. */
async function askJson({ system, prompt, signal, schema, salvage }) {
  let rawStart = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const text = await callGemini({ system, prompt, signal, schema });
    try { return parseJson(text); } catch { /* damaged answer */ }
    const saved = salvage?.(text);
    if (saved) return saved;
    console.warn("Gemini answer could not be read:", text);
    rawStart = text.trim().replace(/\s+/g, " ").slice(0, 80);
  }
  throw fail("BAD_JSON", `Gemini ka jawab samajh nahi aaya. Dobara koshish karein. (Jawab ka shuru: "${rawStart}")`);
}

// ---------- 1) find the relevant ayat (references only, Arabic text comes from our own data) ----------
const FIND_SYSTEM = `You are a careful Quran reference finder inside a Roman Urdu Quran website.
The user's message may be Roman Urdu, Urdu script, English or Arabic (possibly Arabic written in English letters).
Your ONLY job is to point to the relevant ayat of the Holy Quran by surah number and ayah number. The website prints the Arabic text itself from a verified database, so never write Quran text except the short "start" described below.

Return ONLY valid JSON of exactly this shape:
{"mode":"topic","intro":"...","ayat":[{"surah":2,"ayah":43,"start":"...","why":"..."}]}

Rules:
- If the user is quoting or transliterating part of a specific ayah (for example "qul huwallahu ahad"), set "mode":"ayah" and return that ayah first, then at most the next 2 ayat if they naturally continue it.
- Otherwise "mode":"topic": return the 5 to 8 most relevant ayat from the WHOLE Quran, the most direct first, covering different aspects of the question (hukm, fazilat, tareeqa, warning, example...). Prefer clear, direct ayat over distant ones.
- Surah numbers are 1-114 and the ayah number must exist in that surah. If you are not sure about an exact reference, leave it out. Fewer correct ayat are better than many doubtful ones.
- "start": the first 3 to 6 Arabic words of that ayah exactly as written in the Mushaf (harakat optional). It is used to verify your reference, so it must be accurate.
- "why": one short Roman Urdu line (maximum 15 words) saying how this ayah relates to the question.
- "intro": 1 or 2 short Roman Urdu sentences introducing what these ayat are about. Do not give fatwas or rulings and do not add interpretation beyond what the ayat say.
- Roman Urdu means Urdu written in English letters, e.g. "namaz ka hukm", "Allah ne farmaya".
- If the message has nothing to do with the Quran, return {"mode":"topic","intro":"","ayat":[]}.`;

const FIND_SCHEMA = {
  type: "OBJECT",
  properties: {
    mode: { type: "STRING" },
    intro: { type: "STRING" },
    ayat: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: { surah: { type: "INTEGER" }, ayah: { type: "INTEGER" }, start: { type: "STRING" }, why: { type: "STRING" } },
        required: ["surah", "ayah", "start"],
      },
    },
  },
  required: ["mode", "ayat"],
};

const salvageFind = (text) => {
  const ayat = looseObjects(text).filter((o) => o.surah != null && o.ayah != null);
  return ayat.length ? { mode: looseString(text, "mode"), intro: looseString(text, "intro"), ayat } : null;
};

export async function findAyat(query, signal) {
  let data = await askJson({ system: FIND_SYSTEM, prompt: `User message:\n"""${query.slice(0, 500)}"""`, signal, schema: FIND_SCHEMA, salvage: salvageFind });
  if (Array.isArray(data)) data = { ayat: data };
  const ayat = (Array.isArray(data.ayat) ? data.ayat : [])
    .map((a) => ({ surah: Number(a.surah), ayah: Number(a.ayah), start: String(a.start ?? ""), why: String(a.why ?? "") }))
    .filter((a) => a.surah >= 1 && a.surah <= 114 && a.ayah >= 1);
  return { mode: data.mode === "ayah" ? "ayah" : "topic", intro: String(data.intro ?? ""), ayat };
}

// ---------- 2) Arabic -> Roman Urdu ----------
const TRANSLATE_SYSTEM = `You translate ayat of the Holy Quran into Roman Urdu: Urdu written in English/Latin letters, the way Pakistanis write on WhatsApp (for example "Aur namaz qaim karo aur zakat ada karo").
Each item has an id, the Arabic text and a reference Urdu translation (Maududi). Translate from the Arabic meaning, and use the reference Urdu translation to stay faithful to the established meaning.

For every item give two versions of the SAME translation:
- "roman_urdu": Roman Urdu (this is what the reader sees).
- "urdu_script": exactly the same sentences and meaning written in Urdu script (Nastaliq spelling, Urdu full stop "۔"), because it is read aloud by a text-to-speech voice. Write Allah as "اللہ". Do not add or drop anything compared to roman_urdu.

Rules:
- Translate only what is in the ayah: no tafsir, no explanation, no opinions, no commentary in brackets.
- Clear, natural, respectful Urdu. Write Allah, Rab, Rasool, Nabi, Jannat, Jahannam etc. the usual Roman Urdu way.
- roman_urdu must be Roman Urdu only: no Urdu or Arabic script, no English words except names.
- Exactly one translation per item, using the same id.
Return ONLY valid JSON: {"translations":[{"id":"2:43","roman_urdu":"...","urdu_script":"..."}]}`;

const TRANSLATE_SCHEMA = {
  type: "OBJECT",
  properties: {
    translations: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: { id: { type: "STRING" }, roman_urdu: { type: "STRING" }, urdu_script: { type: "STRING" } },
        required: ["id", "roman_urdu", "urdu_script"],
      },
    },
  },
  required: ["translations"],
};
const salvageTranslations = (text) => {
  const translations = looseObjects(text).filter((o) => o.id != null && o.roman_urdu);
  return translations.length ? { translations } : null;
};

function readCache() { try { return JSON.parse(localStorage.getItem(CACHE_STORE) || "{}"); } catch { return {}; } }
function writeCache(obj) {
  try {
    const keys = Object.keys(obj);
    if (keys.length > CACHE_MAX) for (const k of keys.slice(0, keys.length - CACHE_MAX)) delete obj[k];
    localStorage.setItem(CACHE_STORE, JSON.stringify(obj));
  } catch { /* storage full or blocked: caching is optional */ }
}
export const romanCache = () => readCache(); // {id: {r, u}}

/**
 * items: [{id, arabic, urdu}]  ->  Map(id -> {roman, urdu}) (urdu = the same translation in Urdu script, may be "").
 * Results are cached in the browser, so a repeated ayah costs no Gemini call.
 */
export async function translateAyat(items, signal) {
  const out = new Map();
  const cache = readCache();
  const missing = [];
  for (const it of items) {
    const c = cache[it.id];
    if (c?.r) out.set(it.id, { roman: c.r, urdu: c.u || "" });
    else missing.push(it);
  }
  if (!missing.length) return out;

  const CHUNK = 5;
  const chunks = [];
  for (let i = 0; i < missing.length; i += CHUNK) chunks.push(missing.slice(i, i + CHUNK));

  const settled = await Promise.allSettled(
    chunks.map(async (chunk) => {
      let data = await askJson({
        system: TRANSLATE_SYSTEM,
        prompt: JSON.stringify(chunk.map(({ id, arabic, urdu }) => ({ id, arabic, urdu }))),
        signal,
        schema: TRANSLATE_SCHEMA,
        salvage: salvageTranslations,
      });
      if (Array.isArray(data)) data = { translations: data };
      const got = new Map(
        (Array.isArray(data.translations) ? data.translations : []).map((t) => [
          String(t.id),
          { roman: String(t.roman_urdu ?? "").trim(), urdu: String(t.urdu_script ?? "").trim() },
        ])
      );
      for (const it of chunk) {
        const t = got.get(it.id);
        if (t?.roman) { out.set(it.id, t); cache[it.id] = { r: t.roman, u: t.urdu }; }
      }
    })
  );
  writeCache(cache);

  const rejected = settled.find((s) => s.status === "rejected");
  if (rejected && out.size === 0) throw rejected.reason; // nothing worked: let the UI show the reason
  return out;
}

// ---------- 3) spoken translation: Gemini text-to-speech -> playable WAV ----------
const API = "https://generativelanguage.googleapis.com/v1beta";
export const canSpeak = () => Boolean(activeKey()); // needs a key in the browser (the optional Worker only does text)

function ttsRequest(shape, model, key, text, signal) {
  const headers = { "Content-Type": "application/json", "x-goog-api-key": key };
  if (shape === "generate") {
    return fetch(`${API}/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST", signal, headers,
      body: JSON.stringify({
        contents: [{ parts: [{ text: `${CONFIG.TTS_STYLE}:\n${text}` }] }],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: CONFIG.TTS_VOICE } } },
        },
      }),
    });
  }
  // newer "interactions" endpoint
  return fetch(`${API}/interactions`, {
    method: "POST", signal, headers,
    body: JSON.stringify({
      model,
      input: [{ type: "user_input", content: [{ type: "text", text, annotations: [{ type: "speech_metadata", style: CONFIG.TTS_STYLE.replace(/^Say /, "") }] }] }],
      response_format: { type: "audio" },
      generation_config: { speech_config: [{ voice: CONFIG.TTS_VOICE }] },
    }),
  });
}

// the audio can sit in different places depending on the endpoint: look for it everywhere
function findAudio(node, depth = 0) {
  if (!node || typeof node !== "object" || depth > 8) return null;
  const inline = node.inlineData || node.inline_data;
  if (typeof inline?.data === "string") return { b64: inline.data, mime: inline.mimeType || inline.mime_type || "" };
  const mime = String(node.mime_type || node.mimeType || "");
  if (typeof node.data === "string" && node.data.length > 200 && (/audio/i.test(mime) || node.type === "audio")) return { b64: node.data, mime };
  for (const v of Object.values(node)) {
    const f = findAudio(v, depth + 1);
    if (f) return f;
  }
  return null;
}

function pcmToWav(pcm, rate) {
  const header = new ArrayBuffer(44), v = new DataView(header);
  const str = (o, t) => [...t].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF"); v.setUint32(4, 36 + pcm.length, true); str(8, "WAVE"); str(12, "fmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); // PCM, mono
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, "data"); v.setUint32(40, pcm.length, true);
  return new Blob([header, pcm], { type: "audio/wav" });
}

function toAudioBlob({ b64, mime }) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  if (bin.startsWith("RIFF")) return new Blob([bytes], { type: "audio/wav" }); // already a WAV file
  const rate = Number(/rate=(\d+)/i.exec(mime)?.[1]) || 24000; // raw 16-bit mono PCM
  return pcmToWav(bytes, rate);
}

/** Text (Urdu) -> audio Blob (WAV). Throws an Error with .userMessage when it cannot. */
export async function synthesize(text, signal) {
  const key = activeKey();
  if (!key) throw fail("NO_KEY", "Awaaz ke liye Gemini key chahiye.");
  const clipped = text.slice(0, 1800);
  let last = { status: 0, msg: "" };
  for (const model of CONFIG.TTS_MODELS) {
    for (const shape of ["generate", "interactions"]) {
      let res, data = null;
      try {
        res = await ttsRequest(shape, model, key, clipped, signal);
      } catch (e) {
        if (e.name === "AbortError") throw e;
        throw fail("NETWORK", "Internet se rabta nahi ho saka.");
      }
      try { data = await res.json(); } catch { /* not json */ }
      if (res.ok) {
        const audio = findAudio(data);
        if (audio) return toAudioBlob(audio);
        last = { status: 200, msg: "no audio in the answer" };
        continue; // the other endpoint shape may work
      }
      last = { status: res.status, msg: shortMsg(data) };
      if (res.status === 401 || res.status === 403 || (res.status === 400 && /api key/i.test(last.msg))) throw httpError(last, true);
      if (res.status === 429 || RETRY_STATUS.has(res.status)) break; // busy / over the limit: next model
      // 400 / 404: this model does not accept this endpoint shape -> try the other one
    }
  }
  console.warn("Gemini text-to-speech failed:", last);
  throw httpError(last.status ? last : { status: 0, msg: "" }, true);
}
