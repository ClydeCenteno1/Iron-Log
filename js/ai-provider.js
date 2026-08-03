/* ============================================================
   AI PROVIDER
   Single entry point every feature file should call instead of
   GeminiClient or OpenRouterClient directly. Tries the user's
   chosen PRIMARY provider first (Gemini by default); if it fails
   for any reason — missing key, quota, timeout, network — and the
   other provider has a key set, retries the same request against
   that one before giving up.

   The two failure cases are handled differently on purpose:
   - No key at all for the primary provider: don't silently fall
     back. The person hasn't set up AI yet; surface 'missing_key'
     same as before so existing promptForGeminiKey() flows keep
     working unchanged.
   - Primary key present but the call itself failed (quota/network/
     timeout/etc.): THIS is the case fallback exists for. Retry
     against the other provider if available, and if that succeeds,
     tell the user their answer came from a backup provider — an AI
     answer arriving from a different model than they configured
     is the kind of thing that should never happen silently.
   ============================================================ */

const AI_PRIMARY_PROVIDER_STORAGE = 'ft_ai_primary_provider';
const AI_PROVIDERS = {
  gemini: { label: 'Gemini', client: () => GeminiClient, other: 'openrouter', otherLabel: 'OpenRouter' },
  openrouter: { label: 'OpenRouter', client: () => OpenRouterClient, other: 'gemini', otherLabel: 'Gemini' },
};

function getPrimaryProvider() {
  const stored = localStorage.getItem(AI_PRIMARY_PROVIDER_STORAGE);
  return AI_PROVIDERS[stored] ? stored : 'gemini';
}

function setPrimaryProvider(providerId) {
  if (!AI_PROVIDERS[providerId]) return;
  localStorage.setItem(AI_PRIMARY_PROVIDER_STORAGE, providerId);
}

function providerHasKey(providerId) {
  return providerId === 'gemini' ? GeminiClient.hasGeminiKey() : OpenRouterClient.hasOpenRouterKey();
}

function callProvider(providerId, params) {
  return providerId === 'gemini' ? GeminiClient.callGemini(params) : OpenRouterClient.callOpenRouter(params);
}

// Safety net against a class of bug rather than any specific call site: if
// something upstream (a render loop, a stale event handler, etc.) fires the
// *exact same* systemInstruction+prompt+image while an identical call is
// already in flight, share that one in-flight promise instead of hitting
// the provider twice. This does not replace caching at the call site (which
// still avoids the network round-trip entirely) — it's a last-resort guard
// so a future re-render bug burns through quota more slowly, not a
// substitute for fixing the loop itself.
const inFlightCalls = new Map();

function requestSignature(params) {
  return JSON.stringify({
    s: params.systemInstruction,
    p: params.prompt,
    j: params.jsonMode || false,
    i: params.imageBase64 ? params.imageBase64.length : 0,
  });
}

/**
 * Same call contract as GeminiClient.callGemini / OpenRouterClient.callOpenRouter:
 * { ok: true, text } | { ok: true, data } | { ok: false, error }.
 * Callers don't need to know which provider actually answered.
 */
async function callAI(params) {
  const signature = requestSignature(params);
  const existing = inFlightCalls.get(signature);
  if (existing) return existing;

  const promise = callAIUncached(params).finally(() => {
    inFlightCalls.delete(signature);
  });
  inFlightCalls.set(signature, promise);
  return promise;
}

async function callAIUncached(params) {
  const primaryId = getPrimaryProvider();
  const secondaryId = AI_PROVIDERS[primaryId].other;

  if (!providerHasKey(primaryId)) {
    // No primary key configured yet. Fall back straight to the secondary
    // if the person has set one up as their only provider; otherwise
    // behave exactly like the old missing_key gate so promptForGeminiKey()
    // flows are unaffected for anyone who hasn't touched the other one.
    if (providerHasKey(secondaryId)) {
      return callProvider(secondaryId, params);
    }
    return { ok: false, error: 'missing_key' };
  }

  const primaryResult = await callProvider(primaryId, params);
  if (primaryResult.ok) return primaryResult;

  if (!providerHasKey(secondaryId)) {
    // No fallback configured — make it explicit that this is the only
    // provider in play, so "rate limited" doesn't read as "the app has
    // no fallback and I don't know it" when actually no second key is set.
    return { ok: false, error: `${AI_PROVIDERS[primaryId].label}: ${primaryResult.error}` };
  }

  const fallbackResult = await callProvider(secondaryId, params);
  if (fallbackResult.ok) {
    notifyProviderSwitch(primaryId, secondaryId);
    return fallbackResult;
  }

  // Both failed — say so explicitly with both messages, rather than only
  // surfacing one and leaving the other failure invisible. A person seeing
  // "rate limited" with no other context can't tell whether a fallback was
  // even attempted; this makes that unambiguous.
  return {
    ok: false,
    error: `${AI_PROVIDERS[primaryId].label}: ${primaryResult.error} — Fallback (${AI_PROVIDERS[secondaryId].label}) also failed: ${fallbackResult.error}`,
  };
}

// Debounced so a burst of calls in quick succession (e.g. a chat reply plus
// a background re-render) doesn't stack multiple identical toasts.
let lastSwitchNoticeAt = 0;
function notifyProviderSwitch(primaryId, secondaryId) {
  const now = Date.now();
  if (now - lastSwitchNoticeAt < 4000) return;
  lastSwitchNoticeAt = now;

  if (typeof showToast === 'function') {
    const primaryLabel = AI_PROVIDERS[primaryId].label;
    const secondaryLabel = AI_PROVIDERS[secondaryId].label;
    showToast(`${primaryLabel} was unavailable, so this answer came from your backup AI (${secondaryLabel}).`, 'info');
  }
}

/** True if AI features should be considered "available" at all, for the
 * many call sites that gate a button/section on having *some* provider
 * configured rather than caring which one. */
function hasAnyKey() {
  return GeminiClient.hasGeminiKey() || OpenRouterClient.hasOpenRouterKey();
}

window.AIProvider = { callAI, hasAnyKey, getPrimaryProvider, setPrimaryProvider, AI_PROVIDERS };
