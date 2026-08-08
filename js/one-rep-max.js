/* ============================================================
   ONE-REP MAX ENGINE
   Two jobs, both pure and deterministic (same philosophy as
   progression.js — no black boxes, every number traceable to a
   named, published formula or a standard percentage-based
   warm-up protocol):

   1. Estimate a 1RM from a submaximal set (weight x reps) using
      multiple peer-reviewed regression formulas, cross-checked
      against each other so a single outlier formula can't skew
      the estimate.
   2. Build a "PR Day" warm-up ramp + attempt scheme for actually
      testing a real 1RM safely, using the percentage-based ramp
      structure that's standard in strength & conditioning
      coaching (used in powerlifting meet-day prep and NSCA/USAW
      guidance): a handful of increasing-weight, decreasing-rep
      warm-up sets building to a single-rep opener, then 2-3
      graded max attempts with full recovery between them.

   ------------------------------------------------------------
   ACCURACY NOTES (surfaced in the UI, not just here):
   - Sub-max 1RM formulas are estimates, not measurements. Their
     published error margin is roughly +/-5-10% even under good
     conditions, and error grows fast as rep count rises — they
     are only validated up to about 10 reps, and are noticeably
     LESS accurate above ~10 reps because fatigue (not just load)
     starts dominating the reps-to-failure relationship.
     (Reference: LeSuer et al. 1997, J Strength Cond Res — cross-
     validated Epley/Brzycki/Lombardi/etc. against measured 1RMs.)
   - No formula "wins" universally across lifts or lifters, which
     is why this returns an average across several formulas plus
     a min-max range, instead of one falsely-precise number.
   - The only way to know a true 1RM is to actually test it, which
     is what the PR Day planner is for.
   ============================================================ */

/* ---------------- 1RM estimation formulas ----------------
   Each takes (weight, reps) and returns an estimated 1RM in the
   same weight unit that was passed in. All published against
   reps roughly 1-10; each source is a real, citable formula. */
const OneRMFormulas = {
  // Epley (1985) — most commonly used in US strength coaching.
  epley: (weight, reps) => weight * (1 + reps / 30),

  // Brzycki (1993) — very close to Epley for reps <= 6, tends to
  // read slightly more conservative as reps climb.
  brzycki: (weight, reps) => weight * (36 / (37 - reps)),

  // Lombardi (1989) — power-law form, tends to sit a bit lower
  // than Epley/Brzycki at higher rep counts.
  lombardi: (weight, reps) => weight * Math.pow(reps, 0.10),

  // Mayhew et al. (1992) — derived from bench press data specifically,
  // included because it was cross-validated against measured 1RMs
  // in a controlled study rather than a formula-only derivation.
  mayhew: (weight, reps) => (100 * weight) / (52.2 + 41.9 * Math.exp(-0.055 * reps)),

  // Wathan (1994) — similar exponential-decay form to Mayhew, another
  // independently-derived cross-check.
  wathan: (weight, reps) => (100 * weight) / (48.8 + 53.8 * Math.exp(-0.075 * reps)),
};

const FORMULA_LABELS = {
  epley: 'Epley',
  brzycki: 'Brzycki',
  lombardi: 'Lombardi',
  mayhew: 'Mayhew',
  wathan: 'Wathan',
};

// Above this rep count, formula error grows enough that we flag it
// clearly rather than silently returning a number people might trust
// at face value. Backed by LeSuer et al. 1997 finding error increasing
// materially past ~10 reps.
const RELIABLE_REP_CEILING = 10;
// Below 1 or above this, the input just isn't a valid submax set.
const ABSOLUTE_REP_CEILING = 15;

/**
 * Estimate 1RM from a single submaximal set.
 * @param {number} weight - weight lifted, any unit (kg or lb) - output is same unit.
 * @param {number} reps - reps completed to failure (or very near failure) on that weight.
 * @returns {object} { ok, estimate, low, high, byFormula, confidence, warning }
 */
