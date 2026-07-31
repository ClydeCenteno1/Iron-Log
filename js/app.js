/* ============================================================
   APP CONTROLLER
   Vanilla JS, no framework. Views are toggled via .active class;
   each render function rebuilds its section's innerHTML from
   current storage state. Simple, debuggable, no virtual DOM.
   ============================================================ */

/* ---------------- Init ---------------- */

document.addEventListener('DOMContentLoaded', () => {
  Storage.runMigrations();
  Themes.initTheme();
  ExerciseSeed.seedExercisesIfEmpty();
  Nav.go('dashboard');
  renderThemeGrid();
  renderSettingsForm();
  document.getElementById('addExerciseToSessionBtn').addEventListener('click', openExercisePickerForSession);
  document.getElementById('finishSessionBtn').addEventListener('click', finishSession);
});

/* ---------------- Navigation ---------------- */

const Nav = {
  current: 'dashboard',
  go(viewName) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    const target = document.getElementById(`view-${viewName}`);
    if (target) target.classList.add('active');
    this.current = viewName;

    document.querySelectorAll('.nav-item').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.nav === viewName);
    });

    if (viewName === 'dashboard') renderDashboard();
    if (viewName === 'generator') renderGeneratorStart();
    if (viewName === 'manualBuilder') renderManualBuilderStart();
    if (viewName === 'log') renderLogSession();
    if (viewName === 'history') renderHistory();
    if (viewName === 'library') renderLibrary();
    if (viewName === 'programs') renderPrograms();
    if (viewName === 'chat') renderChatView();
    if (viewName === 'settings') { renderThemeGrid(); renderSettingsForm(); }

    window.scrollTo(0, 0);
  },
};

document.getElementById('settingsBtn').addEventListener('click', () => Nav.go('settings'));

/* ============================================================
   DASHBOARD
   ============================================================ */

