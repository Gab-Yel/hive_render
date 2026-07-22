# Deploying Hive

This covers two things: running it on your own machine ("local host"), and
putting it on the public internet so anyone can reach it at a URL.

---

## Part 1 — Local host (what you asked for right now)

```bash
cd Hive/server
cp .env.example .env
```

Open `.env` and fill in two things:

- `JWT_SECRET` — a long random string. Generate one with:
  ```bash
  node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
  ```
- `DATABASE_URL` — your Supabase Postgres connection string (Supabase
  dashboard → **Project Settings → Database → Connection string**). The
  server won't start without this — all data lives in Supabase's Postgres
  now, not in a local file (see `server/src/db.js` for why).

Then:

```bash
npm install
npm start
```

Visit **http://localhost:8000**. That single command runs the API *and*
serves the website — there is nothing else to start.

Useful variants:
- `npm run dev` — restarts the server automatically when you edit a file
  (uses Node's built-in `--watch`, no extra tooling needed).
- To reset all data, go to your Supabase project's **Table Editor** (or
  run SQL in the **SQL Editor**) and clear out the rows — there's no local
  database file to delete anymore.

**Sharing it with someone on the same WiFi (e.g. testing on your phone):**
find your computer's local IP (e.g. `192.168.1.23` — `ipconfig` on Windows,
`ifconfig`/`ip a` on Mac/Linux), then visit `http://192.168.1.23:8000` from
the other device. This is *not* the same as putting it on the public
internet — it only works while both devices are on the same network and
your computer is running the server.

---

### Windows-specific hiccups

One thing trips people up on a fresh Windows machine — not specific to
this project, you'd hit it with any Node project:

- **"running scripts is disabled on this system"** when you run `npm
  install`/`npm start` in PowerShell. PowerShell blocks script files by
  default. Fix once, for your user account only:
  ```powershell
  Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
  ```
  Or just use Command Prompt (`cmd.exe`) instead of PowerShell, which
  doesn't have this restriction.

---

## Part 2 — Putting it online (a real URL, works from anywhere)

### The good news: no persistent disk needed

Your data already lives in Supabase's Postgres, not in a file on the
server's own disk (see `server/src/db.js`) — so unlike a typical SQLite
setup, it's completely safe for a host to wipe the container's filesystem
on every deploy or restart. Any of the options below works fine for
keeping your data; the only thing that differs between them is uptime,
cold-start behavior, and price.

### Option A — Render (recommended: fastest path, free to start)

1. Push this project to a GitHub repository.
2. render.com → **New → Web Service** → connect your GitHub repo, set the
   **root directory** to `server`, build command `npm install`, start
   command `npm start`.
3. Add environment variables in the Render dashboard: `JWT_SECRET` (a long
   random string) and `DATABASE_URL` (your Supabase connection string,
   same one from Part 1 — use the "Session pooler" string from Supabase if
   you hit connection-limit errors, since Render's free tier can spin up
   fresh instances). `PORT` is provided automatically by Render — don't
   set it yourself, `index.js` already reads `process.env.PORT`.
4. Deploy — Render gives you a `*.onrender.com` URL. That's the value that
   goes into `PRODUCTION_API_URL` in Part 3 below.
5. The free tier spins your app down after 15 minutes of inactivity (the
   next visitor waits ~30-60 seconds for it to wake back up). If that's
   annoying for regular use, the paid Starter plan (~$7/month) keeps it
   always-on — your data is unaffected either way since it's in Supabase.

### Option B — Railway

Similar flow to Render: **New Project → Deploy from GitHub repo**, root
directory `server`, add `JWT_SECRET` and `DATABASE_URL` as environment
variables, deploy. Railway's Hobby plan is $5/month (includes $5 of
usage) with no spin-down, so it's the better fit if the Render cold start
bothers you and $5/mo is fine.

### Option C — A basic VPS (DigitalOcean, Linode, a cheap Hetzner box, etc.)

More setup, but full control and often cheapest at this scale, and it's
genuinely useful to learn once:

