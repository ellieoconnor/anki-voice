// ── Config ──────────────────────────────────────────────────────────────────
// Add your deck personas here. The key must match your Anki deck name exactly.
// teachingPersona defaults to the same persona if null.

const CONFIG = {
  decks: {
    BANKI: {
      persona: `You are a hiring manager and career coach whose professional success is directly tied to this candidate getting the job. You care deeply about clear communication, confident framing, structured answers (like STAR method where relevant), and whether this answer would actually land well in a real interview with a skeptical interviewer. Be rigorous, specific, and encouraging. Call out vague language, filler words, or missing specifics.`,
      teachingPersona: null,
    },
    'JavaScript/TypeScript': {
      persona: `You are a staff software engineer and natural teacher at a top tech company. You care about technical precision, edge cases, and whether the candidate truly understands the concept versus pattern-matching to a memorized answer. You push for depth: gotchas, browser/runtime differences, performance implications, real-world usage. Be direct and specific. Praise what's right before addressing gaps.`,
      teachingPersona: null,
      stripExamples: true,
    },
  },
  defaultPersona: `You are a knowledgeable tutor who grades flashcard answers fairly and gives specific, actionable feedback. Be honest about gaps and encouraging about strengths.`,
};

// ── State ────────────────────────────────────────────────────────────────────
const state = {
  apiKey: null,
  currentDeck: null,
  queue: [],
  queueIndex: 0,
  currentCard: null,
  transcript: '',
  gradeCounts: { 1: 0, 2: 0, 3: 0, 4: 0 },
  recognition: null,
  isRecording: false,
  teachHistory: [],
};

// ── AnkiConnect ──────────────────────────────────────────────────────────────
const ANKI_URL = 'http://localhost:8765';

async function ankiRequest(action, params = {}) {
  const res = await fetch(ANKI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, version: 6, params }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data.result;
}

async function getDeckNames() {
  return await ankiRequest('deckNames');
}

async function getDueCardIds(deckName) {
  return await ankiRequest('findCards', { query: `deck:"${deckName}" is:due` });
}

async function getCardsInfo(cardIds) {
  return await ankiRequest('cardsInfo', { cards: cardIds });
}

async function getCardIntervals(cardIds) {
  // Returns estimated next intervals for ease 1-4
  return await ankiRequest('getEaseFactors', { cards: cardIds }).catch(() => null);
}

async function submitCardGrade(cardId, ease) {
  // ease: 1=Again, 2=Hard, 3=Good, 4=Easy
  return await ankiRequest('answerCards', {
    answers: [{ cardId, ease }],
  });
}

function stripHtml(html) {
  const tmp = document.createElement('div');
  tmp.innerHTML = html; // safe: only textContent is read back, never rendered
  return tmp.textContent || tmp.innerText || '';
}

function stripCodeBlocks(html) {
  return html.replace(/<pre[^>]*>[\s\S]*?<\/pre>/gi, '');
}

function extractCardText(html, deckName) {
  const deck = CONFIG.decks[deckName];
  return stripHtml(deck?.stripExamples ? stripCodeBlocks(html) : html).trim();
}

// ── Screen management ────────────────────────────────────────────────────────
function showScreen(name) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
  document.getElementById(`screen-${name}`).classList.add('active');
}

// ── Setup ────────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  const saved = localStorage.getItem('anki-voice-api-key');
  if (saved) {
    state.apiKey = saved;
    loadDecks();
  } else {
    showScreen('setup');
  }
});