function renderDashboard() {
  const sessions = Storage.getSessions();
  const active = Storage.getActiveSession();
  const plan = Storage.getActivePlan();
  const emptyState = document.getElementById('emptyState');
  const content = document.getElementById('dashboardContent');

  if (sessions.length === 0 && !active && !plan) {
    emptyState.classList.remove('hidden');
    content.classList.add('hidden');
    return;
  }
  emptyState.classList.add('hidden');
  content.classList.remove('hidden');

  // Active plan banner — lets you actually start a session from a generated plan
  const planCard = document.getElementById('activePlanCard');
  if (plan && plan.days && plan.days.length) {
    planCard.classList.remove('hidden');
    const planSessions = getSessionsForPlan(plan, sessions);
    planCard.innerHTML = `
      <div class="flex items-center justify-between mb-2">
        <div>
          <p class="font-display font-semibold">${plan.splitLabel}</p>
          <p class="text-xs" style="color: var(--text-muted);">${plan.daysPerWeek} days/week &middot; ${(plan.goal || '').replace('_',' ')}</p>
        </div>
        <div class="flex items-center gap-3">
          <button class="text-xs" style="color: var(--text-muted);" onclick="Nav.go('programs')">My programs</button>
          <button class="text-xs" style="color: var(--text-muted);" onclick="deleteProgram('${plan.id}')">Delete</button>
        </div>
      </div>
      <div class="flex flex-col gap-2 mt-2">
        ${plan.days.map(day => {
          const lastForDay = planSessions.find(item => item.dayNumber === day.dayNumber);
          const lastLabel = lastForDay
            ? `Last: ${new Date(lastForDay.session.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
            : 'Not logged yet';
          return `
          <button class="btn-primary py-2.5 text-sm text-left px-3 flex items-center justify-between" onclick="startSessionFromPlanDay(${day.dayNumber})">
            <span>Day ${day.dayNumber}: ${day.focus}</span>
            <span class="text-xs opacity-80">${day.exercises.length} ex &middot; ${lastLabel}</span>
          </button>`;
        }).join('')}
      </div>
      ${planSessions.length ? `<button class="text-xs mt-2" style="color: var(--text-muted);" onclick="Nav.go('programs')">View previous sessions for this program &rarr;</button>` : ''}`;
  } else {
    planCard.classList.add('hidden');
  }

  // Week consistency dots (last 7 days)
  const today = new Date();
  const weekDots = document.getElementById('weekDots');
  weekDots.innerHTML = '';
  let daysLogged = 0;
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dayStr = d.toDateString();
    const hasSession = sessions.some(s => new Date(s.date).toDateString() === dayStr);
    if (hasSession) daysLogged++;
    const dot = document.createElement('div');
    dot.className = 'flex-1 h-8 rounded-md flex items-center justify-center text-[10px] font-mono';
    dot.style.background = hasSession ? 'var(--accent-logged)' : 'var(--bg-elevated)';
    dot.style.color = hasSession ? '#0E0F12' : 'var(--text-muted)';
    dot.style.border = hasSession ? 'none' : '1px solid var(--border)';
    dot.textContent = d.toLocaleDateString('en-US', { weekday: 'narrow' });
    weekDots.appendChild(dot);
  }
  document.getElementById('weekConsistency').textContent = `${daysLogged}/7 days`;

  // Active session banner
  const activeCard = document.getElementById('activeSessionCard');
  if (active) {
    activeCard.classList.remove('hidden');
    document.getElementById('activeSessionMeta').textContent =
      `${active.entries.length} exercise${active.entries.length !== 1 ? 's' : ''} logged so far`;
  } else {
    activeCard.classList.add('hidden');
  }

  document.getElementById('startSessionBtn').onclick = () => {
    if (!Storage.getActiveSession()) Storage.startNewSession();
    Nav.go('log');
  };

  // Recent lifts
  const recentEl = document.getElementById('recentLifts');
  const recentSessions = [...sessions].sort((a, b) => b.date - a.date).slice(0, 3);
  if (recentSessions.length === 0) {
    recentEl.innerHTML = `<p style="color: var(--text-muted);">No sessions logged yet.</p>`;
  } else {
    const exercises = Storage.getExercises();
    recentEl.innerHTML = recentSessions.map(s => {
      const exNames = s.entries.map(e => {
        const ex = exercises.find(x => x.id === e.exerciseId);
        return ex ? ex.name : 'Unknown exercise';
      }).slice(0, 3).join(', ');
      const dateLabel = new Date(s.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      return `
        <div class="flex items-center justify-between py-2 border-b" style="border-color: var(--border);">
          <div>
            <p class="text-sm font-medium">${dateLabel}</p>
            <p class="text-xs" style="color: var(--text-muted);">${exNames}${s.entries.length > 3 ? '…' : ''}</p>
          </div>
          <span class="text-xs font-mono" style="color: var(--text-muted);">${s.entries.length} ex</span>
        </div>`;
    }).join('');
  }
}

function startFreestyleSession() {
  Storage.startNewSession();
  Nav.go('log');
}

function startSessionFromPlanDay(dayNumber) {
  const plan = Storage.getActivePlan();
  if (!plan) return;
  const day = plan.days.find(d => d.dayNumber === dayNumber);
  if (!day) return;

  // If a session is already in progress, ask before overwriting it.
  const existing = Storage.getActiveSession();
  if (existing && existing.entries.length > 0) {
    if (!confirm('You have a session already in progress. Discard it and start this plan day instead?')) return;
  }

  const session = Storage.startNewSession(plan.styleKey);
  session.entries = day.exercises.map(ex => ({
    exerciseId: ex.exerciseId,
    notes: '',
    sets: Array.from({ length: ex.targetSets || 3 }, () => ({ weight: null, reps: null, rpe: null, isWarmup: false })),
  }));
  Storage.saveActiveSession(session);

  maybeOfferRepeatProgramOverload(day, () => Nav.go('log'));
}

/* ---------------- Repeat-program AI overload prompt ---------------- */

// Detects whether this exact set of exercises (same plan day) has been
// logged before with real weight/rep data. If so, offers to have the AI
// review that history and suggest how to progressively overload each lift
// this time — every single time the user repeats the day, not just once.
function maybeOfferRepeatProgramOverload(day, continueCallback) {
  const dayExerciseIds = day.exercises.map(e => e.exerciseId).sort();
  const sessions = Storage.getSessions();

  const matchingPriorSessions = sessions.filter(s => {
    const sessionIds = [...new Set(s.entries.map(e => e.exerciseId))].sort();
    if (sessionIds.length !== dayExerciseIds.length) return false;
    return sessionIds.every((id, i) => id === dayExerciseIds[i]);
  });

  if (matchingPriorSessions.length === 0) {
    continueCallback();
    return;
  }

  const modal = document.getElementById('modalRoot');
  modal.innerHTML = `
    <div class="fixed inset-0 z-40 flex items-center justify-center p-4" style="background: rgba(0,0,0,0.7);">
      <div class="card w-full max-w-sm p-5 space-y-3">
        <p class="font-display font-bold">You've done this session before</p>
        <p class="text-sm" style="color: var(--text-muted);">You've logged this exact set of exercises ${matchingPriorSessions.length} time${matchingPriorSessions.length > 1 ? 's' : ''} before. Want AI to review your weights/reps from last time and suggest how to progressively overload today?</p>
        <div class="flex gap-2 pt-1">
          <button class="btn-secondary flex-1" onclick="declineRepeatProgramOverload()">Not now</button>
          <button class="btn-primary flex-1" onclick="acceptRepeatProgramOverload()">Yes, show me</button>
        </div>
      </div>
    </div>`;

  window._repeatOverloadContinue = continueCallback;
  window._repeatOverloadDay = day;
}

function declineRepeatProgramOverload() {
  const continueCallback = window._repeatOverloadContinue;
  window._repeatOverloadContinue = null;
  window._repeatOverloadDay = null;
  closeModal();
  if (continueCallback) continueCallback();
}

async function acceptRepeatProgramOverload() {
  const day = window._repeatOverloadDay;
  const continueCallback = window._repeatOverloadContinue;
  closeModal();

  // Show a lightweight loading modal while we fetch suggestions per exercise.
  const modal = document.getElementById('modalRoot');
  modal.innerHTML = `
    <div class="fixed inset-0 z-40 flex items-center justify-center p-4" style="background: rgba(0,0,0,0.7);">
      <div class="card w-full max-w-sm p-5 space-y-3">
        <p class="font-display font-bold">Reviewing your progress…</p>
        <p class="text-sm" style="color: var(--text-muted);">Checking each exercise against your history.</p>
      </div>
    </div>`;

  const profile = Storage.getProfile();
  const exercisesLib = Storage.getExercises();
  const session = Storage.getActiveSession();
  const styleKey = (session && session.trainingStyle) || profile.trainingStyle;

  const results = [];
  for (const ex of day.exercises) {
    const exInfo = exercisesLib.find(x => x.id === ex.exerciseId);
    const name = exInfo ? exInfo.name : ex.name || 'Exercise';
    const baseline = Progression.suggestNextTarget({ exerciseId: ex.exerciseId, styleKey });

    let aiResult = null;
    if (GeminiClient.hasGeminiKey()) {
      aiResult = await Progression.suggestNextTargetAI({
        exerciseId: ex.exerciseId,
        exerciseName: name,
        styleKey,
        profile,
      });
    }
    results.push({ name, baseline, ai: aiResult && aiResult.ok ? aiResult.suggestion : null });
  }

  showRepeatOverloadResults(results, continueCallback);
}

function showRepeatOverloadResults(results, continueCallback) {
  const modal = document.getElementById('modalRoot');
  const anyAI = results.some(r => r.ai);
  modal.innerHTML = `
    <div class="fixed inset-0 z-40 flex items-center justify-center p-4" style="background: rgba(0,0,0,0.7);">
      <div class="card w-full max-w-sm p-5 space-y-4 max-h-[85vh] overflow-y-auto">
        <p class="font-display font-bold text-lg">Progressive overload plan</p>
        ${!anyAI ? `<p class="text-xs" style="color: var(--text-muted);">Showing rules-based targets only — add a Gemini API key in Settings for AI-reviewed suggestions too.</p>` : ''}
        <div class="space-y-2">
          ${results.map(r => {
            const weightLabel = r.baseline.suggestedWeight !== null ? `${r.baseline.suggestedWeight}kg` : 'n/a';
            return `
              <div class="p-3 rounded-lg" style="background: var(--bg-elevated);">
                <p class="text-sm font-medium">${r.name}</p>
                <p class="text-xs font-mono tag-logged mt-1">Target: ${weightLabel} × ${r.baseline.suggestedReps}, ${r.baseline.suggestedSets} sets</p>
                <p class="text-xs mt-1" style="color: var(--text-muted);">${r.baseline.message}</p>
                ${r.ai ? `
                  <div class="mt-2 pt-2 border-t" style="border-color: var(--border);">
                    <p class="text-xs tag-suggest font-medium">✨ AI ${r.ai.agreesWithBaseline ? 'agrees' : 'suggests an adjustment'}</p>
                    <p class="text-xs mt-0.5">${r.ai.suggestedWeight !== null ? r.ai.suggestedWeight + 'kg' : 'n/a'} × ${r.ai.suggestedReps}, ${r.ai.suggestedSets} sets</p>
                    <p class="text-xs mt-1" style="color: var(--text-muted);">${r.ai.reasoning}</p>
                  </div>` : ''}
              </div>`;
          }).join('')}
        </div>
        <button class="btn-primary w-full" onclick="closeModal(); window._repeatOverloadContinue && window._repeatOverloadContinue();">Got it, start session</button>
      </div>
    </div>`;
}

/* ============================================================
   PROGRAMS (saved plans library)
   ============================================================ */

function renderPrograms() {
  const el = document.getElementById('programsContent');
  const plans = [...Storage.getPlans()].sort((a, b) => b.createdAt - a.createdAt);

  if (plans.length === 0) {
    el.innerHTML = `<div class="card p-6 text-center"><p class="text-sm" style="color: var(--text-muted);">No saved programs yet. Generate one to see it here.</p></div>`;
    return;
  }

  const exercises = Storage.getExercises();
  const allSessions = Storage.getSessions();

  el.innerHTML = plans.map(plan => {
    const priorSessions = getSessionsForPlan(plan, allSessions);
    return `
    <div class="card p-4">
      <div class="flex items-center justify-between mb-1">
        <p class="font-display font-semibold">${plan.splitLabel || plan.splitKey}</p>
        ${plan.active ? '<span class="text-xs" style="color: var(--accent-logged);">Active</span>' : ''}
      </div>
      <p class="text-xs mb-3" style="color: var(--text-muted);">${plan.daysPerWeek} days/week &middot; ${(plan.goal || '').replace('_',' ')} &middot; ${new Date(plan.createdAt).toLocaleDateString()}</p>
      <div class="flex gap-2 mb-3">
        ${!plan.active ? `<button class="btn-secondary py-2 px-3 text-xs flex-1" onclick="setActiveProgram('${plan.id}')">Set active</button>` : ''}
        <button class="btn-secondary py-2 px-3 text-xs flex-1" style="color: var(--accent-warn, #E8B23A);" onclick="deleteProgram('${plan.id}')">Delete</button>
      </div>
      ${renderPlanSessionHistory(plan, priorSessions, exercises)}
    </div>`;
  }).join('');
}

// Finds every logged session whose exercises match one of this plan's days
// (same exercise-id set as maybeOfferRepeatProgramOverload uses), tagged
// with which day they belong to, most recent first.
function getSessionsForPlan(plan, allSessions) {
  if (!plan.days || !plan.days.length) return [];
  const dayFingerprints = plan.days.map(day => ({
    dayNumber: day.dayNumber,
    focus: day.focus,
    ids: [...new Set(day.exercises.map(e => e.exerciseId))].sort().join(','),
  }));

  return allSessions
    .map(s => {
      const sessionIds = [...new Set(s.entries.map(e => e.exerciseId))].sort().join(',');
      const match = dayFingerprints.find(d => d.ids === sessionIds);
      return match ? { session: s, dayNumber: match.dayNumber, focus: match.focus } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.session.date - a.session.date);
}

function renderPlanSessionHistory(plan, priorSessions, exercises) {
  if (priorSessions.length === 0) {
    return `<p class="text-xs" style="color: var(--text-muted);">No sessions logged for this program yet.</p>`;
  }

  const visibleCount = 3;
  const shown = priorSessions.slice(0, visibleCount);
  const rest = priorSessions.slice(visibleCount);

  const rowHtml = (item) => {
    const dateLabel = new Date(item.session.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const lifts = item.session.entries.map(entry => {
      const ex = exercises.find(x => x.id === entry.exerciseId);
      const setsLabel = entry.sets.map(set => `${set.weight ?? '—'}kg×${set.reps ?? '—'}`).join(', ');
      const noteLabel = entry.notes ? ` — 📝 ${entry.notes}` : '';
      return `${ex ? ex.name : 'exercise'}: ${setsLabel || '—'}${noteLabel}`;
    }).join(' | ');
    return `
      <div class="py-1.5 border-b" style="border-color: var(--border);">
        <div class="flex items-center justify-between">
          <span class="text-xs font-medium">${dateLabel} &middot; Day ${item.dayNumber}: ${item.focus}</span>
        </div>
        <p class="text-xs mt-0.5" style="color: var(--text-muted);">${lifts}</p>
      </div>`;
  };

  const restId = `planHistoryRest_${plan.id}`;
  return `
    <div class="pt-2 border-t" style="border-color: var(--border);">
      <p class="text-xs uppercase tracking-wide mb-1" style="color: var(--text-muted);">Previous sessions (${priorSessions.length})</p>
      ${shown.map(rowHtml).join('')}
      ${rest.length ? `
        <div id="${restId}" class="hidden">${rest.map(rowHtml).join('')}</div>
        <button class="text-xs mt-1" style="color: var(--accent-logged);" onclick="document.getElementById('${restId}').classList.toggle('hidden'); this.textContent = this.textContent.startsWith('Show') ? 'Hide older sessions' : 'Show ${rest.length} more';">Show ${rest.length} more</button>
      ` : ''}
    </div>`;
}

function setActiveProgram(planId) {
  Storage.setActivePlan(planId);
  renderPrograms();
}

function deleteProgram(planId) {
  if (!confirm('Delete this program? This can\'t be undone.')) return;
  Storage.deletePlan(planId);
  if (Nav.current === 'programs') renderPrograms();
  if (Nav.current === 'dashboard') renderDashboard();
}

/* ============================================================
   WORKOUT GENERATOR (questionnaire flow)
   ============================================================ */

let generatorState = {};

function renderGeneratorStart() {
  const profile = Storage.getProfile();
  generatorState = {
    goal: null,
    splitKey: null,
    styleKey: null,
    equipment: profile.equipment && profile.equipment.length ? profile.equipment : [],
    daysPerWeek: profile.daysPerWeek || 3,
    experienceLevel: profile.experienceLevel || 'beginner',
    customRequest: '',
    step: 1,
  };
  renderGeneratorStep();
}

const GENERATOR_STEPS = 5;

function renderGeneratorStep() {
  const el = document.getElementById('generatorStep');
  const step = generatorState.step;

  const progressBar = `
    <div class="flex gap-1.5 mb-5">
      ${Array.from({ length: GENERATOR_STEPS }, (_, i) => `
        <div class="flex-1 h-1.5 rounded-full" style="background: ${i < step ? 'var(--accent-logged)' : 'var(--border)'};"></div>
      `).join('')}
    </div>`;

  let body = '';

  if (step === 1) {
    body = `
      <p class="text-sm mb-3" style="color: var(--text-muted);">What's your main goal?</p>
      <div class="grid grid-cols-1 gap-2">
        ${optionButton('goal', 'strength', 'Strength', 'Heavier weight, lower reps')}
        ${optionButton('goal', 'hypertrophy', 'Hypertrophy', 'Muscle growth, moderate reps')}
        ${optionButton('goal', 'endurance', 'Endurance', 'Higher reps, less rest')}
        ${optionButton('goal', 'fat_loss', 'Fat Loss', 'Higher volume, shorter rest')}
      </div>`;
  } else if (step === 2) {
    body = `
      <p class="text-sm mb-3" style="color: var(--text-muted);">Preferred training split?</p>
      <div class="grid grid-cols-1 gap-2">
        ${optionButton('splitKey', 'full_body', 'Full Body', 'Every muscle group each session')}
        ${optionButton('splitKey', 'upper_lower', 'Upper / Lower', 'Alternating upper and lower days')}
        ${optionButton('splitKey', 'push_pull_legs', 'Push / Pull / Legs', 'Classic 3-way split')}
      </div>`;
  } else if (step === 3) {
    body = `
      <p class="text-sm mb-3" style="color: var(--text-muted);">Training style?</p>
      <div class="grid grid-cols-1 gap-2">
        ${optionButton('styleKey', 'hiit_low_volume', 'High Intensity / Low Volume', '3-6 reps, longer rest, weight-focused')}
        ${optionButton('styleKey', 'high_volume', 'High Volume / Low Intensity', '10-15 reps, shorter rest, rep-focused')}
        ${optionButton('styleKey', 'balanced', 'Balanced', '6-10 reps, moderate rest')}
      </div>`;
  } else if (step === 4) {
    const equipOptions = ['Bodyweight', 'Weighted Calisthenics', 'Dumbbells', 'Barbell', 'Machine', 'Cable Machine', 'Bands'];
    body = `
      <p class="text-sm mb-3" style="color: var(--text-muted);">What equipment do you have access to? (select all that apply)</p>
      <div class="grid grid-cols-2 gap-2 mb-4">
        ${equipOptions.map(eq => `
          <button class="equip-toggle btn-secondary py-2.5 text-sm ${generatorState.equipment.includes(eq) ? 'equip-active' : ''}"
                  style="${generatorState.equipment.includes(eq) ? 'border-color: var(--accent-logged); color: var(--accent-logged);' : ''}"
                  data-equip="${eq}" onclick="toggleEquipment('${eq}')">${eq}</button>
        `).join('')}
      </div>
      <button class="btn-primary w-full" onclick="generatorNext()">Continue</button>`;
  } else if (step === 5) {
    body = `
      <p class="text-sm mb-3" style="color: var(--text-muted);">Days per week & experience?</p>
      <label class="text-xs" style="color: var(--text-muted);">Days per week</label>
      <select id="daysPerWeekSelect" class="mb-3">
        ${[1,2,3,4,5,6].map(n => `<option value="${n}" ${generatorState.daysPerWeek === n ? 'selected' : ''}>${n} day${n > 1 ? 's' : ''}</option>`).join('')}
      </select>
      <label class="text-xs" style="color: var(--text-muted);">Experience level</label>
      <select id="experienceSelect" class="mb-4">
        <option value="beginner" ${generatorState.experienceLevel === 'beginner' ? 'selected' : ''}>Beginner</option>
        <option value="intermediate" ${generatorState.experienceLevel === 'intermediate' ? 'selected' : ''}>Intermediate</option>
        <option value="advanced" ${generatorState.experienceLevel === 'advanced' ? 'selected' : ''}>Advanced</option>
      </select>
      <label class="text-xs" style="color: var(--text-muted);">Anything specific you want in this plan? (optional)</label>
      <textarea id="customRequestInput" rows="2" placeholder="e.g. bad left knee, prioritize back, only 45 min sessions" class="mb-4">${generatorState.customRequest || ''}</textarea>
      <button class="btn-primary w-full" onclick="finishGeneratorQuestionnaire()">Generate my plan</button>`;
  }

  el.innerHTML = progressBar + `<div class="card p-4">${body}</div>`;
}

function optionButton(field, value, label, sub) {
  const active = generatorState[field] === value;
  return `
    <button class="text-left p-3 rounded-xl border transition-colors"
            style="border-color: ${active ? 'var(--accent-logged)' : 'var(--border)'}; background: ${active ? 'color-mix(in srgb, var(--accent-logged) 12%, transparent)' : 'var(--bg-elevated)'};"
            onclick="selectGeneratorOption('${field}', '${value}')">
      <p class="text-sm font-medium">${label}</p>
      <p class="text-xs mt-0.5" style="color: var(--text-muted);">${sub}</p>
    </button>`;
}

function selectGeneratorOption(field, value) {
  generatorState[field] = value;
  setTimeout(() => generatorNext(), 150);
}

function toggleEquipment(eq) {
  const idx = generatorState.equipment.indexOf(eq);
  if (idx >= 0) generatorState.equipment.splice(idx, 1);
  else generatorState.equipment.push(eq);
  renderGeneratorStep();
}

function generatorNext() {
  if (generatorState.step < GENERATOR_STEPS) {
    generatorState.step++;
    renderGeneratorStep();
  }
}

async function finishGeneratorQuestionnaire() {
  generatorState.daysPerWeek = parseInt(document.getElementById('daysPerWeekSelect').value, 10);
  generatorState.experienceLevel = document.getElementById('experienceSelect').value;
  generatorState.customRequest = document.getElementById('customRequestInput').value.trim();

  Storage.saveProfile({
    goal: generatorState.goal,
    trainingStyle: generatorState.styleKey,
    equipment: generatorState.equipment,
    daysPerWeek: generatorState.daysPerWeek,
    experienceLevel: generatorState.experienceLevel,
  });

  if (!GeminiClient.hasGeminiKey()) {
    promptForGeminiKey(() => finishGeneratorQuestionnaire());
    return;
  }

  const el = document.getElementById('generatorStep');
  el.innerHTML = `<div class="card p-6 text-center text-sm" style="color: var(--text-muted);">Asking your AI coach to build the plan...</div>`;

  const result = await GeneratorAI.generatePlanAI(generatorState);

  if (!result.ok) {
    if (result.error === 'missing_key') { promptForGeminiKey(() => finishGeneratorQuestionnaire()); return; }
    el.innerHTML = `
      <div class="card p-4 space-y-3">
        <p class="text-sm tag-suggest">AI generation failed: ${result.error}</p>
        <button class="btn-secondary w-full" onclick="finishGeneratorQuestionnaire()">Retry with AI</button>
        <button class="btn-primary w-full" onclick="useRulesFallback()">Use rules-based plan instead</button>
      </div>`;
    return;
  }

  Storage.saveActivePlan(result.plan);
  renderGeneratedPlan(result.plan);
}

function useRulesFallback() {
  const plan = Generator.generatePlan(generatorState);
  Storage.saveActivePlan(plan);
  renderGeneratedPlan(plan);
}

function renderGeneratedPlan(plan) {
  const el = document.getElementById('generatorStep');
  el.innerHTML = `
    <div class="space-y-3">
      <div class="card p-4">
        <p class="font-display font-bold text-lg">${plan.splitLabel}</p>
        <p class="text-sm" style="color: var(--text-muted);">${plan.daysPerWeek} days/week &middot; ${plan.goal.replace('_',' ')}</p>
        ${plan.coachNote ? `<p class="text-xs mt-2 tag-logged">${plan.coachNote}</p>` : ''}
        ${plan.customRequest ? `<p class="text-xs mt-2" style="color: var(--text-muted);">Your notes: ${plan.customRequest}</p>` : ''}
        ${plan.warnings.length ? `<p class="text-xs mt-2 tag-suggest">${plan.warnings.join(' ')}</p>` : ''}
      </div>
      ${plan.days.map(day => `
        <div class="card p-4">
          <p class="font-display font-semibold mb-2">Day ${day.dayNumber}: ${day.focus}</p>
          <div class="space-y-1.5">
            ${day.exercises.map(ex => `
              <div class="flex items-center justify-between text-sm py-1.5 border-b" style="border-color: var(--border);">
                <span>${ex.name}</span>
                <span class="font-mono text-xs" style="color: var(--text-muted);">${ex.targetSets}×${ex.targetReps}</span>
              </div>
            `).join('')}
          </div>
        </div>
      `).join('')}
      <button class="btn-primary w-full" onclick="Nav.go('dashboard')">Save & go to dashboard</button>
      <button class="btn-secondary w-full" onclick="renderGeneratorStart()">Start over</button>
    </div>`;
}

/* ============================================================
   MANUAL PROGRAM BUILDER (no AI, no rules-engine templates —
   the user picks their own days, exercises, sets/reps directly)
   ============================================================ */

let manualBuilderState = null;

function emptyManualDay(dayNumber) {
  return { dayNumber, focus: '', exercises: [] };
}

function renderManualBuilderStart() {
  manualBuilderState = {
    splitLabel: '',
    days: [emptyManualDay(1)],
  };
  renderManualBuilder();
}

function renderManualBuilder() {
  const el = document.getElementById('manualBuilderContent');
  const exercises = Storage.getExercises();
  const state = manualBuilderState;

  el.innerHTML = `
    <div class="card p-4 space-y-2">
      <label class="text-xs" style="color: var(--text-muted);">Program name</label>
      <input type="text" id="manualProgramName" placeholder="e.g. My Push Pull Legs" value="${escapeAttr(state.splitLabel)}" onchange="manualBuilderState.splitLabel = this.value">
    </div>

    ${state.days.map((day, dayIdx) => `
      <div class="card p-4 space-y-3">
        <div class="flex items-center justify-between">
          <p class="font-display font-semibold">Day ${day.dayNumber}</p>
          ${state.days.length > 1 ? `<button class="text-xs" style="color: var(--text-muted);" onclick="removeManualDay(${dayIdx})">Remove day</button>` : ''}
        </div>
        <input type="text" placeholder="Day focus (e.g. Push, Legs, Full Body)" value="${escapeAttr(day.focus)}" onchange="updateManualDayFocus(${dayIdx}, this.value)">

        <div class="space-y-2">
          ${day.exercises.map((ex, exIdx) => `
            <div class="p-3 rounded-lg space-y-2" style="background: var(--bg-elevated);">
              <div class="flex items-center justify-between">
                <p class="text-sm font-medium">${ex.name}</p>
                <button class="text-xs" style="color: var(--text-muted);" onclick="removeManualExercise(${dayIdx}, ${exIdx})">Remove</button>
              </div>
              <div class="grid grid-cols-2 gap-2">
                <div>
                  <label class="text-[10px] uppercase tracking-wide" style="color: var(--text-muted);">Sets</label>
                  <input type="number" inputmode="numeric" min="1" value="${ex.targetSets}" onchange="updateManualExerciseField(${dayIdx}, ${exIdx}, 'targetSets', this.value)">
                </div>
                <div>
                  <label class="text-[10px] uppercase tracking-wide" style="color: var(--text-muted);">Target reps</label>
                  <input type="text" placeholder="e.g. 8-12" value="${escapeAttr(ex.targetReps)}" onchange="updateManualExerciseField(${dayIdx}, ${exIdx}, 'targetReps', this.value)">
                </div>
              </div>
            </div>
          `).join('') || `<p class="text-xs" style="color: var(--text-muted);">No exercises added to this day yet.</p>`}
        </div>

        <button class="w-full btn-secondary py-2 text-sm" onclick="openExercisePickerForManualDay(${dayIdx})">+ Add exercise</button>
      </div>
    `).join('')}

    <button class="w-full btn-secondary py-3" onclick="addManualDay()">+ Add day</button>
    <button class="w-full btn-primary py-3" onclick="saveManualProgram()">Save program</button>
  `;
}

function escapeAttr(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function addManualDay() {
  manualBuilderState.days.push(emptyManualDay(manualBuilderState.days.length + 1));
  renderManualBuilder();
}

function removeManualDay(dayIdx) {
  manualBuilderState.days.splice(dayIdx, 1);
  // Renumber remaining days so Day N labels stay sequential
  manualBuilderState.days.forEach((d, i) => { d.dayNumber = i + 1; });
  renderManualBuilder();
}

function updateManualDayFocus(dayIdx, value) {
  manualBuilderState.days[dayIdx].focus = value;
}

function updateManualExerciseField(dayIdx, exIdx, field, value) {
  const ex = manualBuilderState.days[dayIdx].exercises[exIdx];
  ex[field] = field === 'targetSets' ? (parseInt(value, 10) || 1) : value;
}

function removeManualExercise(dayIdx, exIdx) {
  manualBuilderState.days[dayIdx].exercises.splice(exIdx, 1);
  renderManualBuilder();
}

function openExercisePickerForManualDay(dayIdx) {
  const exercises = Storage.getExercises();
  const modal = document.getElementById('modalRoot');
  modal.innerHTML = `
    <div class="fixed inset-0 z-40 flex items-end" style="background: rgba(0,0,0,0.6);" onclick="if(event.target===this) closeModal()">
      <div class="card w-full max-h-[75vh] rounded-b-none flex flex-col" style="border-bottom:none;">
        <div class="p-4 border-b" style="border-color: var(--border);">
          <p class="font-display font-semibold mb-2">Add exercise to Day ${manualBuilderState.days[dayIdx].dayNumber}</p>
          <input type="text" id="manualPickerSearch" placeholder="Search..." oninput="filterManualExercisePicker(${dayIdx}, this.value)">
        </div>
        <div id="manualPickerList" class="overflow-y-auto p-4 space-y-1.5 flex-1"></div>
      </div>
    </div>`;
  renderManualPickerList(dayIdx, exercises);
}

function renderManualPickerList(dayIdx, list) {
  const el = document.getElementById('manualPickerList');
  if (list.length === 0) {
    el.innerHTML = `<p class="text-sm text-center py-4" style="color: var(--text-muted);">No matches. Try the Library tab to add a custom exercise.</p>`;
    return;
  }
  el.innerHTML = list.map(ex => `
    <button class="w-full text-left p-3 rounded-lg btn-secondary flex items-center justify-between" onclick="pickExerciseForManualDay(${dayIdx}, '${ex.id}')">
      <span class="text-sm">${ex.name}</span>
      <span class="text-xs" style="color: var(--text-muted);">${ex.muscleGroup}</span>
    </button>`).join('');
}

function filterManualExercisePicker(dayIdx, query) {
  const q = query.toLowerCase();
  const filtered = Storage.getExercises().filter(ex => ex.name.toLowerCase().includes(q));
  renderManualPickerList(dayIdx, filtered);
}

function pickExerciseForManualDay(dayIdx, exerciseId) {
  const ex = Storage.getExercises().find(x => x.id === exerciseId);
  if (!ex) return;
  manualBuilderState.days[dayIdx].exercises.push({
    exerciseId: ex.id,
    name: ex.name,
    muscleGroup: ex.muscleGroup,
    equipment: ex.equipment,
    targetSets: 3,
    targetReps: '8-12',
    restSeconds: 90,
  });
  closeModal();
  renderManualBuilder();
}

function saveManualProgram() {
  const state = manualBuilderState;
  const nameInput = document.getElementById('manualProgramName');
  const splitLabel = (nameInput ? nameInput.value.trim() : '') || state.splitLabel || 'My Program';

  const nonEmptyDays = state.days.filter(d => d.exercises.length > 0);
  if (nonEmptyDays.length === 0) {
    alert('Add at least one exercise to at least one day before saving.');
    return;
  }

  const days = nonEmptyDays.map((d, i) => ({
    dayNumber: i + 1,
    focus: d.focus.trim() || `Day ${i + 1}`,
    exercises: d.exercises,
  }));

  const plan = {
    goal: Storage.getProfile().goal || 'custom',
    splitKey: 'manual',
    splitLabel,
    styleKey: Storage.getProfile().trainingStyle || 'balanced',
    daysPerWeek: days.length,
    days,
    coachNote: '',
    customRequest: '',
    warnings: [],
    source: 'manual',
  };

  Storage.saveActivePlan(plan);
  Nav.go('dashboard');
}

/* ============================================================
   LOG SESSION (the core, highest-friction-sensitivity screen)
   ============================================================ */

function renderLogSession() {
  let session = Storage.getActiveSession();
  if (!session) session = Storage.startNewSession();

  const container = document.getElementById('logSessionContent');
  const exercises = Storage.getExercises();

  if (session.entries.length === 0) {
    container.innerHTML = `
      <div class="card p-6 text-center">
        <p class="text-sm" style="color: var(--text-muted);">No exercises added yet. Tap "Add exercise" below to start logging.</p>
      </div>`;
    return;
  }

  container.innerHTML = session.entries.map((entry, entryIdx) => {
    const ex = exercises.find(x => x.id === entry.exerciseId);
    const suggestion = Progression.suggestNextTarget({ exerciseId: entry.exerciseId, styleKey: session.trainingStyle });

    return `
      <div class="card p-4">
        <div class="flex items-center justify-between mb-2">
          <p class="font-display font-semibold">${ex ? ex.name : 'Exercise'}</p>
          <button class="text-xs" style="color: var(--text-muted);" onclick="removeExerciseFromSession(${entryIdx})">Remove</button>
        </div>

        <div class="flex items-center gap-2 mb-2 p-2 rounded-lg" style="background: color-mix(in srgb, var(--accent-suggest) 10%, transparent);">
          <span class="dot-suggest w-2 h-2 rounded-full flex-shrink-0"></span>
          <p class="text-xs tag-suggest" id="coachNote-${entryIdx}">${suggestion.message}</p>
        </div>
        <div id="aiOverload-${entryIdx}" class="mb-3">
          <button class="text-xs" style="color: var(--text-muted);" onclick="requestAIOverload(${entryIdx}, '${entry.exerciseId}')">✨ Ask AI to review this target</button>
        </div>

        <div class="space-y-2">
          <div class="grid grid-cols-12 gap-2 text-[10px] uppercase tracking-wide px-1" style="color: var(--text-muted);">
            <span class="col-span-1">#</span>
            <span class="col-span-4">Weight</span>
            <span class="col-span-4">Reps</span>
            <span class="col-span-2">RPE</span>
            <span class="col-span-1"></span>
          </div>
          ${entry.sets.map((set, setIdx) => `
            <div class="grid grid-cols-12 gap-2 items-center">
              <span class="col-span-1 text-xs font-mono" style="color: var(--text-muted);">${setIdx + 1}</span>
              <input class="col-span-4 font-mono tag-logged" type="number" inputmode="decimal" placeholder="kg"
                     value="${set.weight ?? ''}"
                     onchange="updateSet(${entryIdx}, ${setIdx}, 'weight', this.value)">
              <input class="col-span-4 font-mono tag-logged" type="number" inputmode="numeric" placeholder="reps"
                     value="${set.reps ?? ''}"
                     onchange="updateSet(${entryIdx}, ${setIdx}, 'reps', this.value)">
              <input class="col-span-2 font-mono" type="number" inputmode="numeric" placeholder="—" min="1" max="10"
                     value="${set.rpe ?? ''}"
                     onchange="updateSet(${entryIdx}, ${setIdx}, 'rpe', this.value)">
              <button class="col-span-1 text-xs" style="color: var(--text-muted);" onclick="removeSet(${entryIdx}, ${setIdx})">✕</button>
            </div>
          `).join('')}
        </div>
        <button class="w-full btn-secondary mt-3 py-2 text-sm" onclick="addSetToEntry(${entryIdx})">+ Add set</button>
        <textarea class="w-full mt-3 text-sm" rows="2" placeholder="Notes (e.g. felt heavy, elbow pain, form cue)"
                  onchange="updateEntryNotes(${entryIdx}, this.value)">${entry.notes || ''}</textarea>
      </div>`;
  }).join('');

  if (GeminiClient.hasGeminiKey()) {
    const profile = Storage.getProfile();
    session.entries.forEach(async (entry, entryIdx) => {
      const ex = exercises.find(x => x.id === entry.exerciseId);
      const suggestion = Progression.suggestNextTarget({ exerciseId: entry.exerciseId, styleKey: session.trainingStyle });
      const narration = await CoachNarration.narrateCoachingFeedback({ exerciseName: ex ? ex.name : 'exercise', suggestion, profile });
      const noteEl = document.getElementById(`coachNote-${entryIdx}`);
      if (narration.ok && noteEl) noteEl.textContent = narration.text;
    });
  }
}

async function requestAIOverload(entryIdx, exerciseId) {
  if (!GeminiClient.hasGeminiKey()) { promptForGeminiKey(() => requestAIOverload(entryIdx, exerciseId)); return; }

  const el = document.getElementById(`aiOverload-${entryIdx}`);
  if (!el) return;
  el.innerHTML = `<p class="text-xs" style="color: var(--text-muted);">Checking with AI…</p>`;

  const session = Storage.getActiveSession();
  const exercises = Storage.getExercises();
  const ex = exercises.find(x => x.id === exerciseId);
  const profile = Storage.getProfile();

  const result = await Progression.suggestNextTargetAI({
    exerciseId,
    exerciseName: ex ? ex.name : 'exercise',
    styleKey: session.trainingStyle,
    profile,
  });

  if (!result.ok) {
    el.innerHTML = `<p class="text-xs" style="color: var(--accent-warn, #E8B23A);">Couldn't get an AI suggestion (${result.error === 'missing_key' ? 'no API key' : result.error}).</p>`;
    return;
  }

  const s = result.suggestion;
  const weightLabel = s.suggestedWeight !== null ? `${s.suggestedWeight}kg` : 'no change';
  const agreeLabel = s.agreesWithBaseline ? 'Agrees with the baseline' : 'Suggests an adjustment';

  el.innerHTML = `
    <div class="p-2 rounded-lg text-xs" style="background: color-mix(in srgb, var(--accent-logged) 10%, transparent); color: var(--text);">
      <p class="font-medium mb-0.5">✨ AI suggestion — ${agreeLabel}</p>
      <p>${weightLabel} × ${s.suggestedReps}, ${s.suggestedSets} sets</p>
      <p class="mt-1" style="color: var(--text-muted);">${s.reasoning}</p>
    </div>`;
}

