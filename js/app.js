// UI logic: search box, voice input, result cards, Roman Urdu translation, settings.
import { CONFIG } from "./config.js";
import { loadQuranData, loadUrdu, searchIndex, verifyRef, verseInfo, neighbor, hasArabicScript } from "./search.js";
import * as AI from "./gemini.js";

const $ = (sel, root = document) => root.querySelector(sel);
const el = {
  form: $("#search-form"),
  input: $("#q"),
  go: $(".go"),
  mic: $("#mic"),
  langs: document.querySelectorAll(".langs [data-lang]"),
  examples: $("#examples"),
  status: $("#status"),
  intro: $("#intro"),
  results: $("#results"),
  more: $("#more"),
  settings: $("#settings"),
  openSettings: $("#open-settings"),
  settingsMode: $("#settings-mode"),
  key: $("#key"),
  keySave: $("#key-save"),
  voice: $("#voice"),
  keyRemove: $("#key-remove"),
};

let Q = null; // search index (set when data has loaded)
let runId = 0; // increases with every search, so old async work can tell it is out of date
let controller = null; // AbortController of the current search
let queue = []; // results found but not shown yet ("Mazeed ayat dikhayein")
let pageSize = CONFIG.PAGE_SIZE;

// ---------- tiny helpers ----------
function h(tag, attrs = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  node.append(...kids);
  return node;
}
const setStatus = (msg = "", kind = "") => { el.status.textContent = msg; el.status.className = kind; };
const toArabicDigits = (n) => String(n).replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[d]);
const explain = (e) => e?.userMessage || "Kuch masla aa gaya. Dobara koshish karein.";

let toastTimer;
function toast(msg) {
  document.querySelector(".toast")?.remove();
  const t = h("div", { class: "toast", role: "status" }, msg);
  document.body.append(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), 1800);
}

function setBusy(on) {
  el.go.disabled = on;
  el.go.textContent = on ? "Ruk jaiye…" : "Dhoondein";
}

// ---------- ayah cards ----------
function makeCard(entry) {
  const v = verseInfo(Q, entry.i);
  const card = h("article", { class: "ayah", "data-i": entry.i, "data-id": v.id });

  const head = h("div", { class: "ayah-head" },
    h("span", { class: "badge" }, `${v.surahEn} · ${v.id}`, h("span", { class: "ar", lang: "ar" }, v.surahAr)));
  if (entry.why) head.append(h("span", { class: "why" }, entry.why));

  const arabic = h("p", { class: "arabic", lang: "ar", dir: "rtl" }, `${v.arabic} ﴿${toArabicDigits(v.ayah)}﴾`);
  const roman = h("p", { class: "roman pending", "data-role": "roman" }, "Roman Urdu tarjuma ban raha hai");

  const act = (name, label, extra = {}) => h("button", { type: "button", "data-act": name, ...extra }, label);
  const actions = h("div", { class: "actions" },
    act("audio", "Tilawat sunein", { "aria-pressed": "false" }),
    act("speak", "Tarjuma sunein", { "aria-pressed": "false" }),
    act("copy", "Copy"),
    act("prev", "◀ Pichli ayat"),
    act("next", "Agli ayat ▶"));

  card.append(head, arabic, roman, actions);
  return card;
}

function setRoman(card, text, urdu = "") {
  const p = $('[data-role="roman"]', card);
  p.className = "roman";
  p.dataset.text = text;
  p.dataset.urdu = urdu; // same translation in Urdu script: this is what the voice reads
  p.replaceChildren(text);
}

function setFallback(card, urduText, note) {
  const p = $('[data-role="roman"]', card);
  p.className = "roman fallback";
  delete p.dataset.text;
  delete p.dataset.urdu;
  p.replaceChildren(h("span", { class: "note" }, note));
  if (urduText) p.append(h("span", { class: "urdu-script", lang: "ur", dir: "rtl" }, urduText));
  p.append(h("button", { type: "button", class: "retry", "data-act": "retry" }, "Roman Urdu dobara banayein"));
}

function showPending(card) {
  const p = $('[data-role="roman"]', card);
  p.className = "roman pending";
  p.replaceChildren("Roman Urdu tarjuma ban raha hai");
}