function estimateOneRepMax(weight, reps) {
  if (!weight || weight <= 0 || !reps || reps < 1) {
    return { ok: false, error: 'Enter a weight and a rep count of at least 1.' };
  }
  if (reps > ABSOLUTE_REP_CEILING) {
    return {
      ok: false,
      error: `Formulas aren't meaningful above ${ABSOLUTE_REP_CEILING} reps — that's an endurance set, not a strength one. Use a heavier weight for fewer reps to estimate a 1RM.`,
    };
  }

  // Single-rep set: that IS the 1RM (assuming true failure/max effort),
  // no formula needed or appropriate.
  if (reps === 1) {
    return {
      ok: true,
      estimate: Math.round(weight * 10) / 10,
      low: Math.round(weight * 10) / 10,
      high: Math.round(weight * 10) / 10,
      byFormula: { actual: weight },
      confidence: 'measured',
      reps,
      weight,
      warning: null,
    };
  }

  const byFormula = {};
  Object.keys(OneRMFormulas).forEach(key => {
    byFormula[key] = Math.round(OneRMFormulas[key](weight, reps) * 10) / 10;
  });

  const values = Object.values(byFormula);
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  const low = Math.min(...values);
  const high = Math.max(...values);

  let confidence = 'high';
  let warning = null;
  if (reps > RELIABLE_REP_CEILING) {
    confidence = 'low';
    warning = `Estimated from ${reps} reps — accuracy drops off past ${RELIABLE_REP_CEILING} reps since fatigue starts to matter more than raw strength. Treat this as a rough ballpark, not a number to load on the bar.`;
  } else if (reps > 6) {
    confidence = 'medium';
    warning = `Estimated from ${reps} reps. Estimates from lower rep sets (1-5) are more reliable — if you want a tighter number, retest closer to failure at a heavier weight and lower rep count.`;
  }

  return {
    ok: true,
    estimate: Math.round(avg * 10) / 10,
    low: Math.round(low * 10) / 10,
    high: Math.round(high * 10) / 10,
    byFormula,
    confidence, // 'high' | 'medium' | 'low' | 'measured'
    reps,
    weight,
    warning,
  };
}

/* ---------------- PR Day planner ----------------
   Standard percentage-based ramp used across powerlifting meet
   prep and S&C coaching (e.g. USAPL/USAW-style warm-up structure,
   also taught in NSCA guidance): climb in weight while dropping
   reps as you approach the working max, so nervous system and
   joints are primed without accumulating fatigue that would blunt
   the actual attempt. Numbers below are rounded to realistic
   plate-loadable jumps, not raw percentages, since a warm-up
   scheme nobody can actually load is useless. */

const WARMUP_RAMP = [
  { pct: 0.40, reps: 8, label: 'Bar-speed warm-up', restSec: 60 },
  { pct: 0.55, reps: 5, label: 'Warm-up', restSec: 90 },
  { pct: 0.70, reps: 3, label: 'Warm-up', restSec: 120 },
  { pct: 0.80, reps: 2, label: 'Warm-up', restSec: 150 },
  { pct: 0.90, reps: 1, label: 'Opener (last warm-up single)', restSec: 180 },
];

// Attempts climb from the estimated max toward a realistic PR jump.
// 3-attempt structure mirrors a powerlifting-meet attempt scheme:
// opener slightly under/at estimated max, 2nd a small confident jump,
// 3rd a real stretch attempt only if the 2nd moved well.
const ATTEMPT_RAMP = [
  { pct: 1.00, label: 'Attempt 1 — at your current estimated max', restSec: 240 },
  { pct: 1.03, label: 'Attempt 2 — only if Attempt 1 felt clean', restSec: 300 },
  { pct: 1.06, label: 'Attempt 3 — only if Attempt 2 moved well, real PR territory', restSec: 300 },
];

