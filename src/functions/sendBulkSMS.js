// Port of recovered base44/functions/sendBulkSMS/entry.ts
const { httpError } = require('./errors');
const { getTwilioConfig, sendSms } = require('./helpers/sms');

async function handler(ctx, body) {
  const user = await ctx.auth.me();
  if (user?.role !== 'admin') throw httpError(403, 'Forbidden: Admin access required');

  const { tournament_id, recipient_player_ids, message } = body || {};
  if (!tournament_id || !message || !recipient_player_ids || recipient_player_ids.length === 0) {
    throw httpError(400, 'Missing required fields');
  }

  // Original used scoped entities.Registration (RLS-aware).
  const registrations = await ctx.entities.Registration.filter({
    tournament_id,
    opt_in_text_messaging: true,
  });

  const recipientsToNotify = registrations.filter(
    (reg) => recipient_player_ids.includes(reg.player_id) && reg.player_phone,
  );

  if (recipientsToNotify.length === 0) {
    return { message: 'No recipients with SMS opt-in found', sent: 0 };
  }

  if (!getTwilioConfig()) {
    throw httpError(500, 'Twilio credentials not configured');
  }

  let successCount = 0;
  const failedNumbers = [];

  for (const reg of recipientsToNotify) {
    const result = await sendSms({ to: reg.player_phone, body: message });
    if (result.ok) successCount++;
    else failedNumbers.push(reg.player_phone);
  }

  return {
    message: 'SMS campaign completed',
    sent: successCount,
    failed: failedNumbers.length,
    failedNumbers: failedNumbers.length > 0 ? failedNumbers : undefined,
  };
}

module.exports = { public: false, handler };
