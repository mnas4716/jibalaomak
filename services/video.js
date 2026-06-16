/**
 * Video Service — Jitsi (default, free) or Daily.co
 * 
 * Jitsi: generates public room URLs. No API key needed. Works instantly.
 * Daily.co: set VIDEO_PROVIDER=daily + DAILY_API_KEY to activate.
 * Manual: returns a placeholder if you want to paste MS Teams / Zoom links.
 */
require('dotenv').config();
const { v4: uuid } = require('uuid');

const provider = process.env.VIDEO_PROVIDER || 'jitsi';

// ── Jitsi (free, no auth) ──
const jitsiVideo = {
  async createRoom(consultId, options = {}) {
    const domain = process.env.JITSI_DOMAIN || 'meet.jit.si';
    const roomName = `curbside-${consultId}-${uuid().slice(0, 6)}`;
    const url = `https://${domain}/${roomName}`;

    console.log(`[VIDEO:JITSI] Room created → ${url}`);
    return {
      url,
      room_id: roomName,
      provider: 'jitsi',
      expires: null // Jitsi rooms are ephemeral
    };
  }
};

// ── Daily.co ──
const dailyVideo = {
  async createRoom(consultId, options = {}) {
    const res = await fetch('https://api.daily.co/v1/rooms', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.DAILY_API_KEY}`
      },
      body: JSON.stringify({
        name: `curbside-${consultId}-${uuid().slice(0, 6)}`,
        properties: {
          enable_chat: true,
          enable_screenshare: true,
          max_participants: 4,
          exp: Math.floor(Date.now() / 1000) + 3600, // 1 hour
          ...options
        }
      })
    });

    const room = await res.json();
    const domain = process.env.DAILY_DOMAIN || `https://${room.name}.daily.co`;
    const url = room.url || `${domain}/${room.name}`;

    console.log(`[VIDEO:DAILY] Room created → ${url}`);
    return {
      url,
      room_id: room.name,
      provider: 'daily',
      expires: room.config?.exp || null
    };
  }
};

// ── Manual link mode (for Teams / Zoom paste-in) ──
const manualVideo = {
  async createRoom(consultId, options = {}) {
    const placeholder = options.manual_url || null;
    console.log(`[VIDEO:MANUAL] Awaiting manual link for consult ${consultId}`);
    return {
      url: placeholder,
      room_id: `manual-${consultId}`,
      provider: 'manual',
      expires: null
    };
  }
};

// ── Provider selector ──
function getProvider() {
  switch (provider) {
    case 'daily': return dailyVideo;
    case 'manual': return manualVideo;
    default: return jitsiVideo;
  }
}

/**
 * Create a video room for a consult
 * Returns { url, room_id, provider, expires }
 */
async function createVideoRoom(consultId, options = {}) {
  return getProvider().createRoom(consultId, options);
}

module.exports = { createVideoRoom };
