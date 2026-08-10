// Port of recovered base44/functions/verifyCoursePayment/entry.ts
const { httpError } = require('./errors');
const { getStripe } = require('./helpers/stripe');
const {
  markEnrollmentPaidFromPaymentIntent,
  markEnrollmentPaidFromStripeSession,
  sendCoursePaymentPushIfNeeded,
} = require('./helpers/coursePayment');

async function verifyCoursePaymentIntent(service, stripe, { paymentIntentId, enrollmentId, userId }) {
  const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
  const metaEnrollmentId = String(paymentIntent.metadata?.enrollment_id || '').trim();
  const resolvedEnrollmentId = enrollmentId || metaEnrollmentId;
  if (!resolvedEnrollmentId) throw httpError(404, 'Enrollment not found for payment');

  const enrollment = (await service.CourseEnrollment.filter({ id: resolvedEnrollmentId }))[0];
  if (!enrollment) throw httpError(404, 'Enrollment not found');
  if (enrollment.player_id !== userId) throw httpError(403, 'Unauthorized');
  if (metaEnrollmentId && metaEnrollmentId !== resolvedEnrollmentId) {
    throw httpError(400, 'Payment does not match enrollment');
  }

  const paid = paymentIntent?.status === 'succeeded';
  let enrollmentRecord = enrollment;
  let syncedFromStripe = false;
  let pushResult = { pushSent: false };

  if (paid) {
    const result = await markEnrollmentPaidFromPaymentIntent(
      service,
      resolvedEnrollmentId,
      paymentIntent,
    );
    enrollmentRecord = result.enrollment;
    syncedFromStripe = result.updated;

    const courseId = paymentIntent.metadata?.course_id || enrollmentRecord.course_id;
    const course = courseId
      ? (await service.Course.filter({ id: courseId }))[0] ?? null
      : null;

    pushResult = await sendCoursePaymentPushIfNeeded(
      service,
      resolvedEnrollmentId,
      enrollmentRecord,
      courseId,
      course,
      paymentIntent,
    );
  }

  return {
    paid,
    status: paymentIntent.status,
    payment_intent_id: paymentIntent.id,
    enrollment_id: resolvedEnrollmentId,
    course_id: enrollmentRecord.course_id ?? paymentIntent.metadata?.course_id ?? null,
    syncedFromStripe,
    pushSent: pushResult.pushSent,
    enrollment: {
      id: enrollmentRecord.id,
      payment_status: enrollmentRecord.payment_status,
      payment_amount: enrollmentRecord.payment_amount ?? null,
      stripe_payment_intent_id:
        enrollmentRecord.stripe_payment_intent_id ?? paymentIntent.id,
    },
  };
}

async function handler(ctx, body) {
  const user = await ctx.auth.me();
  if (!user) throw httpError(401, 'Unauthorized');

  const sessionId = String(body?.session_id || body?.sessionId || '').trim();
  const paymentIntentId = String(body?.payment_intent_id || body?.paymentIntentId || '').trim();
  const enrollmentId = String(body?.enrollment_id || body?.enrollmentId || '').trim();

  const stripe = getStripe();
  const service = ctx.asServiceRole.entities;

  if (paymentIntentId) {
    return verifyCoursePaymentIntent(service, stripe, {
      paymentIntentId,
      enrollmentId,
      userId: user.id,
    });
  }

  if (!sessionId) throw httpError(400, 'session_id or payment_intent_id is required');

  const session = await stripe.checkout.sessions.retrieve(sessionId);
  const metaEnrollmentId = String(session.metadata?.enrollment_id || '').trim();
  const resolvedEnrollmentId = enrollmentId || metaEnrollmentId;
  if (!resolvedEnrollmentId) throw httpError(404, 'Enrollment not found for session');

  const enrollment = (await service.CourseEnrollment.filter({ id: resolvedEnrollmentId }))[0];
  if (!enrollment) throw httpError(404, 'Enrollment not found');
  if (enrollment.player_id !== user.id) throw httpError(403, 'Unauthorized');
  if (metaEnrollmentId && metaEnrollmentId !== resolvedEnrollmentId) {
    throw httpError(400, 'Session does not match enrollment');
  }

  const paid = session?.payment_status === 'paid';
  let enrollmentRecord = enrollment;
  let syncedFromStripe = false;

  if (paid) {
    const result = await markEnrollmentPaidFromStripeSession(
      service,
      resolvedEnrollmentId,
      session,
    );
    enrollmentRecord = result.enrollment;
    syncedFromStripe = result.updated;
  }

  return {
    paid,
    status: session.payment_status,
    session_id: session.id,
    enrollment_id: resolvedEnrollmentId,
    course_id: enrollmentRecord.course_id ?? session.metadata?.course_id ?? null,
    syncedFromStripe,
    enrollment: {
      id: enrollmentRecord.id,
      payment_status: enrollmentRecord.payment_status,
      payment_amount: enrollmentRecord.payment_amount ?? null,
      stripe_session_id: enrollmentRecord.stripe_session_id ?? session.id,
    },
  };
}

module.exports = { public: false, handler };
