// Port of recovered base44/functions/confirmCoursePayment/entry.ts
const { httpError } = require('./errors');
const { getStripe } = require('./helpers/stripe');
const {
  markEnrollmentPaidFromPaymentIntent,
  sendCoursePaymentPushIfNeeded,
} = require('./helpers/coursePayment');

async function handler(ctx, body) {
  const user = await ctx.auth.me();
  if (!user) throw httpError(401, 'Unauthorized');

  const paymentIntentId = String(body?.payment_intent_id || body?.paymentIntentId || '').trim();
  const enrollmentId = String(body?.enrollment_id || body?.enrollmentId || '').trim();
  if (!paymentIntentId) throw httpError(400, 'payment_intent_id is required');

  const stripe = getStripe();
  const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
  const metaEnrollmentId = String(paymentIntent.metadata?.enrollment_id || '').trim();
  const resolvedEnrollmentId = enrollmentId || metaEnrollmentId;
  if (!resolvedEnrollmentId) throw httpError(404, 'Enrollment not found for payment');

  const service = ctx.asServiceRole.entities;
  const enrollment = (await service.CourseEnrollment.filter({ id: resolvedEnrollmentId }))[0];
  if (!enrollment) throw httpError(404, 'Enrollment not found');
  if (enrollment.player_id !== user.id) throw httpError(403, 'Unauthorized');
  if (metaEnrollmentId && metaEnrollmentId !== resolvedEnrollmentId) {
    throw httpError(400, 'Payment does not match enrollment');
  }

  const paid = paymentIntent?.status === 'succeeded';
  let enrollmentRecord = enrollment;
  let syncedFromStripe = false;
  let pushResult = { pushSent: false, reason: null };

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

module.exports = { public: false, handler };
