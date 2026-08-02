/* ============================================================
   STORAGE LAYER
   All app data lives in localStorage under versioned, namespaced
   keys. Every record type has a `schemaVersion` field so that if
   the shape changes later, we can write a migration instead of
   breaking existing users' data (or, later, swap this file for
   one that talks to a real backend without touching call sites).
   ============================================================ */

const STORAGE_PREFIX = 'ft_'; // fittracker
const SCHEMA_VERSION = 1;

const Keys = {
  EXERCISES: STORAGE_PREFIX + 'exercises',
  SESSIONS: STORAGE_PREFIX + 'sessions',       // completed workout sessions (history)
  ACTIVE_SESSION: STORAGE_PREFIX + 'active_session', // in-progress session, if any
  PROFILE: STORAGE_PREFIX + 'profile',         // user profile/goals/training style
  PLANS: STORAGE_PREFIX + 'plans',             // generated workout plans
  MEALS: STORAGE_PREFIX + 'meals',             // food log entries
  WEIGHT_LOGS: STORAGE_PREFIX + 'weight_logs', // bodyweight check-ins over time
  NUTRITION: STORAGE_PREFIX + 'nutrition',     // BMR/TDEE inputs + calculated calorie/macro targets
  SETTINGS: STORAGE_PREFIX + 'settings',       // theme, units, misc UI prefs
  META: STORAGE_PREFIX + 'meta',               // schema version tracking
};

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw);
  } catch (e) {
    console.error('Storage read failed for', key, e);
    return fallback;
  }
}

function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    console.error('Storage write failed for', key, e);
    return false;
  }
}

function uid(prefix = 'id') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/* ---------------- Meta / migrations ---------------- */

function getMeta() {
  return readJSON(Keys.META, { schemaVersion: 0 });
}

function runMigrations() {
  const meta = getMeta();
  if (meta.schemaVersion >= SCHEMA_VERSION) return;

  // Placeholder for future migrations. Pattern:
  // if (meta.schemaVersion < 1) { ...transform data... }

  meta.schemaVersion = SCHEMA_VERSION;
  writeJSON(Keys.META, meta);
}

/* ---------------- Exercises ---------------- */

function getExercises() {
  return readJSON(Keys.EXERCISES, []);
}

function saveExercises(list) {
  return writeJSON(Keys.EXERCISES, list);
}

function addExercise(exercise) {
  const list = getExercises();
  const record = {
    schemaVersion: SCHEMA_VERSION,
    id: uid('ex'),
    name: exercise.name,
    muscleGroup: exercise.muscleGroup || 'Other',
    equipment: exercise.equipment || 'Bodyweight',
    cues: exercise.cues || '',
    videoUrl: exercise.videoUrl || '',
    isCustom: exercise.isCustom !== undefined ? exercise.isCustom : true,
    createdAt: Date.now(),
  };
  list.push(record);
  saveExercises(list);
  return record;
}

/* ---------------- Sessions (workout history) ---------------- */

function getSessions() {
  return readJSON(Keys.SESSIONS, []);
}

function saveSessions(list) {
  return writeJSON(Keys.SESSIONS, list);
}

function addSession(session) {
  const list = getSessions();
  const record = {
    schemaVersion: SCHEMA_VERSION,
    id: uid('sess'),
    date: session.date || Date.now(),
    trainingStyle: session.trainingStyle || null,
    entries: session.entries || [], // [{ exerciseId, sets: [{weight, reps, rpe, isWarmup}] }]
    notes: session.notes || '',
  };
  list.push(record);
  saveSessions(list);
  return record;
}

// Most recent completed session containing a given exercise
function getLastSessionForExercise(exerciseId) {
  const sessions = getSessions()
    .filter(s => s.entries.some(e => e.exerciseId === exerciseId))
    .sort((a, b) => b.date - a.date);
  if (sessions.length === 0) return null;
  const session = sessions[0];
  const entry = session.entries.find(e => e.exerciseId === exerciseId);
  return { session, entry };
}

/* ---------------- Active (in-progress) session ---------------- */

function getActiveSession() {
  return readJSON(Keys.ACTIVE_SESSION, null);
}

function saveActiveSession(session) {
  return writeJSON(Keys.ACTIVE_SESSION, session);
}

