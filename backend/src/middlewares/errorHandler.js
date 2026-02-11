const { AppError } = require('../utils/errors');
const { sendError } = require('../utils/response');
const { logError } = require('../utils/logger');

const notFoundHandler = (req, res, next) => {
  next(new AppError('Ruta no encontrada', 404));
};

const errorHandler = (err, req, res, next) => {
  if (res.headersSent) return next(err);
  const statusCode = Number(err?.statusCode || err?.status || 500);
  const message = err?.message || 'Error del servidor';
  if (statusCode >= 500) {
    logError(req, err, 'unhandled_error');
  }
  return sendError(res, statusCode, message, err?.details || null);
};

module.exports = { notFoundHandler, errorHandler };
