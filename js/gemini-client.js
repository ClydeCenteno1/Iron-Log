/* ============================================================
   GEMINI CLIENT
   Key is provided by the user once and stored in localStorage —
   never hardcoded, never sent anywhere but Google's API directly
   from the browser. Anyone with devtools access on this device
   can read it; that's the accepted tradeoff for a no-backend v1.
   ============================================================ */

const GEMINI_KEY_STORAGE = 'ft_gemini_key';
const GEMINI_MODEL = 'gemini-3.6-flash';

function getGeminiKey() {
  return localStorage.getItem(GEMINI_KEY_STORAGE) || '';
}

function setGeminiKey(key) {
  localStorage.setItem(GEMINI_KEY_STORAGE, key.trim());
}

function hasGeminiKey() {
  return !!getGeminiKey();
}

/**
 * Calls Gemini with a system instruction + user prompt.
 * If jsonSchema is provided, requests structured JSON output.
 * Returns { ok: true, text } or { ok: true, data } (if schema) or { ok: false, error }.
 */
async function callGemini({ systemInstruction, prompt, jsonMode = false }) {
  const key = getGeminiKey();
  if (!key) return { ok: false, error: 'missing_key' };

  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    systemInstruction: { parts: [{ text: systemInstruction }] },
    generationConfig: jsonMode ? { responseMimeType: 'application/json' } : {},
  };

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(key)}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    );

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      const rawMsg = errBody?.error?.message || `Request failed (${res.status})`;
      const msg = res.status === 429 || /quota/i.test(rawMsg)
        ? 'Gemini free-tier quota is exhausted for this key/project (this is a Google-side billing/quota setting, not something in the app). Check your plan at ai.dev/rate-limit, or wait and retry.'
        : rawMsg;
      return { ok: false, error: msg, status: res.status };
    }

    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
    if (!text) return { ok: false, error: 'Empty response from Gemini.' };

    if (jsonMode) {
      try {
        return { ok: true, data: JSON.parse(text) };
      } catch (e) {
        return { ok: false, error: 'Gemini returned invalid JSON.' };
      }
    }
    return { ok: true, text };
  } catch (e) {
    return { ok: false, error: 'Network error contacting Gemini: ' + e.message };
  }
}

window.GeminiClient = { getGeminiKey, setGeminiKey, hasGeminiKey, callGemini };
