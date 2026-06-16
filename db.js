const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const DB_PATH = path.resolve(process.env.DB_PATH || './curbside.db');

let _db = null;
let _ready = null;

// ── Wrapper: gives sql.js a simpler API ──
const wrapper = {
  // Run SQL that returns nothing (CREATE, INSERT, UPDATE, DELETE)
  run(sql, params = []) {
    _db.run(sql, params);
    return { changes: _db.getRowsModified(), lastInsertRowid: getLastId() };
  },

  // Run SQL that returns rows
  all(sql, params = []) {
    const stmt = _db.prepare(sql);
    stmt.bind(params);
    const rows = [];
    while (stmt.step()) {
      rows.push(stmt.getAsObject());
    }
    stmt.free();
    return rows;
  },

  // Run SQL that returns one row
  get(sql, params = []) {
    const rows = wrapper.all(sql, params);
    return rows[0] || null;
  },

  // Execute raw SQL (for migrations)
  exec(sql) {
    _db.exec(sql);
  },

  // Save DB to disk
  save() {
    const data = _db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(DB_PATH, buffer);
  },

  // Prepare-like helper for compatibility
  prepare(sql) {
    return {
      run: (...params) => wrapper.run(sql, params),
      get: (...params) => wrapper.get(sql, params),
      all: (...params) => wrapper.all(sql, params)
    };
  }
};

function getLastId() {
  const row = _db.exec('SELECT last_insert_rowid() as id');
  return row.length > 0 ? row[0].values[0][0] : 0;
}