// Rounds to the nearest practical loading increment. Barbell lifts
// round to 2.5kg/5lb plate jumps; bodyweight-loaded and machine/cable
// lifts round to 1kg/2lb since micro-adjustments matter more there.
function roundToLoadable(weight, unit, equipment) {
  const barbellLike = /barbell/i.test(equipment || '');
  const step = unit === 'lb'
    ? (barbellLike ? 5 : 2.5)
    : (barbellLike ? 2.5 : 1);
  return Math.round(weight / step) * step;
}

/**
 * Build a full PR Day plan for one exercise.
 * @param {object} opts
 *   estimatedMax {number} - best current estimate of 1RM (from estimateOneRepMax,
 *                            a prior true 1RM, or the user's manual entry).
 *   unit {string} - 'kg' | 'lb', display/rounding only.
 *   equipment {string} - exercise.equipment, used for plate-rounding granularity.
 *   experienceLevel {string} - 'beginner' | 'intermediate' | 'advanced', adjusts
 *                            safety copy (beginners get a stronger caution against
 *                            testing true 1RMs at all).
 */
function buildPRDayPlan({ estimatedMax, unit = 'kg', equipment = '', experienceLevel = 'beginner' }) {
  if (!estimatedMax || estimatedMax <= 0) {
    return { ok: false, error: 'Need a current estimated max (or recent heavy set) to build a warm-up ramp from.' };
  }

  const warmups = WARMUP_RAMP.map(step => ({
    label: step.label,
    weight: roundToLoadable(estimatedMax * step.pct, unit, equipment),
    reps: step.reps,
    restSec: step.restSec,
    pctOfMax: step.pct,
  }));

  const attempts = ATTEMPT_RAMP.map(step => ({
    label: step.label,
    weight: roundToLoadable(estimatedMax * step.pct, unit, equipment),
    reps: 1,
    restSec: step.restSec,
    pctOfMax: step.pct,
  }));

  return {
    ok: true,
    estimatedMax,
    unit,
    warmups,
    attempts,
    totalRestMinutesApprox: Math.round(
      ([...WARMUP_RAMP, ...ATTEMPT_RAMP].reduce((sum, s) => sum + s.restSec, 0)) / 60
    ),
    experienceLevel,
  };
}

// General safety checklist, always shown — not exercise-specific,
// these are the standard precautions any coaching resource gives for
// true maximal-effort attempts (spotter/rack safety, warm-up
// thoroughness, technique-over-ego, stopping rules).
const PR_DAY_SAFETY_CHECKLIST = [
  'Use a spotter for barbell bench press, or safety bars/pins set just below your rack-out depth for squat — a failed rep with no bailout is the single biggest risk on PR day.',
  'Never max out on an exercise you\'re still learning the technique for. Bar speed and form should already be consistent and controlled at heavy weights (RPE 8-9) before testing a true 1-rep max.',
  'Do the full warm-up ramp even if it feels slow — skipping steps to "save energy" is the most common way lifters miss a lift they were strong enough to hit.',
  'If a warm-up set feels heavier or more effortful than it should for that weight, stop the ramp and reassess (sleep, stress, and food all shift what you can safely attempt) rather than pushing through to the planned max.',
  'Stop after any attempt where form breaks down noticeably (bar path shifts, joints buckle, you grind out of position) — that is the body\'s stopping signal, regardless of what the plan says comes next.',
  'Rest the full interval between attempts. True near-max singles need 3-5 minutes of recovery for the nervous system, not just the muscles — rushing this is a common reason a good lifter misses attempt 2 or 3.',
  'Log the actual weight and how it felt afterward — that becomes next time\'s more accurate estimated max, whether or not you hit the number you were chasing.',
];

const BEGINNER_EXTRA_CAUTION =
  'You\'re early in training, where technique is still stabilizing under load. Most coaches recommend working up to a confident, clean-form triple or double (3-5 reps at RPE 9) instead of a true 1-rep max — you\'ll get a very close estimate with a lot less joint stress, and an actual max test can wait until your form is rock-solid under near-max weight.';

