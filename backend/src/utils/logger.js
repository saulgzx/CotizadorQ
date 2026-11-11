const crypto = require('crypto');
const pino = require('pino');

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  redact: {
    paths: ['req.headers.authorization', 'password', '*.password', 'token'],
    remove: true
  }
});

// Parametros de query cuyo valor nunca debe quedar en logs (ej. hub.verify_token del
// webhook de WhatsApp), sin distinguir mayusculas.
const SENSITIVE_QUERY_KEY = /(token|secret|passw|api_?key|signature)/i;
const SENSITIVE_QUERY_EXACT = new Set(['key', 'auth']);
const isSensitiveQueryKey = (key) =>
  SENSITIVE_QUERY_KEY.test(key) || SENSITIVE_QUERY_EXACT.has(key.toLowerCase());

/** URL apta para logs: enmascara /mcp/<secreto> y valores de parametros sensibles. */
const sanitizeUrlForLog = (rawUrl) => {
  const url = String(rawUrl || '');
  const qIndex = url.indexOf('?');
  let pathPart = qIndex === -1 ? url : url.slice(0, qIndex);
  pathPart = pathPart.replace(/^(\/mcp\/).+$/i, '$1[censurado]');
  if (qIndex === -1) return pathPart;
  const query = url
    .slice(qIndex + 1)
    .split('&')
    .map((pair) => {
      const eq = pair.indexOf('=');
      if (eq === -1) return pair;
      const key = pair.slice(0, eq);
      let decodedKey = key;
      try {
        decodedKey = decodeURIComponent(key);
      } catch {
        // clave mal codificada: se evalua tal cual
      }
      return isSensitiveQueryKey(decodedKey) ? `${key}=[censurado]` : pair;
    })
    .join('&');
  return `${pathPart}?${query}`;
};

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
        path: sanitizeUrlForLog(req.originalUrl),
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
      path: sanitizeUrlForLog(req?.originalUrl),
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
  logError,
  sanitizeUrlForLog
};
