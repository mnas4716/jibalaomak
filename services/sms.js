/**
 * SMS Service — mock or Twilio
 * 
 * Set SMS_PROVIDER=twilio + Twilio env vars to activate real SMS.
 * Default: logs to console (perfect for development).
 */
require('dotenv').config();

const provider = process.env.SMS_PROVIDER || 'mock';

// ── Mock provider ──
const mockSMS = {
  async send(to, body) {
    console.log(`[SMS:MOCK] → ${to}`);
    console.log(`  "${body.slice(0, 120)}${body.length > 120 ? '...' : ''}"`);
    return { sid: `MOCK_${Date.now()}`, status: 'sent', provider: 'mock' };
  }
};

// ── Twilio provider ──
const twilioSMS = {
  _client: null,

  _getClient() {
    if (!this._client) {
      const twilio = require('twilio');
      this._client = twilio(
        process.env.TWILIO_ACCOUNT_SID,
        process.env.TWILIO_AUTH_TOKEN
      );
    }
    return this._client;
  },

  async send(to, body) {
    const client = this._getClient();
    const message = await client.messages.create({
      body: body.slice(0, 320), // 2 SMS segments max
      from: process.env.TWILIO_FROM_NUMBER,
      to
    });
    console.log(`[SMS:TWILIO] → ${to} (SID: ${message.sid})`);
    return { sid: message.sid, status: message.status, provider: 'twilio' };
  }
};

// ── Exported interface ──
const sms = provider === 'twilio' ? twilioSMS : mockSMS;

/**
 * Send a consult notification SMS to a specialist
 */
async function sendConsultNotification(specialist, consult, acceptUrl) {
  const body =
    `Curbside: ${consult.specialty} consult from ` +
    `Dr ${consult.gp_name}. ` +
    `${consult.patient_initials}, ${consult.patient_age}${consult.patient_sex}. ` +
    `${consult.case_summary.slice(0, 80)}... ` +
    `Tap to accept: ${acceptUrl}`;

  return sms.send(specialist.phone, body);
}

/**
 * Send a generic SMS
 */
async function sendSMS(to, body) {
  return sms.send(to, body);
}

module.exports = { sendConsultNotification, sendSMS };
