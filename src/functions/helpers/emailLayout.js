/**
 * Port of recovered base44/shared/emailTemplate.ts (business HTML only).
 */

const MONOGRAM_SVG = `<svg width="56" height="56" viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect x="60" y="4" width="79" height="79" transform="rotate(45 60 4)" stroke="#c9a96e" stroke-width="1.5" fill="none"/>
  <rect x="60" y="16" width="62" height="62" transform="rotate(45 60 16)" stroke="#c9a96e" stroke-width="0.75" fill="none"/>
  <text x="50%" y="54%" dominant-baseline="middle" text-anchor="middle" font-family="Georgia,serif" font-weight="300" font-size="52" fill="#c9a96e">M</text>
</svg>`;

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
}

function row(icon, label, value) {
  return { icon, label, value };
}

function detailsCard(title, rows) {
  if (!rows || rows.length === 0) return '';
  const rowsHtml = rows
    .filter((r) => r && r.value)
    .map((r) => {
      const iconCell = r.icon
        ? `<td width="22" valign="top" style="padding-top:1px;"><div style="width:18px;height:18px;background-color:#e8e2da;border-radius:3px;text-align:center;line-height:18px;font-size:11px;">${r.icon}</div></td>`
        : '<td width="22" valign="top"></td>';
      return `<table cellpadding="0" cellspacing="0" style="margin-bottom:8px;"><tr>${iconCell}<td style="padding-left:8px;"><div style="font-family:Arial,sans-serif;font-size:13px;color:#374151;line-height:1.4;"><strong>${escapeHtml(r.label)}:</strong> ${r.value}</div></td></tr></table>`;
    })
    .join('');
  return `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#ffffff;border-radius:10px;border:1px solid #e5ddd0;margin-bottom:24px;overflow:hidden;">
    <tr><td width="4" style="background-color:#c9a96e;border-radius:10px 0 0 10px;">&nbsp;</td>
    <td style="padding:20px 20px 20px 16px;">
      ${title ? `<div style="font-family:Arial,sans-serif;font-size:10px;font-weight:600;letter-spacing:2px;text-transform:uppercase;color:#c9a96e;margin-bottom:12px;">${escapeHtml(title)}</div>` : ''}
      ${rowsHtml}
    </td></tr>
  </table>`;
}

function noticeBox(notice) {
  if (!notice || !notice.html) return '';
  const bg = notice.tone === 'warning' ? '#fef3c7' : '#eef2ff';
  const border = notice.tone === 'warning' ? '#c9a96e' : '#6366f1';
  const text = notice.tone === 'warning' ? '#92400e' : '#3730a3';
  return `<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;"><tr><td style="background-color:${bg};border-left:3px solid ${border};padding:12px 16px;border-radius:0 6px 6px 0;"><div style="font-family:Arial,sans-serif;font-size:13px;color:${text};line-height:1.5;">${notice.html}</div></td></tr></table>`;
}

function ctaButton(cta) {
  if (!cta || !cta.url) return '';
  return `<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px;"><tr><td align="center" style="background-color:#1e2d4a;border-radius:8px;padding:0;"><a href="${escapeHtml(cta.url)}" style="display:block;font-family:Arial,sans-serif;font-size:14px;font-weight:600;letter-spacing:2px;text-transform:uppercase;color:#f2ede6;text-decoration:none;padding:16px 24px;">${escapeHtml(cta.label)} →</a></td></tr></table>`;
}

function emailLayout(opts) {
  const {
    eyebrow,
    title,
    subtitle,
    greeting,
    paragraphs = [],
    detailsTitle,
    details,
    notice,
    cta,
    footerNote,
    recipientEmail,
  } = opts;

  const paraHtml = paragraphs
    .filter(Boolean)
    .map(
      (p) =>
        `<p style="font-family:Arial,sans-serif;font-size:15px;color:#374151;line-height:1.7;margin:0 0 20px;">${p}</p>`,
    )
    .join('');

  const greetingHtml = greeting
    ? `<p style="font-family:Arial,sans-serif;font-size:15px;color:#374151;line-height:1.7;margin:0 0 20px;">${greeting}</p>`
    : '';

  const detailsHtml = detailsCard(detailsTitle || '', details || []);
  const noticeHtml = notice ? noticeBox(notice) : '';
  const ctaHtml = ctaButton(cta || { label: '', url: '' });

  const footerLine = footerNote
    ? `<div style="font-family:Arial,sans-serif;font-size:11px;color:#8899bb;line-height:1.5;">${footerNote}</div>`
    : '';
  const recipientLine = recipientEmail
    ? `<div style="font-family:Arial,sans-serif;font-size:11px;color:#8899bb;margin-top:4px;">Sent to ${escapeHtml(recipientEmail)}</div>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;padding:0;background-color:#1a2a42;font-family:Georgia,serif;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#1a2a42;min-height:100vh;">
    <tr><td align="center" style="padding:32px 16px 48px;">
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:430px;width:100%;border-radius:16px;overflow:hidden;box-shadow:0 24px 60px rgba(0,0,0,0.45);">
        <tr>
          <td align="center" style="background-color:#1e2d4a;padding:40px 32px 32px;">
            <div style="margin-bottom:16px;">${MONOGRAM_SVG}</div>
            <div style="font-family:Georgia,'Times New Roman',serif;font-size:22px;font-weight:400;letter-spacing:6px;text-transform:uppercase;color:#f2ede6;margin-bottom:4px;">Morain Mahj</div>
            <div style="font-family:Arial,sans-serif;font-size:10px;font-weight:300;letter-spacing:4px;text-transform:uppercase;color:#c9a96e;opacity:0.8;">Legacy game for modern players</div>
            <div style="width:40px;height:1px;background-color:#c9a96e;margin:20px auto 0;opacity:0.6;"></div>
          </td>
        </tr>
        <tr><td style="background-color:#c9a96e;height:2px;"></td></tr>
        <tr>
          <td style="background-color:#f5f0e8;padding:32px 28px 28px;">
            ${eyebrow ? `<div style="font-family:Arial,sans-serif;font-size:10px;font-weight:600;letter-spacing:3px;text-transform:uppercase;color:#c9a96e;margin-bottom:16px;text-align:center;">${escapeHtml(eyebrow)}</div>` : ''}
            <div style="font-family:Georgia,'Times New Roman',serif;font-size:24px;font-weight:600;color:#1e2d4a;line-height:1.25;text-align:center;margin-bottom:8px;">${escapeHtml(title)}</div>
            ${subtitle ? `<div style="font-family:Arial,sans-serif;font-size:13px;color:#6b7280;line-height:1.5;text-align:center;margin-bottom:24px;">${escapeHtml(subtitle)}</div>` : '<div style="height:16px;"></div>'}
            ${greetingHtml}${paraHtml}${noticeHtml}${detailsHtml}${ctaHtml}
            ${cta?.url ? `<p style="font-family:Arial,sans-serif;font-size:11px;color:#9ca3af;line-height:1.6;margin:0 0 8px;text-align:center;">Button not working? <a href="${escapeHtml(cta.url)}" style="color:#c9a96e;text-decoration:underline;">Open link</a></p>` : ''}
          </td>
        </tr>
        <tr>
          <td style="background-color:#1e2d4a;padding:20px 28px;text-align:center;">
            <div style="font-family:Arial,sans-serif;font-size:10px;font-weight:600;letter-spacing:3px;text-transform:uppercase;color:#c9a96e;margin-bottom:6px;">Morain Mahj</div>
            ${footerLine}${recipientLine}
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

module.exports = { emailLayout, escapeHtml, row };
