// Port of recovered base44/functions/createCoursePaymentIntent/entry.ts
const { httpError } = require('./errors');
const { getStripe, getAppId, getPublishableKey } = require('./helpers/stripe');

async function handler(ctx, body) {
  const user = await ctx.auth.me();
  if (!user) throw httpError(401, 'Unauthorized');

  const courseId = String(body?.course_id || body?.courseId || '').trim();
  const enrollmentId = String(body?.enrollment_id || body?.enrollmentId || '').trim();
  if (!courseId) throw httpError(400, 'course_id is required');
  if (!enrollmentId) throw httpError(400, 'enrollment_id is required');

  const stripe = getStripe();
  const service = ctx.asServiceRole.entities;

  const course = (await service.Course.filter({ id: courseId }))[0];
  if (!course) throw httpError(404, 'Course not found');

  const amount = course.price || 0;
  if (amount <= 0) throw httpError(400, 'No payment required for this course');

  const enrollment = (await service.CourseEnrollment.filter({ id: enrollmentId }))[0];
  if (!enrollment) throw httpError(404, 'Enrollment not found');
  if (enrollment.player_id !== user.id) throw httpError(403, 'Unauthorized');

  let customerId;
  const existing = await stripe.customers.list({ email: user.email, limit: 1 });
  if (existing.data.length > 0) {
    customerId = existing.data[0].id;
  } else {
    const customer = await stripe.customers.create({
      email: user.email,
      name: user.full_name || user.email,
    });
    customerId = customer.id;
  }

  const ephemeralKey = await stripe.ephemeralKeys.create(
    { customer: customerId },
    { apiVersion: '2023-10-16' },
  );

  const paymentIntent = await stripe.paymentIntents.create({
    amount,
    currency: 'usd',
    customer: customerId,
    metadata: {
      app_id: getAppId(),
      course_id: courseId,
      enrollment_id: enrollmentId,
      user_id: user.id,
    },
  });

  await service.CourseEnrollment.update(enrollmentId, {
    stripe_payment_intent_id: paymentIntent.id,
    payment_status: 'pending',
  });

  return {
    clientSecret: paymentIntent.client_secret,
    client_secret: paymentIntent.client_secret,
    paymentIntentId: paymentIntent.id,
    payment_intent_id: paymentIntent.id,
    customerId,
    customer_id: customerId,
    ephemeralKeySecret: ephemeralKey.secret,
    ephemeral_key_secret: ephemeralKey.secret,
    publishableKey: getPublishableKey(),
    amount,
    currency: 'usd',
    course: { id: course.id, name: course.name, price: course.price },
  };
}

module.exports = { public: false, handler };
