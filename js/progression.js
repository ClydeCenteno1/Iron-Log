/* ============================================================
   PROGRESSIVE OVERLOAD ENGINE
   Pure rules-based, deterministic, no external calls. Every
   suggestion here is explainable in one sentence — this is the
   opposite of a black box on purpose. If an LLM narrates this
   later, it explains these numbers; it never invents them.
   ============================================================ */

const TRAINING_STYLES = {
  hiit_low_volume: {
    label: 'High Intensity / Low Volume',
    repRange: [3, 6],
    setRange: [2, 4],
    restSeconds: 180,
    weightStepPct: 0.05,      // bigger jumps in weight
    progressionBias: 'weight', // prefer adding weight over reps
  },
  high_volume: {
    label: 'High Volume / Low Intensity',
    repRange: [10, 15],
    setRange: [3, 5],
    restSeconds: 60,
    weightStepPct: 0.025,
    progressionBias: 'reps', // prefer adding reps before weight
  },
  balanced: {
    label: 'Balanced',
    repRange: [6, 10],
    setRange: [3, 4],
    restSeconds: 90,
    weightStepPct: 0.035,
    progressionBias: 'mixed',
  },
};

function getStyleConfig(styleKey) {
  return TRAINING_STYLES[styleKey] || TRAINING_STYLES.balanced;
}

/**
 * Compare a completed set to its prior equivalent and classify the outcome.
 * Looks at the TOP set (heaviest weight, or if tied, most reps) from each session
 * as the representative comparison point — this is what actually indicates
 * whether the lift progressed, not an average across warmups/backoffs.
 */
function getTopSet(sets) {
  if (!sets || sets.length === 0) return null;
  return sets
    // Exclude warmups AND fully-empty rows (no weight logged and no reps
    // logged — e.g. a set the user added but never filled in). Without
    // this, an empty set can win the reduce below (0/null treated as a
    // valid comparison point) and every downstream progression suggestion
    // silently targets 0kg or null forever after.
    .filter(s => !s.isWarmup && (s.weight != null || s.reps != null))
    .reduce((best, s) => {
      if (!best) return s;
      const sWeight = s.weight ?? 0;
      const bestWeight = best.weight ?? 0;
      if (sWeight > bestWeight) return s;
      if (sWeight === bestWeight && (s.reps ?? 0) > (best.reps ?? 0)) return s;
      return best;
    }, null);
}

/**
 * Core classification: did this session's top set meet, miss, or regress
 * versus the previous session's top set?
 * Returns: 'met_or_exceeded' | 'missed_slightly' | 'missed_significantly' | 'first_time'
 */
function classifyPerformance(currentTop, previousTop, targetReps) {
  if (!previousTop) return 'first_time';

  const weightSame = currentTop.weight === previousTop.weight;
  const weightUp = currentTop.weight > previousTop.weight;
  const weightDown = currentTop.weight < previousTop.weight;

  if (weightUp) return 'met_or_exceeded';

  if (weightSame) {
    const repDiff = currentTop.reps - previousTop.reps;
    if (repDiff >= 0) return 'met_or_exceeded';
    if (repDiff >= -2) return 'missed_slightly';
    return 'missed_significantly';
  }

  if (weightDown) {
    // Weight dropped from last time — treat as a real regression regardless of reps
    return 'missed_significantly';
  }

  return 'missed_slightly';
}

/**
 * Produce next-session target for one exercise, given the style config
 * and the last two data points we have (or fewer, for a new exercise).
 *
 * Rules (explicit, from the spec):
 *  - met/exceeded target      -> increase weight by styleStepPct, OR add a rep
 *                                 (depends on progressionBias)
 *  - missed by 1-2 reps       -> repeat same weight, target hitting reps again
 *  - missed by 3+ / regressed -> deload ~10% OR suggest extra rest
 */
