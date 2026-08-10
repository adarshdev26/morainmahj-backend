// Port of recovered base44/functions/invitePlayer/entry.ts
// Contract: { tournament_id, emails: string[] } → { results: [{ email, status, registration_id? }] }
const { httpError } = require('./errors');
const { sendEmail } = require('./helpers/email');
const { getAppBaseUrl } = require('./helpers/appUrl');

function inviteEmailHtml({ tournament, tournament_id, email, status, signupUrl }) {
  const formattedDate = tournament.date
    ? new Date(`${tournament.date}T12:00:00`).toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : '';
  const ctaText = status === 'waitlisted' ? 'View Waitlist Status' : 'Confirm Your Attendance';
  const monogramSvg = `<svg width="64" height="64" viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="60" y="4" width="79" height="79" transform="rotate(45 60 4)" stroke="#c9a96e" stroke-width="1.5" fill="none"/>
        <rect x="60" y="16" width="62" height="62" transform="rotate(45 60 16)" stroke="#c9a96e" stroke-width="0.75" fill="none"/>
        <text x="50%" y="54%" dominant-baseline="middle" text-anchor="middle" font-family="Georgia,serif" font-weight="300" font-size="52" fill="#c9a96e">M</text>
      </svg>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>You're Invited — ${tournament.name}</title>
</head>
<body style="margin:0;padding:0;background-color:#1a2a42;font-family:Georgia,serif;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#1a2a42;min-height:100vh;">
    <tr><td align="center" style="padding:32px 16px 48px;">
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:430px;width:100%;border-radius:16px;overflow:hidden;box-shadow:0 24px 60px rgba(0,0,0,0.45);">
        <tr>
          <td align="center" style="background-color:#1e2d4a;padding:40px 32px 32px;">
            <div style="margin-bottom:16px;">${monogramSvg}</div>
            <div style="font-family:Georgia,'Times New Roman',serif;font-size:22px;font-weight:400;letter-spacing:6px;text-transform:uppercase;color:#f2ede6;margin-bottom:4px;">Morain Mahj</div>
            <div style="font-family:Arial,sans-serif;font-size:10px;font-weight:300;letter-spacing:4px;text-transform:uppercase;color:#c9a96e;opacity:0.8;">Legacy game for modern players</div>
            <div style="width:40px;height:1px;background-color:#c9a96e;margin:20px auto 0;opacity:0.6;"></div>
          </td>
        </tr>
        <tr><td style="background-color:#c9a96e;height:2px;"></td></tr>
        <tr>
          <td style="background-color:#f5f0e8;padding:32px 28px 28px;">
            <div style="font-family:Arial,sans-serif;font-size:10px;font-weight:600;letter-spacing:3px;text-transform:uppercase;color:#c9a96e;margin-bottom:20px;text-align:center;">You're Invited</div>
            ${
              status === 'waitlisted'
                ? `<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">
              <tr>
                <td style="background-color:#fef3c7;border-left:3px solid #c9a96e;padding:12px 16px;border-radius:0 6px 6px 0;">
                  <div style="font-family:Arial,sans-serif;font-size:12px;color:#92400e;line-height:1.5;"><strong>Waitlist:</strong> This tournament is at capacity. You've been added to the waitlist and will be notified if a spot opens.</div>
                </td>
              </tr>
            </table>`
                : ''
            }
            <p style="font-family:Arial,sans-serif;font-size:15px;color:#374151;line-height:1.7;margin:0 0 24px;">Hi there,</p>
            <p style="font-family:Arial,sans-serif;font-size:15px;color:#374151;line-height:1.7;margin:0 0 24px;">You've been personally invited to join us for a Mah Jongg tournament. We'd love to have you at the table!</p>
            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#ffffff;border-radius:10px;border:1px solid #e5ddd0;margin-bottom:28px;overflow:hidden;">
              <tr>
                <td width="4" style="background-color:#c9a96e;border-radius:10px 0 0 10px;">&nbsp;</td>
                <td style="padding:20px 20px 20px 16px;">
                  <div style="font-family:Arial,sans-serif;font-size:10px;font-weight:600;letter-spacing:2px;text-transform:uppercase;color:#c9a96e;margin-bottom:6px;">Tournament</div>
                  <div style="font-family:Georgia,'Times New Roman',serif;font-size:20px;font-weight:600;color:#1e2d4a;line-height:1.25;margin-bottom:14px;">${tournament.name}</div>
                  ${
                    formattedDate
                      ? `<div style="font-family:Arial,sans-serif;font-size:13px;color:#374151;line-height:1.4;margin-bottom:8px;">${formattedDate}</div>`
                      : ''
                  }
                  ${
                    tournament.location
                      ? `<div style="font-family:Arial,sans-serif;font-size:13px;color:#374151;line-height:1.4;">${tournament.location}</div>`
                      : ''
                  }
                </td>
              </tr>
            </table>
            <p style="font-family:Arial,sans-serif;font-size:14px;color:#6b7280;line-height:1.7;margin:0 0 28px;text-align:center;">
              ${
                status === 'waitlisted'
                  ? "Complete your profile to secure your waitlist spot. You'll be notified the moment a seat opens up."
                  : 'Complete your player profile and confirm your spot — it only takes a minute.'
              }
            </p>
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">
              <tr>
                <td align="center" style="background-color:#1e2d4a;border-radius:8px;padding:0;">
                  <a href="${signupUrl}" style="display:block;font-family:Arial,sans-serif;font-size:14px;font-weight:600;letter-spacing:2px;text-transform:uppercase;color:#f2ede6;text-decoration:none;padding:16px 24px;">${ctaText} →</a>
                </td>
              </tr>
            </table>
            <p style="font-family:Arial,sans-serif;font-size:11px;color:#9ca3af;line-height:1.6;margin:0;text-align:center;">
              Button not working? <a href="${signupUrl}" style="color:#c9a96e;text-decoration:underline;">Open link</a>
            </p>
          </td>
        </tr>
        <tr>
          <td style="background-color:#1e2d4a;padding:20px 28px;text-align:center;">
            <div style="font-family:Arial,sans-serif;font-size:10px;font-weight:600;letter-spacing:3px;text-transform:uppercase;color:#c9a96e;margin-bottom:6px;">Morain Mahj</div>
            <div style="font-family:Arial,sans-serif;font-size:11px;color:#8899bb;">Sent to ${email}</div>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

async function handler(ctx, body) {
  const user = await ctx.auth.me();
  if (!user || user.role !== 'admin') throw httpError(403, 'Forbidden');

  const { tournament_id, emails } = body || {};
  if (!tournament_id || !Array.isArray(emails)) {
    throw httpError(400, 'tournament_id and emails[] are required');
  }

  const service = ctx.asServiceRole.entities;
  const tournament = (await service.Tournament.filter({ id: tournament_id }))[0];
  if (!tournament) throw httpError(404, 'Tournament not found');

  const confirmed = await service.Registration.filter({ tournament_id, status: 'confirmed' });
  const pending = await service.Registration.filter({ tournament_id, status: 'pending' });
  let activePlayers = confirmed.length + pending.length;

  const results = [];
  const appUrl = getAppBaseUrl();
  const signupUrl = `${appUrl}/player-signup?tournament_id=${tournament_id}`;

  for (const email of emails) {
    const existing = await service.Registration.filter({ tournament_id, player_email: email });
    if (existing.length > 0) {
      results.push({ email, status: 'already_registered' });
      continue;
    }

    const isCapped = tournament.player_cap && activePlayers >= tournament.player_cap;
    const status = isCapped && tournament.waitlist_enabled ? 'waitlisted' : 'pending';

    const reg = await service.Registration.create({
      tournament_id,
      player_id: '',
      player_email: email,
      player_name: email,
      player_phone: '',
      status,
      payment_status: 'not_required',
      invited_at: new Date().toISOString(),
      waitlist_position: null,
    });

    if (status === 'pending') activePlayers += 1;

    try {
      await sendEmail(
        email,
        `You're invited to ${tournament.name}!`,
        inviteEmailHtml({ tournament, tournament_id, email, status, signupUrl }),
      );
    } catch (err) {
      console.warn('[invitePlayer] email failed for', email, err.message);
    }

    results.push({ email, status, registration_id: reg.id });
  }

  return { results };
}

module.exports = { public: false, handler };