function addSetToEntry(entryIdx) {
  const session = Storage.getActiveSession();
  const lastSet = session.entries[entryIdx].sets[session.entries[entryIdx].sets.length - 1];
  session.entries[entryIdx].sets.push({
    weight: lastSet ? lastSet.weight : null,
    reps: lastSet ? lastSet.reps : null,
    rpe: null,
    isWarmup: false,
  });
  Storage.saveActiveSession(session);
  renderLogSession();
}

function removeSet(entryIdx, setIdx) {
  const session = Storage.getActiveSession();
  session.entries[entryIdx].sets.splice(setIdx, 1);
  Storage.saveActiveSession(session);
  renderLogSession();
}

function updateEntryNotes(entryIdx, value) {
  const session = Storage.getActiveSession();
  session.entries[entryIdx].notes = value;
  Storage.saveActiveSession(session);
}

function updateSet(entryIdx, setIdx, field, value) {
  const session = Storage.getActiveSession();
  const parsed = value === '' ? null : parseFloat(value);
  session.entries[entryIdx].sets[setIdx][field] = parsed;
  Storage.saveActiveSession(session);
}

function removeExerciseFromSession(entryIdx) {
  const session = Storage.getActiveSession();
  session.entries.splice(entryIdx, 1);
  Storage.saveActiveSession(session);
  renderLogSession();
}