// While Roman Urdu is being made, the Urdu translation from our own data is shown at once (no waiting).
function showInterim(card, urduText) {
  if (!urduText) return;
  const p = $('[data-role="roman"]', card);
  if (!p.classList.contains("pending")) return;
  p.replaceChildren("Roman Urdu tarjuma ban raha hai", h("span", { class: "urdu-script", lang: "ur", dir: "rtl" }, urduText));
}

async function translateCards(cards, run, signal) {
  const cache = AI.romanCache();
  const todo = [];
  for (const card of cards) {
    const c = cache[card.dataset.id];
    if (c?.r) { setRoman(card, c.r, c.u || ""); prepareVoice(card, run); }
    else todo.push(card);
  }
  if (!todo.length) return;

  let urdu = null;
  try { urdu = await loadUrdu(Q); } catch { /* the Arabic alone is enough for Gemini */ }
  if (run !== runId) return;
  const urduOf = (card) => (urdu ? urdu[card.dataset.i] : "");
  for (const card of todo) showInterim(card, urduOf(card));

  if (!AI.isReady()) {
    for (const card of todo) setFallback(card, urduOf(card), "Roman Urdu ke liye Settings me Gemini API key daalein. Tab tak Urdu tarjuma:");
    return;
  }
  const done = new Set();
  const apply = (map) => { // called for every small batch as soon as it is ready
    if (run !== runId) return;
    for (const card of todo) {
      const t = map.get(card.dataset.id);
      if (!t || done.has(card)) continue;
      done.add(card);
      setRoman(card, t.roman, t.urdu);
      prepareVoice(card, run);
    }
  };
  try {
    const items = todo.map((c) => ({ id: c.dataset.id, arabic: Q.rows[c.dataset.i][2], urdu: urduOf(c) }));
    const map = await AI.translateAyat(items, signal, apply);
    if (run !== runId) return;
    apply(map);
    for (const card of todo) if (!done.has(card)) setFallback(card, urduOf(card), "Is ayat ka Roman Urdu nahi ban saka. Urdu tarjuma:");
  } catch (e) {
    if (e.name === "AbortError" || run !== runId) return;
    for (const card of todo) if (!done.has(card)) setFallback(card, urduOf(card), `${explain(e)} Urdu tarjuma:`);
    if (e.code === "NO_KEY" || e.code === "BAD_KEY") openSettings();
  }
}

function refreshNav() {
  for (const card of el.results.children) {
    const i = Number(card.dataset.i);
    const pj = neighbor(Q, i, -1), nj = neighbor(Q, i, 1);
    const prev = card.previousElementSibling, next = card.nextElementSibling;
    $('[data-act="prev"]', card).hidden = pj === -1 || (prev && Number(prev.dataset.i) === pj);
    $('[data-act="next"]', card).hidden = nj === -1 || (next && Number(next.dataset.i) === nj);
  }
}

function updateMore() {
  el.more.hidden = queue.length === 0;
  if (queue.length) el.more.textContent = `Mazeed ayat dikhayein (${queue.length} baaqi)`;
}

function showNext(count) {
  const shown = new Set([...el.results.children].map((c) => Number(c.dataset.i)));
  const cards = [];
  while (queue.length && cards.length < count) {
    const entry = queue.shift();
    if (shown.has(entry.i)) continue;
    const card = makeCard(entry);
    el.results.append(card);
    cards.push(card);
  }
  refreshNav();
  updateMore();
  return cards;
}

function addNeighbor(card, delta) {
  const j = neighbor(Q, Number(card.dataset.i), delta);
  if (j === -1) return;
  const existing = $(`[data-i="${j}"]`, el.results);
  if (existing) { existing.scrollIntoView({ behavior: "smooth", block: "center" }); return; }
  const fresh = makeCard({ i: j });
  delta < 0 ? card.before(fresh) : card.after(fresh);
  refreshNav();
  translateCards([fresh], runId, controller?.signal);
}

// ---------- audio: recitation (mp3) and spoken translation (browser text-to-speech) ----------
const LABELS = { audio: "Tilawat sunein", speak: "Tarjuma sunein" };
let audio = null, activeBtn = null, speechToken = 0;
const synth = "speechSynthesis" in window ? window.speechSynthesis : null;

