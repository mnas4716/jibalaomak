/**
 * Seed demo users for Curbside MVP
 * Run: node seed.js
 */
const bcrypt = require('bcryptjs');
const { v4: uuid } = require('uuid');
const db = require('./db');

const DEMO_PASSWORD = 'password123';

const users = [
  {
    uid: uuid(),
    role: 'gp',
    email: 'gp@demo.com',
    first_name: 'Amelia',
    last_name: 'Chen',
    phone: '+61400000001',
    ahpra_number: 'MED0001234',
    provider_number: 'GP0001',
    practice_name: 'Bondi Junction Medical Centre',
    practice_address: '123 Oxford St, Bondi Junction NSW 2022',
    practice_state: 'NSW',
    practice_lat: -33.8932,
    practice_lng: 151.2474,
    verified: 1
  },
  // One specialist per specialty — all available + verified so any broadcast connects
  specialist('spec@demo.com', 'Sahil', 'Vohra', 'Dermatology', 'MBBS FACD', '+61400000002'),
  specialist('derm@demo.com', 'Priya', 'Nair', 'Dermatology', 'MBBS FACD', '+61400000003'),
  specialist('cardio@demo.com', 'Mei', 'Lin', 'Cardiology', 'MBBS FRACP', '+61400000004'),
  specialist('endo@demo.com', 'James', 'Okafor', 'Endocrinology', 'MBBS FRACP', '+61400000005'),
  specialist('psych@demo.com', 'Sarah', 'Bennett', 'Psychiatry', 'MBBS FRANZCP', '+61400000006'),
  {
    uid: uuid(),
    role: 'admin',
    email: 'admin@demo.com',
    first_name: 'Admin',
    last_name: 'User',
    verified: 1
  }
];

function specialist(email, first, last, specialty, quals, phone) {
  return {
    uid: uuid(), role: 'specialist', email, first_name: first, last_name: last,
    phone, ahpra_number: 'MED' + Math.floor(1000000 + Math.random() * 9000000),
    provider_number: 'SP' + Math.floor(1000 + Math.random() * 9000),
    practice_name: `${specialty} Centre`, practice_address: 'Sydney NSW 2000',
    practice_state: 'NSW', practice_lat: -33.8688, practice_lng: 151.2093,
    specialty, qualifications: quals,
    bio: `Consultant ${specialty.toLowerCase()} specialist.`,
    consult_rate_cents: 9000, verified: 1, is_available: 1
  };
}

async function seed() {
  await db.ready;

  const hash = await bcrypt.hash(DEMO_PASSWORD, 12);

  for (const u of users) {
    // Skip if email already exists
    const existing = db.get('SELECT id FROM users WHERE email = ?', [u.email]);
    if (existing) {
      console.log(`  ○ ${u.email} already exists — skipping`);
      continue;
    }

    db.run(`
      INSERT INTO users (uid, role, email, password_hash, first_name, last_name,
        phone, ahpra_number, provider_number, practice_name, practice_address,
        practice_state, practice_lat, practice_lng, specialty, qualifications,
        bio, consult_rate_cents, verified, is_available)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      u.uid, u.role, u.email, hash, u.first_name, u.last_name,
      u.phone || null, u.ahpra_number || null, u.provider_number || null,
      u.practice_name || null, u.practice_address || null,
      u.practice_state || null, u.practice_lat || null, u.practice_lng || null,
      u.specialty || null, u.qualifications || null,
      u.bio || null, u.consult_rate_cents || null,
      u.verified || 0, u.is_available || 0
    ]);

    console.log(`  ✓ Created ${u.role}: ${u.email}`);
  }

  db.save();
  console.log('  ✓ Database saved');
}

seed().then(() => process.exit(0)).catch(err => {
  console.error('Seed failed:', err);
  process.exit(1);
});
