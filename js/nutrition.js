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

/* ------------------------------------------------------------
   GOAL INTENT -> nutritionGoal mapping
   The goal-setup wizard asks in the user's own words ("get abs",
   "lose fat", "bulk up"...) rather than the cut/maintain/bulk
   vocabulary the rest of the app uses internally. This map is the
   single place that translates intent -> nutritionGoal, so the
   wizard's copy can stay friendly without introducing a second,
   drifting goal enum elsewhere in the app. "Abs" and "lose_fat"
   both resolve to 'cut' mechanically — they differ only in the
   guidance copy shown to the user, not in the underlying math.
   ------------------------------------------------------------ */
const GOAL_INTENTS = {
  lose_fat: { label: 'Lose fat', nutritionGoal: 'cut', blurb: 'a steady calorie deficit while keeping protein high to protect muscle' },
  get_abs: { label: 'Get abs / lean out', nutritionGoal: 'cut', blurb: 'a calorie deficit — abs come from fat loss, not ab exercises, so the target is the same as fat loss with a bit more patience' },
  build_muscle: { label: 'Build muscle / bulk', nutritionGoal: 'bulk', blurb: 'a modest calorie surplus paired with progressive resistance training' },
  recomposition: { label: 'Recomposition (lose fat + build muscle)', nutritionGoal: 'maintain', blurb: 'calories near maintenance with a protein and training focus — this is the slowest way to change body composition, but it avoids the tradeoffs of a hard cut or bulk' },
  maintain_weight: { label: 'Maintain current weight', nutritionGoal: 'maintain', blurb: 'calories matched to your TDEE' },
};

/* ------------------------------------------------------------
   SUGGESTED GOAL WEIGHT
   Every method below is a named, cited estimation approach, not
   a guess — but all of them are population-level heuristics, not
   individual prescriptions, and the wizard UI must say so. This
   app has no way to measure actual body composition (DEXA, BIA,
   calipers), so anything derived from bodyweight/height alone
   is an approximation with real error bars, especially for
   muscular or very tall/short individuals.

   - BMI method (lose_fat / recomposition / maintain_weight):
     WHO/CDC define healthy BMI as 18.5-24.9 kg/m^2. This is the
     most broadly validated general-population weight-range
     reference available without body-composition data. We
     suggest the midpoint of the healthy range for this height.

   - Body-fat-percentage method (get_abs): "visible abs" doesn't
     correspond to a weight, it corresponds to an estimated body
     fat percentage — commonly cited ranges (ACE body fat
     categories) put visible abdominal definition around 10-14%
     BF for men and roughly 18-22% for women. We convert a target
     BF% to a goal weight using the user's current weight as the
     basis for estimated lean body mass, via LBM = weight * (1 -
     currentBF/100), goalWeight = LBM / (1 - targetBF/100). This
     requires an estimated *current* body fat input from the user
     (a rough guess is fine, and the UI should say so) since we
     have no way to measure it directly.

   - Rate-based method (build_muscle): there is no validated
     "ideal" bulk target weight the way there is a healthy-BMI
     range. Published natural muscle-gain rates (Helms et al.,
     and similar sports-nutrition literature) suggest experienced
     lifters can expect roughly 0.25-0.5% of bodyweight per month
     under a surplus + resistance training, faster for beginners.
     We suggest a first milestone (~8 weeks out) rather than a
     final number, since "how much muscle can I ultimately gain"
     isn't something bodyweight alone can answer.
   ------------------------------------------------------------ */

const HEALTHY_BMI_RANGE = { min: 18.5, max: 24.9 };

/* ------------------------------------------------------------
   BODY FAT % ESTIMATE — U.S. Navy circumference method
   Published by Hodgdon & Beckett (1984) for the US Navy, and
   still one of the most-validated tape-measurement methods
   available without calipers or a DEXA scan (typically within
   ~3-4% of DEXA for most body types in published validation
   studies). Needs waist, neck, and height for men; adds hip for
   women. All measurements in cm.

   Men:   %BF = 495 / (1.0324 - 0.19077*log10(waist-neck) + 0.15456*log10(height)) - 450
   Women: %BF = 495 / (1.29579 - 0.35004*log10(waist+hip-neck) + 0.22100*log10(height)) - 450

   This is still an estimate, not a diagnosis — accuracy degrades for
   very lean or very muscular individuals, and it can't replace an
   actual body-composition scan. The UI must present it as such.
   ------------------------------------------------------------ */

