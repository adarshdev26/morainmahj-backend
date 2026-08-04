// The ported functions signal HTTP status the same way the rest of the backend
// does, by attaching `status` to the error the runner catches.
function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

module.exports = { httpError };
