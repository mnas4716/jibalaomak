/**
 * MBS Billing Engine — Patient End Support (PES)
 *
 * Implements the PES decision logic from the MBS factsheet (effective 1 Mar 2026).
 * Curbside simplification (per product decision):
 *   - Patient is assumed in the room with the GP for the whole consult.
 *   - Patient face-to-face time = total video-on time (consult active duration).
 *
 * Schedule fees are APPROXIMATE and must be validated against MBS Online before
 * going live (the factsheet itself notes fees change and are not legal/billing advice).
 */

// GP PES item map: [tier][location]
const PES_GP = {
  tier_1: { in_rooms: '2484', out_rooms: '2485', raca: '2486' }, // >=6 to <20 min
  tier_2: { in_rooms: '2487', out_rooms: '2488', raca: '2489' }, // >=20 to <40 min
  tier_3: { in_rooms: '2490', out_rooms: '2491', raca: '2492' }, // >=40 to <60 min
  tier_4: { in_rooms: '2493', out_rooms: '2494', raca: '2495' }  // >=60 min
};

// Specialist video items (paired with PES)
const SPEC_ITEMS = { initial: '91822', subsequent: '91823', minor: '91833' };

// Approximate schedule fees in cents (validate against MBS Online)
const FEES = {
  '2484': 4105,  '2485': 7800,  '2486': 7800,
  '2487': 7930,  '2488': 11430, '2489': 11430,
  '2490': 11000, '2491': 15000, '2492': 15000,
  '2493': 14500, '2494': 19000, '2495': 19000,
  '91822': 9000, '91823': 4500, '91833': 3000
};

const TIER_LABELS = {
  tier_1: '6–20 min', tier_2: '20–40 min', tier_3: '40–60 min', tier_4: '60+ min'
};
const LOCATION_LABELS = {
  in_rooms: 'in consulting rooms', out_rooms: 'out of consulting rooms', raca: 'residential aged care'
};

// Time unit for tier selection. 'seconds' (default, for demo/testing so a short
// call still produces a real item) or 'minutes' (production, per the factsheet).
const TIME_UNIT = (process.env.BILLING_TIME_UNIT || 'minutes').toLowerCase();

function durationTier(seconds) {
  const units = TIME_UNIT === 'minutes' ? seconds / 60 : seconds;
  if (units < 6) return null;        // below PES minimum — not claimable
  if (units < 20) return 'tier_1';
  if (units < 40) return 'tier_2';
  if (units < 60) return 'tier_3';
  return 'tier_4';
}

/**
 * Produce a billing recommendation from captured consult signals.
 * @param {object} signals
 *   patient_present, gp_in_room, specialist_billing_mbs (booleans)
 *   consult_mode ('video'|'audio_only')
 *   duration_patient_face_seconds (int)
 *   location_type ('in_rooms'|'out_rooms'|'raca')
 *   is_initial_attendance (bool)
 */
function recommend(signals) {
  const s = signals;
  const flags = [];

  // ── Eligibility gates (per factsheet) ──
  if (s.consult_mode === 'audio_only') flags.push('PES_REQUIRES_VIDEO_NOT_AUDIO');
  if (!s.patient_present) flags.push('PATIENT_NOT_PRESENT');
  if (!s.gp_in_room) flags.push('GP_NOT_IN_ROOM');
  if (!s.specialist_billing_mbs) flags.push('PES_REQUIRES_SPECIALIST_MBS_VIDEO');

  const tier = durationTier(s.duration_patient_face_seconds || 0);
  if (!tier) flags.push('DURATION_BELOW_PES_MINIMUM_6MIN');

  const location = ['in_rooms', 'out_rooms', 'raca'].includes(s.location_type)
    ? s.location_type : 'in_rooms';

  // If any hard gate failed → no PES pathway
  const eligible = flags.length === 0;

  if (!eligible) {
    return {
      pathway: tier ? 'PRIVATE' : 'NONE',
      gp_mbs_item: null,
      gp_schedule_fee_cents: 0,
      specialist_mbs_item: s.specialist_billing_mbs
        ? (s.is_initial_attendance ? SPEC_ITEMS.initial : SPEC_ITEMS.subsequent) : null,
      specialist_schedule_fee_cents: s.specialist_billing_mbs
        ? FEES[s.is_initial_attendance ? SPEC_ITEMS.initial : SPEC_ITEMS.subsequent] : 0,
      decision_rule: 'PES not claimable — eligibility gate failed',
      compliance_flags: flags,
      tier_label: tier ? TIER_LABELS[tier] : 'under 6 min',
      location_label: LOCATION_LABELS[location],
      eligible: false
    };
  }

  // ── PES pathway ──
  const gpItem = PES_GP[tier][location];
  const specItem = s.is_initial_attendance ? SPEC_ITEMS.initial : SPEC_ITEMS.subsequent;

  return {
    pathway: 'PES',
    gp_mbs_item: gpItem,
    gp_schedule_fee_cents: FEES[gpItem] || 0,
    specialist_mbs_item: specItem,
    specialist_schedule_fee_cents: FEES[specItem] || 0,
    decision_rule: `PES ${TIER_LABELS[tier]}, ${LOCATION_LABELS[location]}`,
    compliance_flags: [],
    tier_label: TIER_LABELS[tier],
    location_label: LOCATION_LABELS[location],
    eligible: true
  };
}

function dollars(cents) { return '$' + ((cents || 0) / 100).toFixed(2); }

module.exports = { recommend, FEES, PES_GP, SPEC_ITEMS, dollars, TIME_UNIT };
