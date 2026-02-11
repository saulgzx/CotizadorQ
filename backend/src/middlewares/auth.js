const buildAuthMiddlewares = ({ pool, jwtSecret, getSessionHeaders, validateSession, onMissingSession }) => {
  const requireAuth = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Token requerido' });
    try {
      const jwt = require('jsonwebtoken');
      const user = jwt.verify(token, jwtSecret);
      req.user = user;
      const { sessionId } = getSessionHeaders(req);
      const validation = await validateSession(user.id, sessionId, req, user.role);
      if (!validation.ok) {
        if (validation.reason === 'missing') {
          if (typeof onMissingSession === 'function') {
            await onMissingSession(user, req);
          }
          return next();
        }
        return res.status(401).json({ error: validation.reason || 'Sesion invalida' });
      }
      return next();
    } catch (error) {
      return res.status(401).json({ error: 'Token invalido' });
    }
  };

  const getUserRole = async (userId) => {
    const result = await pool.query('SELECT role FROM usuarios WHERE id = $1', [userId]);
    if (result.rows.length === 0) return null;
    return String(result.rows[0].role || '').toLowerCase();
  };

  const requireAdmin = async (req, res, next) => {
    try {
      const userId = req.user?.id;
      if (!userId) return res.status(403).json({ error: 'Permiso denegado' });
      const role = await getUserRole(userId);
      if (role !== 'admin') return res.status(403).json({ error: 'Permiso denegado' });
      return next();
    } catch (error) {
      return res.status(500).json({ error: 'Error del servidor' });
    }
  };

  const requireOwnerOrAdmin = (resolveOwnerId, notFoundMessage = 'Recurso no encontrado') => async (req, res, next) => {
    try {
      const userId = req.user?.id;
      if (!userId) return res.status(403).json({ error: 'Permiso denegado' });
      const role = await getUserRole(userId);
      if (role === 'admin') return next();
      const ownerId = await resolveOwnerId(req);
      if (ownerId === null || ownerId === undefined) {
        return res.status(404).json({ error: notFoundMessage });
      }
      if (Number(ownerId) !== Number(userId)) {
        return res.status(403).json({ error: 'Permiso denegado' });
      }
      return next();
    } catch (error) {
      return res.status(500).json({ error: 'Error del servidor' });
    }
  };

  return {
    requireAuth,
    requireAdmin,
    requireOwnerOrAdmin
  };
};

module.exports = { buildAuthMiddlewares };
