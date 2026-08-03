/* ============================================================
   MEAL TEXT ESTIMATION
   Free-text description -> estimated calorie/macro RANGE via Gemini,
   e.g. "2 eggs and a cup of rice". Same honesty contract as
   meal-vision.js: a described meal still has ambiguous portion sizes
   and prep details (how were the eggs cooked? oil? butter?), so this
   returns a range too, never a single confident number, and reuses
   the same estimate shape so app.js can render/store both the same
   way (storage.js's estimateRange field, source: 'ai').
   ============================================================ */

const MEAL_TEXT_SYSTEM_INSTRUCTION = `You are a nutrition estimation assistant given a plain-text description of a meal or food item, e.g. "2 eggs and a cup of rice".
Rules you must follow:
- A text description alone can't specify exact preparation (cooking oil/butter, sauce, exact portion weight) unless the person mentioned it — reflect that uncertainty honestly rather than assuming a lean/plain preparation by default.
- Always return a calorie RANGE (low/high), never a single confident number. Do the same implicitly for macros by returning your best-guess midpoint for protein/carbs/fats, but keep the calorie range wide enough to be honest about the uncertainty (typically at least a 15-25% spread between low and high, more if the description is vague about portion size or prep).
- If the description is too vague to identify actual food (e.g. it's empty, gibberish, or not food at all), say so plainly in "notes" and return null for the numeric fields rather than guessing.
- Use standard/common serving sizes and typical home cooking assumptions when the person doesn't specify (e.g. "a cup of rice" = cooked rice, "2 eggs" = large eggs) and note that assumption briefly if it materially affects the estimate.
- Do not assume a diagnosis, health condition, or dietary goal — just parse what's described and estimate its nutrition content.
- Return ONLY valid JSON matching the exact schema requested. No prose, no markdown fences.`;

function buildMealTextPrompt(description) {
  return `Parse this meal description and estimate its nutrition content: "${description.trim()}"

Return JSON in exactly this shape:
{
  "label": "short cleaned-up description of the food, e.g. '2 large eggs and 1 cup cooked rice'",
  "caloriesLow": number or null,
  "caloriesHigh": number or null,
  "protein": number or null,
  "carbs": number or null,
  "fats": number or null,
  "confidence": "low" or "medium" or "high",
  "notes": "1 sentence on anything uncertain — e.g. assumed preparation method, unclear portion size, or that the description couldn't be parsed as food"
}`;
}

function parseMealTextData(data) {
  const hasRange = typeof data.caloriesLow === 'number' && typeof data.caloriesHigh === 'number';

  if (!hasRange) {
    return {
      label: data.label || '',
      identified: false,
      notes: data.notes || "Couldn't confidently estimate this from the description.",
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
 * description: free text like "2 eggs and a cup of rice". Required.
 */
async function estimateMealFromText(description) {
  if (!GeminiClient.hasGeminiKey()) {
    return { ok: false, error: 'missing_key' };
  }
  if (!description || !description.trim()) {
    return { ok: false, error: 'No description provided.' };
  }

  const result = await GeminiClient.callGemini({
    systemInstruction: MEAL_TEXT_SYSTEM_INSTRUCTION,
    prompt: buildMealTextPrompt(description),
    jsonMode: true,
  });

  if (!result.ok) return result;

  const data = result.data;
  if (!data || typeof data !== 'object') {
    return { ok: false, error: 'Gemini returned an unexpected estimate shape.' };
  }

  return { ok: true, estimate: parseMealTextData(data) };
}

window.MealText = { estimateMealFromText, MEAL_TEXT_SYSTEM_INSTRUCTION };
