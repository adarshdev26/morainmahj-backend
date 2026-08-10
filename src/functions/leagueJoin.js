// Port of recovered base44/functions/leagueJoin/entry.ts
const { httpError } = require('./errors');
const { sendEmail } = require('./helpers/email');

async function handler(ctx, body) {
  const user = await ctx.auth.me();
  if (!user) throw httpError(401, 'Unauthorized');

  const { leagueId, playerName, playerEmail, playerPhone } = body || {};

  if (user.email.toLowerCase() !== String(playerEmail || '').toLowerCase() && user.role !== 'admin') {
    throw httpError(403, 'Forbidden: You can only join as yourself');
  }

  if (!leagueId || !playerName || !playerEmail) {
    throw httpError(400, 'leagueId, playerName, and playerEmail are required');
  }

  const service = ctx.asServiceRole.entities;
  const leagues = await service.League.list();
  const league = leagues.find((l) => l.id === leagueId);
  if (!league) throw httpError(404, 'League not found');
  if (league.status !== 'active') {
    throw httpError(400, 'This league is not currently accepting new members');
  }
  if (league.invite_only && user.role !== 'admin') {
    throw httpError(403, 'This league is invite-only. Please contact the organizer to request membership.');
  }

  const allMembers = await service.LeagueMember.filter({ league_id: leagueId });
  const existing = allMembers.find(
    (m) => m.player_email.toLowerCase() === playerEmail.toLowerCase(),
  );
  if (existing) {
    return { alreadyMember: true, message: 'You are already a member of this league!' };
  }

  const activeMembers = allMembers.filter((m) => m.active !== false);
  if (league.member_cap && activeMembers.length >= league.member_cap) {
    return { full: true, message: 'This league is currently full. Please contact the organizer.' };
  }

  const requiresPayment = league.payment_model === 'paid' && league.membership_fee > 0;

  const member = await service.LeagueMember.create({
    league_id: leagueId,
    player_id: user.id,
    player_name: playerName,
    player_email: playerEmail,
    player_phone: playerPhone || '',
    active: !requiresPayment,
    is_regular: false,
    payment_status: requiresPayment ? 'pending' : 'not_required',
    payment_amount: requiresPayment ? league.membership_fee : null,
  });

  if (requiresPayment) {
    return {
      requiresPayment: true,
      memberId: member.id,
      leagueId,
      message: 'Payment required to complete membership.',
    };
  }

  const subject = league.join_email_subject || `Welcome to ${league.name}!`;
  let emailBody =
    league.join_email_body ||
    `
<div style="font-family: Georgia, serif; max-width: 520px; margin: 0 auto; padding: 32px 24px; background: #faf9f7;">
  <h1 style="font-size: 26px; font-weight: bold; color: #1e293b; margin-bottom: 4px;">${league.name}</h1>
  <p style="color: #64748b; font-size: 14px; margin-top: 0;">Welcome to the league!</p>
  <p style="font-size: 15px; color: #334155;">Hi {{player_name}}, you've been added to <strong>{{league_name}}</strong>. You'll receive an email before each session with your RSVP link.</p>
  <p style="font-size: 12px; color: #94a3b8; margin-top: 24px;">Questions? Reply to this email to reach the organizer.</p>
</div>
    `.trim();

  emailBody = emailBody
    .replace(/{{player_name}}/g, playerName)
    .replace(/{{league_name}}/g, league.name);

  try {
    await sendEmail(
      playerEmail,
      subject.replace(/{{league_name}}/g, league.name).replace(/{{player_name}}/g, playerName),
      emailBody,
    );
  } catch (err) {
    console.warn('[leagueJoin] welcome email failed:', err.message);
  }

  return { success: true, message: `Welcome to ${league.name}! Check your email for confirmation.` };
}

module.exports = { public: false, handler };
