// Write an Express asyncHandler wrapper function.
// It takes a function fn as argument.
// Returns a new function (req, res, next) that calls fn(req, res, next)
// and catches any promise rejection, passing the error to next(err).
// Export as module.exports = asyncHandler.
function asyncHandler(fn) {
  return function(req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next)
  }
}

module.exports = asyncHandler