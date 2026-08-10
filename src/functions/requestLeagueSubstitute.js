// Port of recovered base44/functions/requestLeagueSubstitute/entry.ts
const { httpError } = require('./errors');
const { emailLayout, escapeHtml } = require('./helpers/emailLayout');
const { sendEmail } = require('./helpers/email');
const { getAppBaseUrl } = require('./helpers/appUrl');

async function handler(ctx, body) {
  const user = await ctx.auth.me();
  if (!user) throw httpError(401, 'Unauthorized');

  const sessionId = body?.session_id;
  const leagueId = body?.league_id;
  if (!sessionId || !leagueId) {
    throw httpError(400, 'session_id and league_id are required');
  }

  const service = ctx.asServiceRole.entities;
  const now = new Date().toISOString();
  const existing = await service.LeagueRSVP.filter({
    session_id: sessionId,
    player_email: user.email,
  });

  const updateFields = {
    status: 'no',
    volunteering_set: false,
    sub_requested: true,
    sub_requested_at: now,
    responded_at: now,
  };

  let rsvp;
  if (existing.length > 0) {
    rsvp = await service.LeagueRSVP.update(existing[0].id, updateFields);
  } else {
    rsvp = await service.LeagueRSVP.create({
      session_id: sessionId,
      league_id: leagueId,
      player_email: user.email,
      player_name: user.full_name,
      player_id: user.id,
      ...updateFields,
    });
  }

  const league = (await service.League.filter({ id: leagueId }))[0];
  const session = (await service.LeagueSession.filter({ id: sessionId }))[0];
  const leagueName = league?.name || 'your league';
  const dateStr = session?.date
    ? new Date(session.date + 'T12:00:00').toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
      })
    : 'the next session';
  const timeStr = session?.start_time || league?.start_time || '';
  const locStr = session?.location || league?.location || '';
  const player = user.full_name || 'A player';
  const appUrl = getAppBaseUrl();

  const admins = await service.User.list();
  const adminEmails = admins.filter((a) => a.role === 'admin' && a.email).map((a) => a.email);
  const adminSubject = `Substitute needed — ${leagueName}`;
  const adminBody = emailLayout({
    eyebrow: 'Action Needed',
    title: 'Substitute Needed',
    subtitle: escapeHtml(leagueName),
    greeting: 'Hi Organizer,',
    paragraphs: [
      `${escapeHtml(player)} can't make <strong>${escapeHtml(leagueName)}</strong> on <strong>${escapeHtml(dateStr)}</strong>${
        timeStr ? ` at ${escapeHtml(timeStr)}` : ''
      } and has requested a substitute.`,
      'Open the Morain Mahj admin dashboard to assign a substitute from the roster.',
    ],
    cta: { label: 'Open Admin Dashboard', url: `${appUrl}/admin/leagues` },
    footerNote: `You are receiving this because you are an admin for ${escapeHtml(leagueName)}.`,
  });
  await Promise.all(
    adminEmails.map(async (email) => {
      try {
        await sendEmail(email, adminSubject, adminBody);
      } catch {
        /* swallow */
      }
    }),
  );

  const subs = await service.LeagueMember.filter({
    league_id: leagueId,
    is_substitute: true,
    active: true,
  });
  const subSubject = `Substitute opportunity — ${leagueName}`;
  const subBody = emailLayout({
    eyebrow: 'Substitute Opportunity',
    title: 'A Seat Is Open',
    subtitle: escapeHtml(leagueName),
    greeting: 'Hi there,',
    paragraphs: [
      `A seat is open for <strong>${escapeHtml(leagueName)}</strong> on <strong>${escapeHtml(dateStr)}</strong>${
        timeStr ? ` at ${escapeHtml(timeStr)}` : ''
      }${locStr ? ` at ${escapeHtml(locStr)}` : ''}.`,
      'If you are available to sub, please reach out to the organizer or RSVP in the Morain Mahj app.',
    ],
    cta: { label: 'Open the App', url: `${appUrl}/app/leagues` },
    footerNote: `You are receiving this because you are listed as a substitute for ${escapeHtml(leagueName)}.`,
  });
  await Promise.all(
    subs
      .filter((s) => s.player_email)
      .map(async (m) => {
        try {
          await sendEmail(m.player_email, subSubject, subBody);
        } catch {
          /* swallow */
        }
      }),
  );

  return { success: true, rsvp };
}

module.exports = { public: false, handler };