async function handleSetup() {
  const input = document.getElementById('apiKeyInput');
  const key = input.value.trim();
  const errEl = document.getElementById('setupError');
  const btn = document.getElementById('setupBtn');

  errEl.style.display = 'none';
  if (!key.startsWith('sk-ant-')) {
    errEl.textContent =
      "That doesn't look like a valid Claude API key (should start with sk-ant-).";
    errEl.style.display = 'block';
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Connecting...';

  try {
    await ankiRequest('deckNames'); // verify AnkiConnect is up
    localStorage.setItem('anki-voice-api-key', key);
    state.apiKey = key;
    await loadDecks();
  } catch (e) {
    errEl.textContent =
      'Could not connect to Anki. Make sure Anki is open with the AnkiConnect add-on installed.';
    errEl.style.display = 'block';
    btn.disabled = false;
    btn.textContent = 'Connect to Anki';
  }
}

function handleLogout() {
  localStorage.removeItem('anki-voice-api-key');
  state.apiKey = null;
  showScreen('setup');
}

// ── Deck select ──────────────────────────────────────────────────────────────
async function loadDecks() {
  showScreen('deck');
  const listEl = document.getElementById('deckList');
  listEl.innerHTML = `<p class="deck-empty">Loading decks...</p>`;

  try {
    const allDecks = await getDeckNames();
    const deckDue = [];

    for (const deck of allDecks) {
      if (deck === 'Default') continue;
      const ids = await getDueCardIds(deck);
      if (ids.length > 0) {
        deckDue.push({ name: deck, due: ids.length });
      }
    }

    if (deckDue.length === 0) {
      listEl.innerHTML = `<p class="deck-empty">No cards due right now. Come back later!</p>`;
      return;
    }

    listEl.innerHTML = '';
    deckDue.forEach(({ name, due }) => {
      const item = document.createElement('div');
      item.className = 'deck-item';
      item.innerHTML = `
        <span class="deck-name">${name}</span>
        <span class="deck-due">${due} due</span>
      `;
      item.onclick = () => startSession(name);
      listEl.appendChild(item);
    });
  } catch (e) {
    listEl.innerHTML = `<p class="deck-empty" style="color:#e57373;">Could not load decks. Is Anki open?</p>`;
  }
}

// ── Session ──────────────────────────────────────────────────────────────────
async function startSession(deckName) {
  state.currentDeck = deckName;
  state.gradeCounts = { 1: 0, 2: 0, 3: 0, 4: 0 };

  const ids = await getDueCardIds(deckName);
  const cards = await getCardsInfo(ids);

  state.queue = cards;
  state.queueIndex = 0;

  document.getElementById('topbarDeckName').textContent = deckName;
  showScreen('session');
  loadCard();
}

function loadCard() {
  const total = state.queue.length;
  const index = state.queueIndex;

  if (index >= total) {
    showComplete();
    return;
  }

  const card = state.queue[index];
  state.currentCard = card;
  state.transcript = '';

  // Progress
  document.getElementById('progressText').textContent = `${index + 1} / ${total}`;
  document.getElementById('progressFill').style.width = `${(index / total) * 100}%`;

  // Card text
  const front = extractCardText(card.fields[Object.keys(card.fields)[0]].value, state.currentDeck);
  document.getElementById('cardText').textContent = front;

  // Reset UI state
  resetSessionUI();
}

function resetSessionUI() {
  // Recording
  const btn = document.getElementById('recordBtn');
  btn.classList.remove('recording');
  document.getElementById('recordLabel').textContent = 'Click to record your answer';

  // Hide panels
  document.getElementById('transcriptBox').style.display = 'none';
  document.getElementById('feedbackPanel').style.display = 'none';
  document.getElementById('gradeRow').style.display = 'none';
  document.getElementById('gradingSpinner').style.display = 'none';
  document.getElementById('teachBtn').style.display = 'none';

  // Remove suggested badges
  document.querySelectorAll('.grade-btn').forEach((b) => {
    b.classList.remove('suggested');
    const badge = b.querySelector('.suggested-badge');
    if (badge) badge.remove();
  });

  // Reset intervals
  ['Again', 'Hard', 'Good', 'Easy'].forEach((name) => {
    document.getElementById(`interval${name}`).textContent = '';
  });
}

function handleEndSession() {
  if (state.isRecording) stopRecording();
  closeTeaching();
  showComplete();
}

function goToDeckSelect() {
  loadDecks();
}

// ── Recording ────────────────────────────────────────────────────────────────
function toggleRecord() {
  if (state.isRecording) {
    stopRecording();
  } else {
    startRecording();
  }
}

function startRecording() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    alert('Speech recognition is not supported in this browser. Try Chrome or Edge.');
    return;
  }

  const recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = 'en-US';

  state.recognition = recognition;
  state.isRecording = true;
  state.transcript = '';

  const btn = document.getElementById('recordBtn');
  btn.classList.add('recording');
  document.getElementById('recordLabel').textContent = 'Recording — click to stop';

  const transcriptBox = document.getElementById('transcriptBox');
  const transcriptText = document.getElementById('transcriptText');
  transcriptBox.style.display = 'block';
  transcriptText.textContent = 'Listening...';

  recognition.onresult = (event) => {
    let interim = '';
    let final = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      if (event.results[i].isFinal) {
        final += event.results[i][0].transcript;
      } else {
        interim += event.results[i][0].transcript;
      }
    }
    state.transcript += final;
    transcriptText.textContent =
      state.transcript + (interim ? ' ' + interim : '') || 'Listening...';
  };

  recognition.onerror = (event) => {
    console.error('Speech recognition error:', event.error);
    stopRecording();
  };

  recognition.onend = () => {
    if (state.isRecording) {
      // Auto-restart if still recording (browser cuts off after ~60s)
      recognition.start();
    }
  };

  recognition.start();
}

