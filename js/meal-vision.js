/* ============================================================
   MEAL VISION
   Photo -> estimated calorie/macro RANGE via Gemini's vision input.
   This is explicitly an estimate, never a single confident number —
   food-photo calorie estimation from a single image is inherently
   imprecise (portion size, hidden oil/sauce, unseen ingredients),
   and presenting false precision here would be actively misleading
   for something people may use to make eating decisions. The model
   is instructed to return a range; storage.js's estimateRange field
   exists specifically to carry that range through to the UI, and
   the UI must always show it as a range/estimate, never a bare
   single number, until the user manually corrects it.

   ACCURACY MODEL: the single biggest source of error in photo-based
   calorie estimation isn't misidentifying the food — it's misjudging
   its physical SIZE. A photo has no inherent scale, and a top-down
   angle collapses height/depth entirely (a thin layer of rice and a
   tightly packed mound look identical from directly above). So:
   1. The prompt forces a step-by-step size chain — scale reference ->
      footprint -> depth -> volume -> weight -> calories — rather than
      jumping straight from "looks like chicken and rice" to a number.
      This is the actual accuracy lever, not prose length; see the
      TOKEN BUDGET note below for why the instruction text itself is
      kept as short as it can be while keeping that chain intact.
   2. It accepts an optional second photo (different angle, ideally a
      side profile) to recover depth info a single top-down shot can't
      show — offered as an explicit user choice in app.js, not run
      automatically, since it doubles image tokens and call count for
      that meal (see MEAL_PHOTO_TIPS below, surfaced in the UI).

   TOKEN BUDGET: the system instruction below is resent in full on
   every call (initial estimate, second-photo re-estimate, every
   refine) — for someone logging several meals a day this adds up
   fast against a free-tier quota, and unlike image tokens it's pure
   overhead that doesn't improve the estimate once the model has
   internalized the reasoning chain. It's kept as short as possible
   while preserving the full 6-step chain and the honesty rules
   (ranges, "don't guess if unidentifiable", no diagnosis assumptions)
   — cut here only trims explanatory prose, never a reasoning step or
   a safety rule. Same principle applies to the JSON schema blocks
   and the refine prompt below: same fields, terser descriptions.
   ============================================================ */

// Shown in the UI next to the photo capture button so the advice lives in
// one place rather than being duplicated across modal copy. Ordered by
// impact: reference object first because it's the single biggest lever
// (no reference = the model is guessing scale from priors about "a plate"),
// then angle/depth, then framing/lighting basics.
const MEAL_PHOTO_TIPS = [
  { icon: '📏', text: 'Put something familiar in frame for scale — a fork/spoon, your hand, or a standard credit card next to the plate works best.' },
  { icon: '🔝', text: 'Shoot from directly above (top-down) as your main photo — it shows the food\'s full footprint without a distorted perspective.' },
  { icon: '📐', text: 'If the food is piled or layered (rice, pasta, stew, casserole), a second side-angle photo can sharpen the estimate — worth it for big or ambiguous portions, optional otherwise since it uses another AI call.' },
  { icon: '🍽️', text: 'Keep the whole plate/bowl in frame, uncropped, so the model can judge the container size too.' },
  { icon: '💡', text: 'Even, natural light beats a flash — harsh shadows can hide or exaggerate how much food is actually there.' },
];