function clearActiveSession() {
  localStorage.removeItem(Keys.ACTIVE_SESSION);
}

function startNewSession(trainingStyle) {
  const session = {
    schemaVersion: SCHEMA_VERSION,
    id: uid('sess'),
    date: Date.now(),
    trainingStyle: trainingStyle || getProfile().trainingStyle || 'balanced',
    entries: [],
    notes: '',
  };
  saveActiveSession(session);
  return session;
}

/* ---------------- Profile ---------------- */

function getProfile() {
  return readJSON(Keys.PROFILE, {
    schemaVersion: SCHEMA_VERSION,
    age: null,
    sex: null,
    weightKg: null,
    heightCm: null,
    activityLevel: 'moderate', // sedentary | light | moderate | active | very_active
    goal: null,                 // strength | hypertrophy | endurance | fat_loss — workout goal, set via the generator
    nutritionGoal: 'maintain',  // cut | maintain | bulk — separate from `goal` above on purpose,
                                 // since the two use different value sets (see nutrition.js GOAL_ADJUSTMENTS
                                 // vs generator.js GOAL_CONFIG) and previously collided when both wrote to `goal`.
    trainingStyle: 'balanced', // hiit_low_volume | high_volume | balanced
    experienceLevel: 'beginner',
    equipment: [],
    daysPerWeek: 3,
  });
}

function saveProfile(profile) {
  const current = getProfile();
  const merged = { ...current, ...profile, schemaVersion: SCHEMA_VERSION };
  writeJSON(Keys.PROFILE, merged);
  return merged;
}

/* ---------------- Plans (generated workouts) ---------------- */

function getPlans() {
  return readJSON(Keys.PLANS, []);
}

// Saves a new plan as a program in the list and marks it active.
// All prior plans are kept (for the Programs page) but marked inactive.
function saveActivePlan(plan) {
  const list = getPlans().map(p => ({ ...p, active: false }));
  const record = { schemaVersion: SCHEMA_VERSION, id: uid('plan'), createdAt: Date.now(), active: true, ...plan };
  list.push(record);
  writeJSON(Keys.PLANS, list);
  return record;
}

function getActivePlan() {
  const plans = getPlans();
  return plans.find(p => p.active) || null;
}

// Removes the active-plan marker without deleting the program itself.
function clearActivePlan() {
  const list = getPlans().map(p => ({ ...p, active: false }));
  return writeJSON(Keys.PLANS, list);
}

function setActivePlan(planId) {
  const list = getPlans().map(p => ({ ...p, active: p.id === planId }));
  writeJSON(Keys.PLANS, list);
  return list.find(p => p.id === planId) || null;
}

// Permanently deletes a saved program. If it was active, nothing becomes
// active automatically — dashboard falls back to its empty/no-plan state.
function deletePlan(planId) {
  const list = getPlans().filter(p => p.id !== planId);
  return writeJSON(Keys.PLANS, list);
}

/* ---------------- Settings ---------------- */

function getSettings() {
  return readJSON(Keys.SETTINGS, {
    schemaVersion: SCHEMA_VERSION,
    theme: 'iron',   // iron | light | crimson | ...
    units: 'kg',      // kg | lb
  });
}

function saveSettings(settings) {
  const current = getSettings();
  const merged = { ...current, ...settings, schemaVersion: SCHEMA_VERSION };
  writeJSON(Keys.SETTINGS, merged);
  return merged;
}

/* ---------------- Meals (food log) ---------------- */

function getMeals() {
  return readJSON(Keys.MEALS, []);
}

function saveMeals(list) {
  return writeJSON(Keys.MEALS, list);
}

// meal = { category, date, calories, protein, carbs, fats, source: 'ai'|'manual',
//          estimateRange: {caloriesLow, caloriesHigh} | null, photoDataUrl: string|null, label }
function addMeal(meal) {
  const list = getMeals();
  const record = {
    schemaVersion: SCHEMA_VERSION,
    id: uid('meal'),
    date: meal.date || Date.now(),
    category: meal.category || 'Snack', // Breakfast | Lunch | Dinner | Snack (user-editable)
    label: meal.label || '',
    calories: meal.calories ?? null,
    protein: meal.protein ?? null,
    carbs: meal.carbs ?? null,
    fats: meal.fats ?? null,
    source: meal.source || 'manual', // 'ai' | 'manual' | 'ai_corrected'
    estimateRange: meal.estimateRange || null, // { caloriesLow, caloriesHigh } — only set for uncorrected AI estimates
    photoDataUrl: meal.photoDataUrl || null,
    notes: meal.notes || '',
    createdAt: Date.now(),
  };
  list.push(record);
  saveMeals(list);
  return record;
}

