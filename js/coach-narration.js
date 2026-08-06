/* ============================================================
   AI COACHING NARRATION
   The rules engine (progression.js) still computes every number.
   This layer only asks the AI provider to phrase that decision like
   a coach talking to the lifter — tone shaped by training style/goal.
   If no AI provider is available, callers fall back to the rules
   engine's own plain-English message, so the app never breaks
   without a key.
   ============================================================ */

async function narrateCoachingFeedback({ exerciseName, suggestion, profile }) {
  if (!AIProvider.hasAnyKey()) {
    return { ok: false, error: 'missing_key' };
  }

  const systemInstruction = `You are a supportive, no-nonsense strength coach texting a client a quick note after a lift.
You are given the ALREADY-DECIDED numeric target — you must not change or second-guess these numbers, only explain them naturally in 1-2 short sentences.
Rely on established training principles; don't invent claims. Keep it brief, direct, and encouraging without being cheesy.`;

  const prompt = `Exercise: ${exerciseName}
Decision: ${suggestion.status} (${suggestion.classification || 'n/a'})
Fixed target for next session: ${suggestion.suggestedWeight !== null ? suggestion.suggestedWeight + 'kg' : 'n/a'}, ${suggestion.suggestedReps} reps, ${suggestion.suggestedSets} sets.
Training goal: ${profile.goal}, experience: ${profile.experienceLevel}.

Write the 1-2 sentence coaching note explaining this target. Do not restate raw numbers mechanically — talk like a coach would.`;

  const result = await AIProvider.callAI({ systemInstruction, prompt });
  if (!result.ok) return result;
  return { ok: true, text: result.text.trim() };
}

async function narratePostWorkoutSummary({ rows, profile }) {
  if (!AIProvider.hasAnyKey()) {
    return { ok: false, error: 'missing_key' };
  }

  const systemInstruction = `You are a strength coach giving a brief post-workout summary.
You are given the ALREADY-DECIDED outcome per exercise — do not change any classification. Summarize the session's overall trend in 2-3 sentences, encouraging but honest about regressions.`;

  const prompt = `Session results:
${rows.map(r => `- ${r.name}: ${r.classification}${r.topSet ? ` (${r.topSet.weight ?? '—'}kg x ${r.topSet.reps ?? '—'})` : ''}`).join('\n')}

Goal: ${profile.goal}, training style: ${profile.trainingStyle}.
Write a short overall summary (2-3 sentences).`;

  const result = await AIProvider.callAI({ systemInstruction, prompt });
  if (!result.ok) return result;
  return { ok: true, text: result.text.trim() };
}

/**
 * Explains an already-computed weight-trend analysis (see nutrition.js's
 * analyzeWeightTrend) in plain language. Like the other narration functions
 * here, this NEVER changes or re-derives the numbers — trend.suggestedDelta
 * and trend.suggestedCalorieTarget are fixed inputs, not suggestions this
 * call can alter. Tone matters a lot here specifically: weight/calorie
 * trends are a sensitive topic, so this must stay calm, non-alarming, avoid
 * diet-culture language ("good"/"bad" foods, guilt, willpower framing), and
 * always frame the number as optional context the person can ignore.
 */
async function narrateWeightTrend({ trend, profile }) {
  if (!AIProvider.hasAnyKey()) {
    return { ok: false, error: 'missing_key' };
  }
  if (trend.status !== 'ok' || trend.pace === 'on_track') {
    return { ok: false, error: 'nothing_to_narrate' };
  }

  const systemInstruction = `You are a calm, matter-of-fact nutrition coach explaining a weight-trend observation to someone tracking their calories.
You are given ALREADY-COMPUTED numbers (expected vs. actual weekly weight change, and a suggested calorie target) — you must not change, recalculate, or second-guess these numbers, only explain them in 2-3 short sentences.
Tone rules, follow strictly:
- Be neutral and matter-of-fact. Never use words like "good", "bad", "cheat", "should feel", or guilt/willpower language.
- Body weight naturally fluctuates day to day from water, sodium, and digestion — briefly normalize that if relevant, don't make the trend sound alarming.
- Present the suggested number as one option they can try, not an instruction. Explicitly note they can ignore it or keep their current target.
- Never mention or suggest anything below what's given to you — do not recommend a lower calorie target than the one provided.
- If the trend is "wrong_direction" (moving opposite to their stated goal), stay neutral and factual — do not speculate about why, and do not imply anything about their adherence or effort.`;

  const prompt = `Goal: ${trend.goalKey} (${profile.nutritionGoal || 'maintain'})
Expected pace: ${trend.expectedWeeklyKg}kg/week
Actual trend (from recent check-ins): ${trend.actualWeeklyKg}kg/week
Pace assessment: ${trend.pace}
Current calorie target: ${trend.currentCalorieTarget}
Suggested calorie target: ${trend.suggestedCalorieTarget} (${trend.suggestedDelta > 0 ? '+' : ''}${trend.suggestedDelta} kcal/day)

Write a short (2-3 sentence) note explaining this observation and the optional suggested adjustment.`;

  const result = await AIProvider.callAI({ systemInstruction, prompt });
  if (!result.ok) return result;
  return { ok: true, text: result.text.trim() };
}