const MEAL_VISION_SYSTEM_INSTRUCTION = `You are a nutrition estimation assistant looking at one or two photos of the same meal (a second photo, if present, is a different angle — usually for depth/height).

Reason step by step about physical SIZE before estimating calories — misjudged size, not misidentified food, is the main error source. Work through this chain internally, then output ONLY the final JSON (no reasoning text):
1. SCALE REFERENCE: find anything with a known size in frame (fork ~19-20cm, tablespoon head ~4cm, card ~8.5x5.4cm, dinner plate ~26-28cm, side plate ~18-20cm, hand, can, phone). None visible? Fall back on typical dinnerware size, and reflect the extra uncertainty in a wider range / lower confidence.
2. FOOTPRINT: estimate width/length of the food using that reference.
3. DEPTH/HEIGHT: thin layer, moderate serving, or tall mound? Loose salad reads bigger than its mass; packed rice/pasta/stew reads smaller than its mass. Use a second photo for this if provided — side view beats guessing from top-down alone.
4. VOLUME: per visible component (protein, starch, veg, visible oil/sauce), not one lump total.
5. DENSITY/WEIGHT: typical densities per component (rice ~0.9-1g/cm³ packed, salad much less, meat/fish denser, sauce/oil adds weight disproportionate to its visual size).
6. CALORIES: standard nutrition data per component's weight and likely prep, summed.

Rules:
- Never a single confident number — always a calorie RANGE. ~15% spread when you had a good reference + depth view, 30%+ when you had neither. Macros: best-guess midpoint.
- Can't identify the food or it's not food? Say so in "notes", numeric fields null. Don't guess.
- No diagnosis/health/dietary-goal assumptions — just describe and estimate.
- Output ONLY the JSON schema requested, no markdown fences, no prose.`;

function buildMealVisionPrompt(contextNote, hasSecondPhoto) {
  return `${hasSecondPhoto ? 'Two photos of the same food (2nd = different angle, for depth).' : 'One photo of food.'} Identify it, run the size chain (reference -> footprint -> depth -> volume -> weight -> calories), then estimate.
${contextNote ? `\nTreat this as ground truth over the photo where they conflict: "${contextNote}"\n` : ''}
JSON only:
{"label":"short food description","caloriesLow":number|null,"caloriesHigh":number|null,"protein":number|null,"carbs":number|null,"fats":number|null,"confidence":"low"|"medium"|"high","referenceUsed":"what you used for scale, e.g. 'fork in frame' or 'no reference, assumed standard plate'","notes":"1 sentence on what's uncertain, or why unidentifiable"}`;
}

/**
 * imageBase64: raw base64 string (no data: prefix), already compressed/
 * downscaled by the caller (see compressImageForUpload in app.js) — this
 * function does not resize images itself.
 * contextNote: optional free-text from the user (e.g. "2 cups rice, no oil")
 * — a photo alone can't show portion size or hidden ingredients, so this is
 * the single biggest lever for a more accurate estimate. Always optional.
 * secondImageBase64/secondImageMimeType: optional second angle (typically a
 * side view) used specifically to recover depth/height information a single
 * top-down photo can't show — see MEAL_PHOTO_TIPS. Always optional; the
 * estimate still works with one photo, just with a wider (more honest)
 * calorie range and lower confidence.
 */
async function estimateMealFromPhoto(imageBase64, imageMimeType = 'image/jpeg', contextNote = '', secondImageBase64 = null, secondImageMimeType = 'image/jpeg') {
  if (!AIProvider.hasAnyKey()) {
    return { ok: false, error: 'missing_key' };
  }
  if (!imageBase64) {
    return { ok: false, error: 'No image provided.' };
  }

  const images = [{ imageBase64, imageMimeType }];
  if (secondImageBase64) images.push({ imageBase64: secondImageBase64, imageMimeType: secondImageMimeType });

  const result = await AIProvider.callAI({
    systemInstruction: MEAL_VISION_SYSTEM_INSTRUCTION,
    prompt: buildMealVisionPrompt(contextNote, !!secondImageBase64),
    jsonMode: true,
    images,
  });

  if (!result.ok) return result;

  const data = result.data;
  if (!data || typeof data !== 'object') {
    return { ok: false, error: 'Gemini returned an unexpected estimate shape.' };
  }

  return { ok: true, estimate: parseMealEstimateData(data) };
}

