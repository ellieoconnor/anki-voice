# Anki Voice

Answer your Anki flashcards out loud. AI grades your spoken answers and teaches you what you missed.

## Requirements

- [Anki](https://apps.ankiweb.net/) desktop app (must be open while using)
- [AnkiConnect add-on](https://ankiweb.net/shared/info/2055492159) installed in Anki
- A [Claude API key](https://console.anthropic.com/) (Anthropic account required)
- Chrome or Edge browser (for Web Speech API)
- Python 3 (for the local server — comes pre-installed on Mac/Linux)

## Setup

### 1. Install AnkiConnect

In Anki: **Tools → Add-ons → Get Add-ons** → paste code `2055492159` → restart Anki.

### 2. Configure your deck personas (optional but recommended)

Open `app.js` and edit the `CONFIG` object at the top. Add an entry for each deck you want a custom persona for. The key must match your Anki deck name exactly.

```js
const CONFIG = {
  decks: {
    'Your Deck Name': {
      persona: 'You are a [role]. You care about [what matters]. [How to give feedback].',
      teachingPersona: null, // null = use same persona for teaching
    },
  },
  defaultPersona: 'You are a knowledgeable tutor...',
};
```

### 3. Start the local server

Open a terminal in this folder and run:

```bash
python3 -m http.server 8080
```

### 4. Open the app

With Anki open, go to: **http://localhost:8080**

### 5. Enter your API key

Paste your Claude API key on the setup screen. It's saved to your browser's localStorage and never sent anywhere except Anthropic's API.

## How it works

1. Pick a deck — only decks with cards due today are shown
2. Read the card front
3. Click the microphone button and speak your answer
4. Click stop — AI grades your answer and gives feedback
5. The AI suggests which Anki button to press (Again / Hard / Good / Easy) — you confirm
6. Click **Teach me this** anytime to enter a tutoring conversation about the card
7. Grades are submitted to Anki live, so you can stop anytime

## Tips

- Speak clearly and at a normal pace — Web Speech API works best with natural speech
- For technical cards, explain concepts verbally rather than trying to recite syntax
- The persona in `CONFIG` shapes the tone and focus of feedback significantly — worth customizing
- Teaching mode remembers the full conversation per card, so you can go deep

## Troubleshooting

**"Could not connect to Anki"** — Make sure Anki is open and AnkiConnect is installed. Visit `http://localhost:8765` in your browser; you should see a version number.

**Microphone not working** — Make sure you're using Chrome or Edge. Firefox has limited Web Speech API support. Check that the browser has microphone permissions.

**CORS error in console** — AnkiConnect by default allows requests from localhost. If you see CORS errors, go to Anki → Tools → Add-ons → AnkiConnect → Config and add `"http://localhost:8080"` to the `webCorsOriginList`.

**Speech cuts off mid-answer** — The browser's Speech Recognition API has a ~60 second timeout; the app auto-restarts it. If it stops unexpectedly, click the mic button again to continue.