function suggestNextTarget({ exerciseId, styleKey }) {
  const style = getStyleConfig(styleKey);

  // Pull full history for this exercise (most recent first) so we can compare
  // the last logged session against the one before it — NOT against itself.
  const history = Storage.getSessions()
    .filter(s => s.entries.some(e => e.exerciseId === exerciseId))
    .sort((a, b) => b.date - a.date);

  if (history.length === 0) {
    return {
      status: 'no_history',
      message: 'No previous data for this exercise yet — log a session to get a suggestion.',
      suggestedWeight: null,
      suggestedReps: `${style.repRange[0]}-${style.repRange[1]}`,
      suggestedSets: style.setRange[1],
    };
  }

  const lastEntry = history[0].entries.find(e => e.exerciseId === exerciseId);
  const topSet = getTopSet(lastEntry.sets);
  if (!topSet) {
    return {
      status: 'no_history',
      message: 'No working sets recorded last time — log a session to get a suggestion.',
      suggestedWeight: null,
      suggestedReps: `${style.repRange[0]}-${style.repRange[1]}`,
      suggestedSets: style.setRange[1],
    };
  }

  // Compare the last session's top set against the one before it, if it exists.
  // With only one data point, there's nothing to compare yet, so treat it as
  // 'first_time' and give a straightforward starting target rather than
  // fabricating a trend from a single number.
  const previousEntry = history[1] ? history[1].entries.find(e => e.exerciseId === exerciseId) : null;
  const previousTopSet = previousEntry ? getTopSet(previousEntry.sets) : null;
  const targetRepsTop = style.repRange[1];
  const classification = classifyPerformance(topSet, previousTopSet, targetRepsTop);

  let result;
  switch (classification) {
    case 'first_time': {
      // Only one data point exists — nothing to compare trend against yet.
      // Suggest repeating the same weight/reps and building a second data point.
      // Sets: hold at whatever was actually logged last time, since there's
      // no trend yet to justify adding more.
      result = {
        status: 'hold',
        message: `You've logged this once before (${topSet.weight ?? '—'}kg × ${topSet.reps ?? '—'}). Repeat it or nudge up slightly if it felt easy — we'll have a real trend after this session.`,
        suggestedWeight: topSet.weight,
        suggestedReps: topSet.reps ?? style.repRange[1],
        suggestedSets: suggestSetCount(lastEntry.sets, style, 'first_time'),
      };
      break;
    }
    case 'met_or_exceeded': {
      if (style.progressionBias === 'weight') {
        const newWeight = roundToStep(topSet.weight * (1 + style.weightStepPct));
        result = {
          status: 'progress',
          message: `Last time you hit ${topSet.weight}kg × ${topSet.reps}. Try ${newWeight}kg for ${style.repRange[0]}-${style.repRange[1]} reps.`,
          suggestedWeight: newWeight,
          suggestedReps: `${style.repRange[0]}-${style.repRange[1]}`,
          suggestedSets: suggestSetCount(lastEntry.sets, style, classification),
        };
      } else if (style.progressionBias === 'reps') {
        const newReps = Math.min(topSet.reps + 1, style.repRange[1] + 3);
        result = {
          status: 'progress',
          message: `Last time you hit ${topSet.weight}kg × ${topSet.reps}. Same weight, aim for ${newReps} reps this time.`,
          suggestedWeight: topSet.weight,
          suggestedReps: newReps,
          suggestedSets: suggestSetCount(lastEntry.sets, style, classification),
        };
      } else {
        // mixed: alternate — if already at top of rep range, bump weight; else add a rep
        if (topSet.reps >= style.repRange[1]) {
          const newWeight = roundToStep(topSet.weight * (1 + style.weightStepPct));
          result = {
            status: 'progress',
            message: `You're at the top of your rep range (${topSet.reps}). Bump weight to ${newWeight}kg and reset toward ${style.repRange[0]} reps.`,
            suggestedWeight: newWeight,
            suggestedReps: `${style.repRange[0]}-${style.repRange[1] - 1}`,
            suggestedSets: suggestSetCount(lastEntry.sets, style, classification),
          };
        } else {
          const newReps = topSet.reps + 1;
          result = {
            status: 'progress',
            message: `Solid session. Same weight (${topSet.weight}kg), aim for ${newReps} reps.`,
            suggestedWeight: topSet.weight,
            suggestedReps: newReps,
            suggestedSets: suggestSetCount(lastEntry.sets, style, classification),
          };
        }
      }
      break;
    }
    case 'missed_slightly':
      result = {
        status: 'hold',
        message: `You were 1-2 reps under target last time. Repeat ${topSet.weight}kg and aim to hit ${style.repRange[1]} reps.`,
        suggestedWeight: topSet.weight,
        suggestedReps: style.repRange[1],
        suggestedSets: suggestSetCount(lastEntry.sets, style, classification),
      };
      break;
    case 'missed_significantly':
    default: {
      const deload = roundToStep(topSet.weight * 0.9);
      result = {
        status: 'deload',
        message: `Last session dropped off noticeably. Deload to ${deload}kg (or take an extra rest day) and rebuild from there.`,
        suggestedWeight: deload,
        suggestedReps: `${style.repRange[0]}-${style.repRange[1]}`,
        // On a deload, don't add sets even if within range — hold or ease down.
        suggestedSets: Math.min(suggestSetCount(lastEntry.sets, style, classification), (lastEntry.sets || []).filter(s => !s.isWarmup && (s.weight != null || s.reps != null)).length || style.setRange[0]),
      };
      break;
    }
  }

  result.previousTopSet = topSet;
  result.classification = classification;
  return result;
}

