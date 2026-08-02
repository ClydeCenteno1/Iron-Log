/* ============================================================
   SEED EXERCISE LIBRARY
   Loaded once on first run. ~40 common movements across muscle
   groups and equipment types — enough for the generator to build
   real splits without feeling sparse, but not so many it's unwieldy
   to browse. Grows organically after this via user-added exercises.
   ============================================================ */

const SEED_EXERCISES = [
  // Chest
  { name: 'Barbell Bench Press', muscleGroup: 'Chest', equipment: 'Barbell', cues: 'Retract shoulder blades, feet planted, bar to mid-chest.' },
  { name: 'Dumbbell Bench Press', muscleGroup: 'Chest', equipment: 'Dumbbells', cues: 'Control the descent, press up and slightly in.' },
  { name: 'Incline Dumbbell Press', muscleGroup: 'Chest', equipment: 'Dumbbells', cues: '30-45 degree bench, targets upper chest.' },
  { name: 'Push-Up', muscleGroup: 'Chest', equipment: 'Bodyweight', cues: 'Straight line head to heels, elbows ~45 degrees.' },
  { name: 'Cable Fly', muscleGroup: 'Chest', equipment: 'Cable Machine', cues: 'Slight elbow bend, squeeze at midline.' },
  { name: 'Dips', muscleGroup: 'Chest', equipment: 'Weighted Calisthenics', cues: 'Lean forward for chest emphasis, control the bottom. Add weight via belt/vest as bodyweight reps increase.' },

  // Back
  { name: 'Deadlift', muscleGroup: 'Back', equipment: 'Barbell', cues: 'Neutral spine, bar close to shins, drive through floor.' },
  { name: 'Pull-Up', muscleGroup: 'Back', equipment: 'Weighted Calisthenics', cues: 'Full hang to chin over bar, avoid kipping. Add weight via belt/vest as bodyweight reps increase.' },
  { name: 'Barbell Row', muscleGroup: 'Back', equipment: 'Barbell', cues: 'Hinge at hips, pull to lower ribs.' },
  { name: 'Lat Pulldown', muscleGroup: 'Back', equipment: 'Cable Machine', cues: 'Pull to upper chest, avoid leaning back excessively.' },
  { name: 'Seated Cable Row', muscleGroup: 'Back', equipment: 'Cable Machine', cues: 'Chest up, pull to torso, squeeze shoulder blades.' },
  { name: 'Dumbbell Row', muscleGroup: 'Back', equipment: 'Dumbbells', cues: 'Flat back, pull elbow past torso.' },

  // Legs
  { name: 'Barbell Back Squat', muscleGroup: 'Legs', equipment: 'Barbell', cues: 'Hips and knees together, chest up, break parallel.' },
  { name: 'Front Squat', muscleGroup: 'Legs', equipment: 'Barbell', cues: 'Elbows high, upright torso.' },
  { name: 'Romanian Deadlift', muscleGroup: 'Legs', equipment: 'Barbell', cues: 'Soft knees, push hips back, feel hamstring stretch.' },
  { name: 'Leg Press', muscleGroup: 'Legs', equipment: 'Machine', cues: 'Full range without rounding lower back.' },
  { name: 'Walking Lunge', muscleGroup: 'Legs', equipment: 'Dumbbells', cues: 'Front knee tracks over foot, torso upright.' },
  { name: 'Bulgarian Split Squat', muscleGroup: 'Legs', equipment: 'Dumbbells', cues: 'Rear foot elevated, most weight on front leg.' },
  { name: 'Leg Curl', muscleGroup: 'Legs', equipment: 'Machine', cues: 'Controlled tempo, avoid hips rising.' },
  { name: 'Calf Raise', muscleGroup: 'Legs', equipment: 'Machine', cues: 'Full stretch at bottom, pause at top.' },
  { name: 'Bodyweight Squat', muscleGroup: 'Legs', equipment: 'Bodyweight', cues: 'Break parallel, knees tracking over toes.' },

  // Shoulders
  { name: 'Overhead Press', muscleGroup: 'Shoulders', equipment: 'Barbell', cues: 'Brace core, press straight overhead, avoid excess lean-back.' },
  { name: 'Dumbbell Shoulder Press', muscleGroup: 'Shoulders', equipment: 'Dumbbells', cues: 'Press up and slightly in, control descent.' },
  { name: 'Lateral Raise', muscleGroup: 'Shoulders', equipment: 'Dumbbells', cues: 'Slight bend in elbow, raise to shoulder height.' },
  { name: 'Face Pull', muscleGroup: 'Shoulders', equipment: 'Cable Machine', cues: 'Pull to face height, external rotation at the end.' },
  { name: 'Rear Delt Fly', muscleGroup: 'Shoulders', equipment: 'Dumbbells', cues: 'Hinge forward, squeeze rear delts, minimal momentum.' },

  // Arms
  { name: 'Barbell Curl', muscleGroup: 'Arms', equipment: 'Barbell', cues: 'Elbows pinned, avoid swinging.' },
  { name: 'Dumbbell Curl', muscleGroup: 'Arms', equipment: 'Dumbbells', cues: 'Full range, controlled negative.' },
  { name: 'Hammer Curl', muscleGroup: 'Arms', equipment: 'Dumbbells', cues: 'Neutral grip throughout, targets brachialis.' },
  { name: 'Tricep Pushdown', muscleGroup: 'Arms', equipment: 'Cable Machine', cues: 'Elbows pinned to sides, full extension.' },
  { name: 'Skull Crusher', muscleGroup: 'Arms', equipment: 'Barbell', cues: 'Elbows stay fixed, lower to forehead/behind head.' },
  { name: 'Close-Grip Bench Press', muscleGroup: 'Arms', equipment: 'Barbell', cues: 'Hands shoulder-width, elbows tucked.' },

  // Core
  { name: 'Plank', muscleGroup: 'Core', equipment: 'Bodyweight', cues: 'Neutral spine, brace like taking a punch.' },
  { name: 'Hanging Leg Raise', muscleGroup: 'Core', equipment: 'Bodyweight', cues: 'Avoid swinging, control the descent.' },
  { name: 'Cable Crunch', muscleGroup: 'Core', equipment: 'Cable Machine', cues: 'Crunch spine, not just hips.' },
  { name: 'Russian Twist', muscleGroup: 'Core', equipment: 'Bodyweight', cues: 'Rotate from the torso, feet can stay grounded if needed.' },
  { name: 'Ab Wheel Rollout', muscleGroup: 'Core', equipment: 'Bodyweight', cues: 'Avoid lower back sagging, roll out as far as controllable.' },

  // Bands / minimal equipment
  { name: 'Band Pull-Apart', muscleGroup: 'Shoulders', equipment: 'Bands', cues: 'Straight arms, squeeze shoulder blades together.' },
  { name: 'Band Row', muscleGroup: 'Back', equipment: 'Bands', cues: 'Anchor band, pull to torso, control return.' },
  { name: 'Band Squat', muscleGroup: 'Legs', equipment: 'Bands', cues: 'Band around thighs or under feet, maintain tension.' },
];

function seedExercisesIfEmpty() {
  const existing = Storage.getExercises();
  if (existing.length > 0) return;
  const seeded = SEED_EXERCISES.map(ex => ({
    schemaVersion: 1,
    id: Storage.uid('ex'),
    name: ex.name,
    muscleGroup: ex.muscleGroup,
    equipment: ex.equipment,
    cues: ex.cues,
    videoUrl: '',
    isCustom: false,
    createdAt: Date.now(),
  }));
  Storage.saveExercises(seeded);
}

window.ExerciseSeed = { SEED_EXERCISES, seedExercisesIfEmpty };
