// Port of recovered base44/functions/markLeagueMemberPaid/entry.ts
const { httpError } = require('./errors');
const { emailLayout, escapeHtml } = require('./helpers/emailLayout');
const { sendEmail } = require('./helpers/email');
const { sendOneSignalPush } = require('./helpers/onesignal');
const { getAppBaseUrl } = require('./helpers/appUrl');

function orgIdOf(user) {
  return user.data?.organization_id || user.organization_id || '';
}

async function handler(ctx, body) {
  const user = await ctx.auth.me();
  if (!user) throw httpError(401, 'Unauthorized');
  if (user.role !== 'admin' && user.role !== 'organizer_admin') {
    throw httpError(403, 'Forbidden');
  }

  const member_id = body?.member_id;
  if (!member_id) throw httpError(400, 'member_id required');

  const service = ctx.asServiceRole.entities;
  const members = await service.LeagueMember.filter({ id: member_id });
  const member = members[0];
  if (!member) throw httpError(404, 'Member not found');

  if (
    user.role === 'organizer_admin' &&
    member.organization_id &&
    member.organization_id !== orgIdOf(user)
  ) {
    throw httpError(403, 'Forbidden');
  }

  if (member.payment_status === 'paid') {
    throw httpError(400, 'Member is already paid');
  }

  await service.LeagueMember.update(member_id, {
    payment_status: 'paid',
    active: true,
    paid_at: new Date().toISOString(),
    payment_failed_at: null,
  });

  const leagueRows = await service.League.filter({ id: member.league_id });
  const league = leagueRows[0];
  if (league && member.player_email) {
    const subject = league.join_email_subject || `Welcome to ${league.name}!`;
    let emailBody =
      league.join_email_body ||
      emailLayout({
        eyebrow: 'Payment Confirmed',
        title: escapeHtml(league.name),
        subtitle: 'Your membership is now active!',
        greeting: `Hi ${escapeHtml(member.player_name || 'there')},`,
        paragraphs: [
          `Your membership payment has been received and you've been added to <strong>${escapeHtml(
            league.name,
          )}</strong>. You'll receive an email before each session with your RSVP link.`,
        ],
        footerNote: 'Questions? Reply to this email to reach the organizer.',
      });
    emailBody = emailBody
      .replace(/{{player_name}}/g, member.player_name)
      .replace(/{{league_name}}/g, league.name);

    try {
      await sendEmail(
        member.player_email,
        subject
          .replace(/{{league_name}}/g, league.name)
          .replace(/{{player_name}}/g, member.player_name),
        emailBody,
      );
    } catch (e) {
      console.error('markLeagueMemberPaid email failed:', e?.message || e);
    }

    if (member.player_id) {
      try {
        const appUrl = getAppBaseUrl();
        await sendOneSignalPush({
          external_user_ids: [member.player_id],
          title: 'Payment Confirmed! 🎉',
          message: `You're now a member of ${league.name}. You'll receive session invites before each play date.`,
          url: `${appUrl}/app/leagues`,
          data: { type: 'league_membership_confirmed', league_id: member.league_id },
        });
      } catch (e) {
        console.error('markLeagueMemberPaid push failed:', e?.message || e);
      }
    }
  }

  return { success: true, member_id };
}

module.exports = { public: false, handler };