function stopAudio() {
  speechToken++; // cancels a running chunk chain
  speechCtl?.abort();
  speechCtl = null;
  if (audio) { audio.pause(); audio = null; }
  if (synth) synth.cancel();
  if (activeBtn) { activeBtn.textContent = LABELS[activeBtn.dataset.act]; activeBtn.setAttribute("aria-pressed", "false"); activeBtn.removeAttribute("aria-busy"); activeBtn = null; }
}
function markPlaying(btn) {
  activeBtn = btn;
  btn.textContent = "Roken";
  btn.setAttribute("aria-pressed", "true");
}

function toggleAudio(card, btn) {
  const wasThis = activeBtn === btn;
  stopAudio();
  if (wasThis) return;
  const v = verseInfo(Q, Number(card.dataset.i));
  const url = `${CONFIG.AUDIO_BASE}${String(v.surah).padStart(3, "0")}${String(v.ayah).padStart(3, "0")}.mp3`;
  audio = new Audio(url);
  markPlaying(btn);
  audio.addEventListener("ended", stopAudio);
  audio.addEventListener("error", () => { toast("Tilawat nahi chal saki"); stopAudio(); });
  audio.play().catch(() => { toast("Tilawat nahi chal saki"); stopAudio(); });
}

// Gemini text-to-speech first (nothing to install on the phone). If that is not possible the
// browser's own Urdu voice is used when the device has one.
const spoken = new Map(); // "id:length" -> blob url, so a second tap plays instantly and costs nothing
const spokenPending = new Map(); // same key -> promise of a voice that is being made right now
let speechCtl = null;

function speechUrl(key, text, signal) {
  const ready = spoken.get(key);
  if (ready) return Promise.resolve(ready);
  let pending = spokenPending.get(key);
  if (!pending) {
    pending = AI.synthesize(text, signal)
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        if (spoken.size >= 30) { const [oldKey, oldUrl] = spoken.entries().next().value; URL.revokeObjectURL(oldUrl); spoken.delete(oldKey); }
        spoken.set(key, url);
        return url;
      })
      .finally(() => spokenPending.delete(key));
    pending.catch(() => {}); // a failed preparation is not an error until somebody taps the button
    spokenPending.set(key, pending);
  }
  return pending;
}

// Stops waiting for a shared promise without cancelling the work behind it.
const abortable = (promise, signal) =>
  new Promise((resolve, reject) => {
    const abort = () => reject(new DOMException("Aborted", "AbortError"));
    if (signal.aborted) return abort();
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject);
  });

// Gemini needs ~4 s to make a voice. So the voice of the FIRST ayah is made in the background while
// the person reads: by the time "Tarjuma sunein" is tapped it is usually ready and plays at once.
function prepareVoice(card, run) {
  if (!AI.canSpeak() || card !== el.results.firstElementChild || run !== runId) return;
  const text = $('[data-role="roman"]', card).dataset.urdu;
  if (!text) return;
  speechUrl(`${card.dataset.id}:${text.length}:${AI.getVoice()}`, text, controller?.signal);
}

function getVoices() {
  return new Promise((resolve) => {
    const now = synth.getVoices();
    if (now.length) return resolve(now);
    const t = setTimeout(() => resolve(synth.getVoices()), 1200); // some browsers fill the list late
    synth.addEventListener("voiceschanged", () => { clearTimeout(t); resolve(synth.getVoices()); }, { once: true });
  });
}
const pickUrduVoice = (voices) =>
  voices.find((v) => /^ur[-_]PK$/i.test(v.lang)) || voices.find((v) => /^ur/i.test(v.lang)) || null;

// long texts are read sentence by sentence (browsers cut off long utterances)
function speechChunks(text) {
  const parts = text.split(/(?<=[۔؟!.?])\s+/).map((x) => x.trim()).filter(Boolean);
  const out = [];
  for (const part of parts) {
    if (part.length <= 220 || !out.length) { out.push(part); continue; }
    out.push(...part.split(/(?<=[،,])\s+/));
  }
  return out;
}

