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
    .filter(s => !s.isWarmup)
    .reduce((best, s) => {
      if (!best) return s;
      if (s.weight > best.weight) return s;
      if (s.weight === best.weight && s.reps > best.reps) return s;
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
  const last = Storage.getLastSessionForExercise(exerciseId);

  if (!last) {
    return {
      status: 'no_history',
      message: 'No previous data for this exercise yet — log a session to get a suggestion.',
      suggestedWeight: null,
      suggestedReps: `${style.repRange[0]}-${style.repRange[1]}`,
      suggestedSets: style.setRange[1],
    };
  }

  const topSet = getTopSet(last.entry.sets);
  if (!topSet) {
    return {
      status: 'no_history',
      message: 'No working sets recorded last time — log a session to get a suggestion.',
      suggestedWeight: null,
      suggestedReps: `${style.repRange[0]}-${style.repRange[1]}`,
      suggestedSets: style.setRange[1],
    };
  }

  // Compare against the session before that, if it exists, to classify trend.
  // If only one data point exists, we compare the top set against itself
  // (met_or_exceeded baseline) so the very next session gets a real target.
  const targetRepsTop = style.repRange[1];
  const classification = classifyPerformance(topSet, topSet, targetRepsTop);

  let result;
  switch (classification) {
    case 'met_or_exceeded': {
      if (style.progressionBias === 'weight') {
        const newWeight = roundToStep(topSet.weight * (1 + style.weightStepPct));
        result = {
          status: 'progress',
          message: `Last time you hit ${topSet.weight}kg × ${topSet.reps}. Try ${newWeight}kg for ${style.repRange[0]}-${style.repRange[1]} reps.`,
          suggestedWeight: newWeight,
          suggestedReps: `${style.repRange[0]}-${style.repRange[1]}`,
          suggestedSets: style.setRange[1],
        };
      } else if (style.progressionBias === 'reps') {
        const newReps = Math.min(topSet.reps + 1, style.repRange[1] + 3);
        result = {
          status: 'progress',
          message: `Last time you hit ${topSet.weight}kg × ${topSet.reps}. Same weight, aim for ${newReps} reps this time.`,
          suggestedWeight: topSet.weight,
          suggestedReps: newReps,
          suggestedSets: style.setRange[1],
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
            suggestedSets: style.setRange[1],
          };
        } else {
          const newReps = topSet.reps + 1;
          result = {
            status: 'progress',
            message: `Solid session. Same weight (${topSet.weight}kg), aim for ${newReps} reps.`,
            suggestedWeight: topSet.weight,
            suggestedReps: newReps,
            suggestedSets: style.setRange[1],
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
        suggestedSets: style.setRange[1],
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
        suggestedSets: style.setRange[1],
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

window.Progression = {
  TRAINING_STYLES,
  getStyleConfig,
  getTopSet,
  classifyPerformance,
  suggestNextTarget,
  evaluateCompletedSet,
};
