/* ============================================================
   BODY FAT VISION
   Photo -> estimated body-fat-percentage RANGE via the configured
   AI provider's vision input. Same philosophy as meal-vision.js —
   a single photo is inherently imprecise for this (lighting, pose,
   camera angle, and clothing all shift the read), so this always
   returns a RANGE with an explicit confidence level, never a bare
   single number, and is framed throughout as a rough visual
   estimate rather than a measurement or a medical assessment.

   This estimate is ONLY used to feed suggestGoalWeight()'s existing
   body-fat-based goal-weight math (see nutrition.js) — it's a third
   way to fill the same estimatedCurrentBFPercent input that the
   tape-measurement and manual-guess wizard steps already fill,
   nothing more. It never replaces those steps; it sits alongside
   them as another option for people who don't have a tape measure
   handy or don't want to guess a number themselves.

   Privacy: unlike meal photos, this photo is a photo of the user's
   body. The caller (app.js) must never persist the image itself —
   only the resulting numeric estimate is written to Storage. This
   module never stores anything on its own; it's a pure request/
   response call, same as meal-vision.js.
   ============================================================ */

const BODY_FAT_VISION_SYSTEM_INSTRUCTION = `You are giving a rough, visual body-fat-percentage estimate from a single photo, for a fitness app's goal-planning feature.
Rules you must follow:
- You are estimating from one photo — lighting, pose, angle, and clothing all affect how lean someone looks, and you cannot know their actual body composition. Reflect that uncertainty honestly.
- Always return a body-fat-percentage RANGE (low/high), never a single confident number. Keep the range wide enough to be honest about the uncertainty (typically at least 4-6 percentage points between low and high, wider if the photo is unclear, poorly lit, loose clothing obscures the body, or the pose makes it hard to judge).
- If the photo doesn't show enough of the body to estimate (face-only photo, too much clothing, too dark, too far away, or no person visible), say so plainly in "notes" and return null for the numeric fields rather than guessing.
- This is a casual visual estimate for a workout/nutrition app, not a medical or diagnostic assessment — never use clinical or diagnostic language, never comment on health status, and never assume or state a body composition condition.
- Do not comment on attractiveness, make personal judgments, or say anything discouraging — describe only what's needed for the estimate, in a neutral, matter-of-fact tone.
- Return ONLY valid JSON matching the exact schema requested. No prose, no markdown fences.`;

function buildBodyFatVisionPrompt(sex) {
  return `Look at this photo. Give a rough visual estimate of body fat percentage.
${sex === 'male' || sex === 'female' ? `\nFor reference, estimate as if assessing a ${sex} body (this only affects which reference charts are typically used, not how you should perceive the photo).\n` : ''}
Return JSON in exactly this shape:
{
  "bfLow": number or null,
  "bfHigh": number or null,
  "confidence": "low" or "medium" or "high",
  "notes": "1 sentence on anything uncertain — e.g. lighting, pose, clothing, distance — or why an estimate couldn't be made"
}`;
}

/**
 * imageBase64: raw base64 string (no data: prefix), already compressed/
 * downscaled by the caller — this function does not resize images itself.
 * sex: optional 'male' | 'female', from the user's profile — passed through
 * only to pick which reference framing the model uses, same as it already
 * shapes categorizeBodyFat() and VISIBLE_ABS_BF_RANGE in nutrition.js.
 */
async function estimateBodyFatFromPhoto(imageBase64, imageMimeType = 'image/jpeg', sex = null) {
  if (!AIProvider.hasAnyKey()) {
    return { ok: false, error: 'missing_key' };
  }
  if (!imageBase64) {
    return { ok: false, error: 'No image provided.' };
  }

  const result = await AIProvider.callAI({
    systemInstruction: BODY_FAT_VISION_SYSTEM_INSTRUCTION,
    prompt: buildBodyFatVisionPrompt(sex),
    jsonMode: true,
    imageBase64,
    imageMimeType,
  });

  if (!result.ok) return result;

  const data = result.data;
  if (!data || typeof data !== 'object') {
    return { ok: false, error: 'The AI returned an unexpected estimate shape.' };
  }

  return { ok: true, estimate: parseBodyFatEstimateData(data) };
}

function parseBodyFatEstimateData(data) {
  const hasRange = typeof data.bfLow === 'number' && typeof data.bfHigh === 'number';

  if (!hasRange) {
    return {
      identified: false,
      notes: data.notes || "Couldn't get a confident estimate from that photo.",
    };
  }

  const bfLow = Math.round(data.bfLow * 10) / 10;
  const bfHigh = Math.round(data.bfHigh * 10) / 10;
  // Midpoint is what actually feeds suggestGoalWeight() downstream — same
  // "return a range, but also hand callers a usable midpoint" contract as
  // meal-vision.js's parseMealEstimateData.
  const bfMid = Math.round(((bfLow + bfHigh) / 2) * 10) / 10;

  return {
    identified: true,
    bfPercent: bfMid,
    bfLow,
    bfHigh,
    confidence: ['low', 'medium', 'high'].includes(data.confidence) ? data.confidence : 'low',
    notes: data.notes || '',
  };
}

window.BodyFatVision = { estimateBodyFatFromPhoto, BODY_FAT_VISION_SYSTEM_INSTRUCTION };
