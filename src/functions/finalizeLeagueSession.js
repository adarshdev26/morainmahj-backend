// Port of recovered base44/functions/finalizeLeagueSession/entry.ts
const { httpError } = require('./errors');
const { emailLayout, escapeHtml } = require('./helpers/emailLayout');
const { sendEmail } = require('./helpers/email');
const { sendOneSignalPush } = require('./helpers/onesignal');
const { getAppBaseUrl } = require('./helpers/appUrl');

const SEATS = ['east', 'south', 'west', 'north'];

function orgIdOf(user) {
  return user.data?.organization_id || user.organization_id || '';
}

async function handler(ctx, body) {
  const user = await ctx.auth.me();
  if (!user) throw httpError(401, 'Unauthorized');
  const isAdmin = user.role === 'admin';
  const isOrganizer = user.role === 'organizer_admin';
  if (!isAdmin && !isOrganizer) {
    throw httpError(403, 'Forbidden: Admin or organizer access required');
  }

  const sessionId = body?.sessionId;
  if (!sessionId) throw httpError(400, 'sessionId required');

  const service = ctx.asServiceRole.entities;
  const sessions = await service.LeagueSession.filter({ id: sessionId });
  const session = sessions[0];
  if (!session) throw httpError(404, 'Session not found');

  const leagues = await service.League.filter({ id: session.league_id });
  const league = leagues[0];
  if (!league) throw httpError(404, 'League not found');

  if (isOrganizer && league.organization_id && league.organization_id !== orgIdOf(user)) {
    throw httpError(403, 'Forbidden: league belongs to another organization');
  }

  if (session.status === 'completed') {
    throw httpError(400, 'Session is already finalized');
  }

  if (!session.assignments_generated) {
    throw httpError(
      400,
      'Cannot finalize: table assignments have not been generated yet. Generate assignments first, then finalize.',
    );
  }

  const now = new Date().toISOString();
  await service.LeagueSession.update(sessionId, {
    status: 'completed',
    finalized_at: now,
    finalized_by_id: user.id,
  });

  const scorecards = await service.LeagueScoreCard.filter({ session_id: sessionId });
  const winners = [];
  scorecards.forEach((sc) => {
    let bestSeat = null;
    let bestScore = -Infinity;
    SEATS.forEach((seat) => {
      const score = sc[`${seat}_score`];
      if (score != null && score > bestScore) {
        bestScore = score;
        bestSeat = seat;
      }
    });
    if (bestSeat != null) {
      winners.push({
        round: sc.round_number,
        table: sc.table_number,
        email: sc[`${bestSeat}_player_email`],
        name: sc[`${bestSeat}_player_name`],
        score: bestScore,
      });
    }
  });

  const rsvps = await service.LeagueRSVP.filter({ session_id: sessionId });
  const attending = rsvps.filter((r) => r.status === 'yes');
  const dateStr = new Date(session.date + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  const appUrl = getAppBaseUrl();
  await Promise.all(
    attending
      .filter((r) => r.player_email)
      .map(async (r) => {
        try {
          const html = emailLayout({
            eyebrow: 'Session Finalized',
            title: 'Scores Are Locked',
            subtitle: escapeHtml(league.name),
            greeting: `Hi <strong>${escapeHtml(r.player_name || 'there')}</strong>,`,
            paragraphs: [
              `The <strong>${escapeHtml(league.name)}</strong> session on <strong>${escapeHtml(
                dateStr,
              )}</strong> has been finalized.`,
              'Scores are locked and the leaderboard has been updated. Thanks for playing!',
            ],
            detailsTitle: 'Session',
            details: [
              { icon: '🏛', label: 'League', value: escapeHtml(league.name) },
              { icon: '📅', label: 'Date', value: escapeHtml(dateStr) },
            ],
            cta: { label: 'View Leaderboard', url: `${appUrl}/app/leagues` },
            footerNote: `— ${escapeHtml(league.name)} Organizers`,
          });
          await sendEmail(r.player_email, `${league.name} — Session finalized (${dateStr})`, html);
        } catch (emailErr) {
          console.error(
            `[finalizeLeagueSession] Failed to email ${r.player_email}:`,
            emailErr?.message || emailErr,
          );
        }
      }),
  );

  const checkedInPlayerIds = attending
    .filter((r) => r.checked_in && r.player_id)
    .map((r) => r.player_id);
  if (checkedInPlayerIds.length > 0) {
    await sendOneSignalPush({
      external_user_ids: checkedInPlayerIds,
      title: `${league.name} — Session Finalized ✅`,
      message: 'Scores are locked and the leaderboard is updated. Thanks for playing!',
      data: { type: 'league_session_finalized', league_id: league.id, session_id: sessionId },
    });
  }

  return {
    success: true,
    finalizedAt: now,
    scorecards: scorecards.length,
    winners,
    notifiedCount: attending.length,
  };
}

module.exports = { public: false, handler };