async function speakWithBrowserVoice(text, token) {
  if (!synth) return false;
  const voice = pickUrduVoice(await getVoices());
  if (!voice || token !== speechToken) return false;
  const chunks = speechChunks(text);
  const speakAt = (k) => {
    if (token !== speechToken) return;
    if (k >= chunks.length) { stopAudio(); return; }
    const u = new SpeechSynthesisUtterance(chunks[k]);
    u.lang = voice.lang;
    u.voice = voice;
    u.rate = 0.9;
    u.onend = () => speakAt(k + 1);
    u.onerror = (ev) => {
      if (token !== speechToken || ev.error === "canceled" || ev.error === "interrupted") return;
      toast(SPEECH_FAILED);
      stopAudio();
    };
    synth.speak(u);
  };
  markPlaying(activeBtn);
  speakAt(0);
  return true;
}

const SPEECH_FAILED = "Awaaz abhi nahi chal saki. Thori der baad dobara koshish karein.";

// iPhone Safari only lets audio start inside the tap itself, not after waiting for the network.
// So the audio element is "unlocked" with a silent clip right now, and the real voice is put into it later.
const SILENT_WAV = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";

async function toggleSpeech(card, btn) {
  const wasThis = activeBtn === btn;
  stopAudio();
  if (wasThis) return;
  const unlocked = new Audio(SILENT_WAV);
  unlocked.play().catch(() => {});
  audio = unlocked;

  const p = $('[data-role="roman"]', card);
  let text = p.dataset.urdu;
  if (!text) { // no Urdu-script version of the Roman Urdu yet: use the Urdu translation from our data
    try { text = (await loadUrdu(Q))[card.dataset.i]; } catch { /* handled below */ }
  }
  if (!text) { unlocked.pause(); audio = null; toast("Tarjuma abhi tayyar nahi hai. Thori der baad dobara dabayein."); return; }

  const token = speechToken;
  activeBtn = btn;
  btn.textContent = "Awaaz ban rahi hai…"; // tapping again cancels
  btn.setAttribute("aria-busy", "true");

  // 1) Gemini text-to-speech
  if (AI.canSpeak()) {
    try {
      speechCtl = new AbortController();
      const url = await abortable(speechUrl(`${card.dataset.id}:${text.length}:${AI.getVoice()}`, text, controller?.signal), speechCtl.signal);
      if (token !== speechToken) return;
      btn.removeAttribute("aria-busy");
      audio = unlocked;
      audio.src = url;
      markPlaying(btn);
      audio.addEventListener("ended", stopAudio);
      audio.addEventListener("error", () => { toast(SPEECH_FAILED); stopAudio(); });
      await audio.play();
      return;
    } catch (e) {
      if (e.name === "AbortError" || token !== speechToken) return;
      console.warn("Gemini speech failed, trying the browser voice:", e);
      unlocked.pause();
      audio = null;
    }
  }
  if (token !== speechToken) return;

  // 2) the device's own Urdu voice, if it has one
  unlocked.pause();
  audio = null;
  btn.removeAttribute("aria-busy");
  if (!(await speakWithBrowserVoice(text, token))) {
    if (token === speechToken) { stopAudio(); toast(SPEECH_FAILED); }
  }
}

async function copyCard(card) {
  const v = verseInfo(Q, Number(card.dataset.i));
  const roman = $('[data-role="roman"]', card).dataset.text || "";
  const text = `${v.arabic}\n\n${roman}\n\n— Surah ${v.surahEn} (${v.id})`.replace("\n\n\n\n", "\n\n");
  try { await navigator.clipboard.writeText(text); toast("Copy ho gaya"); } catch { toast("Copy nahi ho saka"); }
}

el.results.addEventListener("click", (ev) => {
  const btn = ev.target.closest("[data-act]");
  if (!btn) return;
  const card = btn.closest(".ayah");
  switch (btn.dataset.act) {
    case "audio": toggleAudio(card, btn); break;
    case "speak": toggleSpeech(card, btn); break;
    case "copy": copyCard(card); break;
    case "prev": addNeighbor(card, -1); break;
    case "next": addNeighbor(card, 1); break;
    case "retry": showPending(card); translateCards([card], runId, controller?.signal); break;
  }
});
el.more.addEventListener("click", async () => {
  const cards = showNext(pageSize);
  await translateCards(cards, runId, controller?.signal);
});