/**
 * Batched sibling of narrateCoachingFeedback: writes the short coaching
 * note for every exercise currently in the session in one API call
 * instead of one call per exercise. This is the main quota risk in the
 * log-session screen — it used to auto-fire a separate call per entry on
 * every render (content-cached, but every *new* combo still meant a fresh
 * call). Same per-exercise prompt inputs go in; the model still writes
 * each note independently against its own decision/target, it's just
 * delivered as one request/response instead of many.
 *
 * items: [{ key, exerciseName, suggestion, profile }] — profile is passed
 * per-item for API symmetry with the single version, but in practice is
 * the same object for every item in a session.
 * Returns: { ok, notes: { [key]: string } } — missing keys on partial
 * failure just mean "no note for that one", callers already fall back to
 * suggestion.message when a note isn't available.
 */
async function narrateCoachingFeedbackBatch(items) {
  if (!AIProvider.hasAnyKey()) {
    return { ok: false, error: 'missing_key' };
  }
  if (!items || items.length === 0) {
    return { ok: true, notes: {} };
  }
  if (items.length === 1) {
    const only = items[0];
    const single = await narrateCoachingFeedback({ exerciseName: only.exerciseName, suggestion: only.suggestion, profile: only.profile });
    return single.ok ? { ok: true, notes: { [only.key]: single.text } } : { ok: false, error: single.error };
  }

  const systemInstruction = `You are a supportive, no-nonsense strength coach texting a client quick notes after each lift in their session.
For each exercise below you are given the ALREADY-DECIDED numeric target — you must not change or second-guess these numbers, only explain each one naturally in 1-2 short sentences.
Write each exercise's note independently — don't let one exercise's note reference or blend with another's.
Rely on established training principles; don't invent claims. Keep each note brief, direct, and encouraging without being cheesy.
Return ONLY valid JSON, no prose, no markdown fences.`;

  const blocks = items.map((item, i) => {
    const s = item.suggestion;
    return `--- Exercise ${i + 1}: key="${item.key}" ---
Name: ${item.exerciseName}
Decision: ${s.status} (${s.classification || 'n/a'})
Fixed target for next session: ${s.suggestedWeight !== null ? s.suggestedWeight + 'kg' : 'n/a'}, ${s.suggestedReps} reps, ${s.suggestedSets} sets.
Training goal: ${item.profile.goal}, experience: ${item.profile.experienceLevel}.`;
  }).join('\n\n');

  const prompt = `Write a 1-2 sentence coaching note for each of the following ${items.length} exercises, explaining its fixed target. Do not restate raw numbers mechanically — talk like a coach would.

${blocks}

Return JSON in exactly this shape, with one entry per exercise keyed by its exact key string given above:
{
  "notes": {
    "<key>": "1-2 sentence coaching note"
  }
}`;

  const result = await AIProvider.callAI({ systemInstruction, prompt, jsonMode: true });
  if (!result.ok) return { ok: false, error: result.error };

  const data = result.data;
  const notesRaw = data && typeof data === 'object' ? data.notes : null;
  if (!notesRaw || typeof notesRaw !== 'object') {
    return { ok: false, error: 'AI returned an unexpected notes shape.' };
  }

  const notes = {};
  for (const item of items) {
    const text = notesRaw[item.key];
    if (typeof text === 'string' && text.trim()) notes[item.key] = text.trim();
  }
  return { ok: true, notes };
}

window.CoachNarration = { narrateCoachingFeedback, narrateCoachingFeedbackBatch, narratePostWorkoutSummary, narrateWeightTrend };
