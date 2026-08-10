// Port of recovered base44/functions/sendPushNotification/entry.ts
const { httpError } = require('./errors');
const { sendOneSignalPush } = require('./helpers/onesignal');

async function handler(ctx, body) {
  const user = await ctx.auth.me();
  if (user?.role !== 'admin') throw httpError(403, 'Admin only');

  const { external_user_ids, title, message, url } = body || {};
  if (!external_user_ids?.length || !title || !message) {
    throw httpError(400, 'external_user_ids, title, and message are required');
  }

  if (!process.env.ONESIGNAL_APP_ID || !process.env.ONESIGNAL_REST_API_KEY) {
    return { success: false, error: 'OneSignal credentials not configured' };
  }

  const result = await sendOneSignalPush({
    external_user_ids,
    title,
    message,
    url,
  });

  if (!result.ok) {
    return { success: false, error: result.error || result.response };
  }
  return { success: true, data: result.response };
}

module.exports = { public: false, handler };