function stopRecording() {
  state.isRecording = false;
  if (state.recognition) {
    state.recognition.onend = null;
    state.recognition.stop();
    state.recognition = null;
  }

  const btn = document.getElementById('recordBtn');
  btn.classList.remove('recording');
  document.getElementById('recordLabel').textContent = 'Click to record your answer';

  const transcript = state.transcript.trim();
  if (transcript) {
    document.getElementById('transcriptText').textContent = transcript;
    gradeAnswer(transcript);
  } else {
    document.getElementById('transcriptBox').style.display = 'none';
  }
}

// ── Grading ──────────────────────────────────────────────────────────────────
async function gradeAnswer(transcript) {
  const card = state.currentCard;
  const front = extractCardText(card.fields[Object.keys(card.fields)[0]].value, state.currentDeck);
  const back = extractCardText(card.fields[Object.keys(card.fields)[1]].value, state.currentDeck);
  const persona = getPersona(state.currentDeck);

  document.getElementById('gradingSpinner').style.display = 'flex';

  const examplesNote = CONFIG.decks[state.currentDeck]?.stripExamples
    ? '\nNote: code examples have been stripped from this card. Grade on conceptual understanding only — do not penalize the student for not reciting specific syntax or example code.'
    : '';

  const prompt = `${persona}

You are grading a flashcard answer. Respond ONLY with a JSON object, no markdown, no preamble.${examplesNote}

Card front: ${front}
Correct answer: ${back}
Student's spoken answer: ${transcript}

Grade the answer and return:
{
  "grade": "again" | "hard" | "good" | "easy",
  "scoreLabel": "short label like 'B+' or 'Partial' or 'Excellent'",
  "feedback": "2-4 sentences of specific feedback. What was right, what was missing or imprecise, what to remember next time."
}

Grading rubric:
- again: Fundamentally wrong, missing, or showed no understanding
- hard: Partially correct but missing key details or has significant imprecision (D- to C+)
- good: Correct with minor gaps or imprecision (B- to A)
- easy: Completely correct, precise, confident — nothing to add (A+)`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': state.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1000,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    const data = await response.json();
    const text = data.content[0].text.trim();
    const clean = text.replace(/```json|```/g, '').trim();
    const result = JSON.parse(clean);

    document.getElementById('gradingSpinner').style.display = 'none';
    showFeedback(result);
  } catch (e) {
    document.getElementById('gradingSpinner').style.display = 'none';
    showFeedback({
      grade: 'good',
      scoreLabel: 'Error',
      feedback: 'Could not grade automatically. Please grade manually.',
    });
    console.error('Grading error:', e);
  }
}