function estimateBodyFatNavy({ sex, waistCm, neckCm, hipCm, heightCm }) {
  if (!waistCm || !neckCm || !heightCm) return null;
  if (sex === 'female') {
    if (!hipCm) return null;
    const denom = 1.29579 - 0.35004 * Math.log10(waistCm + hipCm - neckCm) + 0.22100 * Math.log10(heightCm);
    if (denom <= 0) return null;
    const bf = 495 / denom - 450;
    return bf > 0 && bf < 70 ? Math.round(bf * 10) / 10 : null;
  }
  // Male formula also used as the 'other' fallback (no separate validated
  // equation exists for non-binary sex categories in the published method).
  const denom = 1.0324 - 0.19077 * Math.log10(waistCm - neckCm) + 0.15456 * Math.log10(heightCm);
  if (denom <= 0) return null;
  const bf = 495 / denom - 450;
  return bf > 0 && bf < 70 ? Math.round(bf * 10) / 10 : null;
}

// ACE body-fat-percentage categories; "fitness/athletic" band is the
// commonly cited range where abdominal muscle definition becomes visible.
const VISIBLE_ABS_BF_RANGE = {
  male: { min: 10, max: 14 },
  female: { min: 18, max: 22 },
  other: { min: 14, max: 18 }, // midpoint fallback when sex isn't specified
};

// Full ACE body-fat-percentage category table, for context around an
// estimate (not just the "visible abs" band above).
const BF_CATEGORIES = {
  male: [
    { max: 5, label: 'Essential fat' },
    { max: 13, label: 'Athletic' },
    { max: 17, label: 'Fitness' },
    { max: 24, label: 'Average' },
    { max: Infinity, label: 'Above average' },
  ],
  female: [
    { max: 13, label: 'Essential fat' },
    { max: 20, label: 'Athletic' },
    { max: 24, label: 'Fitness' },
    { max: 31, label: 'Average' },
    { max: Infinity, label: 'Above average' },
  ],
};

function categorizeBodyFat(bfPercent, sex) {
  if (!Number.isFinite(bfPercent)) return null;
  const table = BF_CATEGORIES[sex] || BF_CATEGORIES.male;
  return table.find(b => bfPercent <= b.max)?.label || null;
}

// Conservative natural monthly muscle-gain rate for an experienced lifter,
// as a fraction of current bodyweight. Beginners can exceed this, but this
// app has no training-age input feeding into nutrition.js, so it uses the
// more conservative (safer to overestimate timeline than overpromise gains) end.
const MONTHLY_MUSCLE_GAIN_RATE = 0.0035; // ~0.35%/month

function suggestGoalWeightFromBMI(heightCm) {
  if (!heightCm) return null;
  const heightM = heightCm / 100;
  const midpointBMI = (HEALTHY_BMI_RANGE.min + HEALTHY_BMI_RANGE.max) / 2;
  return Math.round(midpointBMI * heightM * heightM * 10) / 10;
}

function suggestGoalWeightFromBodyFat({ weightKg, sex, estimatedCurrentBFPercent }) {
  if (!weightKg || !Number.isFinite(estimatedCurrentBFPercent)) return null;
  const range = VISIBLE_ABS_BF_RANGE[sex] || VISIBLE_ABS_BF_RANGE.other;
  const targetBF = (range.min + range.max) / 2;
  // If they're already leaner than the target range, there's no fat-loss-driven
  // suggestion to make — fall back to current weight (nothing to recommend losing).
  if (estimatedCurrentBFPercent <= targetBF) return Math.round(weightKg * 10) / 10;
  const leanBodyMassKg = weightKg * (1 - estimatedCurrentBFPercent / 100);
  const goalWeightKg = leanBodyMassKg / (1 - targetBF / 100);
  return Math.round(goalWeightKg * 10) / 10;
}

function suggestGoalWeightForMuscleGain(weightKg) {
  if (!weightKg) return null;
  // ~8-week first milestone at the conservative natural monthly rate.
  const gainKg = weightKg * MONTHLY_MUSCLE_GAIN_RATE * 2; // 2 months
  return Math.round((weightKg + gainKg) * 10) / 10;
}

/**
 * Single entry point the wizard calls: given the chosen intent and the
 * user's existing profile stats, returns a suggested goal weight plus a
 * one-sentence explanation of the method, or null if there isn't enough
 * data yet (caller should fall back to manual entry only).
 */
