// Port of recovered base44/functions/courseCheckout/entry.ts
const { httpError } = require('./errors');
const { getStripe, getAppId, getPublishableKey } = require('./helpers/stripe');
const { getAppBaseUrl } = require('./helpers/appUrl');

function buildCheckoutReturnUrls(appUrl, courseId, enrollmentId, mobile) {
  const hosted = appUrl.replace(/\/$/, '');
  const enrollmentQuery = enrollmentId
    ? `&enrollment_id=${encodeURIComponent(enrollmentId)}`
    : '';
  if (mobile) {
    return {
      success_url: `${hosted}/course-payment-return?result=success&session_id={CHECKOUT_SESSION_ID}&course_id=${encodeURIComponent(courseId)}${enrollmentQuery}`,
      cancel_url: `${hosted}/course-payment-return?result=cancelled&course_id=${encodeURIComponent(courseId)}${enrollmentQuery}`,
    };
  }
  return {
    success_url: `${hosted}/app/courses/${courseId}?payment=success`,
    cancel_url: `${hosted}/app/courses/${courseId}?payment=cancelled`,
  };
}

async function handler(ctx, body) {
  const user = await ctx.auth.me();
  if (!user) throw httpError(401, 'Unauthorized');

  const {
    course_id,
    enrollment_id,
    success_url: clientSuccessUrl,
    cancel_url: clientCancelUrl,
    mobile = false,
    native_checkout = false,
    payment_sheet = false,
  } = body || {};

  const usePaymentSheet = Boolean(payment_sheet || (mobile && native_checkout));
  const useMobileFlow = Boolean(mobile || native_checkout);

  if (!course_id) throw httpError(400, 'course_id is required');
  if (!enrollment_id) throw httpError(400, 'enrollment_id is required');

  const stripe = getStripe();
  const service = ctx.asServiceRole.entities;

  const course = (await service.Course.filter({ id: course_id }))[0];
  if (!course) throw httpError(404, 'Course not found');

  const amount = course.price || 0;
  if (amount <= 0) throw httpError(400, 'No payment required for this course');

  const enrollment = (await service.CourseEnrollment.filter({ id: enrollment_id }))[0];
  if (!enrollment) throw httpError(404, 'Enrollment not found');
  if (enrollment.course_id !== course_id) {
    throw httpError(400, 'Enrollment does not match course');
  }
  if (enrollment.player_id !== user.id) throw httpError(403, 'Unauthorized');

  if (usePaymentSheet) {
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
        course_id,
        enrollment_id,
        user_id: user.id,
      },
    });

    await service.CourseEnrollment.update(enrollment_id, {
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

  const appUrl = getAppBaseUrl();
  const defaults = buildCheckoutReturnUrls(appUrl, course_id, enrollment_id, useMobileFlow);
  const success_url = useMobileFlow
    ? defaults.success_url
    : clientSuccessUrl || defaults.success_url;
  const cancel_url = useMobileFlow
    ? defaults.cancel_url
    : clientCancelUrl || defaults.cancel_url;

  const session = await stripe.checkout.sessions.create({
    payment_method_types: ['card'],
    line_items: [
      {
        price_data: {
          currency: 'usd',
          product_data: { name: `${course.name} — Course Enrollment` },
          unit_amount: amount,
        },
        quantity: 1,
      },
    ],
    mode: 'payment',
    success_url,
    cancel_url,
    customer_email: user.email,
    metadata: {
      app_id: getAppId(),
      course_id,
      enrollment_id,
      user_id: user.id,
    },
  });

  await service.CourseEnrollment.update(enrollment_id, {
    stripe_session_id: session.id,
    payment_status: 'pending',
  });

  return {
    url: session.url,
    session_id: session.id,
    enrollment_id,
    course_id,
  };
}

module.exports = { public: false, handler };
