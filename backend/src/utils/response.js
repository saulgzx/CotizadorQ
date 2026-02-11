const sendError = (res, statusCode, message, details = null) => {
  const payload = { error: message };
  if (details) payload.details = details;
  return res.status(statusCode).json(payload);
};

module.exports = { sendError };