function suggestGoalWeight({ intentKey, weightKg, heightCm, sex, estimatedCurrentBFPercent }) {
  const intent = GOAL_INTENTS[intentKey];
  if (!intent) return null;

  if (intentKey === 'get_abs') {
    const suggested = suggestGoalWeightFromBodyFat({ weightKg, sex, estimatedCurrentBFPercent });
    if (suggested == null) return null;
    const range = VISIBLE_ABS_BF_RANGE[sex] || VISIBLE_ABS_BF_RANGE.other;
    return {
      suggestedWeightKg: suggested,
      method: 'body_fat_estimate',
      explanation: `Based on an estimated ${Math.round((range.min + range.max) / 2)}% body fat target (a commonly cited range for visible abdominal definition) and your current weight.`,
    };
  }

  if (intentKey === 'build_muscle') {
    const suggested = suggestGoalWeightForMuscleGain(weightKg);
    if (suggested == null) return null;
    return {
      suggestedWeightKg: suggested,
      method: 'muscle_gain_rate',
      explanation: `A conservative ~8-week milestone at a natural muscle-gain pace (roughly 0.35%/month of bodyweight) — a starting checkpoint, not a final target.`,
    };
  }

  if (intentKey === 'lose_fat') {
    const suggested = suggestGoalWeightFromBMI(heightCm);
    if (suggested == null) return null;
    return {
      suggestedWeightKg: suggested,
      method: 'bmi_midpoint',
      explanation: `The midpoint of the WHO/CDC healthy BMI range (18.5–24.9) for your height — a general-population reference point, not a personal ideal.`,
    };
  }

  // recomposition / maintain_weight: goal is current weight (composition-
  // focused, not weight-focused) unless current weight is already outside
  // the healthy BMI range, in which case default to the BMI midpoint.
  if (!weightKg) return null;
  const bmiSuggested = suggestGoalWeightFromBMI(heightCm);
  const heightM = heightCm ? heightCm / 100 : null;
  const currentBMI = heightM ? weightKg / (heightM * heightM) : null;
  const inHealthyRange = currentBMI != null && currentBMI >= HEALTHY_BMI_RANGE.min && currentBMI <= HEALTHY_BMI_RANGE.max;

  if (inHealthyRange || bmiSuggested == null) {
    return {
      suggestedWeightKg: Math.round(weightKg * 10) / 10,
      method: 'current_weight',
      explanation: `${intentKey === 'maintain_weight' ? 'Maintaining' : 'Recomposition'} is about body composition, not the number on the scale — your current weight is the starting reference.`,
    };
  }

  return {
    suggestedWeightKg: bmiSuggested,
    method: 'bmi_midpoint',
    explanation: `Your current weight falls outside the WHO/CDC healthy BMI range, so we've suggested the midpoint of that range (18.5–24.9 BMI) for your height instead.`,
  };
}

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

/* ============================================================
   DAILY SUMMARY -> WEIGHT PROJECTION & GOAL GUIDANCE
   Separate from analyzeWeightTrend() above: that function looks
   backward at *actual logged bodyweight* over time. This looks
   forward from a single day's food log — "if every day looked
   like today, where would that put you" — using the same
   KCAL_PER_KG_BODYFAT approximation for consistency. It's a
   what-if projection off one day's numbers, not a measured trend,
   so callers should present it as illustrative, not predictive.
   ============================================================ */

// Widely-used sustainable range for intentional weight change: roughly
// 0.5-1% of current bodyweight per week. Kept as a band (not a single
// number) so recommendations can sit in the middle of it rather than
// pretending there's one "correct" rate — same conservative-default
// philosophy as GOAL_ADJUSTMENTS above.
const SAFE_WEEKLY_RATE_PCT = { min: 0.005, max: 0.01 };

/**
 * Projects weight after `days` at a given daily calorie surplus/deficit,
 * from a starting bodyweight. Pure math, no storage access, so it's easy
 * to reuse for the 7-day summary, a goal countdown, or a what-if slider.
 */
function projectWeightAfterDays(currentWeightKg, dailyDelta, days) {
  const deltaKg = (dailyDelta * days) / KCAL_PER_KG_BODYFAT;
  return {
    deltaKg: Math.round(deltaKg * 100) / 100,
    projectedWeightKg: Math.round((currentWeightKg + deltaKg) * 100) / 100,
  };
}

/**
 * Today's food log vs TDEE, projected forward from current bodyweight.
 * Returns both the 7-day snapshot (what the existing UI showed) and the
 * absolute projected weight, since "you'll weigh X" lands more concretely
 * than "you'll lose/gain X" on its own.
 */