function getPRDaySafetyChecklist(experienceLevel) {
  const list = [...PR_DAY_SAFETY_CHECKLIST];
  if (experienceLevel === 'beginner') list.unshift(BEGINNER_EXTRA_CAUTION);
  return list;
}

/* ---------------- Cross-exercise strength translation ----------------
   IMPORTANT DISTINCTION FROM THE CALCULATOR ABOVE: everything above this
   point predicts a 1RM on the SAME exercise from submax reps on that same
   exercise — that's a within-lift fatigue relationship, and it's been
   directly validated against measured 1RMs (LeSuer et al. 1997).

   This section instead estimates one exercise's 1RM FROM a different
   exercise's 1RM (e.g. "my dips 1RM is X, so my bench press might be
   around Y"). That is a fundamentally different, much weaker claim:
   there is no validated regression equation for this in the literature.
   What exists is a set of population-average bodyweight-multiple
   "strength standards" and lift-to-lift ratio ranges used informally in
   strength coaching (the Rippetoe/Kilgore standards tradition, and
   crowd-sourced databases like Symmetric Strength / Strength Level).
   These ranges vary by source (e.g. OHP is commonly cited as 55-75% of
   bench depending on the source), and individual results depend heavily
   on limb length, technique specialization, and training history in a
   way that dwarfs the formula error above. This is a ballpark starting
   point for programming a first attempt at a lift you haven't tested —
   NOT a substitute for actually testing it, and it is deliberately kept
   separate from (and captioned differently than) the same-exercise
   calculator above so the two aren't mistaken for equally rigorous. */

// Ratio of column-exercise 1RM to BENCH PRESS 1RM (bench = 1.0 anchor),
// midpoints of commonly-cited coaching ranges. Bench chosen as the anchor
// since it's the most universally tested lift and dips (a common ask)
// relate most directly to it.
const STRENGTH_RATIO_TO_BENCH = {
  'bench press': 1.00,
  'incline bench press': 0.82,
  'close-grip bench press': 0.90,
  'dumbbell bench press': 0.80, // dumbbells run lower than barbell due to stability demand
  'overhead press': 0.65,
  'dumbbell shoulder press': 0.55,
  'weighted dip': 1.15,         // dips commonly run ~10-20% over bench per coaching refs
  'push-up': null,              // bodyweight-only movement, not a loaded 1RM comparison
  'barbell row': 0.90,
  'pull-up': 0.95,              // as a weighted-pull-up-style total load comparison
  'squat': 1.35,
  'front squat': 1.15,
  'deadlift': 1.60,
  'romanian deadlift': 1.30,
};

// Maps exercise-library names (and common synonyms) to the ratio table's
// canonical keys above — the seed library's naming doesn't always match
// the coaching-standard naming 1:1 (e.g. "Barbell Bench Press" vs "bench press").
const EXERCISE_NAME_TO_RATIO_KEY = {
  'barbell bench press': 'bench press',
  'bench press': 'bench press',
  'incline dumbbell press': 'incline bench press',
  'close-grip bench press': 'close-grip bench press',
  'dumbbell bench press': 'dumbbell bench press',
  'overhead press': 'overhead press',
  'dumbbell shoulder press': 'dumbbell shoulder press',
  'dips': 'weighted dip',
  'weighted dip': 'weighted dip',
  'barbell row': 'barbell row',
  'dumbbell row': 'barbell row',
  'seated cable row': 'barbell row',
  'pull-up': 'pull-up',
  'lat pulldown': 'pull-up',
  'barbell back squat': 'squat',
  'front squat': 'front squat',
  'bodyweight squat': 'squat',
  'deadlift': 'deadlift',
  'romanian deadlift': 'romanian deadlift',
};

function normalizeExerciseNameForRatio(name) {
  return (name || '').trim().toLowerCase();
}

