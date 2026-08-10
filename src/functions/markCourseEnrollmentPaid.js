// Port of recovered base44/functions/markCourseEnrollmentPaid/entry.ts
const { httpError } = require('./errors');
const { sendOneSignalPush } = require('./helpers/onesignal');

const TRACE_VERSION = 'markCourseEnrollmentPaid-v4-raw-onesignal-auth';

const normalizeEmail = (email) => {
  if (!email || typeof email !== 'string') return null;
  return email.trim().toLowerCase();
};

async function resolveEnrollmentUserExternalId(service, enrollment) {
  const email = normalizeEmail(enrollment.player_email);
  if (!email) return null;

  if (enrollment.player_id) {
    const users = await service.User.filter({ id: enrollment.player_id });
    const user = users?.[0];
    if (user) {
      return {
        externalId: user.id,
        userId: user.id,
        email: normalizeEmail(user.email) || email,
      };
    }
  }

  const users = await service.User.filter({ email });
  const user = users?.[0];
  if (!user) return null;
  return {
    externalId: user.id,
    userId: user.id,
    email: normalizeEmail(user.email) || email,
  };
}

async function sendEnrollmentConfirmedPush({ externalId, courseId, enrollmentId, courseName }) {
  if (!process.env.ONESIGNAL_APP_ID || !process.env.ONESIGNAL_REST_API_KEY) {
    return {
      ok: false,
      externalId,
      payload: null,
      oneSignalStatus: null,
      oneSignalResponse: { errors: ['ONESIGNAL_APP_ID or ONESIGNAL_REST_API_KEY not set'] },
      error: 'OneSignal credentials not configured',
      notificationId: null,
      recipients: null,
    };
  }

  const payload = {
    app_id: process.env.ONESIGNAL_APP_ID,
    include_aliases: { external_id: [externalId] },
    target_channel: 'push',
    headings: { en: 'Payment Confirmed ✅' },
    contents: {
      en: `Your payment for ${courseName} has been confirmed. See you in class!`,
    },
    data: {
      type: 'course_payment_confirmed',
      course_id: courseId,
      enrollment_id: enrollmentId,
    },
  };

  const result = await sendOneSignalPush({
    external_user_ids: [externalId],
    title: payload.headings.en,
    message: payload.contents.en,
    data: payload.data,
  });

  return {
    ok: !!result.ok,
    externalId,
    payload,
    oneSignalStatus: result.status ?? null,
    oneSignalResponse: result.response ?? null,
    error: result.ok ? null : result.error || JSON.stringify(result.response?.errors),
    notificationId: result.response?.id ?? null,
    recipients: result.response?.recipients ?? null,
  };
}

async function handler(ctx, body) {
  const user = await ctx.auth.me();
  if (!user || user.role !== 'admin') throw httpError(403, 'Forbidden');

  const { enrollmentId, forceNotify = false } = body || {};
  if (!enrollmentId) throw httpError(400, 'enrollmentId is required');

  const service = ctx.asServiceRole.entities;
  const enrollment = (await service.CourseEnrollment.filter({ id: enrollmentId }))[0];
  if (!enrollment) throw httpError(404, 'Enrollment not found');

  const alreadyPaid = enrollment.payment_status === 'paid';

  if (alreadyPaid && !forceNotify) {
    return {
      traceVersion: TRACE_VERSION,
      success: true,
      paymentUpdated: false,
      pushSent: false,
      skipped: true,
      hint: 'Use Resend Push to deliver the notification again.',
      notification: {
        pushSent: false,
        oneSignalPayload: null,
        oneSignalStatus: null,
        oneSignalResponse: null,
        error: null,
      },
    };
  }

  if (!alreadyPaid && enrollment.payment_status !== 'pending') {
    throw httpError(400, 'Only pending payments can be marked as paid');
  }

  let course = null;
  if (enrollment.course_id) {
    course = (await service.Course.filter({ id: enrollment.course_id }))[0] ?? null;
  }

  let paymentUpdated = false;
  if (!alreadyPaid) {
    await service.CourseEnrollment.update(enrollmentId, {
      payment_status: 'paid',
      payment_confirmation_push_failed: false,
    });
    paymentUpdated = true;
  }

  const pushTarget = await resolveEnrollmentUserExternalId(service, enrollment);
  let notification;

  if (!pushTarget?.externalId) {
    const error = 'No user account found for this student email';
    notification = {
      pushSent: false,
      externalId: null,
      oneSignalPayload: null,
      oneSignalStatus: null,
      oneSignalResponse: { errors: [error] },
      error,
    };
  } else {
    if (!enrollment.player_id && pushTarget.userId) {
      await service.CourseEnrollment.update(enrollmentId, { player_id: pushTarget.userId });
    }

    const push = await sendEnrollmentConfirmedPush({
      externalId: pushTarget.externalId,
      courseId: enrollment.course_id,
      enrollmentId,
      courseName: String(course?.name || 'your course'),
    });

    await service.CourseEnrollment.update(
      enrollmentId,
      push.ok
        ? {
            payment_confirmation_push_sent_at: new Date().toISOString(),
            payment_confirmation_push_failed: false,
          }
        : { payment_confirmation_push_failed: true },
    );

    notification = {
      pushSent: push.ok,
      externalId: push.externalId,
      oneSignalPayload: push.payload,
      oneSignalStatus: push.oneSignalStatus,
      oneSignalResponse: push.oneSignalResponse,
      error: push.error,
      notificationId: push.notificationId ?? null,
      recipients: push.recipients ?? null,
    };
  }

  return {
    traceVersion: TRACE_VERSION,
    success: true,
    paymentUpdated,
    pushSent: notification.pushSent,
    skipped: false,
    externalId: notification.externalId,
    oneSignalPayload: notification.oneSignalPayload,
    oneSignalStatus: notification.oneSignalStatus,
    oneSignalResponse: notification.oneSignalResponse,
    error: notification.error,
    notification,
    debug: {
      studentEmail: normalizeEmail(enrollment.player_email) || null,
      onesignalExternalId: notification.externalId,
      courseName: course?.name ?? null,
      instructorName: course?.instructor_name ?? null,
    },
  };
}

module.exports = { public: false, handler };