/**
 * Post-workout: compare the just-finished session's top set for an exercise
 * against the one immediately prior to it (the session before this one).
 */
function evaluateCompletedSet(exerciseId, currentTopSet) {
  const last = Storage.getLastSessionForExercise(exerciseId);
  if (!last) return { classification: 'first_time', previousTopSet: null };
  const previousTop = getTopSet(last.entry.sets);
  const classification = classifyPerformance(currentTopSet, previousTop, null);
  return { classification, previousTopSet: previousTop };
}

function roundToStep(weight) {
  // Round to nearest 0.5 for realistic plate loading
  return Math.round(weight * 2) / 2;
}

/**
 * How many sets to suggest next time. We anchor on what the lifter actually
 * logged last session (working sets, warmups excluded) rather than always
 * defaulting to the style's max — someone who did 2 sets shouldn't be told
 * to jump to 4 just because their training style allows up to 4. We only
 * nudge the count toward the style's range, and only by one set at a time,
 * so progression stays gradual and grounded in real behavior.
 */
function suggestSetCount(lastEntrySets, style, classification) {
  const workingSets = (lastEntrySets || []).filter(s => !s.isWarmup && (s.weight != null || s.reps != null));
  const loggedCount = workingSets.length;
  if (loggedCount === 0) return style.setRange[1];

  const [minSets, maxSets] = style.setRange;

  // Below the style's range: only add a set if the lifter is actually
  // progressing (met_or_exceeded). Otherwise hold at what they did.
  if (loggedCount < minSets) {
    return classification === 'met_or_exceeded' ? loggedCount + 1 : loggedCount;
  }
  // Within range already: stay put.
  if (loggedCount <= maxSets) {
    return loggedCount;
  }
  // Somehow above the style's max (e.g. style changed): ease back down.
  return maxSets;
}

