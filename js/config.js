// Site settings. Edit this file, not the other code.
export const CONFIG = {
  // URL of your Cloudflare Worker (the secure Gemini proxy, see README.md -> "Step 2").
  // Example: "https://quran-majeed-api.YOURNAME.workers.dev"
  // Leave "" if you do not have a Worker yet: visitors can then paste their own
  // Gemini API key in Settings (the key stays in their own browser).
  WORKER_URL: "",

  // Gemini model used when a visitor uses their own key.
  // (The Worker has its own GEMINI_MODEL variable in worker/wrangler.toml.)
  GEMINI_MODEL: "gemini-3.8-flash",

  // Recitation audio (one mp3 per ayah). Optional: the Sunein button simply fails quietly if offline.
  AUDIO_BASE: "https://everyayah.com/data/Alafasy_128kbps/",

  // How many ayat to show at first when an ayah search has many matches.
  PAGE_SIZE: 5,
};
