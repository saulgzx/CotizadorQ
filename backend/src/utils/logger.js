const crypto = require('crypto');
const pino = require('pino');

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  redact: {
    paths: ['req.headers.authorization', 'password', '*.password', 'token'],
    remove: true
  }
});

const requestLogger = (req, res, next) => {
  const requestId = req.headers['x-request-id'] || crypto.randomUUID();
  req.requestId = requestId;
  res.setHeader('x-request-id', requestId);
  const start = Date.now();

  res.on('finish', () => {
    logger.info(
      {
        requestId,
        method: req.method,
        path: req.originalUrl,
        statusCode: res.statusCode,
        durationMs: Date.now() - start
      },
      'request'
    );
  });

  next();
};

const logError = (req, error, message, extra = {}) => {
  logger.error(
    {
      requestId: req?.requestId,
      method: req?.method,
      path: req?.originalUrl,
      err: error
        ? {
            message: error.message,
            code: error.code,
            stack: process.env.NODE_ENV === 'production' ? undefined : error.stack
          }
        : undefined,
      ...extra
    },
    message || 'error'
  );
};

module.exports = {
  logger,
  requestLogger,
  logError
};