// ---------- searching ----------
function resetResults() {
  stopAudio();
  queue = [];
  el.results.replaceChildren();
  el.intro.hidden = true;
  el.intro.replaceChildren();
  el.more.hidden = true;
}

function showIntro(text) {
  if (!text) return;
  el.intro.replaceChildren(h("p", {}, text));
  el.intro.hidden = false;
}

function resolveRefs(ayat) {
  const seen = new Set();
  const out = [];
  for (const a of ayat) {
    const i = verifyRef(Q, a.surah, a.ayah, a.start);
    if (i === -1 || seen.has(i)) continue; // reference could not be verified against the real Quran text: drop it
    seen.add(i);
    out.push({ i, why: a.why });
  }
  return out;
}

function updateUrl(query) {
  try {
    const u = new URL(location.href);
    u.searchParams.set("q", query);
    history.replaceState(null, "", u);
  } catch { /* file:// or sandbox */ }
}

async function search(raw, { push = true } = {}) {
  const query = String(raw).replace(/\s+/g, " ").trim();
  if (!query) return;
  const run = ++runId;
  controller?.abort();
  controller = new AbortController();
  const { signal } = controller;

  resetResults();
  el.input.value = query;
  el.input.blur(); // hides the phone keyboard
  setBusy(true);
  setStatus("Dhoond raha hu…", "loading");
  if (push) updateUrl(query);

  try {
    await ready;
    if (!Q) throw Object.assign(new Error("DATA"), { userMessage: "Quran ka data load nahi ho saka. Page dobara kholein." });

    let entries = null, intro = "";
    pageSize = CONFIG.PAGE_SIZE;

    // 1) Arabic text? Search the Quran locally (no Gemini needed for this part).
    if (hasArabicScript(query)) {
      const r = searchIndex(Q, query, { limit: 60 });
      const best = r.hits[0];
      const strong = r.kind === "exact" || (r.kind === "fuzzy" && best.coverage >= 0.8 && best.matched >= 2);
      if (strong || (r.kind === "fuzzy" && !AI.isReady())) {
        entries = r.hits.map((x) => ({ i: x.i }));
        intro = r.kind === "exact"
          ? (r.total === 1 ? "Ye ayat Quran me is tarah mili:" : `Ye alfaaz Quran me ${r.total} jagah aaye hain:`)
          : "Alfaaz bilkul match nahi hue, ye milti julti ayat mili hain:";
      }
    }

    // 2) Roman Urdu / Urdu / English question (or an ayah quoted in Latin letters): ask Gemini where to look.
    if (!entries) {
      if (!AI.isReady()) throw Object.assign(new Error("NO_KEY"), { code: "NO_KEY", userMessage: "Sawal se ayat dhoondne ke liye Gemini API key chahiye. Settings me key daalein, ya Arabic alfaaz likh kar search karein." });
      setStatus("Poore Quran me se relevant ayat dhoond raha hu…", "loading");
      const found = await AI.findAyat(query, signal);
      if (run !== runId) return;
      entries = resolveRefs(found.ayat);
      intro = found.intro || (entries.length ? "Quran se ye relevant ayat mili hain:" : "");
      pageSize = 20;
    }
    if (run !== runId) return;

    if (!entries.length) {
      setStatus("Koi ayat nahi mili. Sawal ya alfaaz thore badal kar dobara likhein ya bolein.", "error");
      return;
    }

    setStatus("");
    showIntro(intro);
    queue = entries;
    const cards = showNext(pageSize);
    await translateCards(cards, run, signal);
  } catch (e) {
    if (e.name === "AbortError" || run !== runId) return;
    setStatus(explain(e), "error");
    if (e.code === "NO_KEY" || e.code === "BAD_KEY") openSettings();
  } finally {
    if (run === runId) setBusy(false);
  }
}

el.form.addEventListener("submit", (ev) => { ev.preventDefault(); search(el.input.value); });
el.examples.addEventListener("click", (ev) => {
  const chip = ev.target.closest(".chip");
  if (chip) search(chip.textContent);
});

// ---------- voice input ----------
const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognizer = null, listening = false;
let lang = (() => { try { return localStorage.getItem("qm_lang") || "ur-PK"; } catch { return "ur-PK"; } })();