function openExercisePickerForSession() {
  const exercises = Storage.getExercises();
  const modal = document.getElementById('modalRoot');
  modal.innerHTML = `
    <div class="fixed inset-0 z-40 flex items-end" style="background: rgba(0,0,0,0.6);" onclick="if(event.target===this) closeModal()">
      <div class="card w-full max-h-[75vh] rounded-b-none flex flex-col" style="border-bottom:none;">
        <div class="p-4 border-b" style="border-color: var(--border);">
          <p class="font-display font-semibold mb-2">Add exercise</p>
          <input type="text" id="pickerSearch" placeholder="Search..." oninput="filterExercisePicker(this.value)">
        </div>
        <div id="pickerList" class="overflow-y-auto p-4 space-y-1.5 flex-1"></div>
      </div>
    </div>`;
  renderPickerList(exercises);
}

function renderPickerList(list) {
  const el = document.getElementById('pickerList');
  if (list.length === 0) {
    el.innerHTML = `<p class="text-sm text-center py-4" style="color: var(--text-muted);">No matches. Try the Library tab to add a custom exercise.</p>`;
    return;
  }
  el.innerHTML = list.map(ex => `
    <button class="w-full text-left p-3 rounded-lg btn-secondary flex items-center justify-between" onclick="pickExerciseForSession('${ex.id}')">
      <span class="text-sm">${ex.name}</span>
      <span class="text-xs" style="color: var(--text-muted);">${ex.muscleGroup}</span>
    </button>`).join('');
}

