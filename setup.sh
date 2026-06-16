#!/bin/bash
# Curbside MVP — One-click setup
# Run: chmod +x setup.sh && ./setup.sh

echo ""
echo "🏥 CURBSIDE MVP — Setting up..."
echo ""

# 1. Create .env from example if it doesn't exist
if [ ! -f .env ]; then
  cp .env.example .env
  # Generate a random JWT secret
  JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
  if [[ "$OSTYPE" == "darwin"* ]]; then
    sed -i '' "s/replace_with_64_char_random_string/$JWT_SECRET/" .env
  else
    sed -i "s/replace_with_64_char_random_string/$JWT_SECRET/" .env
  fi
  echo "✓ .env created with random JWT secret"
else
  echo "○ .env already exists — skipping"
fi

# 2. Install dependencies
echo "Installing dependencies..."
npm install
echo "✓ Dependencies installed"

# 3. Seed demo users (optional)
echo ""
read -p "Create demo users (GP + Specialist + Admin)? [y/N] " -n 1 -r
echo ""
if [[ $REPLY =~ ^[Yy]$ ]]; then
  node seed.js
  echo "✓ Demo users created"
fi

echo ""
echo "════════════════════════════════════════════"
echo "  ✅ SETUP COMPLETE"
echo ""
echo "  Run the app:   npm start"
echo "  Dev mode:      npm run dev"
echo "  Then open:     http://localhost:3000"
echo ""
echo "  Demo logins (if seeded):"
echo "    GP:         gp@demo.com / password123"
echo "    Specialist: spec@demo.com / password123"
echo "    Admin:      admin@demo.com / password123"
echo "════════════════════════════════════════════"
echo ""