function projectWeeklyWeightChange(totalCaloriesToday, tdee, currentWeightKg) {
  if (!Number.isFinite(totalCaloriesToday) || !Number.isFinite(tdee)) {
    return null;
  }
  const dailyDelta = totalCaloriesToday - tdee;
  const week = projectWeightAfterDays(currentWeightKg || 0, dailyDelta, 7);
  const direction = Math.abs(week.deltaKg) < 0.05 ? 'maintain' : (week.deltaKg > 0 ? 'gain' : 'lose');
  return {
    dailyDelta: Math.round(dailyDelta),
    weeklyDeltaKg: week.deltaKg,
    projectedWeightKg: Number.isFinite(currentWeightKg) ? week.projectedWeightKg : null,
    direction,
  };
}

/**
 * Given today's calorie intake vs TDEE, how long until a goal weight is
 * reached at that same daily pace. Returns null if there's no meaningful
 * pace to project from (e.g. eating at maintenance while trying to change
 * weight) rather than dividing by ~zero and returning a nonsense duration.
 */
function estimateTimeToGoal({ currentWeightKg, goalWeightKg, dailyDelta }) {
  if (![currentWeightKg, goalWeightKg, dailyDelta].every(Number.isFinite)) return null;

  const weightToChangeKg = goalWeightKg - currentWeightKg; // negative = needs to lose
  if (Math.abs(weightToChangeKg) < 0.1) {
    return { status: 'at_goal' };
  }

  const neededDirection = weightToChangeKg < 0 ? 'lose' : 'gain';
  const actualDirection = dailyDelta < 0 ? 'lose' : (dailyDelta > 0 ? 'gain' : 'maintain');

  if (actualDirection === 'maintain' || actualDirection !== neededDirection) {
    return { status: 'wrong_direction', neededDirection };
  }

  const dailyChangeKg = dailyDelta / KCAL_PER_KG_BODYFAT; // signed, same sign as weightToChangeKg
  const days = Math.abs(weightToChangeKg / dailyChangeKg);
  const weeks = days / 7;

  return {
    status: 'ok',
    neededDirection,
    days: Math.round(days),
    weeks: Math.round(weeks * 10) / 10,
    etaDate: new Date(Date.now() + days * 24 * 60 * 60 * 1000),
  };
}

/**
 * When a user sets a goal weight, recommend a calorie target that gets
 * them there at a *safe* pace (SAFE_WEEKLY_RATE_PCT of bodyweight/week)
 * rather than whatever pace their current logged intake happens to imply.
 * This is the "guide them on the best way to achieve it" piece — shown
 * once at goal-setting time, independent of what they ate today.
 */
function recommendCalorieTargetForGoal({ currentWeightKg, goalWeightKg, tdee }) {
  if (![currentWeightKg, goalWeightKg, tdee].every(Number.isFinite)) return null;

  const weightToChangeKg = goalWeightKg - currentWeightKg;
  if (Math.abs(weightToChangeKg) < 0.1) {
    return { status: 'at_goal' };
  }

  const direction = weightToChangeKg < 0 ? 'lose' : 'gain';
  // Midpoint of the safe range, scaled to current bodyweight.
  const safeWeeklyKg = currentWeightKg * ((SAFE_WEEKLY_RATE_PCT.min + SAFE_WEEKLY_RATE_PCT.max) / 2);
  const safeDailyDelta = Math.round((safeWeeklyKg * KCAL_PER_KG_BODYFAT) / 7);

  const recommendedCalorieTarget = Math.max(
    1200,
    direction === 'lose' ? tdee - safeDailyDelta : tdee + safeDailyDelta
  );

  const days = Math.abs(weightToChangeKg) / safeWeeklyKg * 7;

  return {
    status: 'ok',
    direction,
    recommendedCalorieTarget,
    safeWeeklyKg: Math.round(safeWeeklyKg * 100) / 100,
    estimatedWeeks: Math.round((days / 7) * 10) / 10,
    etaDate: new Date(Date.now() + days * 24 * 60 * 60 * 1000),
  };
}

window.Nutrition = {
  ACTIVITY_MULTIPLIERS,
  GOAL_ADJUSTMENTS,
  MACRO_SPLITS,
  GOAL_INTENTS,
  suggestGoalWeight,
  estimateBodyFatNavy,
  categorizeBodyFat,
  calculateBMR,
  calculateTDEE,
  calculateTargets,
  recalculateAndSaveTargets,
  recalculateMacrosForCalorieTarget,
  hasCompleteProfileForCalc,
  analyzeWeightTrend,
  projectWeightAfterDays,
  projectWeeklyWeightChange,
  estimateTimeToGoal,
  recommendCalorieTargetForGoal,
};