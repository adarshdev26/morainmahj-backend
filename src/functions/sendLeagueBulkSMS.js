// Port of recovered base44/functions/sendLeagueBulkSMS/entry.ts
const { httpError } = require('./errors');
const { getTwilioConfig, sendSms } = require('./helpers/sms');

async function handler(ctx, body) {
  const user = await ctx.auth.me();
  if (!user || user.role !== 'admin') throw httpError(401, 'Unauthorized');

  const { league_id, recipient_emails, message } = body || {};
  if (!league_id || !message || !recipient_emails || recipient_emails.length === 0) {
    throw httpError(400, 'Missing required fields');
  }

  const service = ctx.asServiceRole.entities;
  const members = await service.LeagueMember.filter({ league_id });
  const recipients = members.filter(
    (m) => m.player_phone && recipient_emails.includes(m.player_email),
  );

  if (recipients.length === 0) {
    return { message: 'No recipients with phone numbers found', sent: 0 };
  }

  if (!getTwilioConfig()) {
    throw httpError(500, 'Twilio credentials not configured');
  }

  let successCount = 0;
  const failedNumbers = [];

  for (const member of recipients) {
    try {
      const result = await sendSms({ to: member.player_phone, body: message });
      if (result.ok) successCount++;
      else failedNumbers.push(member.player_phone);
    } catch {
      failedNumbers.push(member.player_phone);
    }
  }

  return {
    message: 'SMS campaign completed',
    sent: successCount,
    failed: failedNumbers.length,
    failedNumbers: failedNumbers.length > 0 ? failedNumbers : undefined,
  };
}

module.exports = { public: false, handler };
