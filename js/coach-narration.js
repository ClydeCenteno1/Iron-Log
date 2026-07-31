/* ============================================================
   AI COACHING NARRATION
   The rules engine (progression.js) still computes every number.
   This layer only asks Gemini to phrase that decision like a coach
   talking to the lifter — tone shaped by training style/goal. If
   Gemini is unavailable, callers fall back to the rules engine's
   own plain-English message, so the app never breaks without a key.
   ============================================================ */

async function narrateCoachingFeedback({ exerciseName, suggestion, profile }) {
  if (!GeminiClient.hasGeminiKey()) {
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

  const result = await GeminiClient.callGemini({ systemInstruction, prompt });
  if (!result.ok) return result;
  return { ok: true, text: result.text.trim() };
}

async function narratePostWorkoutSummary({ rows, profile }) {
  if (!GeminiClient.hasGeminiKey()) {
    return { ok: false, error: 'missing_key' };
  }

  const systemInstruction = `You are a strength coach giving a brief post-workout summary.
You are given the ALREADY-DECIDED outcome per exercise — do not change any classification. Summarize the session's overall trend in 2-3 sentences, encouraging but honest about regressions.`;

  const prompt = `Session results:
${rows.map(r => `- ${r.name}: ${r.classification}${r.topSet ? ` (${r.topSet.weight ?? '—'}kg x ${r.topSet.reps ?? '—'})` : ''}`).join('\n')}

Goal: ${profile.goal}, training style: ${profile.trainingStyle}.
Write a short overall summary (2-3 sentences).`;

  const result = await GeminiClient.callGemini({ systemInstruction, prompt });
  if (!result.ok) return result;
  return { ok: true, text: result.text.trim() };
}

window.CoachNarration = { narrateCoachingFeedback, narratePostWorkoutSummary };
