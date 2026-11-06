// Everything that talks to Gemini lives here: the prompts, the transport and the cache.
//
// Ways to reach Gemini (first one that exists is used):
//   1) a personal key the visitor pastes in Settings        -> called directly from the browser
//   2) SITE_KEY (GitHub secret injected at deploy time)     -> called directly from the browser
//   3) CONFIG.WORKER_URL (optional proxy server)            -> key stays on the server
import { CONFIG } from "./config.js";
import { SITE_KEY } from "./site-key.js";

const KEY_STORE = "qm_gemini_key";
const CACHE_STORE = "qm_roman_v1";
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

function postDirect(model, key, system, prompt, signal) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  return fetch(url, {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 8192, responseMimeType: "application/json" },
    }),
  });
}

function postWorker(system, prompt, signal) {
  return fetch(CONFIG.WORKER_URL, {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ system, prompt }),
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

async function callGemini({ system, prompt, signal }) {
  const key = activeKey();
  if (!key && !CONFIG.WORKER_URL) throw fail("NO_KEY", "Gemini abhi set nahi hai. Settings me apni Gemini API key daalein.");

  const models = key ? CONFIG.GEMINI_MODELS : [null]; // the Worker picks its own model
  let last = null;
  for (const model of models) {
    for (let attempt = 0; attempt < 2; attempt++) {
      let res;
      try {
        res = key ? await postDirect(model, key, system, prompt, signal) : await postWorker(system, prompt, signal);
      } catch (e) {
        if (e.name === "AbortError") throw e;
        throw fail("NETWORK", "Internet ya server se rabta nahi ho saka. Connection check karke dobara koshish karein.");
      }
      let data = null;
      try { data = await res.json(); } catch { /* not json */ }
      if (res.ok) return extractText(data);

      last = { status: res.status, msg: shortMsg(data) };
      if (RETRY_STATUS.has(res.status) && attempt === 0) { await sleep(1200); continue; } // one quick retry
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
  throw fail("BAD_JSON", "Gemini ka jawab samajh nahi aaya. Dobara koshish karein.");
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

export async function findAyat(query, signal) {
  const text = await callGemini({ system: FIND_SYSTEM, prompt: `User message:\n"""${query.slice(0, 500)}"""`, signal });
  const data = parseJson(text);
  const ayat = (Array.isArray(data.ayat) ? data.ayat : [])
    .map((a) => ({ surah: Number(a.surah), ayah: Number(a.ayah), start: String(a.start ?? ""), why: String(a.why ?? "") }))
    .filter((a) => a.surah >= 1 && a.surah <= 114 && a.ayah >= 1);
  return { mode: data.mode === "ayah" ? "ayah" : "topic", intro: String(data.intro ?? ""), ayat };
}

// ---------- 2) Arabic -> Roman Urdu ----------
const TRANSLATE_SYSTEM = `You translate ayat of the Holy Quran into Roman Urdu: Urdu written in English/Latin letters, the way Pakistanis write on WhatsApp (for example "Aur namaz qaim karo aur zakat ada karo").
Each item has an id, the Arabic text and a reference Urdu translation (Maududi). Translate from the Arabic meaning, and use the reference Urdu translation to stay faithful to the established meaning.

Rules:
- Translate only what is in the ayah: no tafsir, no explanation, no opinions, no commentary in brackets.
- Clear, natural, respectful Urdu. Write Allah, Rab, Rasool, Nabi, Jannat, Jahannam etc. the usual Roman Urdu way.
- Output Roman Urdu only: no Urdu or Arabic script, no English words except names.
- Exactly one translation per item, using the same id.
Return ONLY valid JSON: {"translations":[{"id":"2:43","roman_urdu":"..."}]}`;

function readCache() { try { return JSON.parse(localStorage.getItem(CACHE_STORE) || "{}"); } catch { return {}; } }
function writeCache(obj) {
  try {
    const keys = Object.keys(obj);
    if (keys.length > CACHE_MAX) for (const k of keys.slice(0, keys.length - CACHE_MAX)) delete obj[k];
    localStorage.setItem(CACHE_STORE, JSON.stringify(obj));
  } catch { /* storage full or blocked: caching is optional */ }
}
export const romanCache = () => readCache(); // {id: roman urdu}

/**
 * items: [{id, arabic, urdu}]  ->  Map(id -> roman urdu).
 * Results are cached in the browser, so a repeated ayah costs no Gemini call.
 */
export async function translateAyat(items, signal) {
  const out = new Map();
  const cache = readCache();
  const missing = [];
  for (const it of items) (cache[it.id] ? out.set(it.id, cache[it.id]) : missing.push(it));
  if (!missing.length) return out;

  const CHUNK = 5;
  const chunks = [];
  for (let i = 0; i < missing.length; i += CHUNK) chunks.push(missing.slice(i, i + CHUNK));

  const settled = await Promise.allSettled(
    chunks.map(async (chunk) => {
      const text = await callGemini({ system: TRANSLATE_SYSTEM, prompt: JSON.stringify(chunk.map(({ id, arabic, urdu }) => ({ id, arabic, urdu }))), signal });
      const data = parseJson(text);
      const got = new Map((Array.isArray(data.translations) ? data.translations : []).map((t) => [String(t.id), String(t.roman_urdu ?? "").trim()]));
      for (const it of chunk) {
        const t = got.get(it.id);
        if (t) { out.set(it.id, t); cache[it.id] = t; }
      }
    })
  );
  writeCache(cache);

  const rejected = settled.find((s) => s.status === "rejected");
  if (rejected && out.size === 0) throw rejected.reason; // nothing worked: let the UI show the reason
  return out;
}