function filterExercisePicker(query) {
  const q = query.toLowerCase();
  const filtered = Storage.getExercises().filter(ex => ex.name.toLowerCase().includes(q));
  renderPickerList(filtered);
}

function pickExerciseForSession(exerciseId) {
  const session = Storage.getActiveSession();
  session.entries.push({
    exerciseId,
    notes: '',
    sets: [{ weight: null, reps: null, rpe: null, isWarmup: false }],
  });
  Storage.saveActiveSession(session);
  closeModal();
  renderLogSession();
}

function closeModal() {
  document.getElementById('modalRoot').innerHTML = '';
}

function confirmLeaveSession() {
  Nav.go('dashboard');
}

async function finishSession() {
  const session = Storage.getActiveSession();
  if (!session || session.entries.length === 0) {
    Nav.go('dashboard');
    return;
  }

  // Build post-workout summary before clearing the active session
  const exercises = Storage.getExercises();
  const summaryRows = session.entries.map(entry => {
    const ex = exercises.find(x => x.id === entry.exerciseId);
    const topSet = Progression.getTopSet(entry.sets);
    const evalResult = topSet ? Progression.evaluateCompletedSet(entry.exerciseId, topSet) : { classification: 'first_time' };
    return { name: ex ? ex.name : 'Exercise', topSet, classification: evalResult.classification, previousTopSet: evalResult.previousTopSet };
  });

  Storage.addSession(session);
  Storage.clearActiveSession();

  showPostWorkoutSummary(summaryRows, null);

  if (GeminiClient.hasGeminiKey()) {
    const profile = Storage.getProfile();
    const narration = await CoachNarration.narratePostWorkoutSummary({ rows: summaryRows, profile });
    if (narration.ok) showPostWorkoutSummary(summaryRows, narration.text);
  }
}

