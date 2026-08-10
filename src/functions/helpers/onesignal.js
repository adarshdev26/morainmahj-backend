/**
 * OneSignal helpers ported from recovered notify/confirm push logic.
 * No-ops gracefully when credentials are missing.
 */

async function fetchOneSignalUserByExternalId(externalId) {
  const appId = process.env.ONESIGNAL_APP_ID;
  const apiKey = process.env.ONESIGNAL_REST_API_KEY;
  if (!appId || !apiKey || !externalId) return { onesignalId: null, pushSubscriptionIds: [] };

  try {
    const res = await fetch(
      `https://onesignal.com/api/v1/apps/${appId}/users/by/external_id/${encodeURIComponent(externalId)}`,
      { headers: { Authorization: `Key ${apiKey}` } },
    );
    if (!res.ok) return { onesignalId: null, pushSubscriptionIds: [] };
    const data = await res.json();
    const subs = data?.subscriptions ?? [];
    const pushSubs = subs.filter((s) => {
      const type = String(s.type || '').toLowerCase();
      if (type === 'email' || type === 'sms') return false;
      if (s.enabled === false) return false;
      return (
        type.includes('push') ||
        type === 'fcm' ||
        type === 'gcm' ||
        type === 'webpush' ||
        type === 'iospush' ||
        type === 'androidpush' ||
        Boolean(s.token)
      );
    });
    const onesignalId = data?.identity?.onesignal_id ?? null;
    const pushSubscriptionIds = pushSubs.map((s) => s.id).filter(Boolean);
    return { onesignalId, pushSubscriptionIds };
  } catch {
    return { onesignalId: null, pushSubscriptionIds: [] };
  }
}

async function sendOneSignalPush({
  external_user_ids,
  onesignal_ids,
  subscription_ids,
  title,
  message,
  url,
  data,
}) {
  const appId = process.env.ONESIGNAL_APP_ID;
  const apiKey = process.env.ONESIGNAL_REST_API_KEY;
  if (!appId || !apiKey) return { ok: false, error: 'OneSignal credentials not configured' };

  const aliases = [
    ...new Set((external_user_ids || []).map((id) => String(id).trim()).filter(Boolean)),
  ];
  const subIds = [
    ...new Set((subscription_ids || []).map((id) => String(id).trim()).filter(Boolean)),
  ];
  const osIds = [
    ...new Set((onesignal_ids || []).map((id) => String(id).trim()).filter(Boolean)),
  ];

  if (!aliases.length && !subIds.length && !osIds.length) {
    return { ok: false, error: 'No targeting ids provided' };
  }

  const payload = {
    app_id: appId,
    headings: { en: title },
    contents: { en: message },
  };

  if (subIds.length) {
    payload.include_subscription_ids = subIds;
  } else if (aliases.length) {
    payload.include_aliases = { external_id: aliases };
    payload.target_channel = 'push';
  } else {
    payload.include_aliases = { onesignal_id: osIds };
    payload.target_channel = 'push';
  }

  if (data) {
    const normalized = {};
    for (const [k, v] of Object.entries(data)) {
      if (v != null && v !== '') normalized[k] = String(v);
    }
    if (Object.keys(normalized).length) payload.data = normalized;
  }
  if (url) payload.url = url;

  try {
    const res = await fetch('https://onesignal.com/api/v1/notifications', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Key ${apiKey}`,
      },
      body: JSON.stringify(payload),
    });
    const json = await res.json().catch(() => null);
    const errors = Array.isArray(json?.errors) ? json.errors : [];
    const ok = res.ok && !errors.length && json?.id && json?.recipients !== 0;
    return {
      ok,
      status: res.status,
      response: json,
      error: errors[0] || (!ok ? 'push_failed' : undefined),
    };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function sendOneSignalPushWithFallback(opts) {
  const aliases = [
    ...new Set((opts.external_user_ids || []).map((id) => String(id).trim()).filter(Boolean)),
  ];
  const userIdAliases = aliases.filter((id) => !id.includes('@'));
  const emailAliases = aliases.filter((id) => id.includes('@'));
  const subIds = [
    ...new Set((opts.subscription_ids || []).map((id) => String(id).trim()).filter(Boolean)),
  ];
  const osIds = [
    ...new Set((opts.onesignal_ids || []).map((id) => String(id).trim()).filter(Boolean)),
  ];

  for (const ids of [userIdAliases, emailAliases]) {
    if (!ids.length) continue;
    let result = await sendOneSignalPush({ ...opts, external_user_ids: ids, subscription_ids: [], onesignal_ids: [] });
    if (result.ok) return result;
    result = await sendOneSignalPush({
      ...opts,
      external_user_ids: ids,
      subscription_ids: [],
      onesignal_ids: [],
    });
    if (result.ok) return result;
  }

  if (subIds.length) {
    let result = await sendOneSignalPush({
      ...opts,
      subscription_ids: subIds,
      external_user_ids: [],
      onesignal_ids: [],
    });
    if (result.ok) return result;
  }

  if (osIds.length) {
    const result = await sendOneSignalPush({
      ...opts,
      onesignal_ids: osIds,
      external_user_ids: [],
      subscription_ids: [],
    });
    if (result.ok) return result;
  }

  return { ok: false, error: 'All targeting methods failed' };
}

module.exports = {
  fetchOneSignalUserByExternalId,
  sendOneSignalPush,
  sendOneSignalPushWithFallback,
};
