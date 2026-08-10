/**
 * Twilio SMS helper. Returns structured failure when credentials are missing
 * so callers can distinguish config-blocked from send failures.
 */
function getTwilioConfig() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromPhone = process.env.TWILIO_PHONE_NUMBER;
  if (!accountSid || !authToken || !fromPhone) {
    return null;
  }
  return { accountSid, authToken, fromPhone };
}

async function sendSms({ to, body }) {
  const cfg = getTwilioConfig();
  if (!cfg) {
    const err = new Error('Twilio credentials not configured');
    err.status = 500;
    err.code = 'TWILIO_NOT_CONFIGURED';
    throw err;
  }

  const auth = Buffer.from(`${cfg.accountSid}:${cfg.authToken}`).toString('base64');
  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${cfg.accountSid}/Messages.json`,
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        From: cfg.fromPhone,
        To: to,
        Body: body,
      }).toString(),
    },
  );

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return { ok: false, error: text || `HTTP ${res.status}` };
  }
  return { ok: true };
}

module.exports = { getTwilioConfig, sendSms };