// Looks up the ratio key for a free-typed or library exercise name, or null
// if we don't have coaching-standard data for it (better to say "don't know"
// than fabricate a number for an exercise with no real reference point).
function getRatioKeyForExerciseName(name) {
  const normalized = normalizeExerciseNameForRatio(name);
  return EXERCISE_NAME_TO_RATIO_KEY[normalized] || (STRENGTH_RATIO_TO_BENCH[normalized] !== undefined ? normalized : null);
}

function getSupportedRatioExerciseNames() {
  return Object.keys(STRENGTH_RATIO_TO_BENCH).filter(k => STRENGTH_RATIO_TO_BENCH[k] !== null);
}

/**
 * Translate a known/estimated 1RM on one exercise to a ballpark 1RM on a
 * different exercise, via each lift's population-average ratio to bench
 * press. Returns a wide range, not a point estimate — this is explicitly
 * lower-confidence than the same-exercise calculator above.
 *
 * @param {number} sourceMax - 1RM (or good estimate) on the known exercise, any unit.
 * @param {string} sourceExerciseName - name of the known exercise (library name or free text).
 * @param {string} targetExerciseName - name of the exercise to estimate.
 */
function translateOneRepMax(sourceMax, sourceExerciseName, targetExerciseName) {
  if (!sourceMax || sourceMax <= 0) {
    return { ok: false, error: 'Enter a known or estimated 1RM to translate from.' };
  }

  const sourceKey = getRatioKeyForExerciseName(sourceExerciseName);
  const targetKey = getRatioKeyForExerciseName(targetExerciseName);

  if (!sourceKey || STRENGTH_RATIO_TO_BENCH[sourceKey] == null) {
    return { ok: false, error: `We don't have a reliable strength-ratio reference for "${sourceExerciseName}" yet. This works best for common barbell/dumbbell compound lifts (bench, squat, deadlift, OHP, rows, weighted dips/pull-ups).` };
  }
  if (!targetKey || STRENGTH_RATIO_TO_BENCH[targetKey] == null) {
    return { ok: false, error: `We don't have a reliable strength-ratio reference for "${targetExerciseName}" yet. This works best for common barbell/dumbbell compound lifts (bench, squat, deadlift, OHP, rows, weighted dips/pull-ups).` };
  }
  if (sourceKey === targetKey) {
    return { ok: false, error: 'Source and target are the same lift — use the Calculator tab instead for a same-exercise estimate.' };
  }

  // Convert source -> bench-equivalent -> target, via each lift's ratio to bench.
  const benchEquivalent = sourceMax / STRENGTH_RATIO_TO_BENCH[sourceKey];
  const pointEstimate = benchEquivalent * STRENGTH_RATIO_TO_BENCH[targetKey];

  // Wide +/-15% band on top of the ratio itself — population ratios in the
  // sources reviewed varied by roughly that much lift-to-lift (e.g. OHP
  // commonly cited anywhere from 55-75% of bench), and individual leverage/
  // technique can push someone further outside that band in either direction.
  const low = Math.round(pointEstimate * 0.85 * 10) / 10;
  const high = Math.round(pointEstimate * 1.15 * 10) / 10;

  return {
    ok: true,
    estimate: Math.round(pointEstimate * 10) / 10,
    low,
    high,
    sourceExercise: sourceExerciseName,
    targetExercise: targetExerciseName,
    warning: `This is a population-average ballpark, not a validated prediction — unlike the same-exercise calculator, there's no direct research linking these two lifts. Individual results vary a lot with limb length, technique, and which lift you've trained more. Treat this as a rough starting point to program a first attempt, then test the real thing.`,
  };
}

window.OneRepMax = {
  estimateOneRepMax,
  buildPRDayPlan,
  getPRDaySafetyChecklist,
  translateOneRepMax,
  getSupportedRatioExerciseNames,
  getRatioKeyForExerciseName,
  FORMULA_LABELS,
  RELIABLE_REP_CEILING,
  roundToLoadable,
};
