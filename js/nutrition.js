/* ============================================================
   NUTRITION CALCULATOR
   Deterministic, rules-based, no external calls — same philosophy
   as progression.js. BMR via Mifflin-St Jeor (the current best-
   supported equation for general population estimates), scaled
   to TDEE by activity multiplier, then adjusted for the stated
   goal (cut/maintain/bulk) and split into macro targets.
   ============================================================ */

const ACTIVITY_MULTIPLIERS = {
  sedentary: { label: 'Sedentary (little or no exercise)', value: 1.2 },
  light: { label: 'Light (exercise 1-3 days/week)', value: 1.375 },
  moderate: { label: 'Moderate (exercise 3-5 days/week)', value: 1.55 },
  active: { label: 'Active (exercise 6-7 days/week)', value: 1.725 },
  very_active: { label: 'Very active (hard exercise + physical job)', value: 1.9 },
};

// Calorie adjustment relative to TDEE for each goal. Conservative, evidence-
// aligned ranges (~500 kcal deficit/surplus is a common sustainable default;
// more aggressive cuts aren't offered here on purpose since this app can't
// account for individual medical context).
const GOAL_ADJUSTMENTS = {
  cut: { label: 'Cut (lose fat)', calorieDelta: -500 },
  maintain: { label: 'Maintain', calorieDelta: 0 },
  bulk: { label: 'Bulk (gain muscle)', calorieDelta: 300 },
};

// Macro split by goal, as % of total calories. Protein is anchored to
// bodyweight directly (more accurate than a flat % across very different
// body sizes); carbs/fats fill the remainder from the %s below.
const MACRO_SPLITS = {
  cut: { proteinPerKg: 2.2, fatPct: 0.30 },
  maintain: { proteinPerKg: 1.8, fatPct: 0.30 },
  bulk: { proteinPerKg: 1.8, fatPct: 0.25 },
};

/**
 * Mifflin-St Jeor BMR:
 *   Men:   10*weight(kg) + 6.25*height(cm) - 5*age + 5
 *   Women: 10*weight(kg) + 6.25*height(cm) - 5*age - 161
 * For 'other'/unspecified sex, use the midpoint of the male/female constant
 * (a reasonable neutral default in the absence of a third validated equation).
 */
function calculateBMR({ sex, weightKg, heightCm, age }) {
  if (!weightKg || !heightCm || !age) return null;
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
  if (sex === 'male') return Math.round(base + 5);
  if (sex === 'female') return Math.round(base - 161);
  return Math.round(base - 78); // midpoint of +5 and -161
}

function calculateTDEE(bmr, activityLevel) {
  if (bmr == null) return null;
  const mult = (ACTIVITY_MULTIPLIERS[activityLevel] || ACTIVITY_MULTIPLIERS.moderate).value;
  return Math.round(bmr * mult);
}

/**
 * Full pipeline: profile -> { bmr, tdee, calorieTarget, proteinTarget, carbsTarget, fatsTarget }
 * Returns null fields (not a thrown error) if required inputs are missing —
 * callers should check for null and prompt the user to complete their profile
 * rather than getting a NaN-filled dashboard.
 */
function calculateTargets(profile) {
  const bmr = calculateBMR(profile);
  const tdee = calculateTDEE(bmr, profile.activityLevel);

  if (bmr == null || tdee == null) {
    return { bmr, tdee, calorieTarget: null, proteinTarget: null, carbsTarget: null, fatsTarget: null };
  }

  const goal = GOAL_ADJUSTMENTS[profile.nutritionGoal] ? profile.nutritionGoal : 'maintain';
  const adjustment = GOAL_ADJUSTMENTS[goal];
  const split = MACRO_SPLITS[goal];

  // Floor the calorie target so a cut on a very light/low-TDEE profile can't
  // fall to unsafely low numbers — 1200 kcal is a commonly used conservative
  // floor for general audiences; this app doesn't have the medical context
  // to safely go lower and should not pretend otherwise.
  const calorieTarget = Math.max(1200, tdee + adjustment.calorieDelta);

  const proteinTarget = Math.round((profile.weightKg || 0) * split.proteinPerKg);
  const proteinCalories = proteinTarget * 4;
  const fatCalories = calorieTarget * split.fatPct;
  const fatsTarget = Math.round(fatCalories / 9);
  const remainingCalories = Math.max(0, calorieTarget - proteinCalories - fatCalories);
  const carbsTarget = Math.round(remainingCalories / 4);

  return { bmr, tdee, calorieTarget, proteinTarget, carbsTarget, fatsTarget };
}

/**
 * Recomputes protein/carbs/fats for an explicit calorie target that didn't
 * come from calculateTargets' own formula — e.g. the user (or the weight-
 * trend suggestion below) overriding the calorie number directly. Keeps the
 * same protein-anchored-to-bodyweight, fat-percentage split so the macros
 * stay internally consistent with the new total rather than going stale.
 */
