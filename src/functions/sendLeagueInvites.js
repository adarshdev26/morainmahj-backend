// Port of recovered base44/functions/sendLeagueInvites/entry.ts
const { httpError } = require('./errors');
const { sendEmail } = require('./helpers/email');
const { sendPush } = require('./helpers/push');
const { getAppBaseUrl } = require('./helpers/appUrl');

async function handler(ctx, body) {
  const user = await ctx.auth.me();
  if (user?.role !== 'admin') throw httpError(403, 'Admin only');

  const { sessionId } = body || {};
  if (!sessionId) throw httpError(400, 'sessionId required');

  const service = ctx.asServiceRole.entities;
  const session = (await service.LeagueSession.filter({ id: sessionId }))[0];
  if (!session) throw httpError(404, 'Session not found');

  const league = (await service.League.filter({ id: session.league_id }))[0];
  if (!league) throw httpError(404, 'League not found');

  const members = await service.LeagueMember.filter({
    league_id: session.league_id,
    active: true,
  });

  if (members.length === 0) {
    return { sent: 0, message: 'No active members to invite' };
  }

  const appUrl = getAppBaseUrl();
  const dateStr = new Date(`${session.date}T12:00:00`).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
  const timeStr = session.start_time
    ? `${session.start_time}${session.end_time ? '–' + session.end_time : ''}`
    : '';

  let sent = 0;
  for (const member of members) {
    const rsvpUrl = `${appUrl}/league-rsvp?session=${sessionId}&email=${encodeURIComponent(member.player_email)}&name=${encodeURIComponent(member.player_name)}`;

    const defaultBody = `
<div style="font-family: Georgia, serif; max-width: 520px; margin: 0 auto; padding: 32px 24px; background: #faf9f7;">
  <h1 style="font-size: 26px; font-weight: bold; color: #1e293b; margin-bottom: 4px;">${league.name}</h1>
  <p style="color: #64748b; font-size: 14px; margin-top: 0;">You're invited to the next session!</p>
  <div style="background: #fff; border-radius: 12px; padding: 20px; margin: 20px 0; border: 1px solid #e2e8f0;">
    <p style="margin: 0 0 8px; font-size: 15px;"><strong>Date:</strong> ${dateStr}</p>
    ${timeStr ? `<p style="margin: 0 0 8px; font-size: 15px;"><strong>Time:</strong> ${timeStr}</p>` : ''}
    ${session.location || league.location ? `<p style="margin: 0; font-size: 15px;"><strong>Location:</strong> ${session.location || league.location}</p>` : ''}
  </div>
  <p style="font-size: 15px; color: #334155;">Hi ${member.player_name}, please let us know if you'll be joining!</p>
  <a href="${rsvpUrl}" style="display: inline-block; background: #1e293b; color: #fff; text-decoration: none; padding: 14px 28px; border-radius: 8px; font-size: 15px; font-weight: bold; margin: 16px 0;">RSVP Now →</a>
  <p style="font-size: 12px; color: #94a3b8; margin-top: 24px;">You're receiving this because you're a member of ${league.name}.</p>
</div>`.trim();

    const vars = {
      '{{player_name}}': member.player_name,
      '{{league_name}}': league.name,
      '{{date}}': dateStr,
      '{{time}}': timeStr,
      '{{location}}': session.location || league.location || '',
      '{{rsvp_url}}': rsvpUrl,
    };
    const applyVars = (str) =>
      Object.entries(vars).reduce((s, [k, v]) => s.split(k).join(v), str);

    const emailBody = league.invite_email_body ? applyVars(league.invite_email_body) : defaultBody;
    const subject = league.invite_email_subject
      ? applyVars(league.invite_email_subject)
      : `RSVP: ${league.name} — ${dateStr}`;

    try {
      await sendEmail(member.player_email, subject, emailBody);
      sent++;
    } catch (err) {
      console.warn('[sendLeagueInvites] email failed for', member.player_email, err.message);
    }
  }

  const memberEmails = members.map((m) => m.player_email).filter(Boolean);
  if (memberEmails.length > 0) {
    try {
      await sendPush({
        external_user_ids: memberEmails,
        title: `${league.name} — Session Invite`,
        message: `You're invited to the ${dateStr} session. Tap to RSVP!`,
        url: `${appUrl}/league-rsvp?session=${sessionId}`,
      });
    } catch (err) {
      console.warn('[sendLeagueInvites] push failed:', err.message);
    }
  }

  await service.LeagueSession.update(sessionId, {
    invite_sent: true,
    invite_sent_at: new Date().toISOString(),
  });

  return { sent, message: `Invites sent to ${sent} members` };
}

module.exports = { public: false, handler };
