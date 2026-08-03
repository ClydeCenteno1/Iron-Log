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
   ============================================================ */

const MEAL_VISION_SYSTEM_INSTRUCTION = `You are a nutrition estimation assistant looking at a photo of a meal or food item.
Rules you must follow:
- You are estimating from a single photo — you cannot know exact ingredients, cooking oil/sauce quantities, or precise portion weight. Reflect that uncertainty honestly.
- Always return a calorie RANGE (low/high), never a single confident number. Do the same implicitly for macros by returning your best-guess midpoint for protein/carbs/fats, but keep the calorie range wide enough to be honest about the uncertainty (typically at least a 15-25% spread between low and high, more if the photo is ambiguous, low quality, or the dish could vary a lot in preparation).
- If you cannot identify the food with reasonable confidence, or the image doesn't appear to contain food, say so plainly in "notes" and return null for the numeric fields rather than guessing.
- Do not assume a diagnosis, health condition, or dietary goal — just describe what's in the photo and estimate its nutrition content.
- Return ONLY valid JSON matching the exact schema requested. No prose, no markdown fences.`;

function buildMealVisionPrompt(contextNote) {
  return `Look at this photo of food. Identify what it is, then estimate its nutrition content.
${contextNote ? `\nThe person also told you this about the meal — treat it as ground truth over your own visual guess where the two disagree, since they know their food better than a photo can show: "${contextNote}"\n` : ''}
Return JSON in exactly this shape:
{
  "label": "short description of the food, e.g. 'Grilled chicken with rice and vegetables'",
  "caloriesLow": number or null,
  "caloriesHigh": number or null,
  "protein": number or null,
  "carbs": number or null,
  "fats": number or null,
  "confidence": "low" or "medium" or "high",
  "notes": "1 sentence on anything uncertain — e.g. hidden sauce/oil, unclear portion size, or that the food couldn't be identified"
}`;
}

/**
 * imageBase64: raw base64 string (no data: prefix), already compressed/
 * downscaled by the caller (see compressImageForUpload in app.js) — this
 * function does not resize images itself.
 * contextNote: optional free-text from the user (e.g. "2 cups rice, no oil")
 * — a photo alone can't show portion size or hidden ingredients, so this is
 * the single biggest lever for a more accurate estimate. Always optional.
 */
async function estimateMealFromPhoto(imageBase64, imageMimeType = 'image/jpeg', contextNote = '') {
  if (!AIProvider.hasAnyKey()) {
    return { ok: false, error: 'missing_key' };
  }
  if (!imageBase64) {
    return { ok: false, error: 'No image provided.' };
  }

  const result = await AIProvider.callAI({
    systemInstruction: MEAL_VISION_SYSTEM_INSTRUCTION,
    prompt: buildMealVisionPrompt(contextNote),
    jsonMode: true,
    imageBase64,
    imageMimeType,
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
    notes: data.notes || '',
  };
}

/**
 * Re-runs an estimate after the user corrects or adds detail on top of a
 * PRIOR photo estimate (e.g. "actually it's 3 eggs not 2", "I added a
 * tablespoon of olive oil", "no rice, I skipped it"). The original photo is
 * re-attached when available so the model has both the visual and the
 * correction — correction text always takes precedence over the photo where
 * they conflict, same principle as buildMealVisionPrompt's contextNote.
 * imageBase64 may be null (e.g. if the modal no longer has it in memory);
 * in that case this is a text-only refinement against the prior estimate.
 */
async function refineMealEstimate({ previousEstimate, correctionText, imageBase64 = null, imageMimeType = 'image/jpeg' }) {
  if (!AIProvider.hasAnyKey()) {
    return { ok: false, error: 'missing_key' };
  }
  if (!correctionText || !correctionText.trim()) {
    return { ok: false, error: 'No correction provided.' };
  }

  const prompt = `You previously estimated this meal as:
Label: ${previousEstimate.label || 'unknown'}
Calories: ${previousEstimate.caloriesLow ?? '?'}-${previousEstimate.caloriesHigh ?? '?'} kcal
Protein: ${previousEstimate.protein ?? '?'}g, Carbs: ${previousEstimate.carbs ?? '?'}g, Fats: ${previousEstimate.fats ?? '?'}g

The person is now correcting or adding detail on top of that estimate. Treat their statement as ground truth over your prior guess or the photo where they conflict — they know their actual meal better than either can show:
"${correctionText.trim()}"

${imageBase64 ? 'The original photo is attached again for reference.' : 'The original photo is not available for this correction — rely on the previous estimate above plus the correction text.'}

Re-estimate the FULL meal (not just the correction) and return the complete updated numbers.

Return JSON in exactly this shape:
{
  "label": "short description of the food, e.g. 'Grilled chicken with rice and vegetables'",
  "caloriesLow": number or null,
  "caloriesHigh": number or null,
  "protein": number or null,
  "carbs": number or null,
  "fats": number or null,
  "confidence": "low" or "medium" or "high",
  "notes": "1 sentence on anything still uncertain"
}`;

  const result = await AIProvider.callAI({
    systemInstruction: MEAL_VISION_SYSTEM_INSTRUCTION,
    prompt,
    jsonMode: true,
    imageBase64,
    imageMimeType,
  });

  if (!result.ok) return result;

  const data = result.data;
  if (!data || typeof data !== 'object') {
    return { ok: false, error: 'Gemini returned an unexpected estimate shape.' };
  }

  return { ok: true, estimate: parseMealEstimateData(data) };
}

window.MealVision = { estimateMealFromPhoto, refineMealEstimate, MEAL_VISION_SYSTEM_INSTRUCTION };
