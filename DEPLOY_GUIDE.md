# CURBSIDE — Deployment Guide (Idiot-Proof Edition)

> This guide assumes you have ZERO experience with deployment.
> Every click is documented. You'll have a live app in ~1 hour.

---

## WHAT YOU'RE SETTING UP

```
Your laptop
   ↓ (push code)
GitHub (stores your code)
   ↓                          ↓
Railway (runs backend)     Vercel (runs frontend)
   ↓
Supabase (database)
   ↓
Twilio (SMS) + Jitsi (video) ← these are just API keys
```

---

## STEP 0: THINGS YOU NEED BEFORE STARTING

### 0.1 — Install Node.js
1. Go to https://nodejs.org
2. Download the **LTS** version (big green button)
3. Run the installer, click Next on everything
4. To verify: open Terminal (Mac) or Command Prompt (Windows), type:
   ```
   node --version
   ```
   You should see something like `v20.x.x`. If you see an error, restart your computer and try again.

### 0.2 — Install Git
1. Go to https://git-scm.com/downloads
2. Download for your OS
3. Run installer, click Next on everything (defaults are fine)
4. Verify:
   ```
   git --version
   ```

### 0.3 — Create accounts (all free)
Open each link in a new tab. Sign up with your email. All have free tiers.

| Service | Link | What it does |
|---------|------|-------------|
| GitHub | https://github.com/signup | Stores your code |
| Railway | https://railway.app | Runs your backend server |
| Vercel | https://vercel.com/signup | Hosts your frontend |
| Supabase | https://supabase.com/dashboard | Your database |
| Twilio | https://www.twilio.com/try-twilio | Sends SMS (optional for now) |

**TIP**: Sign up for Railway and Vercel using your GitHub account. It makes connecting easier later.

---

## STEP 1: GET YOUR CODE ON GITHUB

### 1.1 — Create a GitHub repository
1. Go to https://github.com/new
2. Repository name: `curbside`
3. Description: `GP-specialist consultation platform`
4. Select **Private** (your code, your business)
5. Do NOT check any boxes (no README, no .gitignore — we have our own)
6. Click **Create repository**
7. You'll see a page with instructions. Leave this tab open.

### 1.2 — Push your code to GitHub
1. Open Terminal / Command Prompt
2. Navigate to your curbside folder:
   ```bash
   cd ~/Desktop/curbside
   ```
   (or wherever you unzipped the files)

3. Run these commands ONE BY ONE:
   ```bash
   git init
   ```
   ```bash
   git add .
   ```
   ```bash
   git commit -m "Initial MVP"
   ```
   ```bash
   git branch -M main
   ```
   ```bash
   git remote add origin https://github.com/YOUR_USERNAME/curbside.git
   ```
   ⚠️ Replace `YOUR_USERNAME` with your actual GitHub username!

   ```bash
   git push -u origin main
   ```

4. It may ask for your GitHub username and password.
   - Username: your GitHub username
   - Password: this is NOT your GitHub password. You need a Personal Access Token.
   - Go to https://github.com/settings/tokens → Generate new token (classic)
   - Check the `repo` box → Generate → Copy the token → Paste it as your password

5. Refresh your GitHub repo page. You should see your files!

---

## STEP 2: SET UP SUPABASE (Database)

### 2.1 — Create a project
1. Go to https://supabase.com/dashboard
2. Click **New Project**
3. Organization: select your default org (or create one — just click through)
4. Project name: `curbside`
5. Database password: click **Generate a password** → **COPY THIS AND SAVE IT SOMEWHERE SAFE**
6. Region: **Southeast Asia (Singapore)** — closest to Australia
   - If Sydney is available, pick that instead
7. Click **Create new project**
8. Wait 1-2 minutes for it to set up

### 2.2 — Get your connection details
1. Once the project is ready, click **Settings** (gear icon, left sidebar)
2. Click **Database** (under Configuration)
3. Scroll to **Connection string** section
4. Click **URI** tab
5. You'll see something like:
   ```
   postgresql://postgres.[project-ref]:[YOUR-PASSWORD]@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres
   ```
6. Copy this. Replace `[YOUR-PASSWORD]` with the password you saved earlier.
7. Save this entire string — this is your `DATABASE_URL`.

### 2.3 — Get your API keys
1. Still in Settings → click **API** (under Configuration)
2. You'll see:
   - **Project URL**: something like `https://abc123.supabase.co` → Save this
   - **anon public key**: a long `eyJ...` string → Save this
   - **service_role secret key**: another long string → Save this (KEEP SECRET)

### 2.4 — Note for MVP
> For the initial MVP, we're using SQLite bundled with the backend (no Supabase DB needed yet).
> When you're ready to scale, swap `db.js` to use the Supabase Postgres connection.
> For now, just save those credentials — you'll need them later.
> 
> What we DO use Supabase for right now: **nothing yet — it's ready for Phase 2 scaling.**
> The MVP runs entirely on SQLite inside Railway.

---

## STEP 3: SET UP RAILWAY (Backend Server)