// Equipment type changes how overload should actually happen. A barbell
// lift, a light dumbbell isolation move, and a bodyweight-plus-load
// exercise (dips, weighted pull-ups) all progress differently — jumping
// straight to "less reps, more weight" makes sense for a compound barbell
// lift, but is often the wrong call (or unsafe) for a small stabilizer
// exercise like lateral raises, where reps-first, small-increment
// progression is usually the safer default.
const EQUIPMENT_GUIDANCE = {
  'Barbell': 'Compound barbell lift — weight jumps of the given step % are standard and safe.',
  'Dumbbells': 'Dumbbell exercise — weight is quantized to whatever increments the dumbbells come in (often 1-2.5kg jumps), and small isolation movements (e.g. lateral raises, curls) should generally progress via reps first before adding weight, since even small weight jumps can be a large relative increase.',
  'Weighted Calisthenics': 'Bodyweight-plus-added-load movement (e.g. pull-ups, dips). Progression usually means adding reps at bodyweight first, then adding small external load (belt/vest) only once the upper rep target is comfortably met — do not treat this like a barbell lift.',
  'Bodyweight': 'Pure bodyweight movement — no external load. Progression is via reps, tempo, or a harder variation/lever, not weight.',
  'Cable Machine': 'Cable/machine exercise — weight is limited to the stack\'s fixed increments.',
  'Machine': 'Machine exercise — weight is limited to the stack\'s fixed increments.',
};

function getEquipmentGuidance(exerciseEquipment) {
  return EQUIPMENT_GUIDANCE[exerciseEquipment] || 'Equipment type not specified — use general judgment.';
}

function getRecentHistoryText(exerciseId) {
  return Storage.getSessions()
    .filter(s => s.entries.some(e => e.exerciseId === exerciseId))
    .sort((a, b) => b.date - a.date)
    .slice(0, 5)
    .map(s => {
      const entry = s.entries.find(e => e.exerciseId === exerciseId);
      const top = getTopSet(entry.sets);
      const base = top ? `${new Date(s.date).toLocaleDateString()}: ${top.weight ?? '?'}kg x ${top.reps ?? '?'}` : null;
      if (!base) return null;
      return entry.notes ? `${base} (note: ${entry.notes})` : base;
    })
    .filter(Boolean)
    .join('\n');
}

const OVERLOAD_SYSTEM_INSTRUCTION = `You are a strength coach reviewing recent lift history to suggest the next session's target.
A deterministic rules engine has already produced a baseline suggestion from the most recent session alone for each exercise. You have more history than it does — use the fuller trend (e.g. plateaus, repeated misses, steady gains) to confirm or adjust that baseline.
Each exercise's equipment type is given and matters: how overload should happen (weight vs. reps vs. added load) differs a lot between a barbell compound lift, a light dumbbell isolation movement, a bodyweight-plus-load exercise, and a machine/cable exercise. Tailor each suggestion to its specific exercise, not a generic "add weight, lower reps" template — treat every exercise independently, don't let one exercise's history or equipment type influence another's suggestion.
Each baseline's set count reflects what the lifter actually logged last session, not a generic default. Only suggest more sets than that if the trend clearly supports it (e.g. consistent met_or_exceeded across sessions) — do not pad the set count up just because a training style allows more.
Never suggest anything unsafe (no large jumps, no ignoring repeated regressions). If you agree with a baseline, say so.
Return ONLY valid JSON, no prose, no markdown fences.`;

/**
 * AI-assisted overload suggestion. The rules engine above remains the
 * source of truth; this asks Gemini to review the same history and either
 * confirm the rules suggestion or propose an adjustment with reasoning
 * (e.g. accounting for a plateau over several sessions, not just the last
 * one). Always labeled as an AI suggestion in the UI — never silently
 * replaces suggestNextTarget's output.
 */
