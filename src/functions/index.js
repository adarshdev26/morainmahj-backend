// Registry of named action handlers that have been ported to Express/PostgreSQL.
//
// Each module exports `{ public, handler }` where handler is
// `async (ctx, body, req?) => result`. Throw an error carrying `status` for
// non-200 responses. Anything absent from this map is reported as 501.
const registry = {
  // Previously ported
  getDemoTournamentForUser: require('./getDemoTournamentForUser'),
  getLeagueRoster: require('./getLeagueRoster'),
  getPlayerRepository: require('./getPlayerRepository'),
  getPublicLeaderboard: require('./getPublicLeaderboard'),
  getPublicLeagueLeaderboard: require('./getPublicLeagueLeaderboard'),
  getRaffleAllocations: require('./getRaffleAllocations'),
  getTournamentPlayerNames: require('./getTournamentPlayerNames'),
  logDataAccess: require('./logDataAccess'),

  // Phase 1 — Group 1: tournament registration
  selfRegister: require('./selfRegister'),
  confirmRegistration: require('./confirmRegistration'),
  invitePlayer: require('./invitePlayer'),

  // Phase 1 — Group 2: league join
  leagueJoin: require('./leagueJoin'),

  // Phase 1 — Group 3: tournament payments
  stripeCheckout: require('./stripeCheckout'),
  createTournamentPaymentIntent: require('./createTournamentPaymentIntent'),
  confirmTournamentPayment: require('./confirmTournamentPayment'),
  verifyTournamentPayment: require('./verifyTournamentPayment'),
  notifyTournamentRegistration: require('./notifyTournamentRegistration'),

  // Phase 1 — Group 4: league payments
  leagueCheckout: require('./leagueCheckout'),
  createLeaguePaymentIntent: require('./createLeaguePaymentIntent'),
  confirmLeaguePayment: require('./confirmLeaguePayment'),

  // Phase 1 — Group 5: course payments
  courseCheckout: require('./courseCheckout'),
  createCoursePaymentIntent: require('./createCoursePaymentIntent'),
  confirmCoursePayment: require('./confirmCoursePayment'),
  verifyCoursePayment: require('./verifyCoursePayment'),
  notifyCourseEnrollment: require('./notifyCourseEnrollment'),

  // Phase 1 — Group 6: subscription (recovered sources only)
  createSubscriptionCheckout: require('./createSubscriptionCheckout'),
  createBillingPortal: require('./createBillingPortal'),

  // Phase 2 — P1 (recovered sources only)
  recalculateLeagueWaitlist: require('./recalculateLeagueWaitlist'),
  promoteFromWaitlistCourse: require('./promoteFromWaitlistCourse'),
  generateLeagueAssignments: require('./generateLeagueAssignments'),
  qrCheckIn: require('./qrCheckIn'),
  sendBulkEmails: require('./sendBulkEmails'),
  sendLeagueInvites: require('./sendLeagueInvites'),
  sendBulkSMS: require('./sendBulkSMS'),
  sendLeagueBulkSMS: require('./sendLeagueBulkSMS'),
  sendPushNotification: require('./sendPushNotification'),
  syncOneSignalIdentity: require('./syncOneSignalIdentity'),

  // Phase 3 — P2 (recovered sources only)
  raffleCheckout: require('./raffleCheckout'),
  drawRaffle: require('./drawRaffle'),
  drawTRaffle: require('./drawTRaffle'),
  checkAuctionCard: require('./checkAuctionCard'),
  saveAuctionCard: require('./saveAuctionCard'),
  placeSilentAuctionBid: require('./placeSilentAuctionBid'),
  lockInAuctionWinners: require('./lockInAuctionWinners'),
  notifyLeaguePrizePayout: require('./notifyLeaguePrizePayout'),
  notifyPrizePayOut: require('./notifyPrizePayOut'),
  markCourseEnrollmentPaid: require('./markCourseEnrollmentPaid'),
  deleteAccount: require('./deleteAccount'),
  deleteLeagueCascade: require('./deleteLeagueCascade'),
  generateShareToken: require('./generateShareToken'),

  // Phase 5 — recovered from commit 9d00bbf3… (match / hand / league / public / sub)
  submitMatchResult: require('./submitMatchResult'),
  respondToMatchResult: require('./respondToMatchResult'),
  finalizeMatchResult: require('./finalizeMatchResult'),
  logHand: require('./logHand'),
  createLeagueWalkIn: require('./createLeagueWalkIn'),
  requestLeagueSubstitute: require('./requestLeagueSubstitute'),
  assignLeagueSubstitute: require('./assignLeagueSubstitute'),
  markLeagueMemberPaid: require('./markLeagueMemberPaid'),
  processLeagueRefund: require('./processLeagueRefund'),
  finalizeLeagueSession: require('./finalizeLeagueSession'),
  getPublicTournamentWebsite: require('./getPublicTournamentWebsite'),
  getPublicLeagueWebsite: require('./getPublicLeagueWebsite'),
  getPublicCourseWebsite: require('./getPublicCourseWebsite'),
  startTrial: require('./startTrial'),
  cancelSubscription: require('./cancelSubscription'),
  verifySubscriptionPayment: require('./verifySubscriptionPayment'),
};

function has(name) {
  return Object.prototype.hasOwnProperty.call(registry, name);
}

function get(name) {
  return has(name) ? registry[name] : null;
}

function names() {
  return Object.keys(registry).sort();
}

module.exports = { get, has, names };
