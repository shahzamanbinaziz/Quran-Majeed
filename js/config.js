// Site settings. Edit this file, not the other code.
export const CONFIG = {
  // URL of your Cloudflare Worker (the secure Gemini proxy, see README.md -> "Step 2").
  // Example: "https://quran-majeed-api.YOURNAME.workers.dev"
  // Leave "" if you do not have a Worker yet: visitors can then paste their own
  // Gemini API key in Settings (the key stays in their own browser).
  WORKER_URL: "",

  // Gemini models used when the browser calls Gemini directly, in order of preference.
  // If one is overloaded (503), rate limited (429) or unknown (404) the next one is tried automatically.
  // The "flash-lite" models are the fast, cheap / free-tier friendly ones.
  GEMINI_MODELS: ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-3.8-flash"],

  // Spoken translation: Gemini text-to-speech (works on every phone, nothing to install).
  // "lite" is the fast one (measured ~4s even for long text, the normal one ~9s), so it goes first.
  TTS_MODELS: ["gemini-3.8-flash-lite-tts", "gemini-3.8-flash-tts"],
  TTS_VOICE: "Kore",
  // Used only by the "interactions" endpoint, where style is a separate field and is NOT read aloud.
  // (In the plain endpoint any instruction put in front of the text gets spoken, so none is added there.)
  TTS_STYLE: "slowly, calmly and clearly, in Urdu with a natural Pakistani accent",

  // Recitation audio (one mp3 per ayah). Optional: the Sunein button simply fails quietly if offline.
  AUDIO_BASE: "https://everyayah.com/data/Alafasy_128kbps/",

  // How many ayat to show at first when an ayah search has many matches.
  PAGE_SIZE: 5,
};
