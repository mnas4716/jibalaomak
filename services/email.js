/**
 * Email Service — mock or SMTP (nodemailer)
 * 
 * Set EMAIL_PROVIDER=smtp + SMTP env vars to activate real email.
 * Default: logs to console.
 * 
 * To activate real email, also run: npm install nodemailer
 */
require('dotenv').config();

const provider = process.env.EMAIL_PROVIDER || 'mock';

// ── Mock provider ──
const mockEmail = {
  async send({ to, subject, body, html }) {
    console.log(`[EMAIL:MOCK] → ${to}`);
    console.log(`  Subject: ${subject}`);
    console.log(`  Body: ${(body || '').slice(0, 100)}...`);
    return { id: `MOCK_EMAIL_${Date.now()}`, status: 'sent', provider: 'mock' };
  }
};

// ── SMTP provider (nodemailer) ──
const smtpEmail = {
  _transporter: null,

  _getTransporter() {
    if (!this._transporter) {
      const nodemailer = require('nodemailer');
      this._transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT || '587'),
        secure: process.env.SMTP_PORT === '465',
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS
        }
      });
    }
    return this._transporter;
  },

  async send({ to, subject, body, html }) {
    const transporter = this._getTransporter();
    const info = await transporter.sendMail({
      from: process.env.EMAIL_FROM || 'noreply@curbside.au',
      to,
      subject,
      text: body,
      html: html || undefined
    });
    console.log(`[EMAIL:SMTP] → ${to} (ID: ${info.messageId})`);
    return { id: info.messageId, status: 'sent', provider: 'smtp' };
  }
};

// ── Export active provider ──
const email = provider === 'smtp' ? smtpEmail : mockEmail;

/**
 * Send a document to a recipient
 */
async function sendDocument({ to, subject, documentContent, consultRef }) {
  return email.send({
    to,
    subject: subject || `Curbside Document — ${consultRef || 'Consultation'}`,
    body: documentContent,
    html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;">
      <div style="border-bottom:2px solid #10b981;padding-bottom:12px;margin-bottom:20px;">
        <strong style="color:#10b981;font-size:18px;">CURBSIDE</strong>
        <span style="color:#64748b;font-size:12px;margin-left:8px;">Clinical Document</span>
      </div>
      <pre style="white-space:pre-wrap;font-size:14px;line-height:1.6;">${documentContent}</pre>
      <div style="border-top:1px solid #e2e8f0;margin-top:20px;padding-top:12px;color:#94a3b8;font-size:11px;">
        Sent via Curbside GP-Specialist Consultation Platform
      </div>
    </div>`
  });
}

/**
 * Send a notification email
 */
async function sendNotification({ to, subject, message }) {
  return email.send({ to, subject, body: message });
}

module.exports = { sendDocument, sendNotification };
