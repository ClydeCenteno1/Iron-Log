/* ============================================================
   AI FITNESS CHATBOT
   System prompt explicitly demands evidence-based answers, honesty
   about uncertainty, and no medical diagnosis. Recent session +
   profile data is injected as context so answers can be personalized.
   ============================================================ */

const CHATBOT_SYSTEM_INSTRUCTION = `You are a fitness and nutrition assistant grounded in peer-reviewed exercise science and nutrition research.
Rules you must follow:
- Rely on scientific consensus, not bro-science, fitness-influencer trends, or anecdote.
- When evidence is mixed or unclear on a topic, say so plainly rather than inventing certainty.
- Never provide a medical diagnosis. For pain, injury, or medical symptoms, recommend seeing a doctor or physical therapist.
- For nutrition specifics tied to medical conditions, recommend a registered dietitian.
- Keep answers concise and practical — this is a chat interface, not an essay.
- You may reference the user's logged workout history/profile provided below to personalize answers, but don't assume anything about them beyond what's given.`;

function getChatContextBlock() {
  const profile = Storage.getProfile();
  const sessions = [...Storage.getSessions()].sort((a, b) => b.date - a.date).slice(0, 5);
  const exercises = Storage.getExercises();

  const sessionSummaries = sessions.map(s => {
    const dateLabel = new Date(s.date).toLocaleDateString();
    const lifts = s.entries.map(e => {
      const ex = exercises.find(x => x.id === e.exerciseId);
      const top = Progression.getTopSet(e.sets);
      const base = top ? `${ex ? ex.name : 'exercise'} ${top.weight ?? '?'}kg x ${top.reps ?? '?'}` : null;
      if (!base) return null;
      return e.notes ? `${base} (note: ${e.notes})` : base;
    }).filter(Boolean).join(', ');
    return `${dateLabel}: ${lifts}`;
  }).join('\n');

  return `User profile: goal=${profile.goal}, training style=${profile.trainingStyle}, experience=${profile.experienceLevel}, days/week=${profile.daysPerWeek}.
Recent sessions:
${sessionSummaries || 'No sessions logged yet.'}`;
}

// Only the most recent turns are sent back to Gemini on each message — an
// unbounded history would make the prompt (and therefore latency) grow with
// every message in a long chat session. 10 turns (~5 exchanges) is enough
// for the model to track the immediate thread; older context isn't usually
// needed turn-to-turn the way it is for e.g. long-form editing.
const MAX_CHAT_HISTORY_TURNS = 10;

async function askChatbot(userMessage, conversationHistory = []) {
  if (!AIProvider.hasAnyKey()) {
    return { ok: false, error: 'missing_key' };
  }

  const contextBlock = getChatContextBlock();
  const recentHistory = conversationHistory.slice(-MAX_CHAT_HISTORY_TURNS);
  const historyText = recentHistory.map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.text}`).join('\n');

  const prompt = `${contextBlock}

${historyText ? historyText + '\n' : ''}User: ${userMessage}

Respond as the assistant.`;

  const result = await AIProvider.callAI({ systemInstruction: CHATBOT_SYSTEM_INSTRUCTION, prompt });
  if (!result.ok) return result;
  return { ok: true, text: result.text.trim() };
}

window.Chatbot = { askChatbot, getChatContextBlock };
