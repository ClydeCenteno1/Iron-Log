/* ============================================================
   AI WORKOUT GENERATOR
   Gemini picks exercises and structures the plan. It's constrained
   to the user's actual exercise library (we pass it the list of
   valid names) so it can't invent exercises that don't exist in
   the app, and to a strict JSON schema so the UI can render it
   without guessing at shape.
   ============================================================ */

const SPLIT_LABELS = {
  full_body: 'Full Body (same muscle groups every session)',
  upper_lower: 'Upper / Lower split',
  push_pull_legs: 'Push / Pull / Legs split',
};

function buildGeneratorPrompt(questionnaire) {
  const { goal, splitKey, styleKey, equipment, daysPerWeek, experienceLevel } = questionnaire;
  const style = Progression.getStyleConfig(styleKey);
  const exercises = Storage.getExercises();
  const equipmentSet = new Set(equipment.length ? equipment : ['Bodyweight']);
  equipmentSet.add('Bodyweight');

  const availableExercises = exercises.filter(ex => equipmentSet.has(ex.equipment));
  const exerciseCatalog = availableExercises.map(ex => `${ex.name} | ${ex.muscleGroup} | ${ex.equipment}`).join('\n');

  const systemInstruction = `You are a certified strength coach building structured workout plans.
You must ONLY select exercises from the provided catalog — never invent an exercise that isn't listed.
Follow evidence-based programming: appropriate volume for the stated goal and experience level, sensible rest times, no dangerous or contraindicated combinations for a beginner if experience level is beginner.
Return ONLY valid JSON matching the exact schema requested. No prose, no markdown fences.`;

  const prompt = `Build a ${daysPerWeek}-day/week ${SPLIT_LABELS[splitKey] || splitKey} workout plan.

Goal: ${goal}
Training style: ${style.label} (rep range ${style.repRange[0]}-${style.repRange[1]}, rest ~${style.restSeconds}s)
Experience level: ${experienceLevel}
Available equipment: ${[...equipmentSet].join(', ')}

Exercise catalog (name | muscle group | equipment) — pick ONLY from this list, using the exact name as written:
${exerciseCatalog}

Return JSON in exactly this shape:
{
  "days": [
    {
      "dayNumber": 1,
      "focus": "short label like 'Push' or 'Upper Body'",
      "exercises": [
        { "name": "exact exercise name from catalog", "targetSets": 3, "targetReps": "8-12", "restSeconds": 90 }
      ]
    }
  ],
  "coachNote": "1-2 sentence rationale for how this plan was structured, in a friendly coach tone"
}`;

  return { systemInstruction, prompt, availableExercises };
}

async function generatePlanAI(questionnaire) {
  if (!GeminiClient.hasGeminiKey()) {
    return { ok: false, error: 'missing_key' };
  }

  const { systemInstruction, prompt, availableExercises } = buildGeneratorPrompt(questionnaire);
  const result = await GeminiClient.callGemini({ systemInstruction, prompt, jsonMode: true });

  if (!result.ok) return result;

  const raw = result.data;
  if (!raw || !Array.isArray(raw.days)) {
    return { ok: false, error: 'Gemini returned an unexpected plan shape.' };
  }

  // Map exercise names back to real exercise IDs, dropping any hallucinated
  // exercise the model returned that isn't actually in the catalog.
  const byName = new Map(availableExercises.map(ex => [ex.name.toLowerCase(), ex]));
  const droppedNames = [];

  const days = raw.days.map(day => {
    const exercises = (day.exercises || []).map(ex => {
      const match = byName.get((ex.name || '').toLowerCase());
      if (!match) { droppedNames.push(ex.name); return null; }
      return {
        exerciseId: match.id,
        name: match.name,
        muscleGroup: match.muscleGroup,
        equipment: match.equipment,
        targetSets: ex.targetSets || 3,
        targetReps: ex.targetReps || '8-12',
        restSeconds: ex.restSeconds || 90,
      };
    }).filter(Boolean);

    return { dayNumber: day.dayNumber, focus: day.focus || 'Workout', exercises };
  });

  const plan = {
    goal: questionnaire.goal,
    splitKey: questionnaire.splitKey,
    splitLabel: SPLIT_LABELS[questionnaire.splitKey] || questionnaire.splitKey,
    styleKey: questionnaire.styleKey,
    daysPerWeek: questionnaire.daysPerWeek,
    days,
    coachNote: raw.coachNote || '',
    warnings: droppedNames.length
      ? [`AI suggested exercises not in your library, so they were skipped: ${droppedNames.join(', ')}.`]
      : [],
    source: 'ai',
  };

  return { ok: true, plan };
}

window.GeneratorAI = { generatePlanAI, buildGeneratorPrompt };