function showFeedback(result) {
  const { grade, scoreLabel, feedback } = result;

  // Persona label
  const personaName = getPersonaName(state.currentDeck);
  document.getElementById('feedbackPersona').textContent = personaName;

  // Score badge
  const scoreEl = document.getElementById('feedbackScore');
  scoreEl.textContent = `${capitalize(grade)} — ${scoreLabel}`;
  scoreEl.className = `feedback-score ${grade}`;

  // Feedback text
  document.getElementById('feedbackBody').innerHTML = formatFeedbackText(feedback);

  document.getElementById('feedbackPanel').style.display = 'block';

  // Grade buttons
  showGradeButtons(grade);

  // Teach button
  document.getElementById('teachBtn').style.display = 'flex';
}

function showGradeButtons(suggestedGrade) {
  const row = document.getElementById('gradeRow');
  row.style.display = 'grid';

  const gradeMap = { again: 1, hard: 2, good: 3, easy: 4 };
  const nameMap = { 1: 'Again', 2: 'Hard', 3: 'Good', 4: 'Easy' };
  const suggestedEase = gradeMap[suggestedGrade];

  [1, 2, 3, 4].forEach((ease) => {
    const btn = document.getElementById(`grade${nameMap[ease]}`);
    btn.classList.remove('suggested');
    const existing = btn.querySelector('.suggested-badge');
    if (existing) existing.remove();

    if (ease === suggestedEase) {
      btn.classList.add('suggested');
      const badge = document.createElement('span');
      badge.className = 'suggested-badge';
      badge.textContent = 'suggested';
      btn.prepend(badge);
    }
  });
}

async function submitGrade(ease) {
  state.gradeCounts[ease]++;
  try {
    await submitCardGrade(state.currentCard.cardId, ease);
  } catch (e) {
    console.error('Failed to submit grade:', e);
  }
  state.queueIndex++;
  closeTeaching();
  loadCard();
}

// ── Teaching mode ────────────────────────────────────────────────────────────
function openTeaching() {
  state.teachHistory = [];
  const messagesEl = document.getElementById('teachMessages');
  const optionsEl = document.getElementById('teachOptions');
  const inputRow = document.getElementById('teachInputRow');

  messagesEl.innerHTML = '';
  inputRow.style.display = 'none';

  // Initial calibration question
  const card = state.currentCard;
  const front = extractCardText(card.fields[Object.keys(card.fields)[0]].value, state.currentDeck);

  const question = `Before I explain, help me calibrate. How would you describe your familiarity with the concept behind: "${front}"?`;

  addTeachMessage('tutor', question);

  optionsEl.innerHTML = '';
  const options = [
    "I'm seeing this for the first time — start from the basics",
    "I've heard of it but it's fuzzy — give me the foundations with examples",
    'I understand it but missed some details just now — focus on what I got wrong',
    'I know it well — just explain what I should have said',
  ];
  options.forEach((opt) => {
    const btn = document.createElement('button');
    btn.className = 'teach-option';
    btn.textContent = opt;
    btn.onclick = () => handleTeachOptionSelect(opt);
    optionsEl.appendChild(btn);
  });

  document.getElementById('teachOverlay').style.display = 'flex';
}

function closeTeaching() {
  document.getElementById('teachOverlay').style.display = 'none';
  state.teachHistory = [];
}

async function handleTeachOptionSelect(option) {
  const optionsEl = document.getElementById('teachOptions');
  optionsEl.innerHTML = '';

  addTeachMessage('you', option);
  state.teachHistory.push({ role: 'user', content: option });

  await fetchTeachResponse();

  document.getElementById('teachInputRow').style.display = 'flex';
}

