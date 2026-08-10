// Port of recovered base44/functions/syncOneSignalIdentity/entry.ts
const { httpError } = require('./errors');

function pushSubscriptionType(platform) {
  const normalized = String(platform || '')
    .trim()
    .toLowerCase();
  if (normalized === 'ios') return 'iOSPush';
  if (normalized === 'android') return 'AndroidPush';
  if (normalized === 'web') return 'ChromePush';
  return null;
}

async function upsertOneSignalUser({
  externalId,
  email,
  pushToken,
  pushSubscriptionId,
  platform,
}) {
  const appId = process.env.ONESIGNAL_APP_ID;
  const restKey = process.env.ONESIGNAL_REST_API_KEY;
  if (!appId || !restKey) {
    return { ok: false, reason: 'not_configured' };
  }

  const subscriptions = [];

  if (email) {
    subscriptions.push({
      type: 'Email',
      token: String(email).trim().toLowerCase(),
      enabled: true,
    });
  }

  const pushType = pushSubscriptionType(platform);
  const token = String(pushToken || '').trim();
  if (pushType && token) {
    const pushSub = {
      type: pushType,
      token,
      enabled: true,
      notification_types: 1,
    };
    if (pushSubscriptionId) {
      pushSub.id = String(pushSubscriptionId).trim();
    }
    subscriptions.push(pushSub);
  }

  const body = {
    identity: { external_id: String(externalId).trim() },
  };
  if (subscriptions.length > 0) body.subscriptions = subscriptions;

  const res = await fetch(`https://api.onesignal.com/apps/${appId}/users`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Key ${restKey}`,
    },
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error('OneSignal upsert user failed:', { status: res.status, data });
    return { ok: false, reason: 'api_error', data };
  }

  return { ok: true, data };
}

async function handler(ctx, body) {
  const user = await ctx.auth.me();
  if (!user) throw httpError(401, 'Unauthorized');

  const payload = body || {};
  const externalId = String(user.id || payload.externalId || '').trim();
  const email = String(user.email || payload.email || '')
    .trim()
    .toLowerCase();
  const pushToken = payload.pushToken ? String(payload.pushToken).trim() : null;
  const pushSubscriptionId = payload.pushSubscriptionId
    ? String(payload.pushSubscriptionId).trim()
    : null;
  const platform = payload.platform ? String(payload.platform).trim().toLowerCase() : null;

  if (!externalId) throw httpError(400, 'User id is required');

  const result = await upsertOneSignalUser({
    externalId,
    email: email || null,
    pushToken,
    pushSubscriptionId,
    platform,
  });

  return {
    success: result.ok,
    externalId,
    email: email || null,
    pushLinked: Boolean(pushToken && pushSubscriptionType(platform)),
    reason: result.ok ? 'upserted' : result.reason,
    data: result.data ?? null,
  };
}

module.exports = { public: false, handler };