async function suggestNextTargetAI({ exerciseId, exerciseName, exerciseEquipment, exerciseCues, styleKey, profile }) {
  if (!window.AIProvider || !AIProvider.hasAnyKey()) {
    return { ok: false, error: 'missing_key' };
  }

  const rulesResult = suggestNextTarget({ exerciseId, styleKey });
  const style = getStyleConfig(styleKey);
  const equipmentGuidance = getEquipmentGuidance(exerciseEquipment);
  const history = getRecentHistoryText(exerciseId);

  const systemInstruction = `You are a strength coach reviewing recent lift history to suggest the next session's target.
A deterministic rules engine has already produced a baseline suggestion from the most recent session alone. You have more history than it does — use the fuller trend (e.g. plateaus, repeated misses, steady gains) to confirm or adjust that baseline.
The exercise's equipment type is given below and matters: how overload should happen (weight vs. reps vs. added load) differs a lot between a barbell compound lift, a light dumbbell isolation movement, a bodyweight-plus-load exercise, and a machine/cable exercise. Tailor your suggestion to the specific exercise, not a generic "add weight, lower reps" template.
The baseline's set count reflects what the lifter actually logged last session, not a generic default. Only suggest more sets than that if the trend clearly supports it (e.g. consistent met_or_exceeded across sessions) — do not pad the set count up just because a training style allows more.
Never suggest anything unsafe (no large jumps, no ignoring repeated regressions). If you agree with the baseline, say so.
Return ONLY valid JSON, no prose, no markdown fences.`;

  const prompt = `Exercise: ${exerciseName}
Equipment: ${exerciseEquipment || 'unknown'} — ${equipmentGuidance}
${exerciseCues ? `Form cues: ${exerciseCues}\n` : ''}Training style: ${style.label} (rep range ${style.repRange[0]}-${style.repRange[1]})
Goal: ${profile.goal}, experience: ${profile.experienceLevel}

Recent history (most recent first):
${history || 'No history available.'}

Rules-engine baseline suggestion: ${rulesResult.status} — ${rulesResult.suggestedWeight !== null ? rulesResult.suggestedWeight + 'kg' : 'n/a'} x ${rulesResult.suggestedReps}, ${rulesResult.suggestedSets} sets. The set count in this baseline is anchored to how many working sets were actually logged last session, not a generic default — do not casually override it upward unless the trend clearly supports adding a set.

Return JSON in exactly this shape:
{
  "agreesWithBaseline": true or false,
  "suggestedWeight": number or null,
  "suggestedReps": "string like '8-12' or a number",
  "suggestedSets": number,
  "reasoning": "1-2 sentence explanation referencing the trend, not just the last session"
}`;

  const result = await AIProvider.callAI({ systemInstruction, prompt, jsonMode: true });
  if (!result.ok) return result;

  const data = result.data;
  if (!data || typeof data !== 'object') {
    return { ok: false, error: 'Gemini returned an unexpected suggestion shape.' };
  }

  return {
    ok: true,
    suggestion: {
      agreesWithBaseline: !!data.agreesWithBaseline,
      suggestedWeight: data.suggestedWeight ?? null,
      suggestedReps: data.suggestedReps ?? rulesResult.suggestedReps,
      suggestedSets: data.suggestedSets ?? rulesResult.suggestedSets,
      reasoning: data.reasoning || '',
      baseline: rulesResult,
    },
  };
}

/**
 * Same job as suggestNextTargetAI, but for a whole workout day at once:
 * one API call reviews every exercise instead of one call per exercise.
 * This is the main lever for staying under free-tier session/rate limits —
 * a 5-6 exercise day previously meant 5-6 sequential Gemini/OpenRouter
 * calls just to open the pre-workout review screen. Same prompt content
 * per exercise (equipment guidance, history, rules baseline) goes in, just
 * batched into one request/response instead of many, so suggestion quality
 * is unchanged — the model still reasons about each exercise's own history
 * and equipment independently, it just does all of them in one pass.
 *
 * exerciseList: [{ exerciseId, exerciseName, exerciseEquipment, exerciseCues }]
 * Returns: { ok, results: { [exerciseId]: { ok, suggestion } | { ok:false, error } } }
 */
