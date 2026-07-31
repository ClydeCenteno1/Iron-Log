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
    goal: 'maintain',          // cut | maintain | bulk
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

function saveActivePlan(plan) {
  const record = { schemaVersion: SCHEMA_VERSION, id: uid('plan'), createdAt: Date.now(), ...plan };
  writeJSON(Keys.PLANS, [record]); // v1: only keep the single active plan
  return record;
}

function getActivePlan() {
  const plans = getPlans();
  return plans.length ? plans[plans.length - 1] : null;
}

function clearActivePlan() {
  return writeJSON(Keys.PLANS, []);
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

/* ---------------- Meals (stubbed for now, used later) ---------------- */

function getMeals() {
  return readJSON(Keys.MEALS, []);
}

function saveMeals(list) {
  return writeJSON(Keys.MEALS, list);
}

window.Storage = {
  Keys, uid, runMigrations,
  getExercises, saveExercises, addExercise,
  getSessions, saveSessions, addSession, getLastSessionForExercise,
  getActiveSession, saveActiveSession, clearActiveSession, startNewSession,
  getProfile, saveProfile,
  getPlans, saveActivePlan, getActivePlan,
  getSettings, saveSettings,
  getMeals, saveMeals,
};
