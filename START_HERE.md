# Curbside — START HERE

This is the **fixed, working** version. Your GitHub repo (`jibalaomak`) was scrambled:
the files had the wrong names, the folders (`routes/`, `services/`, `public/`,
`middleware/`) were flattened, and the real `db.js` database file was missing.
That is the *only* reason it crashed with `Cannot read properties of undefined (reading 'then')`.

This package has the correct structure and has been booted and tested.

---

## Folder structure (this is what your repo MUST look like)

```
curbside/
├── server.js
├── db.js              ← the REAL database module (was missing before)
├── seed.js
├── package.json
├── package-lock.json
├── .env.example
├── .gitignore
├── middleware/
│   └── auth.js
├── routes/
│   ├── auth.js
│   ├── consults.js
│   ├── specialists.js
│   ├── billing.js
│   ├── admin.js
│   └── notes.js
├── services/
│   ├── ai.js
│   ├── billing.js
│   ├── claiming.js
│   ├── video.js
│   ├── email.js
│   └── sms.js
└── public/
    ├── index.html
    └── app.js
```

---

## A) RUN IT LOCALLY (Windows / PowerShell)

```powershell
# 1. open the folder
cd path\to\curbside

# 2. install dependencies (one time)
npm install

# 3. start it
npm start
```

Then open your browser at: **http://localhost:3000**

A ready-to-run `.env` is already included (everything in "mock" mode, so it
works with **no API keys**). You're done.

---

## B) DEPLOY TO RAILWAY (Git)

1. Push this folder to GitHub (replace the scrambled contents of `jibalaomak`):

   ```bash
   cd path/to/curbside
   git init
   git add .
   git commit -m "Fix: correct folder structure + restore db.js"
   git branch -M main
   git remote add origin https://github.com/mnas4716/jibalaomak.git
   git push -u origin main --force
   ```

2. In Railway → your service → **Settings**:
   - **Start Command:** `npm start`   (or leave blank — Railpack auto-detects it)
   - **Build Command:** leave blank (`npm ci` runs automatically)

3. In Railway → **Variables**, add these (the `.env` is git-ignored, so Railway
   needs them set in the dashboard):

   | Variable          | Value                                          |
   |-------------------|------------------------------------------------|
   | `JWT_SECRET`      | a long random string (64+ chars)               |
   | `AI_PROVIDER`     | `mock` (or `claude` + key below)               |
   | `ANTHROPIC_API_KEY` | *(only if AI_PROVIDER=claude)*               |
   | `SMS_PROVIDER`    | `mock`                                          |
   | `EMAIL_PROVIDER`  | `mock`                                          |
   | `VIDEO_PROVIDER`  | `jitsi`                                          |
   | `CLAIMING_PROVIDER` | `mock`                                        |
   | `BILLING_TIME_UNIT` | `minutes`                                     |

   You do **not** need to set `PORT` — Railway sets it automatically and
   `server.js` already reads `process.env.PORT`.

4. Redeploy.

### ⚠️ Important Railway caveat — data does not persist by default
This app stores data in a single SQLite file (`curbside.db`). On Railway that
file lives on **ephemeral** storage, so it is **wiped on every redeploy/restart**.
That's fine for a demo. To keep data between deploys:
- Railway → your service → **Settings → Volumes** → add a volume mounted at e.g. `/data`
- Then set variable `DB_PATH=/data/curbside.db`

---

## Was the empty "Start Command" the problem?
No. Your build logs showed Railway *was* running `npm run start` correctly.
The crash was 100% the scrambled repo / missing `db.js`. Setting the start
command to `npm start` is still good practice, but it wasn't the cause.
