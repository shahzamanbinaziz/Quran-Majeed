#!/usr/bin/env python3
"""Builds the compact data files used by the website.

Sources (public, GitHub: fawazahmed0/quran-api, edition files):
  - ara-quranuthmanienc.json   Arabic, Uthmani script with harakat (display text)
  - ara-quransimple.json       Arabic, simple spelling (used only to build the search index)
  - urd-abulaalamaududi.json   Urdu translation (Maududi) - reference for Gemini

Usage:  python3 scripts/build-data.py <folder-with-the-3-source-json-files>
"""
import json, re, sys, os

src = sys.argv[1]
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data")

def load(name):
    with open(os.path.join(src, name), encoding="utf-8") as f:
        return json.load(f)["quran"]

uth, simple, urdu = (load("ara-quranuthmanienc.json"),
                     load("ara-quransimple.json"),
                     load("urd-abulaalamaududi.json"))
assert len(uth) == len(simple) == len(urdu) == 6236, "verse count mismatch"
for a, b, c in zip(uth, simple, urdu):
    assert (a["chapter"], a["verse"]) == (b["chapter"], b["verse"]) == (c["chapter"], c["verse"])

# --- Arabic normalisation (keep in sync with js/search.js) ---
DIACRITICS = re.compile(r"[ؐ-ًؚ-ٰٟۖ-ۭـ࣓-ࣿ]")
def normalize(t):
    t = DIACRITICS.sub("", t)
    t = (t.replace("ٱ", "ا").replace("أ", "ا").replace("إ", "ا")
          .replace("آ", "ا").replace("ى", "ي").replace("ی", "ي")
          .replace("ئ", "ي").replace("ؤ", "و").replace("ة", "ه")
          .replace("ہ", "ه").replace("ھ", "ه").replace("ک", "ك"))
    t = re.sub(r"[^ء-ي\s]", "", t)
    return re.sub(r"\s+", " ", t).strip()

SURAHS = """الفاتحة|Al-Fatihah
البقرة|Al-Baqarah
آل عمران|Aal-e-Imran
النساء|An-Nisa
المائدة|Al-Maidah
الأنعام|Al-Anam
الأعراف|Al-Araf
الأنفال|Al-Anfal
التوبة|At-Tawbah
يونس|Yunus
هود|Hud
يوسف|Yusuf
الرعد|Ar-Rad
إبراهيم|Ibrahim
الحجر|Al-Hijr
النحل|An-Nahl
الإسراء|Al-Isra
الكهف|Al-Kahf
مريم|Maryam
طه|Ta-Ha
الأنبياء|Al-Anbiya
الحج|Al-Hajj
المؤمنون|Al-Muminun
النور|An-Nur
الفرقان|Al-Furqan
الشعراء|Ash-Shuara
النمل|An-Naml
القصص|Al-Qasas
العنكبوت|Al-Ankabut
الروم|Ar-Rum
لقمان|Luqman
السجدة|As-Sajdah
الأحزاب|Al-Ahzab
سبأ|Saba
فاطر|Fatir
يس|Ya-Sin
الصافات|As-Saffat
ص|Sad
الزمر|Az-Zumar
غافر|Ghafir
فصلت|Fussilat
الشورى|Ash-Shura
الزخرف|Az-Zukhruf
الدخان|Ad-Dukhan
الجاثية|Al-Jathiyah
الأحقاف|Al-Ahqaf
محمد|Muhammad
الفتح|Al-Fath
الحجرات|Al-Hujurat
ق|Qaf
الذاريات|Adh-Dhariyat
الطور|At-Tur
النجم|An-Najm
القمر|Al-Qamar
الرحمن|Ar-Rahman
الواقعة|Al-Waqiah
الحديد|Al-Hadid
المجادلة|Al-Mujadilah
الحشر|Al-Hashr
الممتحنة|Al-Mumtahanah
الصف|As-Saff
الجمعة|Al-Jumuah
المنافقون|Al-Munafiqun
التغابن|At-Taghabun
الطلاق|At-Talaq
التحريم|At-Tahrim
الملك|Al-Mulk
القلم|Al-Qalam
الحاقة|Al-Haqqah
المعارج|Al-Maarij
نوح|Nuh
الجن|Al-Jinn
المزمل|Al-Muzzammil
المدثر|Al-Muddaththir
القيامة|Al-Qiyamah
الإنسان|Al-Insan
المرسلات|Al-Mursalat
النبأ|An-Naba
النازعات|An-Naziat
عبس|Abasa
التكوير|At-Takwir
الانفطار|Al-Infitar
المطففين|Al-Mutaffifin
الانشقاق|Al-Inshiqaq
البروج|Al-Buruj
الطارق|At-Tariq
الأعلى|Al-Ala
الغاشية|Al-Ghashiyah
الفجر|Al-Fajr
البلد|Al-Balad
الشمس|Ash-Shams
الليل|Al-Layl
الضحى|Ad-Duha
الشرح|Ash-Sharh
التين|At-Tin
العلق|Al-Alaq
القدر|Al-Qadr
البينة|Al-Bayyinah
الزلزلة|Az-Zalzalah
العاديات|Al-Adiyat
القارعة|Al-Qariah
التكاثر|At-Takathur
العصر|Al-Asr
الهمزة|Al-Humazah
الفيل|Al-Fil
قريش|Quraysh
الماعون|Al-Maun
الكوثر|Al-Kawthar
الكافرون|Al-Kafirun
النصر|An-Nasr
المسد|Al-Masad
الإخلاص|Al-Ikhlas
الفلق|Al-Falaq
الناس|An-Nas""".split("\n")
assert len(SURAHS) == 114

counts = {}
for v in uth:
    counts[v["chapter"]] = counts.get(v["chapter"], 0) + 1
assert counts[1] == 7 and counts[2] == 286 and counts[114] == 6 and sum(counts.values()) == 6236

surahs = []
for i, line in enumerate(SURAHS, 1):
    ar, en = line.split("|")
    surahs.append({"n": i, "ar": ar, "en": en, "ayahs": counts[i]})

# rows: [surah, ayah, uthmani text]  (same order in the 3 files below)
quran = [[v["chapter"], v["verse"], v["text"].strip()] for v in uth]
BASMALA = "بسم الله الرحمن الرحيم"
search = []
for v in simple:
    t = normalize(v["text"])
    # the simple edition glues the basmala in front of verse 1 of most surahs; drop it
    if v["verse"] == 1 and v["chapter"] not in (1, 9) and t.startswith(BASMALA + " "):
        t = t[len(BASMALA):].strip()
    search.append(t)
ur = [v["text"].strip() for v in urdu]

def dump(name, obj):
    p = os.path.join(out, name)
    with open(p, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))
    print(f"{name}: {os.path.getsize(p)/1024:.0f} KB")

dump("surahs.json", surahs)
dump("quran-ar.json", quran)
dump("quran-search.json", search)
dump("quran-ur.json", ur)
print("empty search rows:", sum(1 for s in search if not s))
