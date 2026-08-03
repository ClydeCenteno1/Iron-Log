/* ============================================================
   OPENROUTER CLIENT
   Second AI provider, used only as a fallback when Gemini fails
   (see ai-provider.js) — never called directly by feature code.
   Same storage/security posture as gemini-client.js: key lives
   only in localStorage, sent straight to OpenRouter's API from
   the browser, never proxied through anything we control.

   OpenRouter's API is OpenAI-compatible (POST /chat/completions,
   messages array, response in choices[0].message), which is a
   different shape than Gemini's contents/parts format — this file
   speaks that dialect and callGemini-shaped results come back out
   the same {ok, text|data, error} contract as GeminiClient so
   ai-provider.js can treat both providers identically.
   ============================================================ */

const OPENROUTER_KEY_STORAGE = 'ft_openrouter_key';
const OPENROUTER_MODEL_STORAGE = 'ft_openrouter_model';

// OpenRouter's free-tier catalog rotates — models get delisted or added
// with little notice (it dropped from 20 to 15 free listings in about a
// week around mid-2026). All options here are vision-capable (required
// for meal photos) as of this writing; if one gets delisted, switching to
// another in Settings is the fix until this list is refreshed.
const OPENROUTER_MODEL_OPTIONS = [
  { id: 'google/gemma-4-31b-it:free', label: 'Gemma 4 31B (default)' },
  { id: 'google/gemma-4-26b-a4b-it:free', label: 'Gemma 4 26B (lighter/faster)' },
  { id: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free', label: 'Nemotron 3 Nano Omni (more reasoning)' },
];
const OPENROUTER_MODEL_DEFAULT = 'google/gemma-4-31b-it:free';
// Distinct from the user-selectable options above: retried automatically
// on a 404/400 from the picked model (delisted/renamed), not a user choice.
const OPENROUTER_MODEL_FALLBACK = 'google/gemma-4-26b-a4b-it:free';

function getOpenRouterModel() {
  return localStorage.getItem(OPENROUTER_MODEL_STORAGE) || OPENROUTER_MODEL_DEFAULT;
}

function setOpenRouterModel(modelId) {
  localStorage.setItem(OPENROUTER_MODEL_STORAGE, modelId);
}

function getOpenRouterKey() {
  return localStorage.getItem(OPENROUTER_KEY_STORAGE) || '';
}

function setOpenRouterKey(key) {
  localStorage.setItem(OPENROUTER_KEY_STORAGE, key.trim());
}

function hasOpenRouterKey() {
  return !!getOpenRouterKey();
}

/**
 * Same call shape as GeminiClient.callGemini: systemInstruction + prompt,
 * optional inline image, optional jsonMode. Returns the same
 * { ok: true, text } / { ok: true, data } / { ok: false, error } shape.
 */
async function callOpenRouter({ systemInstruction, prompt, jsonMode = false, imageBase64 = null, imageMimeType = null }) {
  const key = getOpenRouterKey();
  if (!key) return { ok: false, error: 'missing_key' };

  const userContent = [{ type: 'text', text: prompt }];
  if (imageBase64) {
    userContent.push({
      type: 'image_url',
      image_url: { url: `data:${imageMimeType || 'image/jpeg'};base64,${imageBase64}` },
    });
  }

  const body = {
    messages: [
      { role: 'system', content: systemInstruction },
      { role: 'user', content: userContent },
    ],
    ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
  };

  const attempt = (modelId) => callOpenRouterOnce(modelId, key, body, jsonMode);

  let result = await attempt(getOpenRouterModel());

  // A delisted/renamed free model surfaces as 404 (unknown model) or 400
  // ("not a valid model ID") depending on how OpenRouter validates it —
  // retry once against the backup model for either, same reasoning as
  // GeminiClient's model-fallback. Anything else (quota, network, timeout)
  // is returned as-is since a different model won't fix those.
  if (!result.ok && (result.status === 404 || result.status === 400)) {
    result = await attempt(OPENROUTER_MODEL_FALLBACK);
  }

  return result;
}

async function callOpenRouterOnce(modelId, key, bodyTemplate, jsonMode) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 20000);

  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`,
        // Required by OpenRouter for free-tier requests to attribute usage;
        // harmless to send and not sent anywhere else.
        'HTTP-Referer': window.location.origin,
        'X-Title': 'Iron Log',
      },
      body: JSON.stringify({ ...bodyTemplate, model: modelId }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      const rawMsg = errBody?.error?.message || `Request failed (${res.status})`;
      const msg = res.status === 429 || /rate.?limit/i.test(rawMsg)
        ? 'OpenRouter free-tier rate limit reached for this key (a provider-side limit, not something in the app). Wait a bit and retry, or add credits at openrouter.ai for a higher limit.'
        : rawMsg;
      return { ok: false, error: msg, status: res.status };
    }

    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content || '';
    if (!text) return { ok: false, error: 'Empty response from OpenRouter.' };

    if (jsonMode) {
      try {
        return { ok: true, data: JSON.parse(text) };
      } catch (e) {
        return { ok: false, error: 'OpenRouter returned invalid JSON.' };
      }
    }
    return { ok: true, text };
  } catch (e) {
    if (e.name === 'AbortError') {
      return { ok: false, error: 'OpenRouter took too long to respond (timed out after 20s). Try again — this is usually a transient network/API slowdown.' };
    }
    return { ok: false, error: 'Network error contacting OpenRouter: ' + e.message };
  } finally {
    clearTimeout(timeoutId);
  }
}

window.OpenRouterClient = { getOpenRouterKey, setOpenRouterKey, hasOpenRouterKey, getOpenRouterModel, setOpenRouterModel, OPENROUTER_MODEL_OPTIONS, callOpenRouter };