function recalculateMacrosForCalorieTarget(calorieTarget, profile) {
  const goal = GOAL_ADJUSTMENTS[profile.nutritionGoal] ? profile.nutritionGoal : 'maintain';
  const split = MACRO_SPLITS[goal];
  const proteinTarget = Math.round((profile.weightKg || 0) * split.proteinPerKg);
  const proteinCalories = proteinTarget * 4;
  const fatCalories = calorieTarget * split.fatPct;
  const fatsTarget = Math.round(fatCalories / 9);
  const remainingCalories = Math.max(0, calorieTarget - proteinCalories - fatCalories);
  const carbsTarget = Math.round(remainingCalories / 4);
  return { calorieTarget, proteinTarget, carbsTarget, fatsTarget };
}

/**
 * Recalculates targets from the current training profile (age/sex/weight/
 * height/activityLevel/goal already live there — see storage.js) and caches
 * the result in the dedicated nutrition-profile record so the dashboard
 * doesn't recompute on every render and so targets stay stable until the
 * user explicitly recalculates (e.g. after updating their weight).
 */
function recalculateAndSaveTargets() {
  const profile = Storage.getProfile();
  const targets = calculateTargets(profile);
  return Storage.saveNutritionProfile({ ...targets, lastCalculatedAt: Date.now() });
}

function hasCompleteProfileForCalc(profile) {
  return !!(profile.sex && profile.weightKg && profile.heightCm && profile.age);
}

/* ============================================================
   WEIGHT TREND -> CALORIE ADJUSTMENT
   Deterministic, same philosophy as progression.js: every number
   here is explainable in one sentence, no black box. An optional
   AI layer (coach-narration.js) can phrase this in plain language
   afterward, but it never changes the numbers computed here.

   Approach: expected weekly weight change is derived from the
   goal's calorie delta using the standard ~7700 kcal-per-kg-of-
   bodyfat estimate (a widely used approximation, not exact —
   individual metabolic adaptation, water retention, and glycogen
   swings mean this is directional guidance, not a precise
   prediction). Actual trend uses a simple linear fit over the
   recent check-ins to smooth out normal day-to-day water-weight
   noise, not a raw first-vs-last comparison.
   ============================================================ */

const KCAL_PER_KG_BODYFAT = 7700;

// Minimum data before suggesting anything — a handful of scattered
// weigh-ins isn't enough to distinguish a real trend from water-weight
// noise (bodyweight can swing 1-2kg day to day from sodium, glycogen,
// hydration, and digestion alone).
const MIN_LOGS_FOR_TREND = 4;
const MIN_SPAN_DAYS_FOR_TREND = 10;

// How far off-pace the trend has to be before flagging it, and how big a
// suggested adjustment can ever be — kept conservative on purpose. This
// only ever nudges toward the goal's own expected pace, never accelerates
// past it, and never pushes the calorie target below nutrition.js's 1200
// kcal floor (calculateTargets enforces that floor independently).
const OFF_PACE_RATIO_THRESHOLD = 1.6; // trend is >60% faster/slower than expected
const MAX_SUGGESTED_ADJUSTMENT = 200; // kcal/day, one direction, one suggestion

/**
 * Simple linear regression (least squares) of weight (kg) against days
 * elapsed since the first log in the window. Returns kg/week slope.
 * Using a fitted trend line rather than first-vs-last smooths out any
 * single unusually-high or -low weigh-in from skewing the read.
 */
function fitWeeklyTrendKg(logs) {
  const first = logs[0].date;
  const points = logs.map(l => ({
    x: (l.date - first) / (1000 * 60 * 60 * 24), // days since first log
    y: l.weightKg,
  }));
  const n = points.length;
  const sumX = points.reduce((s, p) => s + p.x, 0);
  const sumY = points.reduce((s, p) => s + p.y, 0);
  const sumXY = points.reduce((s, p) => s + p.x * p.y, 0);
  const sumXX = points.reduce((s, p) => s + p.x * p.x, 0);
  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return 0; // all logs on the same day — no trend to fit
  const slopePerDay = (n * sumXY - sumX * sumY) / denom;
  return slopePerDay * 7;
}

/**
 * Compares actual weight trend against what the current goal/calorie
 * target would predict, and proposes a bounded calorie adjustment if
 * the trend is significantly off-pace. Returns a status the UI can
 * render without needing to re-derive any of this math itself.
 */