async function sendTeachMessage() {
  const input = document.getElementById('teachInput');
  const text = input.value.trim();
  if (!text) return;

  input.value = '';
  addTeachMessage('you', text);
  state.teachHistory.push({ role: 'user', content: text });

  await fetchTeachResponse();
}

async function fetchTeachResponse() {
  const card = state.currentCard;
  const front = extractCardText(card.fields[Object.keys(card.fields)[0]].value, state.currentDeck);
  const back = extractCardText(card.fields[Object.keys(card.fields)[1]].value, state.currentDeck);
  const persona = getPersona(state.currentDeck);
  const transcript = state.transcript;

  document.getElementById('teachSpinner').style.display = 'flex';

  const systemPrompt = `${persona}

You are now in teaching mode. The student is reviewing a flashcard and wants to understand the concept more deeply.

Card front: ${front}
Correct answer: ${back}
What the student said: ${transcript || '(nothing recorded)'}

Teach clearly and specifically. Use examples where helpful. Keep responses focused — 3-6 sentences unless the student asks for more depth. End each response with a brief follow-up question or prompt to check understanding, unless the conversation feels complete.`;

  const messages = state.teachHistory.map((m) => ({ role: m.role, content: m.content }));

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': state.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1000,
        system: systemPrompt,
        messages,
      }),
    });

    const data = await response.json();
    const reply = data.content[0].text.trim();

    state.teachHistory.push({ role: 'assistant', content: reply });
    document.getElementById('teachSpinner').style.display = 'none';
    addTeachMessage('tutor', reply);
  } catch (e) {
    document.getElementById('teachSpinner').style.display = 'none';
    addTeachMessage('tutor', 'Something went wrong. Please try again.');
    console.error('Teaching error:', e);
  }
}

function addTeachMessage(role, text) {
  const messagesEl = document.getElementById('teachMessages');
  const div = document.createElement('div');
  div.className = `teach-msg ${role === 'you' ? 'user' : ''}`;
  div.innerHTML = `
    <span class="teach-msg-role">${role === 'you' ? 'You' : 'Tutor'}</span>
    <p class="teach-msg-body">${escapeHtml(text)}</p>
  `;
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

// ── Session complete ──────────────────────────────────────────────────────────
function showComplete() {
  const total = state.queueIndex;
  document.getElementById('completeStats').textContent =
    `You reviewed ${total} card${total !== 1 ? 's' : ''} from ${state.currentDeck}.`;

  const breakdown = document.getElementById('completeBreakdown');
  const labels = { 1: 'Again', 2: 'Hard', 3: 'Good', 4: 'Easy' };
  const colors = { 1: '#e57373', 2: '#f0a060', 3: '#5dbb8a', 4: '#5ba8d8' };

  breakdown.innerHTML = '';
  [1, 2, 3, 4].forEach((ease) => {
    const item = document.createElement('div');
    item.className = 'breakdown-item';
    item.innerHTML = `
      <span class="breakdown-count" style="color:${colors[ease]}">${state.gradeCounts[ease]}</span>
      <span class="breakdown-label">${labels[ease]}</span>
    `;
    breakdown.appendChild(item);
  });

  showScreen('complete');
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function getPersona(deckName) {
  return CONFIG.decks[deckName]?.persona || CONFIG.defaultPersona;
}

function getPersonaName(deckName) {
  const deck = deckName?.toLowerCase() || '';
  if (deck.includes('interview')) return 'Hiring manager';
  if (deck.includes('javascript') || deck.includes('typescript')) return 'Staff engineer';
  return 'Tutor';
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatFeedbackText(text) {
  // Wrap inline code in backticks with styled spans
  return escapeHtml(text).replace(/`([^`]+)`/g, '<code>$1</code>');
}
