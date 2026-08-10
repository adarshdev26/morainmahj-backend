const { getAppBaseUrl } = require('./appUrl');

/**
 * OneSignal push (same shape as recovered functions).
 * No-ops when credentials are missing.
 */
async function sendPush({ external_user_ids, title, message, url }) {
  const appId = process.env.ONESIGNAL_APP_ID;
  const restKey = process.env.ONESIGNAL_REST_API_KEY;
  if (!appId || !restKey || !external_user_ids?.length) return { skipped: true };

  const res = await fetch('https://onesignal.com/api/v1/notifications', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Key ${restKey}`,
    },
    body: JSON.stringify({
      app_id: appId,
      include_aliases: { external_id: external_user_ids },
      target_channel: 'push',
      headings: { en: title },
      contents: { en: message },
      ...(url ? { url } : {}),
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    console.warn('[push] OneSignal error:', text);
    return { ok: false, error: text };
  }
  return { ok: true, ...(await res.json()) };
}

function defaultMyTournamentsUrl() {
  return `${getAppBaseUrl()}/app/my-tournaments`;
}

module.exports = { sendPush, defaultMyTournamentsUrl };