### 3.1 — Create a new project
1. Go to https://railway.app/dashboard
2. Click **New Project**
3. Click **Deploy from GitHub repo**
4. If it asks to connect GitHub: click **Connect** and authorize Railway
5. Find and select your `curbside` repo
6. Railway will start deploying. It will probably fail — that's OK! We need to add environment variables first.

### 3.2 — Configure the service
1. Click on the service card (the box that appeared)
2. Click **Settings** tab
3. Under **Build & Deploy**:
   - Build Command: `npm install`
   - Start Command: `node server.js`
   - Watch Paths: leave empty
4. Under **Networking**:
   - Click **Generate Domain**
   - You'll get something like `curbside-production-abc123.up.railway.app`
   - **SAVE THIS URL** — this is your backend URL

### 3.3 — Add environment variables
1. Click **Variables** tab
2. Click **New Variable** for each of these:

```
PORT = 3000
JWT_SECRET = (make up a long random string, like: kj4h5kjh345kjhSDFG345sdfg8790dfgh)
JWT_EXPIRES_IN = 7d
DB_PATH = ./curbside.db
SMS_PROVIDER = mock
VIDEO_PROVIDER = jitsi
JITSI_DOMAIN = meet.jit.si
AI_PROVIDER = mock
EMAIL_PROVIDER = mock
```

**To generate a good JWT_SECRET:**
- Go to https://randomkeygen.com
- Scroll to "CodeIgniter Encryption Keys"
- Copy one of those

3. After adding all variables, Railway will auto-redeploy.

### 3.4 — Check if it's working
1. Wait for deploy to finish (green checkmark)
2. Open your Railway URL in a browser:
   ```
   https://YOUR-RAILWAY-URL.up.railway.app/api/health
   ```
3. You should see:
   ```json
   {"ok": true, "app": "Curbside MVP", "time": "...", "routes_loaded": true}
   ```
4. 🎉 **YOUR BACKEND IS LIVE!**

### 3.5 — If deploy fails (troubleshooting)
- Click on the failed deploy → read the logs
- Common issues:
  - Missing env variable → add it in Variables tab
  - Build error → check that package.json is correct
  - Port issue → make sure PORT=3000 is set
- Still stuck? Click **Deploy Logs** and look for red error text

---

## STEP 4: SET UP VERCEL (Frontend)