function analyzeWeightTrend() {
  const profile = Storage.getProfile();
  const nutritionProfile = Storage.getNutritionProfile();
  const logs = Storage.getRecentWeightLogs(60);

  if (logs.length < MIN_LOGS_FOR_TREND) {
    return { status: 'insufficient_data', message: `Log your weight a few more times (${logs.length}/${MIN_LOGS_FOR_TREND}) to see a trend.` };
  }

  const spanDays = (logs[logs.length - 1].date - logs[0].date) / (1000 * 60 * 60 * 24);
  if (spanDays < MIN_SPAN_DAYS_FOR_TREND) {
    return { status: 'insufficient_data', message: `Keep logging — trends need at least ${MIN_SPAN_DAYS_FOR_TREND} days of check-ins to separate real change from normal day-to-day fluctuation.` };
  }

  if (!nutritionProfile.calorieTarget) {
    return { status: 'no_target', message: 'Set up your nutrition targets first so there\'s something to compare your trend against.' };
  }

  const goalKey = GOAL_ADJUSTMENTS[profile.nutritionGoal] ? profile.nutritionGoal : 'maintain';
  const goalDelta = GOAL_ADJUSTMENTS[goalKey].calorieDelta;
  const expectedWeeklyKg = (goalDelta * 7) / KCAL_PER_KG_BODYFAT;
  const actualWeeklyKg = fitWeeklyTrendKg(logs);

  const result = {
    status: 'ok',
    goalKey,
    expectedWeeklyKg: Math.round(expectedWeeklyKg * 100) / 100,
    actualWeeklyKg: Math.round(actualWeeklyKg * 100) / 100,
    currentCalorieTarget: nutritionProfile.calorieTarget,
    suggestedCalorieTarget: null,
    suggestedDelta: 0,
    pace: 'on_track',
  };

  if (goalKey === 'maintain') {
    // For "maintain", judge pace by absolute drift rather than a ratio
    // (dividing by an expected-zero rate is meaningless).
    if (Math.abs(actualWeeklyKg) < 0.15) return result; // within normal noise
    const direction = actualWeeklyKg > 0 ? 'gaining' : 'losing';
    const adjustment = Math.min(MAX_SUGGESTED_ADJUSTMENT, Math.round(Math.abs(actualWeeklyKg) * KCAL_PER_KG_BODYFAT / 7 / 2));
    result.pace = actualWeeklyKg > 0 ? 'faster_than_expected' : 'slower_than_expected';
    result.suggestedDelta = actualWeeklyKg > 0 ? -adjustment : adjustment;
    result.suggestedCalorieTarget = Math.max(1200, nutritionProfile.calorieTarget + result.suggestedDelta);
    result.direction = direction;
    return result;
  }

  // Cut/bulk: compare actual vs expected rate as a ratio. Guard the
  // denominator — expectedWeeklyKg is nonzero for cut/bulk by construction
  // (goalDelta is nonzero), but keep this defensive rather than assuming.
  if (expectedWeeklyKg === 0) return result;
  const ratio = actualWeeklyKg / expectedWeeklyKg;

  // Wrong direction entirely (e.g. cutting but gaining weight) is always
  // flagged regardless of ratio magnitude.
  const wrongDirection = Math.sign(actualWeeklyKg) !== 0 && Math.sign(actualWeeklyKg) !== Math.sign(expectedWeeklyKg);

  if (!wrongDirection && ratio >= 1 / OFF_PACE_RATIO_THRESHOLD && ratio <= OFF_PACE_RATIO_THRESHOLD) {
    return result; // within a reasonable band of the expected pace
  }

  const tooFast = wrongDirection ? false : ratio > OFF_PACE_RATIO_THRESHOLD;
  result.pace = wrongDirection ? 'wrong_direction' : (tooFast ? 'faster_than_expected' : 'slower_than_expected');

  // Move the target a modest, capped step back toward the goal's own
  // expected pace — never overshoot past what the goal itself called for.
  const adjustment = Math.min(MAX_SUGGESTED_ADJUSTMENT, Math.abs(goalDelta) * 0.3);
  // Losing/gaining too fast -> ease the deficit/surplus (move target toward maintenance).
  // Losing/gaining too slow, or wrong direction -> widen the deficit/surplus slightly.
  const easingDirection = goalKey === 'cut' ? 1 : -1; // cut: add calories to ease; bulk: subtract to ease
  result.suggestedDelta = Math.round((tooFast ? easingDirection : -easingDirection) * adjustment);
  result.suggestedCalorieTarget = Math.max(1200, nutritionProfile.calorieTarget + result.suggestedDelta);

  return result;
}

window.Nutrition = {
  ACTIVITY_MULTIPLIERS,
  GOAL_ADJUSTMENTS,
  MACRO_SPLITS,
  calculateBMR,
  calculateTDEE,
  calculateTargets,
  recalculateAndSaveTargets,
  recalculateMacrosForCalorieTarget,
  hasCompleteProfileForCalc,
  analyzeWeightTrend,
};
