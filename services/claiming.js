/**
 * Claiming Service — submits MBS claims via a claiming channel.
 *
 *   CLAIMING_PROVIDER=mock   → logs + simulates approval (default, safe for dev)
 *   CLAIMING_PROVIDER=tyro   → submits real claims to Tyro Health (Medipass) API
 *
 * IMPORTANT (Tyro): each claim is for ONE provider. Curbside submits two claims
 * per consult — the GP's PES item and the specialist's video item — separately.
 *
 * Before going live with tyro, confirm the exact base URL, auth header and invoice
 * schema in the Tyro Health developer portal: https://docs.tyrohealth.com
 * The payload below maps the fields their docs require (provider number; patient
 * name/DOB/Medicare card + IRN; service items with date, item number, fee).
 */
require('dotenv').config();
const { v4: uuid } = require('uuid');

const provider = (process.env.CLAIMING_PROVIDER || 'mock').toLowerCase();

// ── Mock provider ──
const mockClaiming = {
  async submitClaim(invoice) {
    console.log(`[CLAIM:MOCK] Submit ${invoice.claimType} for provider ${invoice.providerNumber}`);
    console.log(`  Items: ${invoice.items.map(i => i.itemNumber + ' $' + (i.feeCents/100).toFixed(2)).join(', ')}`);
    return {
      claimId: `MOCK-${uuid().slice(0, 8)}`,
      // patient claims are ~instant; bulk-bill is next business day (we simulate 'submitted')
      status: invoice.claimType === 'patient' ? 'approved' : 'submitted',
      provider: 'mock'
    };
  },
  async getStatus(claimId) {
    // Mock: anything submitted becomes approved on the next check
    console.log(`[CLAIM:MOCK] Status check ${claimId}`);
    return { claimId, status: 'approved', provider: 'mock' };
  }
};

// ── Tyro Health (Medipass) provider ──
const tyroClaiming = {
  _base() { return (process.env.TYRO_BASE_URL || 'https://api.medipass.io').replace(/\/$/, ''); },
  _headers() {
    return {
      'Content-Type': 'application/json',
      // Confirm the exact auth header name in the Tyro developer portal:
      'authorization': `Bearer ${process.env.TYRO_API_KEY}`,
      'x-api-key': process.env.TYRO_API_KEY || ''
    };
  },

  async submitClaim(invoice) {
    // Map Curbside invoice → Tyro/Medipass invoice payload (confirm exact shape in their docs)
    const payload = {
      claimType: invoice.claimType,                 // 'bulk-bill' | 'patient'
      fundType: 'medicare',
      provider: { providerNumber: invoice.providerNumber },
      patient: {
        firstName: invoice.patient.firstName,
        lastName: invoice.patient.lastName,
        dob: invoice.patient.dob,                    // YYYY-MM-DD
        medicareNumber: invoice.patient.medicare,
        medicareIrn: invoice.patient.irn
      },
      items: invoice.items.map(i => ({
        mbsItemNumber: i.itemNumber,
        dateOfService: i.dateOfService,              // YYYY-MM-DD
        chargeAmount: (i.feeCents / 100).toFixed(2)
      })),
      reference: invoice.reference                   // e.g. consult ref_code
    };

    const res = await fetch(`${this._base()}/api/v2/transactions`, {
      method: 'POST', headers: this._headers(), body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || `Tyro claim failed (${res.status})`);

    console.log(`[CLAIM:TYRO] Submitted ${invoice.claimType} → ${data.id || data.transactionId}`);
    return {
      claimId: data.id || data.transactionId,
      status: data.status || 'submitted',
      provider: 'tyro'
    };
  },

  async getStatus(claimId) {
    const res = await fetch(`${this._base()}/api/v2/transactions/${claimId}`, {
      headers: this._headers()
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || `Tyro status failed (${res.status})`);
    return { claimId, status: data.status, provider: 'tyro' };
  }
};

const impl = provider === 'tyro' ? tyroClaiming : mockClaiming;

module.exports = {
  submitClaim: (invoice) => impl.submitClaim(invoice),
  getStatus: (claimId) => impl.getStatus(claimId),
  providerName: provider
};
