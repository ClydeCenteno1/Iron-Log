/* ============================================================
   APP CONTROLLER
   Vanilla JS, no framework. Views are toggled via .active class;
   each render function rebuilds its section's innerHTML from
   current storage state. Simple, debuggable, no virtual DOM.
   ============================================================ */

/* ---------------- Escaping helper ----------------
   Every user-generated or exercise-library string (names, notes, custom
   requests, chat messages) gets funneled through this before landing in
   innerHTML. Without it, a name like `Curl <img src=x onerror=...>` or
   one containing a stray quote either breaks an onclick="...('${id}')"
   attribute outright or, worse, injects arbitrary HTML/script that
   persists in localStorage and re-fires on every future render. */
function escapeHTML(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
// Kept as an alias — used historically for attribute values specifically,
// but the same escaping is safe (and necessary) in text content too.
function escapeAttr(str) {
  return escapeHTML(str);
}

/* ---------------- Chat markdown rendering ----------------
   The chatbot's system prompt asks for concise prose, but nothing stops
   the model from reaching for markdown (bold, bullets) the way it would
   in any other chat surface — and it does, often. escapeHTML() alone left
   that markdown as literal asterisks with no line breaks (HTML collapses
   raw \n), so a bulleted answer rendered as one run-on paragraph full of
   ** and * characters instead of an actual list.

   This escapes first (XSS-safe — same as every other AI-text call site),
   then converts a deliberately small, safe subset of markdown on top of
   the now-inert escaped text: **bold**, "- "/"* " bullet lines -> <ul>,
   blank-line-separated paragraphs, and single newlines -> <br>. No links,
   no raw HTML passthrough, no nested/complex markdown — a chat bubble
   doesn't need more than this, and less surface area here means less to
   get wrong. Only ever use this for ASSISTANT messages; user messages
   are shown as literal escaped text, which is correct (we're not trying
   to interpret the user's own input as formatting).
*/
function renderChatMarkdown(text) {
  const escaped = escapeHTML(text);

  // Bold: **text** -> <strong>text</strong>. Runs after escaping, so the
  // asterisks here are literal characters in the escaped string, not markup.
  const withBold = escaped.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

  // Split into blocks on blank lines, then render each block as either a
  // bullet list (every line starts with "- " or "* ") or a paragraph with
  // single newlines turned into <br>.
  const blocks = withBold.split(/\n\s*\n/);
  const html = blocks.map(block => {
    const lines = block.split('\n').filter(l => l.trim() !== '');
    if (lines.length === 0) return '';
    const isList = lines.every(l => /^(-|\*)\s+/.test(l.trim()));
    if (isList) {
      const items = lines.map(l => `<li>${l.trim().replace(/^(-|\*)\s+/, '')}</li>`).join('');
      return `<ul class="pl-4 my-1" style="list-style: disc;">${items}</ul>`;
    }
    return `<p class="my-1">${lines.join('<br>')}</p>`;
  }).join('');

  return html || escaped;
}

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
  document.getElementById('settingsBtn').addEventListener('click', () => Nav.go('settings'));

  // If the tab is left open across midnight, "today's" meals/weight would
  // otherwise stay stuck on whatever day the view last rendered — recheck
  // the calendar day whenever the tab regains focus/visibility.
  let lastKnownDay = new Date().toDateString();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    const today = new Date().toDateString();
    if (today !== lastKnownDay) {
      lastKnownDay = today;
      if (Nav.current === 'nutrition') renderNutrition();
    }
  });
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

    // #chatInputBar lives outside .view (see index.html comment) so it
    // isn't shown/hidden by the .active class swap above — toggle it here.
    const chatInputBar = document.getElementById('chatInputBar');
    if (chatInputBar) chatInputBar.style.display = viewName === 'chat' ? 'block' : 'none';

    if (viewName === 'dashboard') renderDashboard();
    if (viewName === 'generator') renderGeneratorStart();
    if (viewName === 'manualBuilder') {
      if (manualBuilderEditingPlanId && manualBuilderState) renderManualBuilder();
      else renderManualBuilderStart();
    }
    if (viewName === 'log') renderLogSession();
    if (viewName === 'history') renderHistory();
    if (viewName === 'library') renderLibrary();
    if (viewName === 'programs') renderPrograms();
    if (viewName === 'chat') renderChatView();
    if (viewName === 'nutrition') renderNutrition();
    if (viewName === 'nutritionProfile') renderNutritionProfileForm();
    if (viewName === 'settings') { renderThemeGrid(); renderSettingsForm(); }

    window.scrollTo(0, 0);
  },
};

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
          <p class="font-display font-semibold">${escapeHTML(plan.splitLabel)}</p>
          <p class="text-xs" style="color: var(--text-muted);">${plan.daysPerWeek} days/week &middot; ${escapeHTML((plan.goal || '').replace('_',' '))}</p>
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
            <span>Day ${day.dayNumber}: ${escapeHTML(day.focus)}</span>
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
    dot.className = 'flex-1 h-8 rounded-md flex items-center justify-center text-[10px] font-mono stagger-in';
    dot.style.animationDelay = `${(6 - i) * 30}ms`;
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
        return escapeHTML(ex ? ex.name : 'Unknown exercise');
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
    <div class="fixed inset-0 z-40 flex items-center justify-center p-4 modal-backdrop" style="background: rgba(0,0,0,0.7);">
      <div class="modal-sheet card w-full max-w-sm p-5 space-y-3">
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
    <div class="fixed inset-0 z-40 flex items-center justify-center p-4 modal-backdrop" style="background: rgba(0,0,0,0.7);">
      <div class="modal-sheet card w-full max-w-sm p-5 space-y-3">
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
    if (AIProvider.hasAnyKey()) {
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
    <div class="fixed inset-0 z-40 flex items-center justify-center p-4 modal-backdrop" style="background: rgba(0,0,0,0.7);">
      <div class="modal-sheet card w-full max-w-sm p-5 space-y-4 max-h-[85vh] overflow-y-auto">
        <p class="font-display font-bold text-lg">Progressive overload plan</p>
        ${!anyAI ? `<p class="text-xs" style="color: var(--text-muted);">Showing rules-based targets only — add a Gemini API key in Settings for AI-reviewed suggestions too.</p>` : ''}
        <div class="space-y-2">
          ${results.map(r => {
            const weightLabel = r.baseline.suggestedWeight !== null ? `${r.baseline.suggestedWeight}kg` : 'n/a';
            return `
              <div class="p-3 rounded-lg" style="background: var(--bg-elevated);">
                <p class="text-sm font-medium">${escapeHTML(r.name)}</p>
                <p class="text-xs font-mono tag-logged mt-1">Target: ${weightLabel} × ${escapeHTML(String(r.baseline.suggestedReps))}, ${r.baseline.suggestedSets} sets</p>
                <p class="text-xs mt-1" style="color: var(--text-muted);">${escapeHTML(r.baseline.message)}</p>
                ${r.ai ? `
                  <div class="mt-2 pt-2 border-t" style="border-color: var(--border);">
                    <p class="text-xs tag-suggest font-medium">✨ AI ${r.ai.agreesWithBaseline ? 'agrees' : 'suggests an adjustment'}</p>
                    <p class="text-xs mt-0.5">${r.ai.suggestedWeight !== null ? r.ai.suggestedWeight + 'kg' : 'n/a'} × ${escapeHTML(String(r.ai.suggestedReps))}, ${r.ai.suggestedSets} sets</p>
                    <p class="text-xs mt-1" style="color: var(--text-muted);">${escapeHTML(r.ai.reasoning)}</p>
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
        ${plan.source === 'manual' ? `<button class="btn-secondary py-2 px-3 text-xs flex-1" onclick="editManualProgram('${plan.id}')">Edit</button>` : ''}
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
      const noteLabel = entry.notes ? ` — 📝 ${escapeHTML(entry.notes)}` : '';
      return `${escapeHTML(ex ? ex.name : 'exercise')}: ${setsLabel || '—'}${noteLabel}`;
    }).join(' | ');
    return `
      <div class="py-1.5 border-b" style="border-color: var(--border);">
        <div class="flex items-center justify-between">
          <span class="text-xs font-medium">${dateLabel} &middot; Day ${item.dayNumber}: ${escapeHTML(item.focus)}</span>
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
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
        ${optionButton('goal', 'strength', 'Strength', 'Heavier weight, lower reps')}
        ${optionButton('goal', 'hypertrophy', 'Hypertrophy', 'Muscle growth, moderate reps')}
        ${optionButton('goal', 'endurance', 'Endurance', 'Higher reps, less rest')}
        ${optionButton('goal', 'fat_loss', 'Fat Loss', 'Higher volume, shorter rest')}
      </div>`;
  } else if (step === 2) {
    body = `
      <p class="text-sm mb-3" style="color: var(--text-muted);">Preferred training split?</p>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
        ${optionButton('splitKey', 'full_body', 'Full Body', 'Every muscle group each session')}
        ${optionButton('splitKey', 'upper_lower', 'Upper / Lower', 'Alternating upper and lower days')}
        ${optionButton('splitKey', 'push_pull_legs', 'Push / Pull / Legs', 'Classic 3-way split')}
      </div>`;
  } else if (step === 3) {
    body = `
      <p class="text-sm mb-3" style="color: var(--text-muted);">Training style?</p>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
        ${optionButton('styleKey', 'hiit_low_volume', 'High Intensity / Low Volume', '3-6 reps, longer rest, weight-focused')}
        ${optionButton('styleKey', 'high_volume', 'High Volume / Low Intensity', '10-15 reps, shorter rest, rep-focused')}
        ${optionButton('styleKey', 'balanced', 'Balanced', '6-10 reps, moderate rest')}
      </div>`;
  } else if (step === 4) {
    const equipOptions = ['Bodyweight', 'Weighted Calisthenics', 'Dumbbells', 'Barbell', 'Machine', 'Cable Machine', 'Bands'];
    body = `
      <p class="text-sm mb-3" style="color: var(--text-muted);">What equipment do you have access to? (select all that apply)</p>
      <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 mb-4">
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

  if (!AIProvider.hasAnyKey()) {
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
        <p class="font-display font-bold text-lg">${escapeHTML(plan.splitLabel)}</p>
        <p class="text-sm" style="color: var(--text-muted);">${plan.daysPerWeek} days/week &middot; ${escapeHTML(plan.goal.replace('_',' '))}</p>
        ${plan.coachNote ? `<p class="text-xs mt-2 tag-logged">${escapeHTML(plan.coachNote)}</p>` : ''}
        ${plan.customRequest ? `<p class="text-xs mt-2" style="color: var(--text-muted);">Your notes: ${escapeHTML(plan.customRequest)}</p>` : ''}
        ${plan.warnings.length ? `<p class="text-xs mt-2 tag-suggest">${escapeHTML(plan.warnings.join(' '))}</p>` : ''}
      </div>
      ${plan.days.map(day => `
        <div class="card p-4">
          <p class="font-display font-semibold mb-2">Day ${day.dayNumber}: ${escapeHTML(day.focus)}</p>
          <div class="space-y-1.5">
            ${day.exercises.map(ex => `
              <div class="flex items-center justify-between text-sm py-1.5 border-b" style="border-color: var(--border);">
                <span>${escapeHTML(ex.name)}</span>
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
let manualBuilderEditingPlanId = null; // null = creating new; set = updating existing plan in place

function emptyManualDay(dayNumber) {
  return { dayNumber, focus: '', exercises: [] };
}

function renderManualBuilderStart() {
  manualBuilderEditingPlanId = null;
  manualBuilderState = {
    splitLabel: '',
    days: [emptyManualDay(1)],
  };
  renderManualBuilder();
}

// Loads an existing saved (manual) program back into the builder for editing,
// preserving each exercise's actual saved targetSets/targetReps rather than
// resetting them to the picker default of 3 sets / 8-12 reps.
function editManualProgram(planId) {
  const plan = Storage.getPlans().find(p => p.id === planId);
  if (!plan) return;
  manualBuilderEditingPlanId = planId;
  manualBuilderState = {
    splitLabel: plan.splitLabel || '',
    days: plan.days.map(d => ({
      dayNumber: d.dayNumber,
      focus: d.focus || '',
      exercises: d.exercises.map(ex => ({ ...ex })),
    })),
  };
  Nav.go('manualBuilder');
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
                <p class="text-sm font-medium">${escapeHTML(ex.name)}</p>
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
    <div class="fixed inset-0 z-40 flex items-end modal-backdrop" style="background: rgba(0,0,0,0.6);" onclick="if(event.target===this) closeModal()">
      <div class="modal-sheet card w-full max-h-[75vh] rounded-b-none flex flex-col" style="border-bottom:none;">
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
      <span class="text-sm">${escapeHTML(ex.name)}</span>
      <span class="text-xs" style="color: var(--text-muted);">${escapeHTML(ex.muscleGroup)}</span>
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

  if (manualBuilderEditingPlanId) {
    Storage.updatePlan(manualBuilderEditingPlanId, plan);
    showToast('Program updated');
  } else {
    Storage.saveActivePlan(plan);
    showToast('Program saved');
  }
  manualBuilderEditingPlanId = null;
  Nav.go('dashboard');
}

/* ============================================================
   LOG SESSION (the core, highest-friction-sensitivity screen)
   ============================================================ */

// Bumped every time the log-session view is (re)rendered. Async coaching
// narration calls capture the value at fetch time and check it back against
// the current value before writing into the DOM, so a response that resolves
// after the user has added/removed/reordered exercises (which shifts what
// entryIdx N actually points at) can't land on the wrong card — or a stale
// one — after a re-render.
// Cache coach narration per exercise+suggestion+profile signature so
// re-renders (typing a weight, ticking a box, adding a set) don't re-fire
// an AI call for every exercise on every keystroke. Only a genuinely new
// coaching decision (different exercise, the progression suggestion
// changing, or the person's goal/experience level changing) results in a
// fresh call. Cleared whenever a session ends, since a new workout may
// start under a different training style and old notes shouldn't linger
// indefinitely in memory.
const coachNoteCache = {};

function clearCoachNoteCache() {
  for (const key in coachNoteCache) delete coachNoteCache[key];
}

let logSessionRenderGen = 0;

function renderLogSession() {
  let session = Storage.getActiveSession();
  if (!session) session = Storage.startNewSession();

  const container = document.getElementById('logSessionContent');
  const exercises = Storage.getExercises();
  const thisGen = ++logSessionRenderGen;

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
    const lastLogged = Storage.getLastSessionForExercise(entry.exerciseId);
    const prevSets = lastLogged ? lastLogged.entry.sets.filter(s => !s.isWarmup) : [];

    return `
      <div class="card p-4">
        <div class="flex items-center justify-between mb-2">
          <p class="font-display font-semibold">${escapeHTML(ex ? ex.name : 'Exercise')}</p>
          <button class="text-xs" style="color: var(--text-muted);" onclick="removeExerciseFromSession(${entryIdx})">Remove</button>
        </div>

        <div class="flex items-center gap-2 mb-2 p-2 rounded-lg" style="background: color-mix(in srgb, var(--accent-suggest) 10%, transparent);">
          <span class="dot-suggest w-2 h-2 rounded-full flex-shrink-0"></span>
          <p class="text-xs tag-suggest" id="coachNote-${entryIdx}">${escapeHTML(suggestion.message)}</p>
        </div>
        <div id="aiOverload-${entryIdx}" class="mb-3">
          <button class="text-xs" style="color: var(--text-muted);" onclick="requestAIOverload(${entryIdx}, '${entry.exerciseId}')">✨ Ask AI to review this target</button>
        </div>

        <div class="space-y-2">
          <div class="grid grid-cols-12 gap-2 text-[10px] uppercase tracking-wide px-1" style="color: var(--text-muted);">
            <span class="col-span-1">#</span>
            <span class="col-span-3">Weight</span>
            <span class="col-span-3">Reps</span>
            <span class="col-span-2">RPE</span>
            <span class="col-span-2 text-center">Warmup</span>
            <span class="col-span-1"></span>
          </div>
          ${entry.sets.map((set, setIdx) => {
            const prev = prevSets[setIdx];
            return `
            <div class="grid grid-cols-12 gap-2 items-center">
              <span class="col-span-1 text-xs font-mono" style="color: var(--text-muted);">${setIdx + 1}</span>
              <input class="col-span-3 font-mono tag-logged" type="number" inputmode="decimal" placeholder="${prev && prev.weight != null ? prev.weight : 'kg'}"
                     value="${set.weight ?? ''}"
                     onchange="updateSet(${entryIdx}, ${setIdx}, 'weight', this.value)">
              <input class="col-span-3 font-mono tag-logged" type="number" inputmode="numeric" placeholder="${prev && prev.reps != null ? prev.reps : 'reps'}"
                     value="${set.reps ?? ''}"
                     onchange="updateSet(${entryIdx}, ${setIdx}, 'reps', this.value)">
              <input class="col-span-2 font-mono" type="number" inputmode="numeric" placeholder="${prev && prev.rpe != null ? prev.rpe : '—'}" min="1" max="10"
                     value="${set.rpe ?? ''}"
                     onchange="updateSet(${entryIdx}, ${setIdx}, 'rpe', this.value)">
              <span class="col-span-2 flex justify-center">
                <input type="checkbox" class="w-4 h-4" ${set.isWarmup ? 'checked' : ''}
                       title="Mark as warmup (excluded from progression suggestions)"
                       onchange="updateSetWarmup(${entryIdx}, ${setIdx}, this.checked)">
              </span>
              <button class="col-span-1 text-xs" style="color: var(--text-muted);" onclick="removeSet(${entryIdx}, ${setIdx})">✕</button>
            </div>
          `;
          }).join('')}
        </div>
        <button class="w-full btn-secondary mt-3 py-2 text-sm" onclick="addSetToEntry(${entryIdx})">+ Add set</button>
        <textarea class="w-full mt-3 text-sm" rows="2" placeholder="Notes (e.g. felt heavy, elbow pain, form cue)"
                  onchange="updateEntryNotes(${entryIdx}, this.value)">${escapeHTML(entry.notes || '')}</textarea>
      </div>`;
  }).join('');

  if (AIProvider.hasAnyKey()) {
    const profile = Storage.getProfile();
    session.entries.forEach(async (entry, entryIdx) => {
      const ex = exercises.find(x => x.id === entry.exerciseId);
      const suggestion = Progression.suggestNextTarget({ exerciseId: entry.exerciseId, styleKey: session.trainingStyle });

      // Key on exercise + the fields that actually drive the note's content,
      // not on entryIdx alone — a re-render triggered by typing a rep count
      // shouldn't count as a new coaching decision. Includes goal/experience
      // since narrateCoachingFeedback's prompt is shaped by both, and a
      // mid-session profile change (reachable from Settings) should produce
      // a fresh note rather than serving a stale cached one.
      const cacheKey = `${entry.exerciseId}:${suggestion.status}:${suggestion.classification}:${suggestion.suggestedWeight}:${suggestion.suggestedReps}:${suggestion.suggestedSets}:${profile.goal}:${profile.experienceLevel}`;
      const noteEl = document.getElementById(`coachNote-${entryIdx}`);

      const cached = coachNoteCache[cacheKey];
      if (cached) {
        if (noteEl) noteEl.textContent = cached;
        return;
      }

      const narration = await CoachNarration.narrateCoachingFeedback({ exerciseName: ex ? ex.name : 'exercise', suggestion, profile });
      if (logSessionRenderGen !== thisGen) return; // view changed underneath this call — discard
      if (!narration.ok) return;

      coachNoteCache[cacheKey] = narration.text;
      const liveEl = document.getElementById(`coachNote-${entryIdx}`);
      if (liveEl) liveEl.textContent = narration.text;
    });
  }
}

function updateSetWarmup(entryIdx, setIdx, checked) {
  const session = Storage.getActiveSession();
  session.entries[entryIdx].sets[setIdx].isWarmup = !!checked;
  Storage.saveActiveSession(session);
}

async function requestAIOverload(entryIdx, exerciseId) {
  if (!AIProvider.hasAnyKey()) { promptForGeminiKey(() => requestAIOverload(entryIdx, exerciseId)); return; }

  const el = document.getElementById(`aiOverload-${entryIdx}`);
  if (!el) return;
  el.innerHTML = `<p class="text-xs" style="color: var(--text-muted);">Checking with AI…</p>`;
  const thisGen = logSessionRenderGen; // capture: if the view re-renders before this resolves, discard the result

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

  if (logSessionRenderGen !== thisGen) return; // stale — the log view changed underneath this call
  const liveEl = document.getElementById(`aiOverload-${entryIdx}`);
  if (!liveEl) return;

  if (!result.ok) {
    liveEl.innerHTML = `<p class="text-xs" style="color: var(--accent-warn, #E8B23A);">Couldn't get an AI suggestion (${escapeHTML(result.error === 'missing_key' ? 'no API key' : result.error)}).</p>`;
    return;
  }

  const s = result.suggestion;
  const weightLabel = s.suggestedWeight !== null ? `${s.suggestedWeight}kg` : 'no change';
  const agreeLabel = s.agreesWithBaseline ? 'Agrees with the baseline' : 'Suggests an adjustment';

  liveEl.innerHTML = `
    <div class="p-2 rounded-lg text-xs" style="background: color-mix(in srgb, var(--accent-logged) 10%, transparent); color: var(--text);">
      <p class="font-medium mb-0.5">✨ AI suggestion — ${agreeLabel}</p>
      <p>${weightLabel} × ${escapeHTML(String(s.suggestedReps))}, ${s.suggestedSets} sets</p>
      <p class="mt-1" style="color: var(--text-muted);">${escapeHTML(s.reasoning)}</p>
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
    <div class="fixed inset-0 z-40 flex items-end modal-backdrop" style="background: rgba(0,0,0,0.6);" onclick="if(event.target===this) closeModal()">
      <div class="modal-sheet card w-full max-h-[75vh] rounded-b-none flex flex-col" style="border-bottom:none;">
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
      <span class="text-sm">${escapeHTML(ex.name)}</span>
      <span class="text-xs" style="color: var(--text-muted);">${escapeHTML(ex.muscleGroup)}</span>
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

// Plays the reverse of the modal's entry animation before clearing it —
// an instant innerHTML wipe reads as the modal vanishing/glitching rather
// than closing. Falls back to an immediate clear if for some reason the
// backdrop element isn't there (defensive, shouldn't normally happen).
// Lightweight, non-blocking confirmation for actions that previously
// happened silently (meal logged, session finished, plan saved) — the user
// had no feedback that the tap actually did anything besides the view
// changing underneath them. Auto-dismisses; never stacks more than 2 at
// once so a burst of quick actions doesn't flood the screen.
const TOAST_KINDS = {
  success: 'var(--accent-success)',
  info: 'var(--accent-logged)',
  warn: 'var(--accent-warn)',
};
function showToast(message, kind = 'success') {
  const root = document.getElementById('toastRoot');
  if (!root) return;

  while (root.children.length >= 2) root.removeChild(root.firstChild);

  const toast = document.createElement('div');
  toast.className = 'toast';
  const dotColor = TOAST_KINDS[kind] || TOAST_KINDS.success;
  toast.innerHTML = `<span class="toast-dot" style="background:${dotColor};"></span><span>${escapeHTML(message)}</span>`;
  root.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('leaving');
    setTimeout(() => toast.remove(), 200);
  }, 2200);
}

function closeModal() {
  const root = document.getElementById('modalRoot');
  const backdrop = root.querySelector('.modal-backdrop');
  const reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!backdrop || reducedMotion) {
    root.innerHTML = '';
    return;
  }
  backdrop.classList.add('closing');
  // Matches the CSS backdropOut/sheetOut animation duration (160ms).
  setTimeout(() => { root.innerHTML = ''; }, 160);
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

  // Drop exercises that were added but never actually logged (no weight and
  // no reps on any set) — these would otherwise sit in history as a phantom
  // "session" for that exercise and skew future progression comparisons.
  session.entries = session.entries.filter(entry =>
    entry.sets.some(s => s.weight != null || s.reps != null)
  );
  if (session.entries.length === 0) {
    Storage.clearActiveSession();
    clearCoachNoteCache();
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
  clearCoachNoteCache();

  showPostWorkoutSummary(summaryRows, null);

  if (AIProvider.hasAnyKey()) {
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
    <div class="fixed inset-0 z-40 flex items-center justify-center p-4 modal-backdrop" style="background: rgba(0,0,0,0.7);">
      <div class="modal-sheet card w-full max-w-sm p-5 space-y-4 max-h-[85vh] overflow-y-auto">
        <p class="font-display font-bold text-lg">Session complete</p>
        ${aiNote ? `<p class="text-sm tag-logged">${escapeHTML(aiNote)}</p>` : (AIProvider.hasAnyKey() ? `<p class="text-xs" style="color: var(--text-muted);">Getting your coach's take...</p>` : '')}
        <div class="space-y-2">
          ${rows.map(r => {
            const info = labelFor[r.classification] || labelFor.first_time;
            return `
              <div class="p-3 rounded-lg" style="background: var(--bg-elevated);">
                <div class="flex items-center justify-between">
                  <p class="text-sm font-medium">${escapeHTML(r.name)}</p>
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
                  <span>${escapeHTML(ex ? ex.name : 'Exercise')}</span>
                  <span class="font-mono text-xs tag-logged">${setsLabel || '—'}</span>
                </div>
                ${entry.notes ? `<p class="text-xs mt-0.5" style="color: var(--text-muted);">📝 ${escapeHTML(entry.notes)}</p>` : ''}
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
      <p class="text-xs uppercase tracking-wide mb-1.5 mt-3" style="color: var(--text-muted);">${escapeHTML(group)}</p>
      <div class="space-y-1.5">
        ${groups[group].map(ex => `
          <div class="card p-3">
            <div class="flex items-center justify-between">
              <p class="text-sm font-medium">${escapeHTML(ex.name)}</p>
              <span class="text-xs px-2 py-0.5 rounded-full" style="background: var(--bg-elevated); color: var(--text-muted);">${escapeHTML(ex.equipment)}</span>
            </div>
            ${ex.cues ? `<p class="text-xs mt-1" style="color: var(--text-muted);">${escapeHTML(ex.cues)}</p>` : ''}
          </div>
        `).join('')}
      </div>
    </div>
  `).join('') || `<p class="text-sm text-center py-6" style="color: var(--text-muted);">No exercises match your search.</p>`;
}

function openAddExerciseModal() {
  const modal = document.getElementById('modalRoot');
  modal.innerHTML = `
    <div class="fixed inset-0 z-40 flex items-center justify-center p-4 modal-backdrop" style="background: rgba(0,0,0,0.7);" onclick="if(event.target===this) closeModal()">
      <div class="modal-sheet card w-full max-w-sm p-5 space-y-3">
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
  const primaryProviderSelect = document.getElementById('primaryProviderSelect');
  if (primaryProviderSelect) primaryProviderSelect.value = AIProvider.getPrimaryProvider();
  const primaryId = AIProvider.getPrimaryProvider();
  const status = document.getElementById('geminiKeyStatus');
  if (status) {
    const isPrimary = primaryId === 'gemini';
    if (GeminiClient.hasGeminiKey()) {
      status.textContent = isPrimary ? 'Key is set (primary).' : 'Key is set (fallback).';
      status.style.color = 'var(--accent-success)';
    } else {
      status.textContent = isPrimary ? 'No key set — AI features won\'t work.' : 'No key set — no fallback if OpenRouter fails.';
      status.style.color = 'var(--text-muted)';
    }
  }
  const orStatus = document.getElementById('openrouterKeyStatus');
  if (orStatus) {
    const isPrimary = primaryId === 'openrouter';
    if (OpenRouterClient.hasOpenRouterKey()) {
      orStatus.textContent = isPrimary ? 'Key is set (primary).' : 'Key is set (fallback).';
      orStatus.style.color = 'var(--accent-success)';
    } else {
      orStatus.textContent = isPrimary ? 'No key set — AI features won\'t work.' : 'No key set — no fallback if Gemini fails.';
      orStatus.style.color = 'var(--text-muted)';
    }
  }

  const geminiModelSelect = document.getElementById('geminiModelSelect');
  if (geminiModelSelect) {
    const currentGeminiModel = GeminiClient.getGeminiModel();
    geminiModelSelect.innerHTML = GeminiClient.GEMINI_MODEL_OPTIONS.map(m => `
      <option value="${m.id}" ${m.id === currentGeminiModel ? 'selected' : ''}>${escapeHTML(m.label)}</option>
    `).join('');
  }

  const openrouterModelSelect = document.getElementById('openrouterModelSelect');
  if (openrouterModelSelect) {
    const currentORModel = OpenRouterClient.getOpenRouterModel();
    openrouterModelSelect.innerHTML = OpenRouterClient.OPENROUTER_MODEL_OPTIONS.map(m => `
      <option value="${m.id}" ${m.id === currentORModel ? 'selected' : ''}>${escapeHTML(m.label)}</option>
    `).join('');
  }
}

function onStyleChange(value) {
  Storage.saveProfile({ trainingStyle: value });
}

function onUnitsChange(value) {
  Storage.saveSettings({ units: value });
}

function onPrimaryProviderChange(value) {
  AIProvider.setPrimaryProvider(value);
  renderSettingsForm();
}

function onGeminiModelChange(value) {
  GeminiClient.setGeminiModel(value);
}

function onOpenRouterModelChange(value) {
  OpenRouterClient.setOpenRouterModel(value);
}

function saveGeminiKeyFromSettings() {
  const val = document.getElementById('geminiKeyInput').value.trim();
  if (!val) return;
  GeminiClient.setGeminiKey(val);
  document.getElementById('geminiKeyInput').value = '';
  document.getElementById('geminiKeyStatus').textContent = 'Key saved.';
  document.getElementById('geminiKeyStatus').style.color = 'var(--accent-success)';
}

function saveOpenRouterKeyFromSettings() {
  const val = document.getElementById('openrouterKeyInput').value.trim();
  if (!val) return;
  OpenRouterClient.setOpenRouterKey(val);
  document.getElementById('openrouterKeyInput').value = '';
  document.getElementById('openrouterKeyStatus').textContent = 'Key saved.';
  document.getElementById('openrouterKeyStatus').style.color = 'var(--accent-success)';
}

/* ---------------- Gemini key prompt (blocking gate for AI features) ---------------- */

function promptForGeminiKey(onSaved) {
  const modal = document.getElementById('modalRoot');
  modal.innerHTML = `
    <div class="fixed inset-0 z-40 flex items-center justify-center p-4 modal-backdrop" style="background: rgba(0,0,0,0.7);">
      <div class="modal-sheet card w-full max-w-sm p-5 space-y-3">
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
let chatSendInFlight = false; // prevents overlapping sendChatMessage() calls from corrupting history

function renderChatView() {
  const el = document.getElementById('chatMessages');
  if (chatHistory.length === 0) {
    el.innerHTML = `<div class="card p-4 text-sm" style="color: var(--text-muted);">Ask about training, recovery, or nutrition. Answers are grounded in your logged workouts and profile where relevant — not a substitute for medical advice.</div>`;
  } else {
    el.innerHTML = chatHistory.map(m => `
      <div class="flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}">
        <div class="card p-3 max-w-[85%] text-sm" style="${m.role === 'user' ? 'background: var(--accent-logged); color: #0E0F12; border: none;' : ''}">
          ${m.role === 'user' ? escapeHTML(m.text) : renderChatMarkdown(m.text)}
          ${m.failed ? `<div class="flex gap-2 mt-2">
            <button class="btn-secondary text-xs px-2 py-1" onclick="retryLastChatMessage()">Retry</button>
            <button class="btn-secondary text-xs px-2 py-1" onclick="Nav.go('settings')">Switch provider/model</button>
          </div>` : ''}
        </div>
      </div>`).join('');
  }
  document.getElementById('chatMessages').scrollIntoView({ block: 'end' });
}

async function sendChatMessage() {
  if (chatSendInFlight) return; // ignore double-taps / double-Enter while a message is in flight

  const input = document.getElementById('chatInput');
  const text = input.value.trim();
  if (!text) return;

  if (!AIProvider.hasAnyKey()) {
    promptForGeminiKey(() => sendChatMessage());
    return;
  }

  chatSendInFlight = true;
  input.disabled = true;

  chatHistory.push({ role: 'user', text });
  input.value = '';
  renderChatView();

  // Tagged placeholder (not a bare positional push) so it can be found and
  // replaced by identity rather than by "last item in the array" — safe
  // even if something else mutates chatHistory while this call is pending.
  const placeholder = { role: 'assistant', text: 'Thinking...', pending: true };
  chatHistory.push(placeholder);
  renderChatView();

  try {
    const result = await Chatbot.askChatbot(text, chatHistory.filter(m => !m.pending));
    const idx = chatHistory.indexOf(placeholder);
    const replacement = result.ok
      ? { role: 'assistant', text: result.text }
      : { role: 'assistant', text: `Couldn't reach the coach: ${result.error === 'missing_key' ? 'no API key set.' : result.error}`, failed: true, retryText: text };
    if (idx !== -1) chatHistory[idx] = replacement;
    else chatHistory.push(replacement); // placeholder was somehow removed — still show the answer
  } finally {
    chatSendInFlight = false;
    input.disabled = false;
    renderChatView();
    input.focus();
  }
}

// Retries the most recent failed exchange (timeout, quota, network error)
// without making the user retype their message. Removes the failed
// assistant reply AND its paired user message from history first, then
// resends through the normal path — otherwise a retry would leave two
// copies of the same user message in history and in the context sent to
// Gemini on the next real turn.
function retryLastChatMessage() {
  if (chatSendInFlight) return;
  const lastIdx = chatHistory.length - 1;
  const last = chatHistory[lastIdx];
  if (!last || !last.failed || !last.retryText) return;

  chatHistory.splice(lastIdx, 1); // drop the failed assistant reply
  if (chatHistory[lastIdx - 1]?.role === 'user') {
    chatHistory.splice(lastIdx - 1, 1); // drop its paired user message too
  }

  const input = document.getElementById('chatInput');
  input.value = last.retryText;
  sendChatMessage();
}

/* ============================================================
   NUTRITION
   Profile form feeds Nutrition.calculateTargets() (nutrition.js);
   dashboard shows today's logged meals against those targets.
   Meal logging supports both manual entry and photo/AI estimation
   via meal-vision.js — the "Estimate from a photo" button below
   compresses the image, sends it to Gemini, then pre-fills the
   fields, which the user can still edit before saving.
   ============================================================ */

const MEAL_CATEGORIES = ['Breakfast', 'Lunch', 'Dinner', 'Snack'];

function renderNutritionProfileForm() {
  const profile = Storage.getProfile();
  const container = document.getElementById('nutritionProfileForm');

  container.innerHTML = `
    <div class="card p-4 space-y-3">
      <div>
        <label class="text-xs" style="color: var(--text-muted);">Age</label>
        <input type="number" inputmode="numeric" id="nutAge" placeholder="e.g. 28" value="${profile.age ?? ''}">
      </div>
      <div>
        <label class="text-xs" style="color: var(--text-muted);">Sex</label>
        <select id="nutSex">
          <option value="">Select…</option>
          <option value="male" ${profile.sex === 'male' ? 'selected' : ''}>Male</option>
          <option value="female" ${profile.sex === 'female' ? 'selected' : ''}>Female</option>
          <option value="other" ${profile.sex === 'other' ? 'selected' : ''}>Other / prefer not to say</option>
        </select>
        <p class="text-xs mt-1" style="color: var(--text-muted);">Only used to estimate calorie needs (Mifflin-St Jeor). "Other" uses a neutral midpoint estimate.</p>
      </div>
      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="text-xs" style="color: var(--text-muted);">Weight (kg)</label>
          <input type="number" inputmode="decimal" id="nutWeight" placeholder="e.g. 72" value="${profile.weightKg ?? ''}">
        </div>
        <div>
          <label class="text-xs" style="color: var(--text-muted);">Height (cm)</label>
          <input type="number" inputmode="decimal" id="nutHeight" placeholder="e.g. 175" value="${profile.heightCm ?? ''}">
        </div>
      </div>
      <div>
        <label class="text-xs" style="color: var(--text-muted);">Activity level</label>
        <select id="nutActivity">
          ${Object.entries(Nutrition.ACTIVITY_MULTIPLIERS).map(([key, a]) => `
            <option value="${key}" ${profile.activityLevel === key ? 'selected' : ''}>${a.label}</option>
          `).join('')}
        </select>
      </div>
      <div>
        <label class="text-xs" style="color: var(--text-muted);">Goal</label>
        <select id="nutGoal">
          ${Object.entries(Nutrition.GOAL_ADJUSTMENTS).map(([key, g]) => `
            <option value="${key}" ${(profile.nutritionGoal || 'maintain') === key ? 'selected' : ''}>${g.label}</option>
          `).join('')}
        </select>
        <p class="text-xs mt-1" style="color: var(--text-muted);">Set automatically when you use "Set a goal" below — changeable here directly too.</p>
      </div>
      <div class="card p-3 space-y-2" style="background: var(--bg-elevated);">
        ${profile.goalWeightKg ? `
          <p class="text-sm font-medium">${escapeHTML(Nutrition.GOAL_INTENTS[profile.goalIntent]?.label || 'Goal weight set')}</p>
          <p class="text-xs" style="color: var(--text-muted);">Target: ${profile.goalWeightKg}kg</p>
          <button class="btn-secondary w-full py-2 text-sm" onclick="openGoalWizard()">Change goal</button>
        ` : `
          <p class="text-sm" style="color: var(--text-muted);">No goal weight set yet.</p>
          <button class="btn-secondary w-full py-2 text-sm" onclick="openGoalWizard()">Set a goal</button>
        `}
      </div>
      <button class="btn-primary w-full py-2 text-sm" onclick="saveNutritionProfileForm()">Calculate targets</button>
      <p id="nutritionFormStatus" class="text-xs"></p>
      <div id="goalGuidanceCard"></div>
    </div>
  `;
  renderGoalGuidance();
}

/* ---------------- Goal-setting wizard ----------------
   A short, one-question-at-a-time flow rather than a flat form: asking
   "what's your goal" in plain language (abs, lose fat, bulk...) before
   asking for a target weight gives the number context, and lets the
   guidance card afterward speak to what the user actually said they
   want rather than a generic cut/bulk label. */

let goalWizardState = { step: 'intent', intent: null, estimatedCurrentBFPercent: null, bfMethod: null };

function openGoalWizard() {
  const profile = Storage.getProfile();
  goalWizardState = {
    step: 'intent',
    intent: profile.goalIntent || null,
    estimatedCurrentBFPercent: profile.estimatedBFPercent || null,
    bfMethod: null,
  };
  renderGoalWizardStep();
}

function computeGoalSuggestion() {
  const profile = Storage.getProfile();
  return Nutrition.suggestGoalWeight({
    intentKey: goalWizardState.intent,
    weightKg: profile.weightKg,
    heightCm: profile.heightCm,
    sex: profile.sex,
    estimatedCurrentBFPercent: goalWizardState.estimatedCurrentBFPercent,
  });
}

function renderGoalWizardStep() {
  const modal = document.getElementById('modalRoot');
  const profile = Storage.getProfile();
  const settings = Storage.getSettings();
  const unitLabel = settings.units === 'lb' ? 'lb' : 'kg';
  const displayWeight = (kg) => settings.units === 'lb' ? Math.round(kg * 2.20462 * 10) / 10 : Math.round(kg * 10) / 10;

  let bodyHTML;

  if (goalWizardState.step === 'intent') {
    bodyHTML = `
      <p class="font-display font-bold text-lg">What's your main goal?</p>
      <p class="text-sm" style="color: var(--text-muted);">We'll use this plus your stats to suggest a goal weight.</p>
      <div class="space-y-2">
        ${Object.entries(Nutrition.GOAL_INTENTS).map(([key, intent]) => `
          <button class="w-full text-left btn-secondary py-3 px-4 text-sm" onclick="selectGoalIntent('${key}')">${escapeHTML(intent.label)}</button>
        `).join('')}
      </div>
      <button class="w-full text-sm py-2" style="color: var(--text-muted);" onclick="closeModal()">Cancel</button>`;

  } else if (goalWizardState.step === 'bodyfat') {
    // Only reached for get_abs — a current body-fat estimate is needed to
    // translate a target BF% into a goal weight (see nutrition.js). Offer
    // the tape-measurement method (more accurate) with manual entry as a
    // fallback for anyone who'd rather not measure.
    bodyHTML = `
      <p class="font-display font-bold text-lg">What's your current body fat?</p>
      <p class="text-sm" style="color: var(--text-muted);">This helps translate a "visible abs" target into a weight number specific to you.</p>
      <div class="space-y-2">
        <button class="w-full text-left btn-secondary py-3 px-4 text-sm" onclick="goalWizardState.step='bodyfat_measure'; renderGoalWizardStep();">
          Measure it (tape method) — most accurate
        </button>
        ${AIProvider.hasAnyKey() ? `
          <button class="w-full text-left btn-secondary py-3 px-4 text-sm" onclick="goalWizardState.step='bodyfat_photo'; renderGoalWizardStep();">
            📷 Estimate from a photo
          </button>
        ` : ''}
        <button class="w-full text-left btn-secondary py-3 px-4 text-sm" onclick="goalWizardState.step='bodyfat_manual'; renderGoalWizardStep();">
          I'll enter a rough guess
        </button>
      </div>
      <button class="btn-secondary w-full py-2 text-sm" onclick="goalWizardState.step='intent'; renderGoalWizardStep();">Back</button>`;

  } else if (goalWizardState.step === 'bodyfat_photo') {
    bodyHTML = `
      <p class="font-display font-bold text-lg">Estimate from a photo</p>
      <p class="text-sm" style="color: var(--text-muted);">
        A rough AI visual estimate — less accurate than the tape method, but quick. Best with a clear, well-lit, full-torso photo in fitted clothing. This photo is only used for this one estimate and is never saved.
      </p>
      <div id="bfPhotoArea">
        <input type="file" accept="image/*" capture="environment" id="bfPhotoInput" class="hidden" onchange="handleBodyFatPhotoSelected(this.files[0])">
        <button class="w-full btn-secondary py-2.5 text-sm text-left px-3 flex items-center gap-2" onclick="document.getElementById('bfPhotoInput').click()">
          📷 Choose or take a photo
        </button>
      </div>
      <button class="btn-secondary w-full py-2 text-sm" onclick="goalWizardState.step='bodyfat'; renderGoalWizardStep();">Back</button>`;

  } else if (goalWizardState.step === 'bodyfat_measure') {
    const profile = Storage.getProfile();
    const sex = profile.sex || 'male';
    bodyHTML = `
      <p class="font-display font-bold text-lg">Quick tape measurements</p>
      <p class="text-sm" style="color: var(--text-muted);">
        U.S. Navy method — a validated tape-measurement formula, typically within a few percent of a DEXA scan. Measure snugly, not compressed, in cm.
      </p>
      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="text-xs" style="color: var(--text-muted);">Neck (cm)</label>
          <input type="number" inputmode="decimal" id="measNeck" placeholder="e.g. 38">
        </div>
        <div>
          <label class="text-xs" style="color: var(--text-muted);">Waist (cm)</label>
          <input type="number" inputmode="decimal" id="measWaist" placeholder="e.g. 85">
          <p class="text-xs mt-1" style="color: var(--text-muted);">At the navel</p>
        </div>
      </div>
      ${sex === 'female' ? `
        <div>
          <label class="text-xs" style="color: var(--text-muted);">Hips (cm)</label>
          <input type="number" inputmode="decimal" id="measHip" placeholder="e.g. 100">
          <p class="text-xs mt-1" style="color: var(--text-muted);">Widest point</p>
        </div>
      ` : ''}
      <p class="text-xs" style="color: var(--text-muted);">Uses your height (${profile.heightCm ? profile.heightCm + 'cm' : 'add it on the setup page first'}) from your profile.</p>
      <p id="measureError" class="text-xs" style="color: var(--accent-warn);"></p>
      <div class="flex gap-2">
        <button class="btn-secondary flex-1 py-2 text-sm" onclick="goalWizardState.step='bodyfat'; renderGoalWizardStep();">Back</button>
        <button class="btn-primary flex-1 py-2 text-sm" onclick="submitMeasuredBodyFat()">Calculate</button>
      </div>`;

  } else if (goalWizardState.step === 'bodyfat_manual') {
    bodyHTML = `
      <p class="font-display font-bold text-lg">Rough estimate: current body fat?</p>
      <p class="text-sm" style="color: var(--text-muted);">A ballpark is fine — pick your closest guess.</p>
      <div>
        <label class="text-xs" style="color: var(--text-muted);">Estimated body fat %</label>
        <input type="number" inputmode="decimal" id="wizardBodyFat" placeholder="e.g. 22" min="3" max="60">
      </div>
      <div class="flex gap-2">
        <button class="btn-secondary flex-1 py-2 text-sm" onclick="goalWizardState.step='bodyfat'; renderGoalWizardStep();">Back</button>
        <button class="btn-primary flex-1 py-2 text-sm" onclick="submitBodyFatEstimate()">Continue</button>
      </div>`;

  } else {
    // step === 'weight'
    const intent = Nutrition.GOAL_INTENTS[goalWizardState.intent];
    const suggestion = computeGoalSuggestion();
    const prefillKg = profile.goalWeightKg || suggestion?.suggestedWeightKg || profile.weightKg;
    const bfPercent = goalWizardState.estimatedCurrentBFPercent;
    const bfCategory = bfPercent != null ? Nutrition.categorizeBodyFat(bfPercent, profile.sex) : null;

    bodyHTML = `
      <p class="font-display font-bold text-lg">${escapeHTML(intent.label)}</p>
      <p class="text-sm" style="color: var(--text-muted);">That usually means ${escapeHTML(intent.blurb)}.</p>

      ${bfPercent != null ? `
        <div class="card p-3" style="background: var(--bg-elevated);">
          <p class="text-xs" style="color: var(--text-muted);">Estimated current body fat${goalWizardState.bfMethod === 'navy' ? ' (tape method)' : goalWizardState.bfMethod === 'photo' ? ' (photo estimate)' : ' (your estimate)'}</p>
          <p class="font-display text-lg font-bold">${bfPercent}%${bfCategory ? ` <span class="text-xs font-normal" style="color: var(--text-muted);">— ${escapeHTML(bfCategory)}</span>` : ''}</p>
        </div>
      ` : ''}

      ${suggestion ? `
        <div class="card p-3 space-y-1" style="background: var(--bg-elevated);">
          <p class="text-xs" style="color: var(--text-muted);">Suggested goal weight</p>
          <p class="font-display text-xl font-bold">${displayWeight(suggestion.suggestedWeightKg)}${unitLabel}</p>
          <p class="text-xs" style="color: var(--text-muted);">${escapeHTML(suggestion.explanation)} This is a population-level estimate, not a personal prescription — adjust it to whatever feels right for you below.</p>
        </div>
      ` : `
        <p class="text-xs" style="color: var(--text-muted);">Add your weight and height on this page first to get a suggested number — for now, enter one manually below.</p>
      `}

      <div>
        <label class="text-xs" style="color: var(--text-muted);">Goal weight (${unitLabel})</label>
        <input type="number" inputmode="decimal" id="wizardGoalWeight" placeholder="${profile.weightKg ? `e.g. ${displayWeight(profile.weightKg)}` : 'e.g. 68'}" value="${prefillKg ? displayWeight(prefillKg) : ''}">
        <p class="text-xs mt-1" style="color: var(--text-muted);">Pre-filled with the suggestion above — change it to anything you'd rather use.</p>
      </div>
      <div class="flex gap-2">
        <button class="btn-secondary flex-1 py-2 text-sm" onclick="goalWizardState.step='${goalWizardState.intent === 'get_abs' ? 'bodyfat' : 'intent'}'; renderGoalWizardStep();">Back</button>
        <button class="btn-primary flex-1 py-2 text-sm" onclick="saveGoalWizard()">Save goal</button>
      </div>`;
  }

  modal.innerHTML = `
    <div class="fixed inset-0 z-40 flex items-center justify-center p-4 modal-backdrop" style="background: rgba(0,0,0,0.7);">
      <div class="modal-sheet card w-full max-w-sm p-5 space-y-3 max-h-[85vh] overflow-y-auto">
        ${bodyHTML}
      </div>
    </div>`;
}

function selectGoalIntent(key) {
  goalWizardState.intent = key;
  goalWizardState.step = key === 'get_abs' ? 'bodyfat' : 'weight';
  renderGoalWizardStep();
}

function submitBodyFatEstimate() {
  const input = document.getElementById('wizardBodyFat');
  const raw = parseFloat(input.value);
  if (!Number.isFinite(raw) || raw <= 0 || raw >= 100) {
    input.style.borderColor = 'var(--accent-warn)';
    return;
  }
  goalWizardState.estimatedCurrentBFPercent = raw;
  goalWizardState.bfMethod = 'manual';
  Storage.saveProfile({ estimatedBFPercent: raw });
  goalWizardState.step = 'weight';
  renderGoalWizardStep();
}

function submitMeasuredBodyFat() {
  const profile = Storage.getProfile();
  const sex = profile.sex || 'male';
  const errorEl = document.getElementById('measureError');

  const neckCm = parseFloat(document.getElementById('measNeck').value);
  const waistCm = parseFloat(document.getElementById('measWaist').value);
  const hipCm = sex === 'female' ? parseFloat(document.getElementById('measHip').value) : null;

  if (!profile.heightCm) {
    errorEl.textContent = 'Add your height on the setup page first, then come back to this step.';
    return;
  }
  if (!Number.isFinite(neckCm) || !Number.isFinite(waistCm) || (sex === 'female' && !Number.isFinite(hipCm))) {
    errorEl.textContent = 'Fill in all measurements to calculate.';
    return;
  }

  const bf = Nutrition.estimateBodyFatNavy({ sex, waistCm, neckCm, hipCm, heightCm: profile.heightCm });
  if (bf == null) {
    errorEl.textContent = "Those numbers don't work out to a valid estimate — double check the measurements (waist should be larger than neck) and try again.";
    return;
  }

  goalWizardState.estimatedCurrentBFPercent = bf;
  goalWizardState.bfMethod = 'navy';
  Storage.saveProfile({ estimatedBFPercent: bf });
  goalWizardState.step = 'weight';
  renderGoalWizardStep();
}

/**
 * Photo-based body-fat estimate. Mirrors handleMealPhotoSelected's
 * compress -> show preview -> call AI -> handle result flow, but:
 * - never writes the photo itself to Storage (only the numeric estimate),
 *   since this is a photo of the user's body rather than of food
 * - lets the user accept the AI's estimate or fall back to a manual
 *   number if the estimate looks off, rather than only offering "redo"
 */
async function handleBodyFatPhotoSelected(file) {
  if (!file) return;
  const area = document.getElementById('bfPhotoArea');
  area.innerHTML = `<p class="text-xs" style="color: var(--text-muted);">Compressing photo…</p>`;

  let dataUrl;
  try {
    dataUrl = await compressImageForUpload(file);
  } catch (e) {
    area.innerHTML = `<p class="text-xs" style="color: var(--accent-warn, #E8B23A);">${escapeHTML(e.message)}</p>`;
    return;
  }

  const base64 = dataUrl.split(',')[1];

  // Preview only lives in this modal's DOM for the duration of the call —
  // never assigned to goalWizardState or Storage, so it's gone as soon as
  // the wizard moves past this step or the modal closes.
  area.innerHTML = `
    <img src="${dataUrl}" class="w-full rounded-lg mb-2" style="max-height: 200px; object-fit: cover;" alt="Photo for body fat estimate">
    <p class="text-xs flex items-center gap-1.5" style="color: var(--text-muted);">
      <span class="spinner" style="width:10px;height:10px;"></span>
      Estimating… usually takes a few seconds
    </p>`;

  const profile = Storage.getProfile();
  const result = await BodyFatVision.estimateBodyFatFromPhoto(base64, 'image/jpeg', profile.sex);

  // Modal may have moved on while this was in flight.
  if (!document.getElementById('bfPhotoArea')) return;

  const previewHTML = `<img src="${dataUrl}" class="w-full rounded-lg mb-2" style="max-height: 200px; object-fit: cover;" alt="Photo for body fat estimate">`;

  if (!result.ok) {
    area.innerHTML = `
      ${previewHTML}
      <p class="text-xs" style="color: var(--accent-warn, #E8B23A);">Couldn't get an estimate (${escapeHTML(result.error === 'missing_key' ? 'no API key' : result.error)}).</p>
      <button class="btn-secondary w-full py-2 text-sm mt-2" onclick="goalWizardState.step='bodyfat_manual'; renderGoalWizardStep();">Enter a rough guess instead</button>`;
    return;
  }

  const est = result.estimate;

  if (!est.identified) {
    area.innerHTML = `
      ${previewHTML}
      <p class="text-xs" style="color: var(--accent-warn, #E8B23A);">${escapeHTML(est.notes)}</p>
      <div class="flex gap-2 mt-2">
        <button class="btn-secondary flex-1 py-2 text-sm" onclick="document.getElementById('bfPhotoInput').click()">Try another photo</button>
        <button class="btn-secondary flex-1 py-2 text-sm" onclick="goalWizardState.step='bodyfat_manual'; renderGoalWizardStep();">Enter a guess</button>
      </div>`;
    return;
  }

  area.innerHTML = `
    ${previewHTML}
    <p class="text-xs tag-suggest">✨ Estimated ${est.bfLow}–${est.bfHigh}% body fat · confidence: ${escapeHTML(est.confidence)}</p>
    <p class="text-xs mt-0.5" style="color: var(--text-muted);">${escapeHTML(est.notes || 'This is a rough visual estimate — adjust it below if it looks off.')}</p>
    <div>
      <label class="text-xs" style="color: var(--text-muted);">Use this estimate (%)</label>
      <input type="number" inputmode="decimal" id="bfPhotoEstimateValue" value="${est.bfPercent}" min="3" max="60">
    </div>
    <div class="flex gap-2 mt-2">
      <button class="btn-secondary flex-1 py-2 text-sm" onclick="document.getElementById('bfPhotoInput').click()">Retake</button>
      <button class="btn-primary flex-1 py-2 text-sm" onclick="submitPhotoBodyFat()">Use this</button>
    </div>`;
}

function submitPhotoBodyFat() {
  const input = document.getElementById('bfPhotoEstimateValue');
  const raw = parseFloat(input.value);
  if (!Number.isFinite(raw) || raw <= 0 || raw >= 100) {
    input.style.borderColor = 'var(--accent-warn)';
    return;
  }
  goalWizardState.estimatedCurrentBFPercent = raw;
  goalWizardState.bfMethod = 'photo';
  Storage.saveProfile({ estimatedBFPercent: raw });
  goalWizardState.step = 'weight';
  renderGoalWizardStep();
}

function saveGoalWizard() {
  const input = document.getElementById('wizardGoalWeight');
  const raw = parseFloat(input.value);
  if (!Number.isFinite(raw) || raw <= 0) {
    input.style.borderColor = 'var(--accent-warn)';
    return;
  }

  const settings = Storage.getSettings();
  const goalWeightKg = settings.units === 'lb' ? raw / 2.20462 : raw;
  const intent = Nutrition.GOAL_INTENTS[goalWizardState.intent];

  Storage.saveProfile({
    goalIntent: goalWizardState.intent,
    goalWeightKg: Math.round(goalWeightKg * 10) / 10,
    nutritionGoal: intent.nutritionGoal,
  });

  const updatedProfile = Storage.getProfile();
  if (Nutrition.hasCompleteProfileForCalc(updatedProfile)) {
    Nutrition.recalculateAndSaveTargets();
  }

  closeModal();
  renderNutritionProfileForm();
  showToast('Goal saved.');
}

// Shown after saving, only if a goal weight is set — recommends a calorie
// target for a *safe* pace toward that goal (independent of whatever the
// user's current calorieTarget/nutritionGoal cut-bulk delta happens to be),
// and offers to apply it directly so the guidance isn't just informational.
function renderGoalGuidance() {
  const container = document.getElementById('goalGuidanceCard');
  if (!container) return;

  const profile = Storage.getProfile();
  const nutritionProfile = Storage.getNutritionProfile();

  if (!profile.goalWeightKg || nutritionProfile.tdee == null) {
    container.innerHTML = '';
    return;
  }

  const rec = Nutrition.recommendCalorieTargetForGoal({
    currentWeightKg: profile.weightKg,
    goalWeightKg: profile.goalWeightKg,
    tdee: nutritionProfile.tdee,
  });

  if (!rec) { container.innerHTML = ''; return; }

  const settings = Storage.getSettings();
  const displayWeight = (kg) => settings.units === 'lb' ? Math.round(kg * 2.20462 * 10) / 10 : Math.round(kg * 10) / 10;
  const unitLabel = settings.units === 'lb' ? 'lb' : 'kg';

  if (rec.status === 'at_goal') {
    container.innerHTML = `
      <div class="card p-3" style="background: var(--bg-elevated);">
        <p class="text-sm">You're already at your goal weight — targets are set to maintain.</p>
      </div>`;
    return;
  }

  const etaStr = rec.etaDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  const verb = rec.direction === 'lose' ? 'lose' : 'gain';
  const intent = Nutrition.GOAL_INTENTS[profile.goalIntent];
  const intentLine = intent ? `For "${escapeHTML(intent.label)}," that generally means ${escapeHTML(intent.blurb)}.` : '';

  container.innerHTML = `
    <div class="card p-3 space-y-2" style="background: var(--bg-elevated);">
      <p class="font-display font-semibold text-sm">Best way to get there</p>
      ${intentLine ? `<p class="text-sm">${intentLine}</p>` : ''}
      <p class="text-sm">
        To ${verb} safely (about ${displayWeight(rec.safeWeeklyKg)}${unitLabel}/week), aim for roughly
        <strong>${rec.recommendedCalorieTarget} kcal/day</strong>. At that pace you'd reach
        ${displayWeight(profile.goalWeightKg)}${unitLabel} in about ${rec.estimatedWeeks} weeks (around ${etaStr}).
      </p>
      <p class="text-xs" style="color: var(--text-muted);">
        Faster is possible but tends to cost more muscle (cutting) or add more fat (bulking) along the way — this pace is a common sustainable default, not a hard rule.
      </p>
      <button class="btn-primary w-full py-2 text-sm" onclick="applyGoalRecommendedTarget(${rec.recommendedCalorieTarget})">Use ${rec.recommendedCalorieTarget} kcal as my target</button>
    </div>`;
}

function applyGoalRecommendedTarget(calorieTarget) {
  const profile = Storage.getProfile();
  const recalculated = Nutrition.recalculateMacrosForCalorieTarget(calorieTarget, profile);
  Storage.saveNutritionProfile({ ...recalculated, lastCalculatedAt: Date.now() });
  showToast('Target updated to ' + calorieTarget + ' kcal.');
  Nav.go('nutrition');
}

function saveNutritionProfileForm() {
  const age = parseInt(document.getElementById('nutAge').value, 10);
  const sex = document.getElementById('nutSex').value;
  const weightKg = parseFloat(document.getElementById('nutWeight').value);
  const heightCm = parseFloat(document.getElementById('nutHeight').value);
  const activityLevel = document.getElementById('nutActivity').value;
  const nutritionGoal = document.getElementById('nutGoal').value;

  const status = document.getElementById('nutritionFormStatus');

  Storage.saveProfile({
    age: Number.isFinite(age) ? age : null,
    sex: sex || null,
    weightKg: Number.isFinite(weightKg) ? weightKg : null,
    heightCm: Number.isFinite(heightCm) ? heightCm : null,
    activityLevel: activityLevel || 'moderate',
    nutritionGoal: nutritionGoal || 'maintain',
  });

  const updatedProfile = Storage.getProfile();
  if (!Nutrition.hasCompleteProfileForCalc(updatedProfile)) {
    status.textContent = 'Saved — fill in age, sex, weight, and height to calculate targets.';
    status.style.color = 'var(--text-muted)';
    renderGoalGuidance();
    return;
  }

  Nutrition.recalculateAndSaveTargets();
  status.textContent = 'Targets updated.';
  status.style.color = 'var(--accent-success)';
  renderGoalGuidance();
}

function renderNutrition() {
  const container = document.getElementById('nutritionContent');
  const profile = Storage.getProfile();
  const nutritionProfile = Storage.getNutritionProfile();

  if (!Nutrition.hasCompleteProfileForCalc(profile) || nutritionProfile.calorieTarget == null) {
    container.innerHTML = `
      <div class="card p-6 text-center space-y-3">
        <p class="font-display text-lg font-semibold">Set up your targets</p>
        <p class="text-sm" style="color: var(--text-muted);">A few basics (age, sex, weight, height) let us estimate a daily calorie and macro range to track against.</p>
        <button class="btn-primary" onclick="Nav.go('nutritionProfile')">Set up nutrition</button>
      </div>`;
    return;
  }

  const todaysMeals = Storage.getMealsForDate();
  const totals = todaysMeals.reduce((acc, m) => {
    acc.calories += m.calories || 0;
    acc.protein += m.protein || 0;
    acc.carbs += m.carbs || 0;
    acc.fats += m.fats || 0;
    return acc;
  }, { calories: 0, protein: 0, carbs: 0, fats: 0 });

  const macroRow = (label, consumed, target, unit = 'g') => `
    <div>
      <div class="flex items-center justify-between text-xs mb-1">
        <span style="color: var(--text-muted);">${label}</span>
        <span class="font-mono">${Math.round(consumed)}${unit} / ${target ?? '—'}${unit}</span>
      </div>
      <div class="h-1.5 rounded-full" style="background: var(--bg-elevated);">
        <div class="h-1.5 rounded-full" style="width: ${target ? Math.min(100, (consumed / target) * 100) : 0}%; background: var(--accent-logged);"></div>
      </div>
    </div>`;

  container.innerHTML = `
    <div class="card p-4 space-y-3">
      <div class="flex items-center justify-between">
        <span class="text-sm" style="color: var(--text-muted);">Today</span>
        <span class="text-sm font-mono">${Math.round(totals.calories)} / ${nutritionProfile.calorieTarget} kcal</span>
      </div>
      <div class="h-2 rounded-full" style="background: var(--bg-elevated);">
        <div class="h-2 rounded-full" style="width: ${Math.min(100, (totals.calories / nutritionProfile.calorieTarget) * 100)}%; background: var(--accent-suggest);"></div>
      </div>
      <div class="space-y-2 pt-1">
        ${macroRow('Protein', totals.protein, nutritionProfile.proteinTarget)}
        ${macroRow('Carbs', totals.carbs, nutritionProfile.carbsTarget)}
        ${macroRow('Fats', totals.fats, nutritionProfile.fatsTarget)}
      </div>
    </div>

    ${renderWeightTrackerCard()}
    <div id="weightTrendCard"></div>

    <button class="w-full btn-secondary py-3 flex items-center justify-center gap-2" onclick="openLogMealModal()">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 5v14M5 12h14"/></svg>
      Log a meal
    </button>

    <button class="w-full btn-primary py-3 flex items-center justify-center gap-2" onclick="openDailySummaryModal()" ${todaysMeals.length === 0 ? 'disabled' : ''}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
      Log My Day
    </button>

    <div class="card p-4">
      <p class="font-display font-semibold text-sm mb-3">Today's meals</p>
      <div id="todaysMealsList" class="space-y-2">
        ${todaysMeals.length === 0
          ? `<p class="text-sm" style="color: var(--text-muted);">Nothing logged yet today.</p>`
          : todaysMeals.map(m => `
            <div class="flex items-center justify-between py-2 border-b" style="border-color: var(--border);">
              <div>
                <p class="text-sm font-medium">${escapeHTML(m.label || m.category)}</p>
                <p class="text-xs" style="color: var(--text-muted);">${escapeHTML(m.category)}${m.estimateRange ? ` · estimated ${m.estimateRange.caloriesLow}–${m.estimateRange.caloriesHigh} kcal` : ''}</p>
              </div>
              <div class="text-right">
                <p class="text-sm font-mono">${m.calories != null ? Math.round(m.calories) + ' kcal' : '—'}</p>
                <button class="text-xs" style="color: var(--text-muted);" onclick="deleteMealAndRefresh('${m.id}')">Remove</button>
              </div>
            </div>`).join('')}
      </div>
    </div>
  `;

  renderWeightTrendCard();
}

function deleteMealAndRefresh(mealId) {
  Storage.deleteMeal(mealId);
  renderNutrition();
}

/* ---------------- Daily summary & weight prediction ---------------- */

// Pulls today's meals + targets, computes totals, and hands off to
// Nutrition.projectWeeklyWeightChange() for the forward-looking "if every
// day looked like today" projection. Presented as a modal (not inline)
// since it's an on-demand snapshot the user requests, not part of the
// always-visible dashboard state.
function openDailySummaryModal() {
  const todaysMeals = Storage.getMealsForDate();
  const nutritionProfile = Storage.getNutritionProfile();
  const profile = Storage.getProfile();
  const settings = Storage.getSettings();
  const unitLabel = settings.units === 'lb' ? 'lb' : 'kg';
  const displayWeight = (kg) => settings.units === 'lb' ? Math.round(kg * 2.20462 * 10) / 10 : Math.round(kg * 10) / 10;

  const totals = todaysMeals.reduce((acc, m) => {
    acc.calories += m.calories || 0;
    acc.protein += m.protein || 0;
    acc.carbs += m.carbs || 0;
    acc.fats += m.fats || 0;
    return acc;
  }, { calories: 0, protein: 0, carbs: 0, fats: 0 });

  const tdee = nutritionProfile.tdee;
  const currentWeightKg = profile.weightKg;
  const projection = (tdee != null && currentWeightKg != null)
    ? Nutrition.projectWeeklyWeightChange(totals.calories, tdee, currentWeightKg)
    : null;

  const displayDelta = (kg) => {
    const val = settings.units === 'lb' ? kg * 2.20462 : kg;
    return Math.round(Math.abs(val) * 100) / 100;
  };

  let projectionHTML;
  if (!projection) {
    projectionHTML = `
      <p class="text-sm" style="color: var(--text-muted);">
        Set up your nutrition targets (age, sex, weight, height) to see a weight projection — we need your TDEE and current weight to estimate this.
      </p>`;
  } else if (projection.direction === 'maintain') {
    projectionHTML = `
      <p class="text-sm">
        Today's total is right around your maintenance level (${tdee} kcal TDEE). If every day looked like today, you'd stay close to <strong>${displayWeight(currentWeightKg)}${unitLabel}</strong> this week.
      </p>`;
  } else {
    const verb = projection.direction === 'lose' ? 'lose' : 'gain';
    const sign = projection.dailyDelta > 0 ? '+' : '';
    projectionHTML = `
      <p class="text-sm">
        Today's total is <span class="font-mono">${sign}${projection.dailyDelta} kcal</span> vs. your ${tdee} kcal TDEE.
        If you ate like this every day, you'd roughly <strong>${verb} ${displayDelta(projection.weeklyDeltaKg)}${unitLabel}</strong> over 7 days —
        putting you around <strong>${displayWeight(projection.projectedWeightKg)}${unitLabel}</strong> (from ${displayWeight(currentWeightKg)}${unitLabel} today).
      </p>
      <p class="text-xs" style="color: var(--text-muted);">
        A rough estimate based on one day's log (~7700 kcal ≈ 1kg of bodyfat) — not a precise prediction. Actual results vary with water weight, activity, and day-to-day differences in what you eat.
      </p>`;
  }

  // If a goal weight is set, also show how long the *current pace* would
  // take to get there — separate from the fixed-recommendation card on the
  // setup form, since this one reflects what they actually ate today.
  let goalHTML = '';
  if (profile.goalWeightKg && projection) {
    const eta = Nutrition.estimateTimeToGoal({
      currentWeightKg,
      goalWeightKg: profile.goalWeightKg,
      dailyDelta: projection.dailyDelta,
    });
    if (eta?.status === 'ok') {
      const etaStr = eta.etaDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
      goalHTML = `
        <div class="card p-3 space-y-1" style="background: var(--bg-elevated);">
          <p class="font-display font-semibold text-sm">Goal: ${displayWeight(profile.goalWeightKg)}${unitLabel}</p>
          <p class="text-sm">At today's pace, you'd reach your goal in about <strong>${eta.weeks} weeks</strong> (around ${etaStr}).</p>
        </div>`;
    } else if (eta?.status === 'wrong_direction') {
      goalHTML = `
        <div class="card p-3 space-y-1" style="background: var(--bg-elevated);">
          <p class="font-display font-semibold text-sm">Goal: ${displayWeight(profile.goalWeightKg)}${unitLabel}</p>
          <p class="text-sm">Today's intake would move you away from this goal rather than toward it. Check the guidance on your nutrition setup page for a target that fits.</p>
        </div>`;
    } else if (eta?.status === 'at_goal') {
      goalHTML = `
        <div class="card p-3" style="background: var(--bg-elevated);">
          <p class="text-sm">You're already at your goal weight of ${displayWeight(profile.goalWeightKg)}${unitLabel}.</p>
        </div>`;
    }
  }

  const macroLine = (label, val) => `
    <div class="flex items-center justify-between text-sm py-1.5 border-b" style="border-color: var(--border);">
      <span style="color: var(--text-muted);">${label}</span>
      <span class="font-mono">${Math.round(val)}${label === 'Calories' ? ' kcal' : 'g'}</span>
    </div>`;

  const modal = document.getElementById('modalRoot');
  modal.innerHTML = `
    <div class="fixed inset-0 z-40 flex items-center justify-center p-4 modal-backdrop" style="background: rgba(0,0,0,0.7);">
      <div class="modal-sheet card w-full max-w-sm p-5 space-y-4 max-h-[85vh] overflow-y-auto">
        <div class="flex items-center justify-between">
          <p class="font-display font-bold text-lg">Today's Summary</p>
          <button class="text-sm" style="color: var(--text-muted);" onclick="closeModal()">Close</button>
        </div>

        <div>
          ${macroLine('Calories', totals.calories)}
          ${macroLine('Protein', totals.protein)}
          ${macroLine('Carbs', totals.carbs)}
          ${macroLine('Fats', totals.fats)}
        </div>

        <div class="card p-3 space-y-2" style="background: var(--bg-elevated);">
          <p class="font-display font-semibold text-sm">7-day projection</p>
          ${projectionHTML}
        </div>

        ${goalHTML}
        <button class="w-full btn-secondary py-2 text-sm" onclick="Nav.go('nutritionProfile'); openGoalWizard();">${profile.goalWeightKg ? 'Change goal weight' : 'Set a goal weight'}</button>

        <button class="w-full btn-secondary py-3" onclick="closeModal()">Done</button>
      </div>
    </div>`;
}

/* ---------------- Weight tracker ---------------- */

function renderWeightTrackerCard() {
  const logs = Storage.getRecentWeightLogs(8);
  const settings = Storage.getSettings();
  const unitLabel = settings.units === 'lb' ? 'lb' : 'kg';
  const todayStr = new Date().toDateString();
  const todaysLog = logs.find(w => new Date(w.date).toDateString() === todayStr);
  const displayWeight = (kg) => settings.units === 'lb' ? Math.round(kg * 2.20462 * 10) / 10 : Math.round(kg * 10) / 10;

  return `
    <div class="card p-4 space-y-3">
      <div class="flex items-center justify-between">
        <p class="font-display font-semibold text-sm">Weight</p>
        <span class="text-xs" style="color: var(--text-muted);">${logs.length ? `Last: ${displayWeight(logs[logs.length - 1].weightKg)}${unitLabel}` : 'No check-ins yet'}</span>
      </div>
      <div class="flex gap-2">
        <input type="number" inputmode="decimal" id="quickWeightInput" placeholder="${todaysLog ? displayWeight(todaysLog.weightKg) : `Today's weight (${unitLabel})`}" value="${todaysLog ? displayWeight(todaysLog.weightKg) : ''}">
        <button class="btn-primary px-4 text-sm" onclick="logWeightFromDashboard()">Log</button>
      </div>
      ${logs.length > 1 ? `
        <div class="flex items-end gap-1" style="height: 40px;">
          ${(() => {
            const weights = logs.map(w => w.weightKg);
            const min = Math.min(...weights), max = Math.max(...weights);
            const range = max - min || 1;
            return logs.map(w => {
              const h = 6 + ((w.weightKg - min) / range) * 34;
              return `<div class="flex-1 rounded-t" style="height: ${h}px; background: var(--accent-logged); opacity: 0.7;" title="${escapeAttr(new Date(w.date).toLocaleDateString() + ': ' + displayWeight(w.weightKg) + unitLabel)}"></div>`;
            }).join('');
          })()}
        </div>
      ` : ''}
    </div>`;
}

function logWeightFromDashboard() {
  const input = document.getElementById('quickWeightInput');
  const raw = parseFloat(input.value);
  if (!Number.isFinite(raw) || raw <= 0) return;

  const settings = Storage.getSettings();
  const weightKg = settings.units === 'lb' ? raw / 2.20462 : raw;

  Storage.addWeightLog({ weightKg });
  // Keep the training profile's weightKg in sync so BMR/TDEE calculations
  // (nutrition.js) reflect the latest check-in without a separate edit —
  // same shallow-merge save used everywhere else in the app.
  Storage.saveProfile({ weightKg: Math.round(weightKg * 10) / 10 });

  renderNutrition();
}

/* ---------------- Weight trend & calorie adjustment suggestion ---------------- */

let weightTrendRenderGen = 0;

function renderWeightTrendCard() {
  const container = document.getElementById('weightTrendCard');
  if (!container) return;
  const thisGen = ++weightTrendRenderGen;

  const trend = Nutrition.analyzeWeightTrend();

  if (trend.status !== 'ok' || trend.pace === 'on_track') {
    container.innerHTML = '';
    return;
  }

  const settings = Storage.getSettings();
  const displayDelta = (kgPerWeek) => {
    const val = settings.units === 'lb' ? kgPerWeek * 2.20462 : kgPerWeek;
    return `${val > 0 ? '+' : ''}${Math.round(val * 100) / 100}${settings.units === 'lb' ? 'lb' : 'kg'}/week`;
  };

  const fallbackMessage = trend.pace === 'wrong_direction'
    ? `Your logged weight is trending the opposite way from your ${trend.goalKey} goal (${displayDelta(trend.actualWeeklyKg)}). This could just be normal fluctuation — but if it holds up, a target closer to ${trend.suggestedCalorieTarget} kcal is one option.`
    : `You're trending ${displayDelta(trend.actualWeeklyKg)} against an expected ${displayDelta(trend.expectedWeeklyKg)} for your ${trend.goalKey} goal. A target closer to ${trend.suggestedCalorieTarget} kcal (${trend.suggestedDelta > 0 ? '+' : ''}${trend.suggestedDelta} kcal) is one option if this trend continues.`;

  container.innerHTML = `
    <div class="card p-4 space-y-2 border-l-4" style="border-left-color: var(--accent-warn);">
      <p class="font-display font-semibold text-sm">Trend check</p>
      <p class="text-sm" id="weightTrendMessage" style="color: var(--text-muted);">${escapeHTML(fallbackMessage)}</p>
      <div class="flex gap-2 pt-1">
        <button class="btn-secondary flex-1 text-xs py-2" onclick="dismissWeightTrend()">Keep current target</button>
        <button class="btn-primary flex-1 text-xs py-2" onclick="applyWeightTrendSuggestion(${trend.suggestedCalorieTarget})">Try ${trend.suggestedCalorieTarget} kcal</button>
      </div>
    </div>`;

  if (AIProvider.hasAnyKey()) {
    const profile = Storage.getProfile();
    CoachNarration.narrateWeightTrend({ trend, profile }).then(result => {
      if (weightTrendRenderGen !== thisGen) return; // view changed underneath this call — discard
      const msgEl = document.getElementById('weightTrendMessage');
      if (result.ok && msgEl) msgEl.textContent = result.text;
    });
  }
}

function dismissWeightTrend() {
  const container = document.getElementById('weightTrendCard');
  if (container) container.innerHTML = '';
}

// The user must explicitly tap "Try Xkcal" — this never applies on its own.
// Re-saves through the normal nutrition profile path so the change is
// visible and undoable the same way any manual target edit would be.
function applyWeightTrendSuggestion(newTarget) {
  const profile = Storage.getProfile();
  const recalculated = Nutrition.recalculateMacrosForCalorieTarget(newTarget, profile);
  Storage.saveNutritionProfile({ ...recalculated, lastCalculatedAt: Date.now() });
  dismissWeightTrend();
  renderNutrition();
}

let mealModalState = { photoDataUrl: null, photoBase64: null, secondPhotoDataUrl: null, secondPhotoBase64: null, estimateRange: null, source: 'manual', lastEstimate: null };

// Rendered inside a <details> so it's available but doesn't eat vertical
// space by default — most people will glance at it once and remember the
// gist (reference object + top-down + side angle for tall/piled food).
function renderMealPhotoTipsHTML() {
  return `
    <details class="mb-2" style="font-size: 0.75rem;">
      <summary style="color: var(--text-muted); cursor: pointer;">📸 Tips for a more accurate estimate</summary>
      <ul class="mt-1.5 space-y-1 pl-0.5" style="list-style: none; color: var(--text-muted);">
        ${MealVision.MEAL_PHOTO_TIPS.map(t => `<li class="flex items-start gap-1.5"><span>${t.icon}</span><span>${escapeHTML(t.text)}</span></li>`).join('')}
      </ul>
    </details>`;
}

function openLogMealModal() {
  mealModalState = { photoDataUrl: null, photoBase64: null, secondPhotoDataUrl: null, secondPhotoBase64: null, estimateRange: null, source: 'manual', lastEstimate: null };
  const modal = document.getElementById('modalRoot');
  modal.innerHTML = `
    <div class="fixed inset-0 z-40 flex items-center justify-center p-4 modal-backdrop" style="background: rgba(0,0,0,0.7);">
      <div class="modal-sheet card w-full max-w-sm p-5 space-y-3 max-h-[85vh] overflow-y-auto">
        <p class="font-display font-bold text-lg">Log a meal</p>

        <div id="mealPhotoArea">
          ${AIProvider.hasAnyKey() ? `
            <input type="file" accept="image/*" capture="environment" id="mealPhotoInput" class="hidden" onchange="handleMealPhotoSelected(this.files[0])">
            ${renderMealPhotoTipsHTML()}
            <div class="mb-2">
              <label class="text-xs" style="color: var(--text-muted);">Anything the photo won't show? (optional, but helps a lot)</label>
              <input type="text" id="mealPhotoContext" placeholder="e.g. 2 cups rice, no oil, small portion">
            </div>
            <button class="w-full btn-secondary py-2.5 text-sm text-left px-3 flex items-center gap-2 mb-2" onclick="document.getElementById('mealPhotoInput').click()">
              📷 Estimate from a photo
            </button>
            <div class="flex items-center gap-2 mb-2">
              <input type="text" id="mealTextDescription" placeholder="e.g. 2 eggs and a cup of rice" class="flex-1" onkeydown="if(event.key==='Enter'){event.preventDefault();handleMealTextSubmitted();}">
              <button class="btn-secondary py-2.5 px-3 text-sm whitespace-nowrap" onclick="handleMealTextSubmitted()">✨ Estimate</button>
            </div>
          ` : `
            <button class="w-full btn-secondary py-2.5 text-sm text-left px-3" disabled style="opacity: 0.5; cursor: not-allowed;">
              📷 Estimate from a photo or text — add a Gemini API key in Settings first
            </button>
          `}
        </div>

        <div>
          <label class="text-xs" style="color: var(--text-muted);">Category</label>
          <select id="mealCategory">
            ${MEAL_CATEGORIES.map(c => `<option value="${c}">${c}</option>`).join('')}
          </select>
        </div>
        <div>
          <label class="text-xs" style="color: var(--text-muted);">Name (optional)</label>
          <input type="text" id="mealLabel" placeholder="e.g. Chicken rice bowl">
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="text-xs" style="color: var(--text-muted);">Calories</label>
            <input type="number" inputmode="numeric" id="mealCalories" placeholder="kcal" onchange="markMealFieldEdited()">
          </div>
          <div>
            <label class="text-xs" style="color: var(--text-muted);">Protein (g)</label>
            <input type="number" inputmode="numeric" id="mealProtein" placeholder="g" onchange="markMealFieldEdited()">
          </div>
          <div>
            <label class="text-xs" style="color: var(--text-muted);">Carbs (g)</label>
            <input type="number" inputmode="numeric" id="mealCarbs" placeholder="g" onchange="markMealFieldEdited()">
          </div>
          <div>
            <label class="text-xs" style="color: var(--text-muted);">Fats (g)</label>
            <input type="number" inputmode="numeric" id="mealFats" placeholder="g" onchange="markMealFieldEdited()">
          </div>
        </div>
        <p id="mealEstimateNote" class="text-xs" style="color: var(--text-muted);"></p>
        <div id="mealRefineArea"></div>

        <div class="flex gap-2 pt-1">
          <button class="btn-secondary flex-1" onclick="closeModal()">Cancel</button>
          <button class="btn-primary flex-1" onclick="saveMealFromModal()">Log meal</button>
        </div>
      </div>
    </div>`;
}

// If the user edits any numeric field by hand after an AI estimate populated
// it, that number is now theirs — don't keep labeling it "estimated" once
// they've corrected it (source becomes 'ai_corrected', per storage.js's schema).
function markMealFieldEdited() {
  if (mealModalState.source === 'ai') mealModalState.source = 'ai_corrected';
  mealModalState.lastEstimate = null;
  renderMealRefineArea();
}

/**
 * Downscales an image file client-side before it's ever stored or sent to
 * Gemini — localStorage's total budget (~5-10MB across the whole app) would
 * fill up fast on uncompressed photos, and Gemini doesn't need full
 * resolution to read a plate of food. Returns a JPEG data URL capped at
 * maxDim on its longest side.
 */
function compressImageForUpload(file, maxDim = 768, quality = 0.78) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read the selected file.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Could not decode the selected image.'));
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          const scale = maxDim / Math.max(width, height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

async function handleMealPhotoSelected(file) {
  if (!file) return;
  const area = document.getElementById('mealPhotoArea');
  const contextInput = document.getElementById('mealPhotoContext');
  const contextNote = contextInput ? contextInput.value.trim() : '';
  area.innerHTML = `<p class="text-xs" style="color: var(--text-muted);">Compressing photo…</p>`;

  let dataUrl;
  try {
    // This step is local (canvas resize) and near-instant — the network
    // call below is what actually takes time, so these get separate
    // status messages rather than one combined "compressing and analyzing"
    // string that makes a fast local step look like part of the slow part.
    dataUrl = await compressImageForUpload(file);
  } catch (e) {
    area.innerHTML = `<p class="text-xs" style="color: var(--accent-warn, #E8B23A);">${escapeHTML(e.message)}</p>`;
    return;
  }

  mealModalState.photoDataUrl = dataUrl;
  const base64 = dataUrl.split(',')[1];
  mealModalState.photoBase64 = base64;

  // Show the photo right away so the user has visual confirmation the
  // upload worked, with an explicit "this can take a few seconds" note —
  // waiting on nothing but a spinner is what makes network latency feel
  // like the app is stuck.
  area.innerHTML = `
    <img src="${dataUrl}" class="w-full rounded-lg mb-2" style="max-height: 160px; object-fit: cover;" alt="Photo of the meal">
    <p class="text-xs flex items-center gap-1.5" style="color: var(--text-muted);">
      <span class="spinner" style="width:10px;height:10px;"></span>
      Asking the AI to estimate… usually takes a few seconds
    </p>`;

  const result = await MealVision.estimateMealFromPhoto(base64, 'image/jpeg', contextNote, mealModalState.secondPhotoBase64, 'image/jpeg');

  // Modal may have been closed/reopened while this was in flight.
  if (!document.getElementById('mealPhotoArea')) return;

  if (!result.ok) {
    area.innerHTML = `
      <img src="${dataUrl}" class="w-full rounded-lg mb-2" style="max-height: 160px; object-fit: cover;" alt="Photo of the meal">
      <p class="text-xs" style="color: var(--accent-warn, #E8B23A);">Couldn't get an estimate (${escapeHTML(result.error === 'missing_key' ? 'no API key' : result.error)}). You can still enter values manually below.</p>`;
    return;
  }

  applyMealEstimateToForm(result.estimate, {
    areaHTML: buildMealPhotoPreviewHTML(),
    hasPhoto: true,
    sourceLabel: 'from the photo',
  });
}

/**
 * Renders whichever photo(s) are currently attached in mealModalState —
 * shared by every render path (initial estimate, second-angle add, refine)
 * so the preview never silently drops the second photo once one's added.
 */
function buildMealPhotoPreviewHTML() {
  if (!mealModalState.photoDataUrl) return '';
  const imgs = [`<img src="${mealModalState.photoDataUrl}" class="w-full rounded-lg" style="max-height: 160px; object-fit: cover;" alt="Photo of the meal">`];
  if (mealModalState.secondPhotoDataUrl) {
    imgs.push(`<img src="${mealModalState.secondPhotoDataUrl}" class="w-full rounded-lg" style="max-height: 160px; object-fit: cover;" alt="Side-angle photo of the meal">`);
  }
  return `<div class="grid ${imgs.length > 1 ? 'grid-cols-2' : 'grid-cols-1'} gap-2 mb-2">${imgs.join('')}</div>`;
}

/**
 * Handles the optional "add a side angle" photo — a second shot of the same
 * food used purely to give the model depth/height information a top-down
 * photo can't show (see meal-vision.js's ACCURACY MODEL note). Re-runs the
 * estimate with both photos attached once the second one is compressed.
 */
async function handleMealSecondPhotoSelected(file) {
  if (!file || !mealModalState.photoBase64) return;
  const area = document.getElementById('mealPhotoArea');
  const contextInput = document.getElementById('mealPhotoContext');
  const contextNote = contextInput ? contextInput.value.trim() : '';

  let dataUrl;
  try {
    dataUrl = await compressImageForUpload(file);
  } catch (e) {
    if (area) area.insertAdjacentHTML('beforeend', `<p class="text-xs mt-1" style="color: var(--accent-warn, #E8B23A);">${escapeHTML(e.message)}</p>`);
    return;
  }

  mealModalState.secondPhotoDataUrl = dataUrl;
  mealModalState.secondPhotoBase64 = dataUrl.split(',')[1];

  if (area) {
    area.innerHTML = `
      ${buildMealPhotoPreviewHTML()}
      <p class="text-xs flex items-center gap-1.5" style="color: var(--text-muted);">
        <span class="spinner" style="width:10px;height:10px;"></span>
        Re-estimating with the side angle…
      </p>`;
  }

  const result = await MealVision.estimateMealFromPhoto(mealModalState.photoBase64, 'image/jpeg', contextNote, mealModalState.secondPhotoBase64, 'image/jpeg');

  if (!document.getElementById('mealPhotoArea')) return;

  if (!result.ok) {
    if (area) {
      area.innerHTML = `
        ${buildMealPhotoPreviewHTML()}
        <p class="text-xs" style="color: var(--accent-warn, #E8B23A);">Couldn't update the estimate (${escapeHTML(result.error === 'missing_key' ? 'no API key' : result.error)}). Your first-photo estimate above is still applied.</p>`;
    }
    return;
  }

  applyMealEstimateToForm(result.estimate, {
    areaHTML: buildMealPhotoPreviewHTML(),
    hasPhoto: true,
    sourceLabel: 'from the two photos',
  });
}

/**
 * Text-description path: "2 eggs and a cup of rice" -> estimate, same
 * pre-fill + editable-fields behavior as the photo path. Lives alongside
 * the photo button rather than replacing it — some meals are easier to
 * describe than photograph (leftovers already plated weird, eating out
 * without pulling out a phone, etc).
 */
async function handleMealTextSubmitted() {
  const input = document.getElementById('mealTextDescription');
  const description = input ? input.value.trim() : '';
  if (!description) return;

  const area = document.getElementById('mealPhotoArea');
  const priorPhotoHTML = buildMealPhotoPreviewHTML();

  area.innerHTML = `
    ${priorPhotoHTML}
    <p class="text-xs flex items-center gap-1.5" style="color: var(--text-muted);">
      <span class="spinner" style="width:10px;height:10px;"></span>
      Asking the AI to estimate "${escapeHTML(description)}"…
    </p>`;

  const result = await MealText.estimateMealFromText(description);

  if (!document.getElementById('mealPhotoArea')) return;

  if (!result.ok) {
    area.innerHTML = `
      ${priorPhotoHTML}
      <p class="text-xs" style="color: var(--accent-warn, #E8B23A);">Couldn't get an estimate (${escapeHTML(result.error === 'missing_key' ? 'no API key' : result.error)}). You can still enter values manually below.</p>`;
    return;
  }

  applyMealEstimateToForm(result.estimate, {
    areaHTML: priorPhotoHTML,
    hasPhoto: !!mealModalState.photoDataUrl,
    sourceLabel: 'from your description',
  });
}

/**
 * Shared by both the photo and text estimate paths (and by the refine
 * follow-up below) so pre-fill behavior, source-tagging, and the "correct
 * this" affordance stay identical regardless of how the estimate was
 * produced.
 */
function applyMealEstimateToForm(est, { areaHTML, hasPhoto, sourceLabel }) {
  const area = document.getElementById('mealPhotoArea');
  // Offer "add a side angle" only when there's a first photo, no second one
  // yet, and confidence isn't already high — a confident top-down read of a
  // flat dish (e.g. a sandwich) doesn't need a depth shot, but low/medium
  // confidence on something that could be piled is exactly when a side
  // angle helps most.
  const offerSecondPhoto = hasPhoto && !mealModalState.secondPhotoBase64 && est.identified && est.confidence !== 'high';
  area.innerHTML = `
    ${areaHTML}
    ${est.identified
      ? `<p class="text-xs tag-suggest">✨ Estimated ${est.caloriesLow}–${est.caloriesHigh} kcal · confidence: ${escapeHTML(est.confidence)}</p>
         <p class="text-xs mt-0.5" style="color: var(--text-muted);">${escapeHTML(est.notes || `This is an estimate ${sourceLabel} — adjust anything below that looks off.`)}</p>
         ${est.referenceUsed ? `<p class="text-xs mt-0.5" style="color: var(--text-muted);"><em>Scale used: ${escapeHTML(est.referenceUsed)}</em></p>` : ''}`
      : `<p class="text-xs" style="color: var(--accent-warn, #E8B23A);">${escapeHTML(est.notes)}</p>`}
    ${offerSecondPhoto ? `
      <input type="file" accept="image/*" capture="environment" id="mealSecondPhotoInput" class="hidden" onchange="handleMealSecondPhotoSelected(this.files[0])">
      <button class="w-full btn-secondary py-2 text-xs mt-2" onclick="document.getElementById('mealSecondPhotoInput').click()">
        📐 Add a side-angle photo (optional, uses another AI call)
      </button>` : ''}
  `;

  if (!est.identified) {
    mealModalState.lastEstimate = null;
    renderMealRefineArea();
    return;
  }

  document.getElementById('mealLabel').value = est.label || '';
  document.getElementById('mealCalories').value = est.calories ?? '';
  document.getElementById('mealProtein').value = est.protein ?? '';
  document.getElementById('mealCarbs').value = est.carbs ?? '';
  document.getElementById('mealFats').value = est.fats ?? '';
  mealModalState.source = 'ai';
  mealModalState.estimateRange = { caloriesLow: est.caloriesLow, caloriesHigh: est.caloriesHigh };
  mealModalState.lastEstimate = est;
  document.getElementById('mealEstimateNote').textContent = `Values are pre-filled ${sourceLabel} — edit any of them if they look off.`;
  renderMealRefineArea();
}

// Renders the "correct or add detail" follow-up box under any AI estimate
// (photo or text). This re-runs the estimate rather than just letting the
// user overwrite numbers by hand — useful when the correction changes
// several numbers at once (e.g. "actually there's 2 tbsp peanut butter too"
// shifts calories/fat/carbs together) and the user would rather describe
// the change than recompute it themselves.
function renderMealRefineArea() {
  const container = document.getElementById('mealRefineArea');
  if (!container) return;
  if (!mealModalState.lastEstimate) {
    container.innerHTML = '';
    return;
  }
  container.innerHTML = `
    <div class="flex items-center gap-2 mt-1">
      <input type="text" id="mealRefineInput" placeholder="Correct or add detail, e.g. 3 eggs not 2" class="flex-1" onkeydown="if(event.key==='Enter'){event.preventDefault();handleMealRefineSubmitted();}">
      <button class="btn-secondary py-2 px-3 text-xs whitespace-nowrap" onclick="handleMealRefineSubmitted()">Update</button>
    </div>`;
}

async function handleMealRefineSubmitted() {
  const input = document.getElementById('mealRefineInput');
  const correctionText = input ? input.value.trim() : '';
  if (!correctionText || !mealModalState.lastEstimate) return;

  const container = document.getElementById('mealRefineArea');
  container.innerHTML = `
    <p class="text-xs flex items-center gap-1.5 mt-1" style="color: var(--text-muted);">
      <span class="spinner" style="width:10px;height:10px;"></span>
      Updating the estimate…
    </p>`;

  const result = await MealVision.refineMealEstimate({
    previousEstimate: mealModalState.lastEstimate,
    correctionText,
    imageBase64: mealModalState.photoBase64,
    imageMimeType: 'image/jpeg',
    secondImageBase64: mealModalState.secondPhotoBase64,
    secondImageMimeType: 'image/jpeg',
  });

  if (!document.getElementById('mealRefineArea')) return;

  if (!result.ok) {
    container.innerHTML = `<p class="text-xs mt-1" style="color: var(--accent-warn, #E8B23A);">Couldn't update the estimate (${escapeHTML(result.error === 'missing_key' ? 'no API key' : result.error)}). You can still edit the fields above by hand.</p>`;
    return;
  }

  applyMealEstimateToForm(result.estimate, { areaHTML: buildMealPhotoPreviewHTML(), hasPhoto: !!mealModalState.photoDataUrl, sourceLabel: 'after your correction' });
}

function saveMealFromModal() {
  const category = document.getElementById('mealCategory').value;
  const label = document.getElementById('mealLabel').value.trim();
  const calories = parseFloat(document.getElementById('mealCalories').value);
  const protein = parseFloat(document.getElementById('mealProtein').value);
  const carbs = parseFloat(document.getElementById('mealCarbs').value);
  const fats = parseFloat(document.getElementById('mealFats').value);

  Storage.addMeal({
    category,
    label,
    calories: Number.isFinite(calories) ? calories : null,
    protein: Number.isFinite(protein) ? protein : null,
    carbs: Number.isFinite(carbs) ? carbs : null,
    fats: Number.isFinite(fats) ? fats : null,
    source: mealModalState.source,
    // Only an uncorrected AI estimate carries the range forward — once the
    // user has touched a field (source flips to 'ai_corrected'), their
    // number is no longer just an estimate, so drop the range per
    // storage.js's contract ("only set for uncorrected AI estimates").
    estimateRange: mealModalState.source === 'ai' ? mealModalState.estimateRange : null,
    photoDataUrl: mealModalState.photoDataUrl,
  });

  closeModal();
  renderNutrition();
  showToast(label ? `Logged: ${label}` : 'Meal logged');
}
