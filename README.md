# STUAN BEWO — bot + web

Registration happens entirely through a Telegram bot: solve a simple math
check, send your X username, done. The bot also hands out an **access
code** so that same person can log into the website. The landing page
reads the live participant list from `/api/participants`.

## 1. Create the bot
1. Open Telegram, message **@BotFather**, run `/newbot`, follow the prompts.
2. Copy the token it gives you.

## 2. Configure
```
cp .env.example .env
```
Edit `.env`:
```
TELEGRAM_BOT_TOKEN=the_token_botfather_gave_you
PORT=3000
```

## 3. Install and run
```
npm install
npm start
```
This needs to keep running 24/7 — for a real launch, deploy it on a small
always-on host (Railway, Render, a cheap VPS, etc.) rather than your own
laptop.

## How registration + login works

**In Telegram:**
1. `/start` — bot asks a one-line sum (blocks basic bots/spam)
2. Once solved, bot asks for the X username
3. Bot saves it and sends an **8-character access code** (letters + numbers,
   no confusing 0/O or 1/l/I)
4. `/login` — anytime, generates a fresh code and immediately invalidates
   the previous one

**On the website:**
- Under "Join the platform", there's a "log in" field for that code
- A valid code logs the browser in (session cookie, 30 days) and shows
  "Logged in as @handle" with a logout link

## Security notes on the access code
- The code does **not expire on its own** — it works like a password, so
  treat it that way (don't post screenshots of it, don't share it).
- Requesting a new code via `/login` **kills the old one immediately** —
  that's the way to recover if a code ever leaks.
- The code is stored as a **SHA-256 hash**, never in plaintext — not even
  in `participants.json`. The plaintext only ever exists in the Telegram
  message sent to the user.
- The login endpoint rate-limits guesses (8 attempts per 15 minutes per
  IP) to slow down brute-force attempts. At 8 random alphanumeric
  characters, guessing a valid code by chance is not practically feasible.
- Ownership check is still on trust: whatever X username someone types is
  what gets saved. The access code only proves "same Telegram identity
  across visits," not "owns that X account." A code-in-bio verification
  against the X API is a natural next step once the project has traction.

## Where the data lives
- `participants.json` — registered users + their code hash (flat file,
  fine for an early launch; swap for a real database later if it grows)
- Web sessions and the rate-limit counters are **in-memory** (reset if the
  server restarts) — fine for a first version.
