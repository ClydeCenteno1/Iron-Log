/* ============================================================
   GEMINI CLIENT
   Key is provided by the user once and stored in localStorage —
   never hardcoded, never sent anywhere but Google's API directly
   from the browser. Anyone with devtools access on this device
   can read it; that's the accepted tradeoff for a no-backend v1.
   ============================================================ */

const GEMINI_KEY_STORAGE = 'ft_gemini_key';
const GEMINI_MODEL_STORAGE = 'ft_gemini_model';
// gemini-3.6-flash is GA and current as of mid-2026 and is the default —
// fast, cheap, plenty for this app's template-shaped calls. Offered
// alongside a couple of alternatives in Settings for people who want to
// trade speed for more reasoning quality, or vice versa. Every entry here
// must support both vision (meal photos) and JSON mode (every other call),
// since callGemini doesn't know at call time which a given model choice
// will be asked to do.
const GEMINI_MODEL_OPTIONS = [
  { id: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash (default — fast)' },
  { id: 'gemini-3.6-pro', label: 'Gemini 3.6 Pro (slower, stronger reasoning)' },
  { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite (fastest, lighter)' },
];
const GEMINI_MODEL_DEFAULT = 'gemini-3.6-flash';
// Kept distinct from the user-selectable options above: if Google retires/
// renames a model ID (has happened before to prior Flash generations),
// callGemini retries once against this regardless of what the user picked,
// since a 404 means the picked ID itself is gone, not a quality tradeoff.
const GEMINI_MODEL_FALLBACK = 'gemini-3.5-flash-lite';

function getGeminiModel() {
  return localStorage.getItem(GEMINI_MODEL_STORAGE) || GEMINI_MODEL_DEFAULT;
}

function setGeminiModel(modelId) {
  localStorage.setItem(GEMINI_MODEL_STORAGE, modelId);
}

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
 * Calls Gemini with a system instruction + user prompt, optionally with an
 * inline image (for vision calls like meal photo estimation).
 * If jsonMode is true, requests structured JSON output.
 * Returns { ok: true, text } or { ok: true, data } (if jsonMode) or { ok: false, error }.
 */
async function callGemini({ systemInstruction, prompt, jsonMode = false, imageBase64 = null, imageMimeType = null }) {
  const key = getGeminiKey();
  if (!key) return { ok: false, error: 'missing_key' };

  const userParts = [{ text: prompt }];
  if (imageBase64) {
    userParts.push({ inlineData: { mimeType: imageMimeType || 'image/jpeg', data: imageBase64 } });
  }

  const body = {
    contents: [{ role: 'user', parts: userParts }],
    systemInstruction: { parts: [{ text: systemInstruction }] },
    generationConfig: {
      // "minimal" thinking: every call this app makes is template-shaped
      // extraction/classification (parse a meal into macros, phrase an
      // already-decided coaching number, pick exercises from a fixed list)
      // rather than open-ended reasoning, so the model doesn't need to
      // "think" before answering — this is the single biggest lever on
      // response latency for Gemini 3.x models, which default to "medium".
      thinkingConfig: { thinkingLevel: 'minimal' },
      ...(jsonMode ? { responseMimeType: 'application/json' } : {}),
    },
  };

  // 20s timeout per attempt: with thinkingLevel minimal, a normal JSON or
  // vision call should return well under this; short enough that a hung
  // request still fails with a retryable error instead of leaving the UI
  // stuck on a spinner with no way out.
  const attempt = (modelId) => callGeminiOnce(modelId, key, body);

  let result = await attempt(getGeminiModel());

  // If the primary model ID itself is invalid/retired (Google returns 404
  // for an unrecognized model), retry once against the fallback rather than
  // surfacing a confusing error for something the user can't fix on their
  // end. Any other failure (timeout, quota, network) is returned as-is —
  // retrying those against a different model wouldn't help and would just
  // double the wait.
  if (!result.ok && result.status === 404) {
    result = await attempt(GEMINI_MODEL_FALLBACK);
  }

  return result;
}

async function callGeminiOnce(modelId, key, body) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 20000);

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${encodeURIComponent(key)}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal }
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

    if (body.generationConfig?.responseMimeType === 'application/json') {
      try {
        return { ok: true, data: JSON.parse(text) };
      } catch (e) {
        return { ok: false, error: 'Gemini returned invalid JSON.' };
      }
    }
    return { ok: true, text };
  } catch (e) {
    if (e.name === 'AbortError') {
      return { ok: false, error: 'Gemini took too long to respond (timed out after 20s). Try again — this is usually a transient network/API slowdown, not something wrong with your photo or key.' };
    }
    return { ok: false, error: 'Network error contacting Gemini: ' + e.message };
  } finally {
    clearTimeout(timeoutId);
  }
}

window.GeminiClient = { getGeminiKey, setGeminiKey, hasGeminiKey, getGeminiModel, setGeminiModel, GEMINI_MODEL_OPTIONS, callGemini };