1. Provision a small Ubuntu instance, SSH in.
2. Install Node.js (via `nvm` is easiest) and `git`.
3. `git clone` your repo, `cd server && npm install`.
4. Create `.env` on the server directly with `JWT_SECRET` and
   `DATABASE_URL` (never commit real secrets to Git).
5. Run it with a process manager so it survives reboots/crashes:
   ```bash
   npm install -g pm2
   pm2 start src/index.js --name hive
   pm2 save
   pm2 startup   # follow the printed instructions
   ```
6. Put Nginx in front of it as a reverse proxy (so port 80/443 → your app's
   port 8000) and get a free HTTPS certificate with `certbot`. This step is
   genuinely worth learning — it's the same pattern behind most real
   production Node deployments.

### Whichever host you choose

- Set `JWT_SECRET` to something long and random — not the placeholder from
  `.env.example`. Anyone who has this value can forge login tokens.
- Don't commit your real `.env` file to Git (the included `.gitignore`
  already excludes it).
- HTTPS: Render and Railway give you HTTPS automatically on their default
  domains. On a VPS, `certbot --nginx` gets you a free certificate in one
  command once Nginx is set up.

---

## Part 3 — When you wrap this in a mobile app

### The one thing that matters most: point the app at your deployed backend

`public/scripts/api.js` has a constant called `PRODUCTION_API_URL`. The
native app (and any web deploy that isn't `localhost`) always sends its
requests to this exact URL — there is no other configuration for this, so
if it's wrong, *every* request fails, including sign up/login, which is
what a "Request failed (401)" on the name step of sign up means.

Set it to wherever you deployed the `server/` folder in Part 2, with `/api`
on the end — for Render that looks like:

```js
const PRODUCTION_API_URL = "https://your-app-name.onrender.com/api";
```

**Do not** paste your Supabase project URL here (the
`https://xxxx.supabase.co` one from your dashboard). That URL is Supabase's
own auto-generated REST API, which knows nothing about routes like
`/auth/register` — those only exist on your Express server. Supabase is
only this app's *database* (see `server/src/db.js`); the app always talks
to your Express server, and your Express server talks to Supabase's
Postgres behind the scenes. Pointing `PRODUCTION_API_URL` straight at
Supabase is what produces a 401 on every request, and it'll happen on
`http://localhost:8000` too if you ever open it from a non-localhost
hostname, not just on mobile.

After changing this file, rebuild/resync the native app so it picks up the
change:

```bash
npx cap sync
```

A couple of other things will make the mobile transition smoother, since
the backend was already built with it in mind:

- **Auth already uses bearer tokens (JWT), not cookies** — your mobile
  wrapper (Capacitor, React Native, etc.) can store the token in secure
  device storage and send it as an `Authorization` header exactly like the
  web client does in `public/scripts/api.js`. No auth rewrite needed.
- **CORS is already enabled** on the server, so the mobile app can call the
  API from a different origin (e.g. a `capacitor://` scheme) without
  extra server config.
- **Push notifications** (for things like new join requests or
  announcements) aren't implemented yet — that's a mobile-specific feature
  (Firebase Cloud Messaging for Android, APNs for iOS) that sits on top of
  this API rather than inside it. The natural hook point is
  `server/src/routes/announcements.js` and `rooms.js`, where a
  notification could be sent out at the same moments an in-app
  announcement is created — that's the piece to add when you get there.

### App icon & splash screen

`assets/icon.png` (1024x1024) is the source image for the home-screen app
icon on both platforms — it's the same honeycomb mark used next to "Hive"
in the sidebar, on the brand orange gradient. `assets/splash.png` is the
launch screen shown while the app boots.

If you ever change the logo or brand colors, edit those two source files,
then regenerate every platform size from them (this overwrites the
generated files under `android/app/src/main/res` and
`ios/App/App/Assets.xcassets`, so there's nothing to hand-edit there):

```bash
npm install   # only needed once, to pull in @capacitor/assets
npx capacitor-assets generate --android --iconBackgroundColor "#E8792C" --iconBackgroundColorDark "#C7601C"
npx capacitor-assets generate --ios
npx cap sync
```
