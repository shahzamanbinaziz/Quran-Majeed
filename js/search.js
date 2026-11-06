// Arabic search over the full Quran (6236 ayat), 100% in the browser, no API needed.
//
// Idea: every ayah is stored twice
//   - display text (Uthmani script with harakat)           -> data/quran-ar.json
//   - search text (plain letters, no harakat, one spelling) -> data/quran-search.json
// A query is normalised the same way, then matched as a phrase (exact) or word-by-word (fuzzy,
// tolerant to speech-recognition mistakes of one letter per word).

// ---- keep this normalisation identical to scripts/build-data.py ----
const DIACRITICS = /[ؐ-ًؚ-ٰٟۖ-ۭـ࣓-ࣿ]/g;

export function normalize(text) {
  return String(text ?? "")
    .replace(DIACRITICS, "")
    .replace(/[ٱأإآ]/g, "ا") // alef variants -> ا
    .replace(/[ىیےئ]/g, "ي") // ى ی ے ئ -> ي
    .replace(/ؤ/g, "و") // ؤ -> و
    .replace(/[ةہھ]/g, "ه") // ة ہ ھ -> ه
    .replace(/ک/g, "ك") // ک -> ك
    .replace(/[^ء-ي\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function hasArabicScript(text) {
  return /[؀-ۿ]/.test(text);
}

// true when a and b differ by at most one inserted / deleted / replaced letter
function within1(a, b) {
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < la && j < lb) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (la > lb) i++;
    else if (lb > la) j++;
    else { i++; j++; }
  }
  return edits + (la - i) + (lb - j) <= 1;
}

export function createIndex(rows, norm, surahs) {
  const tokens = norm.map((t) => t.split(" "));
  const inverted = new Map();
  tokens.forEach((toks, i) => {
    for (const w of new Set(toks)) {
      let list = inverted.get(w);
      if (!list) inverted.set(w, (list = []));
      list.push(i);
    }
  });
  const lookup = new Map();
  rows.forEach((r, i) => lookup.set(r[0] * 1000 + r[1], i));
  return { rows, norm, tokens, inverted, vocab: [...inverted.keys()], lookup, surahs, urdu: null };
}

export async function loadQuranData(base = "data/") {
  const get = (f) =>
    fetch(base + f).then((r) => {
      if (!r.ok) throw new Error(`${f}: HTTP ${r.status}`);
      return r.json();
    });
  const [rows, norm, surahs] = await Promise.all([get("quran-ar.json"), get("quran-search.json"), get("surahs.json")]);
  return createIndex(rows, norm, surahs);
}

// The Urdu translation (used only as a reference for Gemini, or as a fallback) is loaded on demand.
export async function loadUrdu(idx, base = "data/") {
  if (!idx.urdu) {
    const r = await fetch(base + "quran-ur.json");
    if (!r.ok) throw new Error(`quran-ur.json: HTTP ${r.status}`);
    idx.urdu = await r.json();
  }
  return idx.urdu;
}

export function verseInfo(idx, i) {
  const [surah, ayah, arabic] = idx.rows[i];
  const s = idx.surahs[surah - 1];
  return { i, surah, ayah, arabic, id: `${surah}:${ayah}`, surahEn: s.en, surahAr: s.ar };
}

// previous (-1) / next (+1) ayah inside the same surah, or -1
export function neighbor(idx, i, delta) {
  const j = i + delta;
  if (j < 0 || j >= idx.rows.length) return -1;
  return idx.rows[j][0] === idx.rows[i][0] ? j : -1;
}

/**
 * Search the Quran for an Arabic phrase.
 * Returns { kind: "exact" | "fuzzy" | "none", hits: [{i, score, coverage, matched}], total }
 */
export function searchIndex(idx, query, { limit = 50 } = {}) {
  const q = normalize(query);
  const none = { kind: "none", hits: [], total: 0, query: q };
  if (q.replace(/\s/g, "").length < 3) return none;

  // 1) exact phrase (the last word may be unfinished: the user stopped mid-word)
  const needle = " " + q;
  const exact = [];
  for (let i = 0; i < idx.norm.length; i++) {
    const pos = (" " + idx.norm[i]).indexOf(needle);
    if (pos !== -1) exact.push({ i, score: pos === 0 ? 2 : 1, coverage: 1, matched: q.split(" ").length });
  }
  if (exact.length) {
    exact.sort((a, b) => b.score - a.score || a.i - b.i);
    return { kind: "exact", hits: exact.slice(0, limit), total: exact.length, query: q };
  }

  // 2) fuzzy: match word by word, allow 1 wrong letter in words of 4+ letters
  const qTokens = [...new Set(q.split(" "))];
  const variants = qTokens.map((t) => {
    const set = new Set([t]);
    if (t.length >= 4) for (const w of idx.vocab) if (within1(t, w)) set.add(w);
    return set;
  });
  const candidates = new Set();
  for (const set of variants) for (const w of set) for (const i of idx.inverted.get(w) ?? []) candidates.add(i);

  const hits = [];
  for (const i of candidates) {
    const matchedTokens = new Array(qTokens.length).fill(false);
    let minPos = Infinity, maxPos = -1, matchedPositions = 0;
    idx.tokens[i].forEach((w, pos) => {
      let any = false;
      variants.forEach((set, k) => {
        if (set.has(w)) { matchedTokens[k] = true; any = true; }
      });
      if (any) { matchedPositions++; minPos = Math.min(minPos, pos); maxPos = Math.max(maxPos, pos); }
    });
    const matched = matchedTokens.filter(Boolean).length;
    const coverage = matched / qTokens.length;
    if (coverage < 0.6 || (qTokens.length > 1 && matched < 2)) continue;
    const density = matchedPositions / (maxPos - minPos + 1);
    hits.push({ i, score: coverage * 0.7 + density * 0.3, coverage, matched });
  }
  if (!hits.length) return none;
  hits.sort((a, b) => b.score - a.score || a.i - b.i);
  const best = hits[0].score;
  const kept = hits.filter((h) => h.score >= best - 0.25);
  return { kind: "fuzzy", hits: kept.slice(0, limit), total: kept.length, query: q };
}

/**
 * Check a reference given by an AI ("surah:ayah" + the first Arabic words of that ayah).
 * Returns the verse index if the Arabic really starts like that, repairs the reference through
 * a text search when the number was wrong, and returns -1 when nothing can be verified.
 */
export function verifyRef(idx, surah, ayah, startHint) {
  const hint = normalize(startHint).split(" ").filter(Boolean);
  const i = idx.lookup.get(Number(surah) * 1000 + Number(ayah));
  const agrees = (k) => {
    if (!hint.length) return true;
    const found = hint.filter((w) => idx.tokens[k].some((t) => t === w || (w.length >= 4 && within1(t, w))));
    return found.length / hint.length >= 0.6;
  };
  if (i !== undefined && agrees(i)) return i;
  if (hint.length >= 2) {
    const r = searchIndex(idx, hint.join(" "), { limit: 3 });
    if (r.kind === "exact" && r.hits.length) return r.hits[0].i;
  }
  return -1;
}
