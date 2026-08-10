const {
  fetchOneSignalUserByExternalId,
  sendOneSignalPushWithFallback,
} = require('./onesignal');
const { getAppBaseUrl } = require('./appUrl');

function formatCourseDate(dateStr) {
  if (!dateStr) return '';
  try {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

async function markEnrollmentPaidFromPaymentIntent(service, enrollmentId, paymentIntent) {
  const enrollment = (await service.CourseEnrollment.filter({ id: enrollmentId }))[0];
  if (!enrollment) throw new Error('Enrollment not found');
  if (enrollment.payment_status === 'paid') {
    return { alreadyPaid: true, enrollment, updated: false };
  }

  const amount = paymentIntent.amount_received ?? paymentIntent.amount ?? null;
  const update = {
    payment_status: 'paid',
    status: 'enrolled',
    stripe_payment_intent_id: paymentIntent.id ?? enrollment.stripe_payment_intent_id ?? null,
  };
  if (amount != null) update.payment_amount = amount;

  await service.CourseEnrollment.update(enrollmentId, update);
  const updatedRows = await service.CourseEnrollment.filter({ id: enrollmentId });
  return { alreadyPaid: false, enrollment: updatedRows[0] ?? enrollment, updated: true };
}

async function markEnrollmentPaidFromStripeSession(service, enrollmentId, session) {
  const enrollment = (await service.CourseEnrollment.filter({ id: enrollmentId }))[0];
  if (!enrollment) throw new Error('Enrollment not found');
  if (enrollment.payment_status === 'paid') {
    return { alreadyPaid: true, enrollment, updated: false };
  }

  await service.CourseEnrollment.update(enrollmentId, {
    payment_status: 'paid',
    status: 'enrolled',
    stripe_session_id: session.id,
    payment_amount: session.amount_total ?? enrollment.payment_amount,
    stripe_payment_intent_id: session.payment_intent ?? enrollment.stripe_payment_intent_id,
  });
  const updatedRows = await service.CourseEnrollment.filter({ id: enrollmentId });
  return { alreadyPaid: false, enrollment: updatedRows[0] ?? enrollment, updated: true };
}

async function resolveEnrollmentPushTarget(service, enrollment) {
  const playerId = enrollment?.player_id ? String(enrollment.player_id).trim() : null;
  if (playerId) return playerId;
  const email = String(enrollment?.player_email || '')
    .trim()
    .toLowerCase();
  if (!email) return null;
  const users = await service.User.filter({ email });
  return users[0]?.id ? String(users[0].id).trim() : null;
}

async function buildCourseEnrollmentPushMessage(service, courseId, course, paymentIntent) {
  const courseName = course?.name || 'your course';
  const parts = [`You're enrolled in ${courseName}.`];
  if (course?.instructor_name) parts.push(`Instructor: ${course.instructor_name}.`);
  if (course?.location) parts.push(`Location: ${course.location}.`);
  if (course?.start_date) {
    const start = formatCourseDate(course.start_date);
    const end = course.end_date ? formatCourseDate(course.end_date) : '';
    parts.push(end && end !== start ? `Dates: ${start} — ${end}.` : `Date: ${start}.`);
  }
  const amount = paymentIntent?.amount_received ?? paymentIntent?.amount;
  if (amount) parts.push(`Paid: $${(amount / 100).toFixed(2)}.`);
  if (courseId) {
    const lessons = await service.Lesson.filter({ course_id: courseId, status: 'upcoming' });
    const sorted = [...(lessons || [])].sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
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

async function sendCoursePaymentPushIfNeeded(
  service,
  enrollmentId,
  enrollment,
  courseId,
  course,
  paymentIntent,
) {
  if (enrollment.payment_confirmation_push_sent_at) {
    return { pushSent: true, skipped: true, reason: 'already_sent' };
  }

  const pushTarget = await resolveEnrollmentPushTarget(service, enrollment);
  if (!pushTarget) return { pushSent: false, reason: 'no_push_target' };

  const appUrl = getAppBaseUrl();
  const message = await buildCourseEnrollmentPushMessage(
    service,
    courseId,
    course,
    paymentIntent,
  );
  const url = courseId ? `${appUrl}/app/courses/${courseId}` : `${appUrl}/app/courses`;
  const onesignalUser = await fetchOneSignalUserByExternalId(pushTarget);

  const pushResult = await sendOneSignalPushWithFallback({
    external_user_ids: [pushTarget],
    onesignal_ids: onesignalUser.onesignalId ? [onesignalUser.onesignalId] : [],
    subscription_ids: onesignalUser.pushSubscriptionIds ?? [],
    title: 'Payment Confirmed! 📚',
    message,
    url,
    data: {
      type: 'course_enrollment_confirmed',
      enrollment_id: enrollmentId,
      course_id: courseId || '',
    },
  });

  await service.CourseEnrollment.update(
    enrollmentId,
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

module.exports = {
  formatCourseDate,
  markEnrollmentPaidFromPaymentIntent,
  markEnrollmentPaidFromStripeSession,
  resolveEnrollmentPushTarget,
  buildCourseEnrollmentPushMessage,
  sendCoursePaymentPushIfNeeded,
};
