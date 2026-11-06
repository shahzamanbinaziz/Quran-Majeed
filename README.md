# Quran Majeed - ayat dhoondein, Roman Urdu tarjuma

Ek asaan website jo mobile aur desktop dono par chalti hai.

- **Ayat ka koi bhi hissa likhein ya bolein** (Arabic me) -> poore Quran me se wo ayat mil jati hai, poori Arabic ke saath.
- **Sawal poochein** (Roman Urdu / Urdu / English), jaise *"namaz ki baat Quran me kahan hui hai?"* -> poore Quran se relevant ayat.
- Har ayat ke neeche **Roman Urdu tarjuma** (Arabic se Gemini API ke zariye).
- Har ayat par: **Sunein** (qari ki recitation), **Copy**, **Pichli / Agli ayat**.

Koi build tool ya framework nahi: sirf HTML, CSS aur JavaScript. GitHub Pages par seedha chalta hai.

---

## Ye kaise kaam karta hai (zaroor padhein)

```
User likhta/bolta hai
        |
        v
 Arabic hai?  --haan-->  Browser me poore Quran (6236 ayat) me search   (Gemini ki zaroorat nahi)
        |
       nahi (sawal / Roman Urdu)
        v
 Gemini sirf batata hai: "Surah 2, Ayah 43"   (ayat ka reference)
        |
        v
 Hum us reference ko apne Quran data se CHECK karte hain
 (ghalat reference ho to theek karte hain, na milne wala hata dete hain)
        |
        v
 Arabic matn hamare data se aata hai (Gemini se kabhi nahi)
        |
        v
 Gemini Arabic ko Roman Urdu me tarjuma karta hai
 (saath me Maududi ka Urdu tarjuma "reference" ke taur par deta hain taake meaning sahi rahe)
```

**Ye tareeqa isliye rakha gaya:** AI kabhi kabhi Quran ki ayat ghalat likh deta hai. Isliye Arabic matn hamesha verified data se aata hai, aur AI se sirf *reference dhoondna* aur *Roman Urdu tarjuma* karwate hain.

Agar Gemini na chale (limit, internet, key nahi) to ayat phir bhi dikhti hai aur Roman Urdu ki jagah **Urdu tarjuma** (Maududi) dikha diya jata hai.

---

## Files

```
index.html            homepage
css/style.css         design (mobile + desktop, light/dark)
js/config.js          settings (Worker URL yahan daalna hai)
js/search.js          Arabic search engine (browser me)
js/gemini.js          Gemini prompts + Roman Urdu cache
js/app.js             search box, mic, cards, settings
data/                 poora Quran (Arabic + search index + Urdu reference + surah names)
fonts/                Amiri Quran font (SIL OFL licence)
worker/               Cloudflare Worker: Gemini API key ko mehfooz rakhta hai
scripts/build-data.py data files dobara banane ki script
scripts/test-search.mjs  search ka self-test
```

---

## Step 1: Website GitHub Pages par chalayein

1. GitHub repo me **Settings -> Pages** kholein.
2. **Source: Deploy from a branch**, **Branch: `main`**, folder **`/ (root)`** -> **Save**.
3. 1-2 minute baad website yahan khulegi: `https://shahzamanbinaziz.github.io/Quran-Majeed/`

Is waqt Arabic search chal jayegi. Roman Urdu aur sawal-se-search ke liye Gemini chahiye (Step 2 ya Step 3).

## Step 2: Gemini ko mehfooz tareeqe se jodein (Cloudflare Worker, muft)

**Zaroori baat:** GitHub Pages ek *public* website hai. Gemini API key ko JavaScript me likhenge to koi bhi usay dekh kar chura sakta hai. Isliye key ek chhote server (Worker) me rakhi jati hai.

1. Gemini API key banayein: <https://aistudio.google.com/apikey>
2. Cloudflare par muft account banayein: <https://dash.cloudflare.com>
3. Computer par (Node.js chahiye) terminal me:

```bash
cd worker
npx wrangler login
npx wrangler deploy
npx wrangler secret put GEMINI_API_KEY     # yahan apni Gemini key paste karein
```

4. `deploy` ke baad ek URL milega, jaise `https://quran-majeed-api.APKANAAM.workers.dev`
5. `js/config.js` kholein aur daalein:

```js
WORKER_URL: "https://quran-majeed-api.APKANAAM.workers.dev",
```

6. Commit karke push kar dein. Bas.

`worker/wrangler.toml` me `ALLOWED_ORIGINS` pehle se `https://shahzamanbinaziz.github.io` par set hai. Agar apna domain lagayein to usay wahan badal dein.

**Kuch zaroori hifazati baatein:**
- Worker sirf isi website se aane wali requests maanta hai (`ALLOWED_ORIGINS`), lekin ye origin check curl jaise tools se bypass ho sakta hai. Isliye Google AI Studio me key par **quota/limit** zaroor lagayein, aur Cloudflare dashboard me **Rate limiting** rule laga dein, taake koi aap ka muft quota na khatam kar sake.
- Key kabhi `config.js` ya kisi bhi file me commit na karein.

## Step 3 (optional): Bina server ke, apni key se

Agar Worker nahi banana, to website par **gear (Settings)** icon dabayein aur apni Gemini key paste kar dein. Key sirf us browser me `localStorage` me rehti hai. Ye sirf aap ke apne istemal ke liye theek hai; public visitors ke liye Step 2 chahiye.

---

## Apne computer par chalana

`index.html` ko seedha double-click karne se data load nahi hoga (browser `file://` se JSON fetch nahi karne deta). Chhota server chalayein:

```bash
python3 -m http.server 8000
```

phir <http://localhost:8000> kholein.

Search ka self-test:

```bash
node scripts/test-search.mjs
```

## Awaaz se search (mic)

Browser ki **Web Speech API** istemal hoti hai: Chrome / Edge (Android aur desktop) par behtareen chalti hai. Safari / Firefox me kamzor ya mojood nahi, wahan likh kar search karein.

- **Urdu** chunein agar sawal bol rahe hain ("namaz ki baat Quran me kahan hui").
- **Arabic** chunein agar ayat ka hissa tilawat kar rahe hain.

Mic ke liye website **https** par honi chahiye (GitHub Pages par hoti hai) aur browser me microphone allow karna hoga.

## Data ke source aur licence

- Arabic matn (Uthmani) aur Urdu tarjuma (Abul A'la Maududi): <https://github.com/fawazahmed0/quran-api> ke edition files se, `scripts/build-data.py` ke zariye banaye gaye.
- Font: Amiri Quran, SIL Open Font License (`fonts/OFL-AmiriQuran.txt`).
- Recitation audio: Mishary Alafasy, <https://everyayah.com> se seedha stream hoti hai (hamare repo me nahi).

## Zaroori izhaar

Roman Urdu tarjuma AI se banta hai aur is me ghalti ho sakti hai. Arabic matn hi asal hai. Deeni masail aur tafseer ke liye mustanad ulama se rujoo karein.

## Aage ki mumkin cheezein

- Poori surah kholna / surah ki list
- Search history aur bookmarks
- Offline support (PWA)
- Aur tarjume / tafseer ka intikhab
