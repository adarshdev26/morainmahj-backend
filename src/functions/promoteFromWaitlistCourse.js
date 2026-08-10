// Port of recovered base44/functions/promoteFromWaitlistCourse/entry.ts
const { httpError } = require('./errors');
const { sendEmail } = require('./helpers/email');

async function handler(ctx, body) {
  const user = await ctx.auth.me();
  if (!user || user.role !== 'admin') {
    throw httpError(403, 'Forbidden: Admin access required');
  }

  const { courseId } = body || {};
  if (!courseId) throw httpError(400, 'courseId is required');

  const service = ctx.asServiceRole.entities;
  const course = await service.Course.get(courseId);
  if (!course) throw httpError(404, 'Course not found');

  const waitlisted = await service.CourseEnrollment.filter(
    { course_id: courseId, status: 'waitlisted' },
    'enrolled_at',
    1,
  );

  if (!waitlisted || waitlisted.length === 0) {
    return { message: 'No waitlisted students to promote' };
  }

  const promotedStudent = waitlisted[0];
  await service.CourseEnrollment.update(promotedStudent.id, { status: 'enrolled' });

  const subject = `You're in! ${course.name}`;
  const emailBody =
    `Hi ${promotedStudent.player_name},\n\n` +
    `Great news! A spot has opened up in ${course.name} and you've been promoted from the waitlist.\n\n` +
    `You're now officially enrolled. Check your course details for lesson schedules and materials.\n\n` +
    `Instructor: ${course.instructor_name || 'TBA'}\n` +
    `Location: ${course.location || 'TBA'}\n\n` +
    `See you soon!`;

  try {
    await sendEmail(promotedStudent.player_email, subject, emailBody.replace(/\n/g, '<br>'));
  } catch (err) {
    console.warn('[promoteFromWaitlistCourse] email failed:', err.message);
  }

  return {
    success: true,
    promoted_student: promotedStudent.player_name,
    message: `${promotedStudent.player_name} promoted from waitlist`,
  };
}

module.exports = { public: false, handler };
