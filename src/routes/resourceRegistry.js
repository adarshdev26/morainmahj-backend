// Named REST resources → PostgreSQL entity (table) names.
//
// `ops` lists only the HTTP operations the frontend actually uses today, so we
// do not expose write/delete/bulk where nothing calls them.
//
//   list   → GET    /api/{path}
//   get    → GET    /api/{path}/:id
//   create → POST   /api/{path}
//   update → PATCH  /api/{path}/:id  (PUT also accepted)
//   remove → DELETE /api/{path}/:id
//   bulkCreate → POST /api/{path}/bulk
//   bulkUpdate → PUT  /api/{path}/bulk

const RESOURCES = [
  { path: 'audit-logs', entity: 'AuditLog', ops: ['list', 'create'] },
  { path: 'blocked-users', entity: 'BlockedUser', ops: ['list', 'create'] },
  { path: 'card-hands', entity: 'CardHand', ops: ['list', 'get', 'create', 'update', 'remove'] },
  { path: 'communication-logs', entity: 'CommunicationLog', ops: ['list', 'create'] },
  { path: 'community-agreements', entity: 'CommunityAgreement', ops: ['list', 'create'] },
  { path: 'community-comments', entity: 'CommunityComment', ops: ['list', 'create', 'update'] },
  { path: 'community-posts', entity: 'CommunityPost', ops: ['list', 'create', 'update'] },
  { path: 'community-rules', entity: 'CommunityRule', ops: ['list', 'create', 'update', 'remove'] },
  { path: 'content-reports', entity: 'ContentReport', ops: ['list', 'create', 'update'] },
  { path: 'courses', entity: 'Course', ops: ['list', 'get', 'create', 'update'] },
  { path: 'course-enrollments', entity: 'CourseEnrollment', ops: ['list', 'create', 'update', 'remove'] },
  { path: 'email-deliveries', entity: 'EmailDelivery', ops: ['list'] },
  { path: 'email-templates', entity: 'EmailTemplate', ops: ['list', 'create', 'update', 'remove'] },
  { path: 'faqs', entity: 'FAQ', ops: ['list', 'create', 'update', 'remove'], publicOps: ['list'] },
  { path: 'hand-logs', entity: 'HandLog', ops: ['list'] },
  { path: 'leagues', entity: 'League', ops: ['list', 'get', 'create', 'update'] },
  { path: 'league-members', entity: 'LeagueMember', ops: ['list', 'create', 'update', 'remove', 'bulkCreate'] },
  { path: 'league-posts', entity: 'LeaguePost', ops: ['list', 'create', 'update', 'remove'] },
  { path: 'league-prizes', entity: 'LeaguePrize', ops: ['list', 'create', 'update', 'remove'] },
  { path: 'league-round-timers', entity: 'LeagueRoundTimer', ops: ['list', 'create', 'update'] },
  { path: 'league-rsvps', entity: 'LeagueRSVP', ops: ['list', 'create', 'update', 'remove', 'bulkUpdate'] },
  { path: 'league-score-cards', entity: 'LeagueScoreCard', ops: ['list', 'create', 'update'] },
  { path: 'league-sessions', entity: 'LeagueSession', ops: ['list', 'create', 'update'] },
  {
    path: 'league-table-assignments',
    entity: 'LeagueTableAssignment',
    ops: ['list', 'update', 'remove', 'bulkCreate'],
  },
  { path: 'lessons', entity: 'Lesson', ops: ['list', 'create', 'update', 'remove'] },
  { path: 'lesson-flightings', entity: 'LessonFlighting', ops: ['list', 'create', 'update', 'remove'] },
  { path: 'managers', entity: 'Manager', ops: ['list', 'create'] },
  {
    path: 'marketing-features',
    entity: 'MarketingFeature',
    ops: ['list', 'create', 'update', 'remove'],
    publicOps: ['list'],
  },
  {
    path: 'marketing-pages',
    entity: 'MarketingPage',
    ops: ['list', 'create', 'update', 'remove'],
    publicOps: ['list'],
  },
  {
    path: 'marketing-sections',
    entity: 'MarketingSection',
    ops: ['list', 'create', 'update', 'remove'],
    publicOps: ['list'],
  },
  { path: 'match-results', entity: 'MatchResult', ops: ['list', 'create'] },
  { path: 'organizations', entity: 'Organization', ops: ['list', 'update'] },
  { path: 'players', entity: 'Player', ops: ['list', 'create', 'update', 'remove'] },
  { path: 'prize-structures', entity: 'PrizeStructure', ops: ['list', 'create', 'update'] },
  { path: 'prize-winners', entity: 'PrizeWinner', ops: ['list', 'create', 'update', 'remove'] },
  { path: 'raffles', entity: 'Raffle', ops: ['list', 'create', 'update', 'remove'] },
  { path: 'raffle-allocations', entity: 'RaffleAllocation', ops: ['list', 'create', 'update', 'remove'] },
  { path: 'raffle-prize-items', entity: 'RafflePrizeItem', ops: ['list', 'create', 'remove'] },
  { path: 'raffle-tickets', entity: 'RaffleTicket', ops: ['list'] },
  { path: 'registrations', entity: 'Registration', ops: ['list', 'update', 'bulkCreate'] },
  { path: 'room-maps', entity: 'RoomMap', ops: ['list', 'create', 'update'] },
  { path: 'round-timers', entity: 'RoundTimer', ops: ['list', 'create', 'update'] },
  { path: 'score-cards', entity: 'ScoreCard', ops: ['list', 'create', 'update', 'remove', 'bulkCreate'] },
  { path: 'share-invites', entity: 'ShareInvite', ops: ['list', 'update'] },
  { path: 'silent-auctions', entity: 'SilentAuction', ops: ['list', 'create', 'update', 'remove'] },
  { path: 'silent-auction-bids', entity: 'SilentAuctionBid', ops: ['list'] },
  { path: 'silent-auction-items', entity: 'SilentAuctionItem', ops: ['list', 'create', 'remove'] },
  { path: 'special-hands', entity: 'SpecialHand', ops: ['list', 'create', 'update', 'remove'] },
  { path: 'subscriptions', entity: 'Subscription', ops: ['list'] },
  {
    path: 'table-assignments',
    entity: 'TableAssignment',
    ops: ['list', 'create', 'update', 'remove', 'bulkCreate'],
  },
  { path: 'teaching-materials', entity: 'TeachingMaterial', ops: ['list', 'create', 'update', 'remove'] },
  {
    path: 'testimonials',
    entity: 'Testimonial',
    ops: ['list', 'create', 'update', 'remove'],
    publicOps: ['list'],
  },
  {
    path: 'tournaments',
    entity: 'Tournament',
    ops: ['list', 'get', 'create', 'update', 'remove'],
    publicOps: ['list', 'get'],
  },
  { path: 'users', entity: 'User', ops: ['list', 'update'] },
];

function byPath() {
  const map = new Map();
  for (const resource of RESOURCES) map.set(resource.path, resource);
  return map;
}

module.exports = { RESOURCES, byPath };