function updateMeal(mealId, changes) {
  const list = getMeals();
  const idx = list.findIndex(m => m.id === mealId);
  if (idx === -1) return null;
  list[idx] = { ...list[idx], ...changes };
  saveMeals(list);
  return list[idx];
}

function deleteMeal(mealId) {
  const list = getMeals().filter(m => m.id !== mealId);
  return saveMeals(list);
}

// All meals logged on the same calendar day as `date` (defaults to today), local time.
function getMealsForDate(date = new Date()) {
  const dayStr = new Date(date).toDateString();
  return getMeals().filter(m => new Date(m.date).toDateString() === dayStr);
}

/* ---------------- Weight log (bodyweight check-ins) ---------------- */

function getWeightLogs() {
  return readJSON(Keys.WEIGHT_LOGS, []);
}

function saveWeightLogs(list) {
  return writeJSON(Keys.WEIGHT_LOGS, list);
}

// One check-in per calendar day: logging again on the same day updates that
// day's entry instead of creating a second one, so a weekly-trend read isn't
// skewed by someone weighing in twice in one morning.
function addWeightLog({ weightKg, date = Date.now(), notes = '' }) {
  const list = getWeightLogs();
  const dayStr = new Date(date).toDateString();
  const existingIdx = list.findIndex(w => new Date(w.date).toDateString() === dayStr);

  const record = {
    schemaVersion: SCHEMA_VERSION,
    id: existingIdx !== -1 ? list[existingIdx].id : uid('wt'),
    date,
    weightKg,
    notes,
    createdAt: existingIdx !== -1 ? list[existingIdx].createdAt : Date.now(),
  };

  if (existingIdx !== -1) list[existingIdx] = record;
  else list.push(record);

  saveWeightLogs(list);
  return record;
}

function deleteWeightLog(logId) {
  const list = getWeightLogs().filter(w => w.id !== logId);
  return saveWeightLogs(list);
}

// Most recent N check-ins, oldest first — the shape trend analysis wants.
function getRecentWeightLogs(n = 90) {
  return getWeightLogs()
    .sort((a, b) => b.date - a.date)
    .slice(0, n)
    .sort((a, b) => a.date - b.date);
}

/* ---------------- Nutrition targets (BMR/TDEE + macro goals) ---------------- */

function getNutritionProfile() {
  return readJSON(Keys.NUTRITION, {
    schemaVersion: SCHEMA_VERSION,
    // Inputs mirror the training profile's age/sex/weightKg/heightCm/activityLevel/goal
    // so the user doesn't have to enter them twice, but are cached here as their own
    // record because nutrition targets (calorie/macro numbers) are derived values that
    // should stay stable until the user recalculates, not silently drift if the
    // training profile changes for an unrelated reason.
    calorieTarget: null,
    proteinTarget: null,
    carbsTarget: null,
    fatsTarget: null,
    bmr: null,
    tdee: null,
    lastCalculatedAt: null,
  });
}

function saveNutritionProfile(nutrition) {
  const current = getNutritionProfile();
  const merged = { ...current, ...nutrition, schemaVersion: SCHEMA_VERSION };
  writeJSON(Keys.NUTRITION, merged);
  return merged;
}

window.Storage = {
  Keys, uid, runMigrations,
  getExercises, saveExercises, addExercise,
  getSessions, saveSessions, addSession, getLastSessionForExercise,
  getActiveSession, saveActiveSession, clearActiveSession, startNewSession,
  getProfile, saveProfile,
  getPlans, saveActivePlan, getActivePlan, setActivePlan, deletePlan,
  getSettings, saveSettings,
  getMeals, saveMeals, addMeal, updateMeal, deleteMeal, getMealsForDate,
  getWeightLogs, saveWeightLogs, addWeightLog, deleteWeightLog, getRecentWeightLogs,
  getNutritionProfile, saveNutritionProfile,
};