// ── Schema migrations ──
function runMigrations() {
  wrapper.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      uid TEXT UNIQUE NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('gp', 'specialist', 'admin')),
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      phone TEXT,
      ahpra_number TEXT,
      provider_number TEXT,
      practice_name TEXT,
      practice_address TEXT,
      practice_lat REAL,
      practice_lng REAL,
      practice_state TEXT,
      specialty TEXT,
      qualifications TEXT,
      bio TEXT,
      consult_rate_cents INTEGER DEFAULT 9000,
      verified INTEGER NOT NULL DEFAULT 0,
      verified_at TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      is_available INTEGER NOT NULL DEFAULT 0,
      available_updated_at TEXT,
      avatar_url TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      last_login_at TEXT
    );

    CREATE TABLE IF NOT EXISTS availability_windows (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      specialist_id INTEGER NOT NULL,
      day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      timezone TEXT NOT NULL DEFAULT 'Australia/Sydney',
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      CHECK (start_time < end_time)
    );

    CREATE TABLE IF NOT EXISTS availability_slots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      specialist_id INTEGER NOT NULL,
      slot_date TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS consults (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ref_code TEXT UNIQUE NOT NULL,
      gp_id INTEGER NOT NULL,
      specialist_id INTEGER,
      specialty TEXT NOT NULL,
      urgency TEXT NOT NULL CHECK (urgency IN ('routine', 'soon', 'urgent')),
      status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
        'draft','structured','broadcasting','accepted','active',
        'completed','cancelled','expired'
      )),
      patient_initials TEXT,
      patient_first_name TEXT,
      patient_last_name TEXT,
      patient_medicare TEXT,
      patient_irn TEXT,
      patient_dob TEXT,
      patient_age INTEGER,
      patient_sex TEXT CHECK (patient_sex IN ('M','F','Other')),
      booking_type TEXT DEFAULT 'on_call' CHECK (booking_type IN ('on_call','scheduled')),
      scheduled_at TEXT,
      case_summary TEXT NOT NULL,
      ai_structured_summary TEXT,
      transcript TEXT,
      soap_note TEXT,
      attachments TEXT DEFAULT '[]',
      video_room_url TEXT,
      video_room_id TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      structured_at TEXT,
      broadcast_at TEXT,
      accepted_at TEXT,
      started_at TEXT,
      ended_at TEXT,
      duration_seconds INTEGER,
      duration_patient_face_seconds INTEGER,
      gp_rating INTEGER CHECK (gp_rating BETWEEN 1 AND 5),
      gp_feedback TEXT,
      gp_confirmed INTEGER NOT NULL DEFAULT 0,
      specialist_confirmed INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS billing_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      consult_id INTEGER NOT NULL,
      billing_pathway TEXT NOT NULL CHECK (billing_pathway IN (
        'PES','CASE_CONFERENCE','STANDARD_TELEHEALTH',
        'STANDARD_GP_ATTENDANCE','PRIVATE','NONE'
      )),
      gp_mbs_item TEXT,
      gp_schedule_fee_cents INTEGER,
      gp_item_confirmed INTEGER NOT NULL DEFAULT 0,
      specialist_mbs_item TEXT,
      specialist_schedule_fee_cents INTEGER,
      specialist_item_confirmed INTEGER NOT NULL DEFAULT 0,
      specialist_billing_mbs INTEGER NOT NULL DEFAULT 1,
      patient_present INTEGER NOT NULL,
      gp_in_room INTEGER NOT NULL,
      consult_mode TEXT NOT NULL CHECK (consult_mode IN ('video','audio_only')),
      duration_patient_face_seconds INTEGER,
      location_type TEXT CHECK (location_type IN ('in_rooms','out_rooms','raca')),
      is_initial_attendance INTEGER,
      patient_consent_recorded INTEGER NOT NULL DEFAULT 0,
      platform_fee_cents INTEGER,
      decision_rule_applied TEXT,
      compliance_flags TEXT DEFAULT '[]',
      billing_status TEXT DEFAULT 'recommended' CHECK (billing_status IN (
        'recommended','confirmed','submitted','paid','rejected'
      )),
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      consult_id INTEGER NOT NULL,
      doc_type TEXT NOT NULL CHECK (doc_type IN (
        'soap_note','letter_to_gp','referral_letter',
        'patient_handout','appointment_request','billing_summary'
      )),
      content TEXT NOT NULL,
      generated_by TEXT DEFAULT 'ai',
      ai_model TEXT,
      reviewed_by INTEGER,
      reviewed_at TEXT,
      is_signed_off INTEGER NOT NULL DEFAULT 0,
      sent_at TEXT,
      delivery_status TEXT DEFAULT 'draft' CHECK (delivery_status IN (
        'draft','ready','sent','delivered','failed'
      )),
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      consult_id INTEGER,
      author_id INTEGER NOT NULL,
      content TEXT NOT NULL,
      note_type TEXT DEFAULT 'clinical' CHECK (note_type IN (
        'clinical','internal','follow_up','admin'
      )),
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      recipient_id INTEGER NOT NULL,
      type TEXT NOT NULL CHECK (type IN (
        'incoming_consult','consult_accepted','consult_completed',
        'billing_recommendation','verification_approved','system_alert'
      )),
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      consult_id INTEGER,
      sms_sent INTEGER NOT NULL DEFAULT 0,
      read INTEGER NOT NULL DEFAULT 0,
      read_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event TEXT NOT NULL,
      actor_id INTEGER,
      actor_type TEXT DEFAULT 'user' CHECK (actor_type IN ('user','system','ai')),
      target_type TEXT,
      target_id TEXT,
      metadata TEXT DEFAULT '{}',
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // Migration: add is_active to existing DBs (ignore error if column exists)
  try {
    wrapper.exec('ALTER TABLE users ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1');
  } catch (e) { /* column already exists */ }

  // Migration: add new consult patient/booking columns to existing DBs
  const consultCols = [
    'patient_first_name TEXT', 'patient_last_name TEXT', 'patient_medicare TEXT',
    'patient_irn TEXT', 'patient_dob TEXT',
    "booking_type TEXT DEFAULT 'on_call'", 'scheduled_at TEXT',
    "declined_specialist_ids TEXT DEFAULT '[]'"
  ];
  for (const col of consultCols) {
    try { wrapper.exec(`ALTER TABLE consults ADD COLUMN ${col}`); }
    catch (e) { /* exists */ }
  }
  try { wrapper.exec('ALTER TABLE users ADD COLUMN postcode TEXT'); } catch (e) {}

  // Migration: add Medicare claim tracking to billing_records
  const billingCols = [
    'gp_claim_id TEXT', 'gp_claim_status TEXT',
    'specialist_claim_id TEXT', 'specialist_claim_status TEXT',
    'claim_submitted_at TEXT'
  ];
  for (const col of billingCols) {
    try { wrapper.exec(`ALTER TABLE billing_records ADD COLUMN ${col}`); }
    catch (e) { /* exists */ }
  }

  wrapper.save();
  console.log('  ✓ Database schema ready');
}

// ── Init: returns a promise, resolves with the wrapper ──
_ready = initSqlJs().then(SQL => {
  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    _db = new SQL.Database(fileBuffer);
    console.log('  ✓ Database loaded from disk');
  } else {
    _db = new SQL.Database();
    console.log('  ✓ New database created');
  }

  runMigrations();

  // Auto-save every 30 seconds
  setInterval(() => wrapper.save(), 30000);

  // Save on exit
  process.on('SIGINT', () => { wrapper.save(); process.exit(0); });
  process.on('SIGTERM', () => { wrapper.save(); process.exit(0); });

  return wrapper;
});

// Export both the wrapper (for sync use after init) and the ready promise
module.exports = wrapper;
module.exports.ready = _ready;
