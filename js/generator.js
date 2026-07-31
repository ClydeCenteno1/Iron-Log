/* ============================================================
   WORKOUT GENERATOR
   Deterministic filtering + selection from the exercise library
   based on questionnaire answers. No AI call needed for v1 — this
   is template/rule matching against tagged exercise data.
   ============================================================ */

const SPLITS = {
  full_body: {
    label: 'Full Body',
    days: (n) => Array.from({ length: n }, () => ['Legs', 'Chest', 'Back', 'Shoulders', 'Arms', 'Core']),
  },
  upper_lower: {
    label: 'Upper / Lower',
    days: (n) => {
      const pattern = [
        ['Chest', 'Back', 'Shoulders', 'Arms'],
        ['Legs', 'Core'],
      ];
      return Array.from({ length: n }, (_, i) => pattern[i % 2]);
    },
  },
  push_pull_legs: {
    label: 'Push / Pull / Legs',
    days: (n) => {
      const pattern = [
        ['Chest', 'Shoulders', 'Arms'], // push (arms here = triceps-leaning, simplification for v1)
        ['Back', 'Arms'],               // pull
        ['Legs', 'Core'],               // legs
      ];
      return Array.from({ length: n }, (_, i) => pattern[i % 3]);
    },
  },
};

const GOAL_CONFIG = {
  strength: { repRangeOverride: [3, 6], exercisesPerGroup: 1 },
  hypertrophy: { repRangeOverride: [8, 12], exercisesPerGroup: 2 },
  endurance: { repRangeOverride: [15, 20], exercisesPerGroup: 2 },
  fat_loss: { repRangeOverride: [10, 15], exercisesPerGroup: 2 },
};

/**
 * questionnaire = {
 *   goal, splitKey, styleKey, equipment: [...], daysPerWeek, experienceLevel
 * }
 */
function generatePlan(questionnaire) {
  const { goal, splitKey, styleKey, equipment, daysPerWeek, experienceLevel } = questionnaire;
  const split = SPLITS[splitKey] || SPLITS.full_body;
  const style = Progression.getStyleConfig(styleKey);
  const goalConfig = GOAL_CONFIG[goal] || GOAL_CONFIG.hypertrophy;
  const repRange = goalConfig.repRangeOverride || style.repRange;

  const allExercises = Storage.getExercises();
  const equipmentSet = new Set(equipment.length ? equipment : ['Bodyweight']);
  // Bodyweight is always available regardless of what user selected
  equipmentSet.add('Bodyweight');

  const availableByGroup = {};
  allExercises.forEach(ex => {
    if (!equipmentSet.has(ex.equipment)) return;
    if (!availableByGroup[ex.muscleGroup]) availableByGroup[ex.muscleGroup] = [];
    availableByGroup[ex.muscleGroup].push(ex);
  });

  const dayGroups = split.days(daysPerWeek);
  const exercisesPerGroup = experienceLevel === 'beginner'
    ? Math.max(1, goalConfig.exercisesPerGroup - 1)
    : goalConfig.exercisesPerGroup;

  const days = dayGroups.map((groups, i) => {
    const dayExercises = [];
    const usedIds = new Set();

    groups.forEach(group => {
      const pool = (availableByGroup[group] || []).filter(ex => !usedIds.has(ex.id));
      const picks = pickN(pool, exercisesPerGroup);
      picks.forEach(ex => {
        usedIds.add(ex.id);
        dayExercises.push({
          exerciseId: ex.id,
          name: ex.name,
          muscleGroup: ex.muscleGroup,
          equipment: ex.equipment,
          targetSets: style.setRange[1],
          targetReps: `${repRange[0]}-${repRange[1]}`,
          restSeconds: style.restSeconds,
        });
      });
    });

    return {
      dayNumber: i + 1,
      focus: [...new Set(groups)].join(' / '),
      exercises: dayExercises,
    };
  });

  const unmetGroups = Object.keys(
    dayGroups.flat().reduce((acc, g) => {
      if (!availableByGroup[g] || availableByGroup[g].length === 0) acc[g] = true;
      return acc;
    }, {})
  );

  const warnings = unmetGroups.length
    ? [`No exercises available for: ${unmetGroups.join(', ')} with your selected equipment. Add custom exercises or expand equipment selection.`]
    : [];
  if (questionnaire.customRequest) {
    warnings.push(`Note: this rules-based plan can't read free-text requests — your notes are saved below but not applied. Try "Retry with AI" to have them factored in.`);
  }

  return {
    goal,
    splitKey,
    splitLabel: split.label,
    styleKey,
    daysPerWeek,
    days,
    customRequest: questionnaire.customRequest || '',
    warnings,
  };
}

function pickN(arr, n) {
  // simple deterministic-ish pick: shuffle with a seed based on array to avoid
  // wildly different plans on every regenerate, but still vary selection
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, Math.min(n, copy.length));
}

window.Generator = { SPLITS, GOAL_CONFIG, generatePlan };