function parseMealEstimateData(data) {
  const hasRange = typeof data.caloriesLow === 'number' && typeof data.caloriesHigh === 'number';

  if (!hasRange) {
    return {
      label: data.label || '',
      identified: false,
      notes: data.notes || "Couldn't confidently identify this.",
    };
  }

  const caloriesMid = Math.round((data.caloriesLow + data.caloriesHigh) / 2);

  return {
    identified: true,
    label: data.label || 'Estimated meal',
    calories: caloriesMid,
    caloriesLow: Math.round(data.caloriesLow),
    caloriesHigh: Math.round(data.caloriesHigh),
    protein: typeof data.protein === 'number' ? Math.round(data.protein) : null,
    carbs: typeof data.carbs === 'number' ? Math.round(data.carbs) : null,
    fats: typeof data.fats === 'number' ? Math.round(data.fats) : null,
    confidence: ['low', 'medium', 'high'].includes(data.confidence) ? data.confidence : 'low',
    referenceUsed: typeof data.referenceUsed === 'string' ? data.referenceUsed : '',
    notes: data.notes || '',
  };
}

/**
 * Re-runs an estimate after the user corrects or adds detail on top of a
 * PRIOR photo estimate (e.g. "actually it's 3 eggs not 2", "I added a
 * tablespoon of olive oil", "no rice, I skipped it"). The original photo(s)
 * are re-attached when available so the model has both the visual and the
 * correction — correction text always takes precedence over the photo where
 * they conflict, same principle as buildMealVisionPrompt's contextNote.
 * imageBase64 may be null (e.g. if the modal no longer has it in memory);
 * in that case this is a text-only refinement against the prior estimate.
 */
async function refineMealEstimate({ previousEstimate, correctionText, imageBase64 = null, imageMimeType = 'image/jpeg', secondImageBase64 = null, secondImageMimeType = 'image/jpeg' }) {
  if (!AIProvider.hasAnyKey()) {
    return { ok: false, error: 'missing_key' };
  }
  if (!correctionText || !correctionText.trim()) {
    return { ok: false, error: 'No correction provided.' };
  }

  const images = [];
  if (imageBase64) images.push({ imageBase64, imageMimeType });
  if (secondImageBase64) images.push({ imageBase64: secondImageBase64, imageMimeType: secondImageMimeType });

  const prompt = `Prior estimate — Label: ${previousEstimate.label || 'unknown'}. Calories: ${previousEstimate.caloriesLow ?? '?'}-${previousEstimate.caloriesHigh ?? '?'} kcal. Protein: ${previousEstimate.protein ?? '?'}g, Carbs: ${previousEstimate.carbs ?? '?'}g, Fats: ${previousEstimate.fats ?? '?'}g.

Correction (treat as ground truth over the photo/prior guess where they conflict): "${correctionText.trim()}"

${images.length ? `Photo${images.length > 1 ? 's' : ''} re-attached — reuse the size chain (reference -> footprint -> depth -> volume -> weight -> calories) for anything the correction doesn't cover.` : 'No photo available — use the prior estimate plus the correction only.'}

Re-estimate the FULL meal, not just the correction. JSON only:
{"label":"short food description","caloriesLow":number|null,"caloriesHigh":number|null,"protein":number|null,"carbs":number|null,"fats":number|null,"confidence":"low"|"medium"|"high","referenceUsed":"what you used for scale","notes":"1 sentence on what's still uncertain"}`;

  const result = await AIProvider.callAI({
    systemInstruction: MEAL_VISION_SYSTEM_INSTRUCTION,
    prompt,
    jsonMode: true,
    images,
  });

  if (!result.ok) return result;

  const data = result.data;
  if (!data || typeof data !== 'object') {
    return { ok: false, error: 'Gemini returned an unexpected estimate shape.' };
  }

  return { ok: true, estimate: parseMealEstimateData(data) };
}

window.MealVision = { estimateMealFromPhoto, refineMealEstimate, MEAL_VISION_SYSTEM_INSTRUCTION, MEAL_PHOTO_TIPS };
