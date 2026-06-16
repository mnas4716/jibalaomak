# CURBSIDE MVP — How To Run This

## What you need first (one-time installs)

### Step 1: Install Node.js
1. Go to https://nodejs.org
2. Click the big green **LTS** button
3. Run the downloaded file, click Next/Continue on everything
4. Restart your computer

### Step 2: Verify it worked
- **Mac**: Open "Terminal" (search for it in Spotlight)
- **Windows**: Open "Command Prompt" (search in Start menu)

Type this and press Enter:
```
node --version
```
If you see a number like `v20.18.0` — you're good. If you see an error, reinstall Node.js.

---

## How to run Curbside

### Step 1: Unzip this file
Unzip `curbside-complete.zip` anywhere on your computer.
You'll get a folder called `curbside/`.

### Step 2: Open Terminal in that folder

**Mac:**
1. Open Terminal
2. Type `cd ` (with a space after it)
3. Drag the `curbside` folder from Finder into the Terminal window
4. Press Enter

**Windows:**
1. Open the `curbside` folder in File Explorer
2. Click in the address bar at the top
3. Type `cmd` and press Enter
4. A black Command Prompt window opens inside that folder

### Step 3: Install and run (3 commands)

Type these one at a time, pressing Enter after each:

```
npm install
```
(Wait for it to finish — takes 30-60 seconds)

```
node seed.js
```
(Creates demo user accounts for testing)

```
npm start
```

You should see:
```
🏥 Curbside MVP running → http://localhost:3000
```

### Step 4: Open it
Open your web browser and go to:
```
http://localhost:3000
```

### Step 5: Test it
The API is running. You can test with these demo accounts:

| Role | Email | Password |
|------|-------|----------|
| GP | gp@demo.com | password123 |
| Specialist | spec@demo.com | password123 |
| Admin | admin@demo.com | password123 |

### Quick API test (paste into browser address bar):
```
http://localhost:3000/api/health
```
Should show: `{"ok":true,"app":"Curbside MVP",...}`

---

## How to stop the server
Press `Ctrl + C` in the Terminal window.

## How to start it again later
1. Open Terminal
2. `cd` into the curbside folder (same as Step 2 above)
3. Type `npm start` and press Enter

---

## What's included

```
curbside/
├── server.js          ← The main server
├── db.js              ← Database (creates itself automatically)
├── seed.js            ← Creates demo users
├── setup.sh           ← Auto-setup script (Mac/Linux only)
├── package.json       ← Dependencies list
├── .env.example       ← Config template
├── DEPLOY_GUIDE.md    ← How to put this on the internet
├── middleware/
│   └── auth.js        ← Login/JWT security
├── services/
│   ├── sms.js         ← SMS (prints to console, swap to Twilio)
│   ├── video.js       ← Video links (Jitsi — works immediately!)
│   ├── ai.js          ← AI notes (mock, swap to Claude API)
│   └── email.js       ← Email (prints to console, swap to SMTP)
├── routes/
│   ├── auth.js        ← Register + Login endpoints
│   └── consults.js    ← Create/manage consultations
└── public/            ← Frontend goes here (coming in Phase 8-10)
```

## FAQ

**Q: I see "command not found: node"**
A: Node.js isn't installed. Go back to Step 1.

**Q: I see "Cannot find module" errors**
A: You forgot to run `npm install`. Run it and try again.

**Q: The port is already in use**
A: Another app is using port 3000. Either close it, or change PORT in .env to 3001.

**Q: Where's the frontend / UI?**
A: The backend API is done. Frontend UI is coming in Phase 8-10. For now you can test via the API directly or use the test page at http://localhost:3000.