function paintLangs() {
  el.langs.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.lang === lang)));
}
paintLangs();
el.langs.forEach((b) => b.addEventListener("click", () => {
  lang = b.dataset.lang;
  try { localStorage.setItem("qm_lang", lang); } catch { /* ignore */ }
  paintLangs();
  if (listening) recognizer.stop();
}));

const MIC_ERRORS = {
  "not-allowed": "Microphone ki ijazat nahi mili. Browser me microphone allow karein.",
  "service-not-allowed": "Microphone ki ijazat nahi mili. Browser me microphone allow karein.",
  "no-speech": "Awaaz sunai nahi di. Dobara mic dabayein aur saaf bolein.",
  "audio-capture": "Microphone nahi mila. Device check karein.",
  "network": "Awaaz pehchanne ke liye internet chahiye.",
  "language-not-supported": "Is zubaan me awaaz search support nahi. Doosri zubaan chunein.",
};

function toggleMic() {
  if (!SpeechRec) {
    setStatus("Is browser me awaaz se search support nahi. Chrome ya Edge use karein, ya likh kar search karein.", "error");
    return;
  }
  if (listening) { recognizer.stop(); return; }

  let heard = "";
  recognizer = new SpeechRec();
  recognizer.lang = lang;
  recognizer.interimResults = true;
  recognizer.continuous = false;
  recognizer.maxAlternatives = 1;
  recognizer.onstart = () => {
    listening = true;
    el.mic.classList.add("on");
    el.mic.setAttribute("aria-pressed", "true");
    setStatus("Sun raha hu… ab boliye", "loading");
  };
  recognizer.onresult = (ev) => {
    heard = [...ev.results].map((r) => r[0].transcript).join(" ").trim();
    el.input.value = heard;
  };
  recognizer.onerror = (ev) => {
    if (ev.error !== "aborted") setStatus(MIC_ERRORS[ev.error] || "Awaaz pehchanne me masla aaya. Dobara koshish karein.", "error");
    heard = "";
  };
  recognizer.onend = () => {
    listening = false;
    el.mic.classList.remove("on");
    el.mic.setAttribute("aria-pressed", "false");
    if (heard) search(heard);
    else if (el.status.classList.contains("loading")) setStatus("");
  };
  try { recognizer.start(); } catch { /* already started */ }
}
el.mic.addEventListener("click", toggleMic);

// ---------- settings ----------
function openSettings() {
  if (el.settings.open) return;
  const modeText = { "own-key": "Abhi aap ki apni Gemini key istemal ho rahi hai.", "site-key": "Abhi website ki apni Gemini key istemal ho rahi hai. Chahein to apni key bhi daal sakte hain.", worker: "Abhi website ka apna server istemal ho raha hai. Chahein to apni key bhi daal sakte hain.", none: "Roman Urdu tarjume aur sawal se search ke liye Gemini API key chahiye." };
  el.settingsMode.textContent = modeText[AI.mode()];
  el.key.value = "";
  el.key.placeholder = AI.getUserKey() ? "Key save hai (naye se badalne ke liye likhein)" : "AIza...";
  el.voice.replaceChildren(...CONFIG.TTS_VOICES.map(([name, label]) => h("option", { value: name }, label)));
  el.voice.value = AI.getVoice();
  el.settings.showModal();
}
el.openSettings.addEventListener("click", openSettings);
el.voice.addEventListener("change", () => { AI.setVoice(el.voice.value); toast("Awaaz badal di gayi"); });
el.keySave.addEventListener("click", () => {
  const v = el.key.value.trim();
  if (!v) { el.key.focus(); return; }
  AI.setUserKey(v);
  el.settings.close();
  toast("Key save ho gayi");
});
el.keyRemove.addEventListener("click", () => {
  AI.setUserKey("");
  el.settings.close();
  toast("Key hata di gayi");
});

// ---------- start ----------
const ready = loadQuranData()
  .then((data) => { Q = data; return data; })
  .catch((e) => {
    console.error(e);
    setStatus("Quran ka data load nahi ho saka. Agar file se khola hai to server se kholein (README dekhein).", "error");
    return null;
  });

ready.then((data) => {
  if (!data) return;
  const q = new URLSearchParams(location.search).get("q");
  if (q) search(q, { push: false });
});
