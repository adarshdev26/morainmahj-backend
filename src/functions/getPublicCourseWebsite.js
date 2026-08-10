// Port of recovered base44/functions/getPublicCourseWebsite/entry.ts
const { httpError } = require('./errors');

function orgIdOf(user) {
  return user?.data?.organization_id || user?.organization_id || '';
}

async function handler(ctx, body, req) {
  const slug = body?.slug || req?.query?.slug;
  const preview =
    body?.preview === true ||
    body?.preview === 'true' ||
    req?.query?.preview === 'true';

  if (!slug) throw httpError(400, 'Slug is required');

  const service = ctx.asServiceRole.entities;
  const courses = await service.Course.filter({ website_slug: slug });
  const course = courses[0];
  if (!course) throw httpError(404, 'Course not found');

  if (preview) {
    const user = await ctx.auth.me().catch(() => null);
    const isSuperAdmin = user?.role === 'admin';
    const isOrgOrganizer =
      user?.role === 'organizer_admin' && orgIdOf(user) === course.organization_id;
    if (!isSuperAdmin && !isOrgOrganizer) {
      throw httpError(403, 'Unauthorized to preview this website');
    }
  } else if (!course.website_enabled || course.website_status !== 'published') {
    throw httpError(404, 'This course website is not publicly available yet.');
  }

  let organization = null;
  if (course.organization_id) {
    const orgs = await service.Organization.filter({ id: course.organization_id });
    organization = orgs[0] || null;
  }

  const lessons = await service.Lesson.filter({ course_id: course.id });
  const sortedLessons = lessons.sort(
    (a, b) => (a.lesson_number || 0) - (b.lesson_number || 0),
  );

  const enrollments = await service.CourseEnrollment.filter({
    course_id: course.id,
    status: 'enrolled',
  });

  return {
    course,
    organization,
    lessons: sortedLessons,
    enrolledCount: enrollments.length,
  };
}

module.exports = { public: true, handler };