### 4.1 — Import your project
1. Go to https://vercel.com/dashboard
2. Click **Add New...** → **Project**
3. Click **Import** next to your `curbside` repo
4. Configure:
   - Framework Preset: **Other**
   - Root Directory: click **Edit** → type `public` → click **Continue**
   - Build Command: leave empty (it's static HTML)
   - Output Directory: `.`
5. Click **Deploy**

### 4.2 — Add environment variables
1. Go to your project **Settings** → **Environment Variables**
2. Add:
   ```
   NEXT_PUBLIC_API_URL = https://YOUR-RAILWAY-URL.up.railway.app
   ```
   (use your actual Railway URL from Step 3.3)

### 4.3 — Check if it's working
1. Vercel gives you a URL like `curbside-abc123.vercel.app`
2. Open it in your browser
3. You should see the Curbside frontend
4. 🎉 **YOUR FRONTEND IS LIVE!**

### 4.4 — Custom domain (optional, do later)
1. In Vercel → Settings → Domains
2. Click **Add**
3. Type your domain: `app.curbside.com.au`
4. Vercel tells you which DNS records to add
5. Go to your domain registrar (Namecheap, GoDaddy, etc.)
6. Add the DNS records Vercel tells you
7. Wait 5-30 minutes for DNS to propagate
8. Done — your app is at `app.curbside.com.au`

---

## STEP 5: SET UP TWILIO (SMS — Optional for MVP)

### 5.1 — Get your credentials
1. Go to https://console.twilio.com
2. On the dashboard, you'll see:
   - **Account SID**: starts with `AC...` → Copy it
   - **Auth Token**: click the eye icon to reveal → Copy it

### 5.2 — Get a phone number
1. In Twilio console, click **Phone Numbers** → **Manage** → **Buy a number**
2. Country: Australia
3. Capabilities: check **SMS**
4. Click **Search** → pick any number → **Buy** (free on trial)
5. Your number looks like: `+61412345678` → Copy it

### 5.3 — Add to Railway
1. Go back to Railway → your project → Variables tab
2. Update/add:
   ```
   SMS_PROVIDER = twilio
   TWILIO_ACCOUNT_SID = AC1234567890abcdef1234567890abcdef
   TWILIO_AUTH_TOKEN = your_auth_token_here
   TWILIO_FROM_NUMBER = +61412345678
   ```
3. Railway auto-redeploys. SMS is now live!

### 5.4 — Twilio trial limitations
- Free trial: can only send SMS to **verified numbers**
- To verify a number: Twilio Console → Phone Numbers → Verified Caller IDs → Add
- To remove this limit: upgrade to paid ($20 minimum top-up)
- Cost per SMS in Australia: ~$0.06 AUD

---

## STEP 6: VIDEO LINKS (Jitsi — Free, No Setup)

### 6.1 — It already works!
Jitsi Meet is free and needs NO API keys. The app generates video room URLs like:
```
https://meet.jit.si/curbside-consult-abc123
```

Anyone with the link can join. No accounts needed. Works on mobile browsers.

### 6.2 — Upgrading to Daily.co (optional, better quality)
1. Go to https://www.daily.co/signup
2. Create account
3. Dashboard → **Developers** → copy your API key
4. Your domain is: `https://YOUR-SUBDOMAIN.daily.co`
5. Add to Railway:
   ```
   VIDEO_PROVIDER = daily
   DAILY_API_KEY = your_daily_api_key
   DAILY_DOMAIN = https://yourname.daily.co
   ```

### 6.3 — Using MS Teams links instead
If you prefer MS Teams:
- The app generates a Jitsi link by default
- You can manually paste a Teams meeting link when creating a consult
- Full Teams API integration requires a Microsoft 365 business account + Azure app registration (complex — do this later)

---

## STEP 7: AI DOCUMENTATION (Optional for MVP)

### 7.1 — Mock mode (default)
The app ships with mock AI responses. Consults still work — they just get placeholder SOAP notes and letters instead of AI-generated ones.

### 7.2 — Activate Claude AI
1. Go to https://console.anthropic.com
2. Sign up → add a payment method
3. Go to **API Keys** → **Create Key** → Copy it
4. Add to Railway:
   ```
   AI_PROVIDER = claude
   ANTHROPIC_API_KEY = sk-ant-api03-xxxxxxxxxxxx
   ```
5. Cost: ~$0.01-0.05 per consult (very cheap)

---

## STEP 8: VERIFY EVERYTHING WORKS

### 8.1 — Checklist
Open each URL and verify:

| Check | URL | Expected |
|-------|-----|----------|
| Backend health | `https://YOUR-RAILWAY-URL/api/health` | `{"ok": true}` |
| Frontend loads | `https://YOUR-VERCEL-URL` | Curbside login page |
| Register works | Frontend → Sign up as GP | Success message |
| Login works | Frontend → Log in | Dashboard loads |
| Video link | Create a consult → click video link | Jitsi room opens |

### 8.2 — Test the full flow
1. Register as a GP (role: gp)
2. Register as a specialist in a different browser/incognito (role: specialist)
3. As GP: create a consult request
4. As specialist: toggle available → see incoming request → accept
5. Both: click video link → Jitsi room opens
6. End consult → see SOAP note generated

---

## STEP 9: ONGOING MAINTENANCE

### 9.1 — Pushing updates
When you change code locally:
```bash
git add .
git commit -m "describe what you changed"
git push
```
Both Railway and Vercel auto-deploy when you push to GitHub.

### 9.2 — Viewing logs
- **Railway**: click your service → **Deployments** → click latest → **View Logs**
- **Vercel**: project → **Deployments** → click latest → **Functions** tab

### 9.3 — Database backups
The SQLite database lives inside your Railway container. To back it up:
1. Railway dashboard → your service → **Settings**
2. Under **Railway CLI**: install it locally
3. Run: `railway shell` then `cat curbside.db | base64 > backup.txt`

**Better long-term**: migrate to Supabase Postgres (has automatic daily backups).

### 9.4 — Costs summary

| Service | Free tier | When you'd pay |
|---------|-----------|----------------|
| Railway | $5 free credit/month | After ~500 hours or heavy traffic |
| Vercel | 100GB bandwidth/month | Extremely high traffic only |
| Supabase | 500MB DB, 50k requests | If/when you migrate DB there |
| Twilio | ~$15 trial credit | After trial, ~$0.06/SMS |
| Jitsi | Unlimited, forever | Never (or switch to paid provider for quality) |
| Claude AI | Pay per use | ~$0.01-0.05 per consult |

**Total to run MVP: $0-5/month** until you have real users.

---

## QUICK REFERENCE — YOUR SAVED URLS & KEYS

Fill this in as you go:

```
GITHUB REPO:       https://github.com/________/curbside
RAILWAY BACKEND:   https://__________________.up.railway.app
VERCEL FRONTEND:   https://__________________.vercel.app
SUPABASE PROJECT:  https://__________________.supabase.co
SUPABASE ANON KEY: eyJ_____________________________
TWILIO SID:        AC______________________________
TWILIO NUMBER:     +61_____________________________
ANTHROPIC KEY:     sk-ant-api03-___________________
```

---

## TROUBLESHOOTING

### "Deploy failed" on Railway
→ Click deploy → read logs → usually a missing env var or typo in package.json

### "Cannot connect to API" on frontend  
→ Check that NEXT_PUBLIC_API_URL in Vercel matches your Railway URL exactly (with https://)

### "Token expired" errors
→ Log out and log back in. JWTs expire after 7 days by default.

### SMS not sending
→ Check SMS_PROVIDER=twilio (not mock). Check Twilio balance. Check recipient is verified (trial mode).

### Video link doesn't work
→ Jitsi is sometimes slow in Australia. Try refreshing. Or switch to Daily.co.

### Database reset after deploy
→ Railway resets the filesystem on each deploy. This is why you should migrate to Supabase Postgres before going live with real patients.

---

*End of deployment guide. Save this file — you'll reference it repeatedly.*
