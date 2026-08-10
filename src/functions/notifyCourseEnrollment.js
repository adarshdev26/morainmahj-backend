// Port of recovered base44/functions/notifyCourseEnrollment/entry.ts
const { httpError } = require('./errors');
const {
  fetchOneSignalUserByExternalId,
  sendOneSignalPushWithFallback,
} = require('./helpers/onesignal');
const { getAppBaseUrl } = require('./helpers/appUrl');
const { formatCourseDate } = require('./helpers/coursePayment');

async function buildEnrollmentMessage(service, courseId, course, enrollment) {
  const courseName = course?.name || 'your course';
  const parts = [`You're enrolled in ${courseName}.`];
  if (course?.instructor_name) parts.push(`Instructor: ${course.instructor_name}.`);
  if (course?.location) parts.push(`Location: ${course.location}.`);
  if (course?.start_date) {
    const start = formatCourseDate(course.start_date);
    const end = course.end_date ? formatCourseDate(course.end_date) : '';
    parts.push(end && end !== start ? `Dates: ${start} — ${end}.` : `Date: ${start}.`);
  }
  const amount = enrollment?.payment_amount ?? course?.price;
  if (amount && amount > 0 && enrollment?.payment_status === 'paid') {
    parts.push(`Paid: $${(amount / 100).toFixed(2)}.`);
  }
  if (courseId) {
    const lessons = await service.Lesson.filter({ course_id: courseId, status: 'upcoming' });
    const sorted = [...(lessons || [])].sort((a, b) =>
      String(a.date || '').localeCompare(String(b.date || '')),
    );
    const next = sorted[0];
    if (next?.date) {
      let nextPart = `Next session: ${formatCourseDate(next.date)}`;
      if (next.start_time) nextPart += ` at ${next.start_time}`;
      parts.push(`${nextPart}.`);
    }
  }
  parts.push('Tap to view your schedule and materials.');
  return parts.join(' ');
}

async function handler(ctx, body) {
  const user = await ctx.auth.me();
  if (!user) throw httpError(401, 'Unauthorized');

  const enrollment_id = body?.enrollment_id;
  if (!enrollment_id) throw httpError(400, 'enrollment_id is required');

  const service = ctx.asServiceRole.entities;
  const enrollment = (await service.CourseEnrollment.filter({ id: enrollment_id }))[0];
  if (!enrollment) throw httpError(404, 'Enrollment not found');

  const userEmail = String(user.email || '')
    .trim()
    .toLowerCase();
  const enrollmentEmail = String(enrollment.player_email || '')
    .trim()
    .toLowerCase();
  const owns =
    enrollment.player_id === user.id ||
    (userEmail && enrollmentEmail && userEmail === enrollmentEmail);
  if (!owns) throw httpError(403, 'Unauthorized');
  if (enrollment.status !== 'enrolled') {
    throw httpError(400, 'Enrollment is not active');
  }

  const courseId = enrollment.course_id;
  const course = courseId
    ? (await service.Course.filter({ id: courseId }))[0] ?? null
    : null;

  const targetExternalId = enrollment.player_id
    ? String(enrollment.player_id).trim()
    : String(user.id || '').trim();
  if (!targetExternalId) return { pushSent: false, reason: 'no_target_id' };

  const appUrl = getAppBaseUrl();
  const message = await buildEnrollmentMessage(service, courseId, course, enrollment);
  const title =
    enrollment.payment_status === 'paid'
      ? 'Payment Confirmed! 📚'
      : 'Enrollment Confirmed! 📚';
  const url = courseId ? `${appUrl}/app/courses/${courseId}` : `${appUrl}/app/courses`;
  const playerEmail = String(enrollment.player_email || user.email || '')
    .trim()
    .toLowerCase();
  const onesignalUser = await fetchOneSignalUserByExternalId(targetExternalId);

  const pushResult = await sendOneSignalPushWithFallback({
    external_user_ids: [targetExternalId, playerEmail].filter(Boolean),
    onesignal_ids: onesignalUser.onesignalId ? [onesignalUser.onesignalId] : [],
    subscription_ids: onesignalUser.pushSubscriptionIds ?? [],
    title,
    message,
    url,
    data: {
      type: 'course_enrollment_confirmed',
      enrollment_id,
      course_id: courseId || '',
    },
  });

  await service.CourseEnrollment.update(
    enrollment_id,
    pushResult.ok
      ? {
          payment_confirmation_push_sent_at: new Date().toISOString(),
          payment_confirmation_push_failed: false,
        }
      : { payment_confirmation_push_failed: true },
  );

  return {
    pushSent: !!pushResult.ok,
    reason: pushResult.ok ? 'sent' : pushResult.error || pushResult.reason,
  };
}

module.exports = { public: false, handler };
