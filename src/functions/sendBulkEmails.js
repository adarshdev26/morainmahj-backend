// Port of recovered base44/functions/sendBulkEmails/entry.ts
const { httpError } = require('./errors');
const { sendEmail } = require('./helpers/email');

async function handler(ctx, body) {
  const user = await ctx.auth.me();
  if (!user || user.role !== 'admin') throw httpError(401, 'Unauthorized');

  const { template, tournament, recipientEmails, registrations, comm_log_id } = body || {};
  if (!template || !recipientEmails || recipientEmails.length === 0) {
    throw httpError(400, 'Missing template or recipients');
  }

  const regs = registrations || [];
  const replaceVariables = (text, playerEmail) => {
    const registration = regs.find((r) => r.player_email === playerEmail);
    if (!registration) return text;
    return text
      .replace(/{{player_name}}/g, registration.player_name || 'Valued Player')
      .replace(/{{tournament_name}}/g, tournament?.name || 'Tournament')
      .replace(/{{tournament_date}}/g, tournament?.date || '')
      .replace(/{{tournament_time}}/g, tournament?.time || '')
      .replace(/{{location}}/g, tournament?.location || '');
  };

  const service = ctx.asServiceRole.entities;
  const results = [];

  for (const email of recipientEmails) {
    const registration = regs.find((r) => r.player_email === email);
    const subject = replaceVariables(template.subject, email);
    const emailBody = replaceVariables(template.body, email);

    let deliveryRecord;
    try {
      deliveryRecord = await service.EmailDelivery.create({
        comm_log_id: comm_log_id || '',
        tournament_id: tournament?.id || '',
        player_name: registration?.player_name || '',
        to_email: email,
        subject,
        body: emailBody,
        status: 'sending',
      });
    } catch (e) {
      console.error(`Failed to create delivery record for ${email}:`, e.message);
    }

    try {
      await sendEmail(email, subject, emailBody);

      if (deliveryRecord?.id) {
        await service.EmailDelivery.update(deliveryRecord.id, {
          status: 'sent',
          sent_at: new Date().toISOString(),
        });
      }

      results.push({ email, success: true, sentAt: new Date().toISOString() });
    } catch (sendError) {
      console.error(`Failed to send email to ${email}:`, sendError.message);

      if (deliveryRecord?.id) {
        await service.EmailDelivery.update(deliveryRecord.id, {
          status: 'error',
          error_message: sendError.message,
          sent_at: new Date().toISOString(),
        });
      }

      results.push({ email, success: false, error: sendError.message });
    }
  }

  return {
    success: true,
    sentCount: results.filter((r) => r.success).length,
    errorCount: results.filter((r) => !r.success).length,
    results,
    message: `Sent ${results.filter((r) => r.success).length} of ${results.length} emails`,
  };
}

module.exports = { public: false, handler };
