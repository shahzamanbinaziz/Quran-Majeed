// Quick self-test of js/search.js against the real data:  node scripts/test-search.mjs
import { readFileSync } from "node:fs";
import { createIndex, searchIndex, verifyRef, normalize, neighbor } from "../js/search.js";

const read = (f) => JSON.parse(readFileSync(new URL("../data/" + f, import.meta.url), "utf8"));
const idx = createIndex(read("quran-ar.json"), read("quran-search.json"), read("surahs.json"));
const ref = (i) => `${idx.rows[i][0]}:${idx.rows[i][1]}`;
let failed = 0;
const check = (name, ok, extra = "") => { console.log(ok ? "PASS" : "FAIL", name, extra); if (!ok) failed++; };

// half ayah, with harakat / without harakat
let r = searchIndex(idx, "وَأَقِيمُوا الصَّلَاةَ");
check("half ayah -> exact", r.kind === "exact" && r.hits.some((h) => ref(h.i) === "2:43"), `${r.total} hits: ${r.hits.slice(0, 6).map((h) => ref(h.i))}`);
r = searchIndex(idx, "قل هو الله احد");
check("Ikhlas 112:1 first", r.kind === "exact" && ref(r.hits[0].i) === "112:1", ref(r.hits[0].i));
r = searchIndex(idx, "الحمد لله رب العالمين");
check("Fatiha 1:2", r.hits.some((h) => ref(h.i) === "1:2"));
// unfinished last word (speech stopped)
r = searchIndex(idx, "ان مع العسر يسر");
check("94:5/94:6", r.hits.some((h) => ["94:5", "94:6"].includes(ref(h.i))), r.hits.map((h) => ref(h.i)));
// middle of an ayah (Ayat al-Kursi)
r = searchIndex(idx, "لا تاخذه سنه ولا نوم");
check("Ayat al-Kursi from the middle", r.hits.some((h) => ref(h.i) === "2:255"));
// Urdu keyboard letters (ک ی ہ) instead of Arabic ones
r = searchIndex(idx, "قل ہو اللہ احد");
check("Urdu keyboard letters", r.hits.some((h) => ref(h.i) === "112:1"), r.kind);
// one wrong word (speech recognition mistake) -> fuzzy
r = searchIndex(idx, "قل هو الله احاد");
check("one wrong letter -> fuzzy/exact finds 112:1", r.hits.some((h) => ref(h.i) === "112:1"), r.kind);
// Urdu sentence must not look like a good Arabic match
r = searchIndex(idx, "نماز کے بارے میں");
check("Urdu sentence is not a strong Arabic match", r.kind === "none" || r.hits[0].coverage < 0.8, r.kind);
// too short
check("too short -> none", searchIndex(idx, "ال").kind === "none");
// verifyRef
check("verifyRef correct", verifyRef(idx, 2, 43, "وأقيموا الصلاة") === idx.lookup.get(2043));
const fixed = verifyRef(idx, 2, 99, "قل هو الله احد");
check("verifyRef repairs wrong number", fixed !== -1 && ref(fixed) === "112:1", fixed === -1 ? "-1" : ref(fixed));
check("verifyRef rejects nonsense", verifyRef(idx, 300, 1, "كلام غير موجود") === -1);
check("neighbor stays in surah", neighbor(idx, idx.lookup.get(1007), 1) === -1 && neighbor(idx, idx.lookup.get(1001), 1) === idx.lookup.get(1002));
check("normalize parity", normalize("ٱلرَّحۡمَـٰنِ ٱلرَّحِیمِ") === "الرحمن الرحيم");

const t0 = performance.now();
for (let k = 0; k < 20; k++) searchIndex(idx, "قل هو الله احاد");
console.log(`fuzzy search ~${((performance.now() - t0) / 20).toFixed(1)} ms`);
process.exit(failed ? 1 : 0);