async function suggestNextTargetsAIBatch({ exerciseList, styleKey, profile }) {
  if (!window.AIProvider || !AIProvider.hasAnyKey()) {
    return { ok: false, error: 'missing_key' };
  }
  if (!exerciseList || exerciseList.length === 0) {
    return { ok: true, results: {} };
  }

  // Single exercise: no batching benefit, just reuse the existing single-shot
  // path so behavior/prompt shape for the common case stays identical.
  if (exerciseList.length === 1) {
    const only = exerciseList[0];
    const single = await suggestNextTargetAI({ ...only, styleKey, profile });
    return { ok: true, results: { [only.exerciseId]: single } };
  }

  const style = getStyleConfig(styleKey);
  const rulesResults = {};
  const blocks = exerciseList.map((ex, i) => {
    const rulesResult = suggestNextTarget({ exerciseId: ex.exerciseId, styleKey });
    rulesResults[ex.exerciseId] = rulesResult;
    const equipmentGuidance = getEquipmentGuidance(ex.exerciseEquipment);
    const history = getRecentHistoryText(ex.exerciseId);
    return `--- Exercise ${i + 1}: "${ex.exerciseId}" (${ex.exerciseName}) ---
Equipment: ${ex.exerciseEquipment || 'unknown'} — ${equipmentGuidance}
${ex.exerciseCues ? `Form cues: ${ex.exerciseCues}\n` : ''}Recent history (most recent first):
${history || 'No history available.'}
Rules-engine baseline: ${rulesResult.status} — ${rulesResult.suggestedWeight !== null ? rulesResult.suggestedWeight + 'kg' : 'n/a'} x ${rulesResult.suggestedReps}, ${rulesResult.suggestedSets} sets. Set count is anchored to sets actually logged last session, not a generic default.`;
  }).join('\n\n');

  const prompt = `Training style: ${style.label} (rep range ${style.repRange[0]}-${style.repRange[1]})
Goal: ${profile.goal}, experience: ${profile.experienceLevel}

Review EACH of the following ${exerciseList.length} exercises independently — do not let one exercise's data influence another's suggestion:

${blocks}

Return JSON in exactly this shape, with one entry per exercise keyed by its exact id string given above:
{
  "results": {
    "<exerciseId>": {
      "agreesWithBaseline": true or false,
      "suggestedWeight": number or null,
      "suggestedReps": "string like '8-12' or a number",
      "suggestedSets": number,
      "reasoning": "1-2 sentence explanation referencing the trend, not just the last session"
    }
  }
}`;

  const result = await AIProvider.callAI({ systemInstruction: OVERLOAD_SYSTEM_INSTRUCTION, prompt, jsonMode: true });
  if (!result.ok) {
    // Batched call failed outright (quota/network/etc) — every exercise
    // reports the same failure so callers can fall back to rules-only
    // per exercise without needing separate error handling per item.
    const results = {};
    exerciseList.forEach(ex => { results[ex.exerciseId] = { ok: false, error: result.error }; });
    return { ok: false, error: result.error, results };
  }

  const data = result.data;
  const perExercise = data && typeof data === 'object' ? data.results : null;
  if (!perExercise || typeof perExercise !== 'object') {
    const results = {};
    exerciseList.forEach(ex => { results[ex.exerciseId] = { ok: false, error: 'Gemini returned an unexpected suggestion shape.' }; });
    return { ok: false, error: 'Gemini returned an unexpected suggestion shape.', results };
  }

  const results = {};
  for (const ex of exerciseList) {
    const rulesResult = rulesResults[ex.exerciseId];
    const d = perExercise[ex.exerciseId];
    if (!d || typeof d !== 'object') {
      // Model omitted this exercise from its response — degrade gracefully
      // to rules-only for just this one, rest of the batch still succeeds.
      results[ex.exerciseId] = { ok: false, error: 'No suggestion returned for this exercise.' };
      continue;
    }
    results[ex.exerciseId] = {
      ok: true,
      suggestion: {
        agreesWithBaseline: !!d.agreesWithBaseline,
        suggestedWeight: d.suggestedWeight ?? null,
        suggestedReps: d.suggestedReps ?? rulesResult.suggestedReps,
        suggestedSets: d.suggestedSets ?? rulesResult.suggestedSets,
        reasoning: d.reasoning || '',
        baseline: rulesResult,
      },
    };
  }

  return { ok: true, results };
}

window.Progression = {
  TRAINING_STYLES,
  getStyleConfig,
  getTopSet,
  classifyPerformance,
  suggestNextTarget,
  suggestNextTargetAI,
  suggestNextTargetsAIBatch,
  evaluateCompletedSet,
};
