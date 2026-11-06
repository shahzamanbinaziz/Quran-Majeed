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
js/config.js          settings (model, optional Worker URL)
js/site-key.js        khali placeholder; deploy ke waqt GitHub Secret se bharta hai
js/search.js          Arabic search engine (browser me)
js/gemini.js          Gemini prompts + Roman Urdu cache
js/app.js             search box, mic, cards, settings
data/                 poora Quran (Arabic + search index + Urdu reference + surah names)
fonts/                Amiri Quran font (SIL OFL licence)
worker/               OPTIONAL Cloudflare Worker (key server par rakhne ke liye)
.github/workflows/    GitHub Pages deploy + secret injection
scripts/build-data.py data files dobara banane ki script
scripts/test-search.mjs  search ka self-test
```

---

## Step 1: Gemini key ko GitHub Secret me rakhein

1. Key banayein: <https://aistudio.google.com/apikey>
2. Repo me **Settings -> Secrets and variables -> Actions -> New repository secret**
   - Name: `GEMINI_API_KEY`
   - Secret: apni `AIza...` key
3. Key repo ki kisi file me **nahi** likhni. `js/site-key.js` khali (`""`) rehti hai.

## Step 2: GitHub Pages ko Actions se chalayein

1. **Settings -> Pages -> Build and deployment -> Source: GitHub Actions** chunein.
2. `main` par har push par `.github/workflows/pages.yml` chalta hai: wo website ki files copy karta hai, secret se key `js/site-key.js` me daalta hai (sirf deploy hone wali copy me, repo me nahi), aur site publish kar deta hai.
3. **Actions** tab me workflow ka green tick dekhein. Phir site yahan khulegi: `https://shahzamanbinaziz.github.io/Quran-Majeed/`

Secret baad me badlein to **Actions -> Deploy to GitHub Pages -> Run workflow** dabayein.

## Step 3 (BOHAT ZAROORI): key ko sirf apni website tak mehdood karein

GitHub Pages sirf static files dikhata hai, isliye deploy hone ke baad key website ki JavaScript me hoti hai aur browser ka "View Source" dekhne wala use dekh sakta hai. Isko roknay ka koi tareeqa nahi, lekin nuqsan kam kiya ja sakta hai:

1. <https://console.cloud.google.com/apis/credentials> par us key ko kholein (wohi project jo AI Studio ne banaya).
2. **Application restrictions -> Websites (HTTP referrers)** chunein aur add karein: `https://shahzamanbinaziz.github.io/*` (aur local test ke liye chahein to `http://localhost:8000/*`).
3. **API restrictions -> Restrict key** me sirf **Generative Language API** rakhein.
4. Usage/quota ki hadd kam rakhein aur billing band rakhein (muft tier), taake ghalat istemal hone par bhi nuqsan na ho.

Phir bhi samajh lein: referrer restriction ek roka-tok hai, mukammal hifazat nahi (curl se referrer jhoota bheja ja sakta hai). Isliye key par *kabhi paid billing na lagayein* aur agar abuse nazar aaye to key delete karke nayi bana lein.

**Agar baad me mehfooz banana ho:** `worker/` folder me Cloudflare Worker ka tayyar code maujood hai. Us me key server par rehti hai. Uska URL `js/config.js` me `WORKER_URL` me daalne se website Worker ke zariye chalegi. Ye zaroori nahi, sirf optional hai.

## Step 4 (optional): Sirf apne liye, apni key browser me

Website par **gear (Settings)** icon dabayein aur apni Gemini key paste karein. Ye key sirf us browser me rehti hai aur site wali key par fauqiyat rakhti hai.

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