function showPostWorkoutSummary(rows, aiNote) {
  const modal = document.getElementById('modalRoot');
  const labelFor = {
    first_time: { text: 'First time logged', color: 'var(--accent-logged)' },
    met_or_exceeded: { text: 'Progressed', color: 'var(--accent-success)' },
    missed_slightly: { text: 'Close — hold steady next time', color: 'var(--accent-warn)' },
    missed_significantly: { text: 'Regressed', color: 'var(--accent-suggest)' },
  };

  modal.innerHTML = `
    <div class="fixed inset-0 z-40 flex items-center justify-center p-4" style="background: rgba(0,0,0,0.7);">
      <div class="card w-full max-w-sm p-5 space-y-4 max-h-[85vh] overflow-y-auto">
        <p class="font-display font-bold text-lg">Session complete</p>
        ${aiNote ? `<p class="text-sm tag-logged">${aiNote}</p>` : (GeminiClient.hasGeminiKey() ? `<p class="text-xs" style="color: var(--text-muted);">Getting your coach's take...</p>` : '')}
        <div class="space-y-2">
          ${rows.map(r => {
            const info = labelFor[r.classification] || labelFor.first_time;
            return `
              <div class="p-3 rounded-lg" style="background: var(--bg-elevated);">
                <div class="flex items-center justify-between">
                  <p class="text-sm font-medium">${r.name}</p>
                  <span class="text-xs font-medium" style="color: ${info.color};">${info.text}</span>
                </div>
                ${r.topSet ? `<p class="text-xs font-mono mt-1" style="color: var(--text-muted);">Top set: ${r.topSet.weight ?? '—'}kg × ${r.topSet.reps ?? '—'}</p>` : ''}
              </div>`;
          }).join('')}
        </div>
        <button class="btn-primary w-full" onclick="closeModal(); Nav.go('dashboard');">Done</button>
      </div>
    </div>`;
}

/* ============================================================
   HISTORY
   ============================================================ */

function renderHistory() {
  const sessions = [...Storage.getSessions()].sort((a, b) => b.date - a.date);
  const exercises = Storage.getExercises();
  const el = document.getElementById('historyContent');

  if (sessions.length === 0) {
    el.innerHTML = `<div class="card p-6 text-center text-sm" style="color: var(--text-muted);">No sessions yet. Your history will build up here.</div>`;
    return;
  }

  el.innerHTML = sessions.map(s => {
    const dateLabel = new Date(s.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    return `
      <div class="card p-4">
        <p class="font-display font-semibold text-sm mb-2">${dateLabel}</p>
        <div class="space-y-1.5">
          ${s.entries.map(entry => {
            const ex = exercises.find(x => x.id === entry.exerciseId);
            const setsLabel = entry.sets.map(set => `${set.weight ?? '—'}kg×${set.reps ?? '—'}${set.isWarmup ? ' (warmup)' : ''}`).join(', ');
            return `
              <div class="text-sm">
                <div class="flex items-center justify-between">
                  <span>${ex ? ex.name : 'Exercise'}</span>
                  <span class="font-mono text-xs tag-logged">${setsLabel || '—'}</span>
                </div>
                ${entry.notes ? `<p class="text-xs mt-0.5" style="color: var(--text-muted);">📝 ${entry.notes}</p>` : ''}
              </div>`;
          }).join('')}
        </div>
      </div>`;
  }).join('');
}

/* ============================================================
   EXERCISE LIBRARY
   ============================================================ */

function renderLibrary() {
  const query = (document.getElementById('librarySearch')?.value || '').toLowerCase();
  const exercises = Storage.getExercises().filter(ex => ex.name.toLowerCase().includes(query));
  const el = document.getElementById('libraryContent');

  const groups = {};
  exercises.forEach(ex => {
    if (!groups[ex.muscleGroup]) groups[ex.muscleGroup] = [];
    groups[ex.muscleGroup].push(ex);
  });

  el.innerHTML = Object.keys(groups).sort().map(group => `
    <div>
      <p class="text-xs uppercase tracking-wide mb-1.5 mt-3" style="color: var(--text-muted);">${group}</p>
      <div class="space-y-1.5">
        ${groups[group].map(ex => `
          <div class="card p-3">
            <div class="flex items-center justify-between">
              <p class="text-sm font-medium">${ex.name}</p>
              <span class="text-xs px-2 py-0.5 rounded-full" style="background: var(--bg-elevated); color: var(--text-muted);">${ex.equipment}</span>
            </div>
            ${ex.cues ? `<p class="text-xs mt-1" style="color: var(--text-muted);">${ex.cues}</p>` : ''}
          </div>
        `).join('')}
      </div>
    </div>
  `).join('') || `<p class="text-sm text-center py-6" style="color: var(--text-muted);">No exercises match your search.</p>`;
}

function openAddExerciseModal() {
  const modal = document.getElementById('modalRoot');
  modal.innerHTML = `
    <div class="fixed inset-0 z-40 flex items-center justify-center p-4" style="background: rgba(0,0,0,0.7);" onclick="if(event.target===this) closeModal()">
      <div class="card w-full max-w-sm p-5 space-y-3">
        <p class="font-display font-bold">Add custom exercise</p>
        <input type="text" id="newExName" placeholder="Exercise name">
        <select id="newExGroup">
          ${['Chest','Back','Legs','Shoulders','Arms','Core','Other'].map(g => `<option value="${g}">${g}</option>`).join('')}
        </select>
        <select id="newExEquip">
          ${['Bodyweight','Weighted Calisthenics','Dumbbells','Barbell','Machine','Cable Machine','Bands'].map(e => `<option value="${e}">${e}</option>`).join('')}
        </select>
        <textarea id="newExCues" placeholder="Form cues (optional)" rows="2"></textarea>
        <input type="text" id="newExVideo" placeholder="Video link (optional)">
        <div class="flex gap-2 pt-1">
          <button class="btn-secondary flex-1" onclick="closeModal()">Cancel</button>
          <button class="btn-primary flex-1" onclick="submitNewExercise()">Add</button>
        </div>
      </div>
    </div>`;
}

function submitNewExercise() {
  const name = document.getElementById('newExName').value.trim();
  if (!name) return;
  Storage.addExercise({
    name,
    muscleGroup: document.getElementById('newExGroup').value,
    equipment: document.getElementById('newExEquip').value,
    cues: document.getElementById('newExCues').value.trim(),
    videoUrl: document.getElementById('newExVideo').value.trim(),
    isCustom: true,
  });
  closeModal();
  renderLibrary();
}

/* ============================================================
   SETTINGS
   ============================================================ */

function renderThemeGrid() {
  const grid = document.getElementById('themeGrid');
  const current = Storage.getSettings().theme;
  grid.innerHTML = Object.entries(Themes.THEMES).map(([key, theme]) => `
    <button class="flex items-center gap-2 p-3 rounded-xl border text-left"
            style="border-color: ${current === key ? 'var(--accent-logged)' : 'var(--border)'};"
            onclick="selectTheme('${key}')">
      <span class="w-4 h-4 rounded-full flex-shrink-0" style="background: ${theme.swatch};"></span>
      <span class="text-sm">${theme.label}</span>
    </button>
  `).join('');
}

function selectTheme(key) {
  Storage.saveSettings({ theme: key });
  Themes.applyTheme(key);
  renderThemeGrid();
}

function renderSettingsForm() {
  const profile = Storage.getProfile();
  const settings = Storage.getSettings();
  const styleSelect = document.getElementById('settingsStyleSelect');
  styleSelect.innerHTML = Object.entries(Progression.TRAINING_STYLES).map(([key, s]) => `
    <option value="${key}" ${profile.trainingStyle === key ? 'selected' : ''}>${s.label}</option>
  `).join('');
  document.getElementById('settingsUnitsSelect').value = settings.units;
  const status = document.getElementById('geminiKeyStatus');
  if (status) {
    status.textContent = GeminiClient.hasGeminiKey() ? 'Key is set.' : 'No key set yet.';
    status.style.color = GeminiClient.hasGeminiKey() ? 'var(--accent-success)' : 'var(--text-muted)';
  }
}

function onStyleChange(value) {
  Storage.saveProfile({ trainingStyle: value });
}

function onUnitsChange(value) {
  Storage.saveSettings({ units: value });
}

function saveGeminiKeyFromSettings() {
  const val = document.getElementById('geminiKeyInput').value.trim();
  if (!val) return;
  GeminiClient.setGeminiKey(val);
  document.getElementById('geminiKeyInput').value = '';
  document.getElementById('geminiKeyStatus').textContent = 'Key saved.';
  document.getElementById('geminiKeyStatus').style.color = 'var(--accent-success)';
}

/* ---------------- Gemini key prompt (blocking gate for AI features) ---------------- */

function promptForGeminiKey(onSaved) {
  const modal = document.getElementById('modalRoot');
  modal.innerHTML = `
    <div class="fixed inset-0 z-40 flex items-center justify-center p-4" style="background: rgba(0,0,0,0.7);">
      <div class="card w-full max-w-sm p-5 space-y-3">
        <p class="font-display font-bold">Add your Gemini API key</p>
        <p class="text-xs" style="color: var(--text-muted);">This app uses Gemini to generate workouts and coaching feedback. Your key is stored only in this browser and sent directly to Google's API.</p>
        <input type="text" id="keyPromptInput" placeholder="Paste your Gemini API key">
        <div class="flex gap-2 pt-1">
          <button class="btn-secondary flex-1" onclick="closeModal()">Cancel</button>
          <button class="btn-primary flex-1" onclick="submitKeyPrompt()">Save & continue</button>
        </div>
      </div>
    </div>`;
  window._onKeySaved = onSaved;
}

function submitKeyPrompt() {
  const val = document.getElementById('keyPromptInput').value.trim();
  if (!val) return;
  GeminiClient.setGeminiKey(val);
  closeModal();
  if (window._onKeySaved) { const cb = window._onKeySaved; window._onKeySaved = null; cb(); }
}

/* ============================================================
   CHATBOT
   ============================================================ */

let chatHistory = [];

function renderChatView() {
  const el = document.getElementById('chatMessages');
  if (chatHistory.length === 0) {
    el.innerHTML = `<div class="card p-4 text-sm" style="color: var(--text-muted);">Ask about training, recovery, or nutrition. Answers are grounded in your logged workouts and profile where relevant — not a substitute for medical advice.</div>`;
  } else {
    el.innerHTML = chatHistory.map(m => `
      <div class="flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}">
        <div class="card p-3 max-w-[85%] text-sm" style="${m.role === 'user' ? 'background: var(--accent-logged); color: #0E0F12; border: none;' : ''}">
          ${m.text}
        </div>
      </div>`).join('');
  }
  document.getElementById('chatMessages').scrollIntoView({ block: 'end' });
}

async function sendChatMessage() {
  const input = document.getElementById('chatInput');
  const text = input.value.trim();
  if (!text) return;

  if (!GeminiClient.hasGeminiKey()) {
    promptForGeminiKey(() => sendChatMessage());
    return;
  }

  chatHistory.push({ role: 'user', text });
  input.value = '';
  renderChatView();

  chatHistory.push({ role: 'assistant', text: 'Thinking...' });
  renderChatView();

  const result = await Chatbot.askChatbot(text, chatHistory.slice(0, -2));
  chatHistory.pop(); // remove "Thinking..."

  if (!result.ok) {
    chatHistory.push({ role: 'assistant', text: `Couldn't reach the coach: ${result.error === 'missing_key' ? 'no API key set.' : result.error}` });
  } else {
    chatHistory.push({ role: 'assistant', text: result.text });
  }
  renderChatView();
}
