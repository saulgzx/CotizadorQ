/**
 * Flujo real de sesiones contra una BD en memoria: login -> peticiones -> logout,
 * tal como lo hacen el frontend (X-Session-Id propio, reusado entre logins) y el
 * MCP (mcp_bot: un X-Session-Id fijo por proceso y re-login ante 401).
 *
 * A diferencia de los tests de caracterizacion, aqui el estado de la tabla
 * `sesiones` persiste entre peticiones, asi que se prueba la integracion de
 * upsertSession (login), validateSession (requireAuth) y las revocaciones.
 */
const request = require('supertest');
const bcrypt = require('bcryptjs');

const mockQuery = jest.fn();

jest.mock('pg', () => ({
  Pool: jest.fn(() => ({ query: mockQuery, connect: jest.fn() }))
}));

process.env.JWT_SECRET = 'stage6-tests-secret-with-minimum-32-chars';
process.env.ALLOWED_ORIGINS = 'http://localhost:5173';
process.env.GEO_ENABLED = 'false';
process.env.LOGIN_RATE_LIMIT_ENABLED = 'false';

const app = require('../src/app');

const PASSWORD = 'password123';
const HASH = bcrypt.hashSync(PASSWORD, 4);

// ---------------------------------------------------------------- BD en memoria
const crearBd = () => {
  const db = {
    usuarios: [
      { id: 1, usuario: 'admin', password: HASH, nombre: 'Admin', role: 'admin', empresa: '', activo: true },
      { id: 7, usuario: 'mcp_bot', password: HASH, nombre: 'MCP', role: 'client', empresa: '', activo: true }
    ],
    sesiones: [],
    seq: 100
  };
  const usuario = (id) => db.usuarios.find((u) => u.id === Number(id));
  const fecha = (v) => new Date(v).getTime();

  const query = async (sql, p = []) => {
    const s = sql.replace(/\s+/g, ' ');
    if (s.includes('FROM login_logs') && s.includes('success = false')) {
      return { rows: [{ user_failures: 0, ip_failures: 0 }] };
    }
    if (s.includes('INSERT INTO login_logs')) return { rows: [{ id: 1 }] };
    if (s.includes('SELECT * FROM usuarios WHERE usuario = $1')) {
      return { rows: db.usuarios.filter((u) => u.usuario === p[0]) };
    }
    if (s.includes('DELETE FROM sesiones WHERE user_id = $1 AND last_seen < $2')) {
      db.sesiones = db.sesiones.filter((x) => !(x.user_id === p[0] && fecha(x.last_seen) < fecha(p[1])));
      return { rows: [] };
    }
    if (s.includes('SELECT id FROM sesiones WHERE user_id = $1 AND session_id = $2')) {
      return { rows: db.sesiones.filter((x) => x.user_id === p[0] && x.session_id === p[1]).map(({ id }) => ({ id })) };
    }
    if (s.includes('SET device_id = $1, ip_address = $2, user_agent = $3, last_seen = CURRENT_TIMESTAMP, revoked = false WHERE id = $4')) {
      const x = db.sesiones.find((r) => r.id === p[3]);
      Object.assign(x, { device_id: p[0], last_seen: new Date().toISOString(), revoked: false });
      return { rows: [] };
    }
    if (s.includes('FROM sesiones WHERE user_id = $1 AND revoked = false AND last_seen >= $2')) {
      return {
        rows: db.sesiones
          .filter((x) => x.user_id === p[0] && !x.revoked && fecha(x.last_seen) >= fecha(p[1]))
          .sort((a, b) => fecha(a.last_seen) - fecha(b.last_seen))
      };
    }
    if (s.includes('UPDATE sesiones SET revoked = true WHERE id = $1')) {
      db.sesiones.find((r) => r.id === p[0]).revoked = true;
      return { rows: [] };
    }
    if (s.includes('INSERT INTO sesiones')) {
      db.sesiones.push({
        id: ++db.seq, user_id: p[0], session_id: p[1], device_id: p[2],
        revoked: false, last_seen: new Date().toISOString()
      });
      return { rows: [] };
    }
    // validateSession (requireAuth): sesion + datos actuales del usuario.
    if (s.includes('FROM sesiones') && s.includes('session_id = $2') && s.includes('revoked, ')) {
      const rows = db.sesiones
        .filter((x) => x.user_id === p[0] && x.session_id === p[1] && usuario(x.user_id))
        .map((x) => ({ ...x, role: usuario(x.user_id).role, activo: usuario(x.user_id).activo }));
      return { rows };
    }
    if (s.includes('SET last_seen = CURRENT_TIMESTAMP')) {
      const x = db.sesiones.find((r) => r.id === p[0]);
      if (x) x.last_seen = new Date().toISOString();
      return { rows: [] };
    }
    if (s.includes('UPDATE sesiones SET revoked = true WHERE user_id = $1 AND session_id = $2')) {
      db.sesiones.filter((x) => x.user_id === p[0] && x.session_id === p[1]).forEach((x) => { x.revoked = true; });
      return { rows: [] };
    }
    if (s.includes('UPDATE sesiones SET revoked = true WHERE session_id = $1')) {
      const afectadas = db.sesiones.filter((x) => x.session_id === p[0]);
      afectadas.forEach((x) => { x.revoked = true; });
      return { rows: afectadas.map(({ session_id }) => ({ session_id })) };
    }
    if (s.includes('SELECT password FROM usuarios WHERE id = $1')) {
      const u = usuario(p[0]);
      return { rows: u ? [{ password: u.password }] : [] };
    }
    if (s.includes('UPDATE usuarios SET password = $1 WHERE id = $2')) {
      const u = usuario(p[1]);
      if (!u) return { rows: [] };
      u.password = p[0];
      return { rows: [{ id: u.id }] };
    }
    if (s.includes('UPDATE sesiones SET revoked = true WHERE user_id = $1 AND session_id <> $2')) {
      db.sesiones.filter((x) => x.user_id === Number(p[0]) && x.session_id !== p[1]).forEach((x) => { x.revoked = true; });
      return { rows: [] };
    }
    if (s.includes('UPDATE sesiones SET revoked = true WHERE user_id = $1 AND revoked = false')) {
      db.sesiones.filter((x) => x.user_id === Number(p[0])).forEach((x) => { x.revoked = true; });
      return { rows: [] };
    }
    if (s.includes('SELECT role FROM usuarios WHERE id = $1')) {
      const u = usuario(p[0]);
      return { rows: u ? [{ role: u.role }] : [] };
    }
    if (s.includes('SELECT id, usuario, nombre, empresa, logo_url, role')) {
      return { rows: db.usuarios.map(({ password, ...resto }) => resto) };
    }
    throw new Error(`SQL sin manejar: ${s}`);
  };
  return { db, query };
};

let bd;
beforeEach(() => {
  bd = crearBd();
  mockQuery.mockReset();
  mockQuery.mockImplementation(bd.query);
});

const login = (usuario, sessionId, deviceId) => {
  const req = request(app).post('/api/login');
  if (sessionId) req.set('X-Session-Id', sessionId);
  if (deviceId) req.set('X-Device-Id', deviceId);
  return req.send({ usuario, password: PASSWORD });
};
const conSesion = (req, token, sessionId) => {
  req.set('Authorization', `Bearer ${token}`);
  if (sessionId) req.set('X-Session-Id', sessionId);
  return req;
};
const listarUsuarios = (token, sessionId) => conSesion(request(app).get('/api/usuarios'), token, sessionId);
const logout = (token, sessionId) => conSesion(request(app).post('/api/logout'), token, sessionId);

describe('frontend: login -> peticiones -> logout', () => {
  test('el flujo normal funciona y tras el logout el mismo token ya no sirve', async () => {
    const sid = 'b2c1e0d4-0000-4000-8000-000000000001';
    const res = await login('admin', sid, 'dev-navegador');
    expect(res.status).toBe(200);
    expect(res.body.session.session_id).toBe(sid);
    const { token } = res.body;

    expect((await listarUsuarios(token, sid)).status).toBe(200);
    expect((await listarUsuarios(token, sid)).status).toBe(200);

    expect((await logout(token, sid)).status).toBe(200);

    const despues = await listarUsuarios(token, sid);
    expect(despues.status).toBe(401);
    expect(despues.body.error).toBe('Sesion revocada');
  });

  test('con el token de una sesion cerrada, inventar otro X-Session-Id da 401 y no crea sesiones', async () => {
    const res = await login('admin', 'sid-original');
    await logout(res.body.token, 'sid-original');
    const antes = bd.db.sesiones.length;

    const intento = await listarUsuarios(res.body.token, 'sid-inventado');
    expect(intento.status).toBe(401);
    expect(intento.body.error).toBe('Sesion invalida');
    expect(bd.db.sesiones).toHaveLength(antes);
  });

  test('X-Session-Id inventado con un token valido (sesion viva en otro id): 401', async () => {
    const res = await login('admin', 'sid-legitimo');
    const intento = await listarUsuarios(res.body.token, 'sid-del-atacante');
    expect(intento.status).toBe(401);
    // La sesion legitima sigue funcionando.
    expect((await listarUsuarios(res.body.token, 'sid-legitimo')).status).toBe(200);
  });

  test('el frontend reusa su sessionId de localStorage: logout y nuevo login con el mismo id vuelve a funcionar', async () => {
    const sid = 'sid-persistente';
    const primero = await login('admin', sid);
    await logout(primero.body.token, sid);
    const segundo = await login('admin', sid);
    expect(segundo.status).toBe(200);
    expect((await listarUsuarios(segundo.body.token, sid)).status).toBe(200);
  });

  test('una sesion revocada por el admin deja de valer', async () => {
    const admin = await login('admin', 'sid-admin');
    const bot = await login('mcp_bot', 'mcp-uno');
    expect((await logout(bot.body.token, 'mcp-uno')).status).toBe(200); // sesion valida
    await login('mcp_bot', 'mcp-uno'); // se reabre con un login
    const revocar = await conSesion(request(app).post('/api/sessions/mcp-uno/revoke'), admin.body.token, 'sid-admin');
    expect(revocar.status).toBe(200);
    expect((await logout(bot.body.token, 'mcp-uno')).status).toBe(401);
  });

  test('login sin X-Session-Id: el backend genera el id y ese id sirve en las peticiones', async () => {
    const res = await login('admin');
    expect(res.status).toBe(200);
    const sid = res.body.session.session_id;
    expect(sid).toMatch(/^srv-/);
    expect((await listarUsuarios(res.body.token, sid)).status).toBe(200);
  });
});

describe('mcp_bot (servidor MCP)', () => {
  const SID = 'mcp-4f1d2c3b-aaaa-4bbb-8ccc-1234567890ab';

  test('login con su X-Session-Id fijo y peticiones con el mismo id pasan la autenticacion', async () => {
    const res = await login('mcp_bot', SID, 'mcp-server');
    expect(res.status).toBe(200);
    expect(res.body.session.session_id).toBe(SID);
    // client: requireAuth lo deja pasar y requireAdmin responde 403 (no 401).
    expect((await listarUsuarios(res.body.token, SID)).status).toBe(403);
  });

  test('sesion vencida por inactividad: 401 y el re-login con el mismo id la reabre (lo que hace el MCP)', async () => {
    const res = await login('mcp_bot', SID, 'mcp-server');
    bd.db.sesiones.find((x) => x.session_id === SID).last_seen = new Date(Date.now() - 60 * 60 * 1000).toISOString();

    const vencida = await listarUsuarios(res.body.token, SID);
    expect(vencida.status).toBe(401);
    expect(vencida.body.error).toBe('Sesion expirada');

    const relogin = await login('mcp_bot', SID, 'mcp-server');
    expect(relogin.status).toBe(200);
    expect((await listarUsuarios(relogin.body.token, SID)).status).toBe(403);
  });

  test('un proceso MCP nuevo (otro id) desplaza al anterior, que recibe 401 y puede re-loguearse', async () => {
    const viejo = await login('mcp_bot', 'mcp-viejo');
    const nuevo = await login('mcp_bot', 'mcp-nuevo');
    expect(nuevo.body.session.revoked_sessions).toEqual(['mcp-viejo']);
    expect((await listarUsuarios(viejo.body.token, 'mcp-viejo')).status).toBe(401);
    expect((await listarUsuarios(nuevo.body.token, 'mcp-nuevo')).status).toBe(403);
  });
});

describe('cambio de contrasena', () => {
  const cambiarPropia = (token, sid, body) =>
    conSesion(request(app).patch('/api/usuarios/me/password'), token, sid).send(body);

  test('/me/password exige la contrasena actual: sin ella 400, incorrecta 400 y nada cambia', async () => {
    const res = await login('admin', 'sid-a');
    const sinActual = await cambiarPropia(res.body.token, 'sid-a', { password: 'nueva-clave-123' });
    expect(sinActual.status).toBe(400);
    const incorrecta = await cambiarPropia(res.body.token, 'sid-a', { password_actual: 'otra-cosa', password: 'nueva-clave-123' });
    expect(incorrecta.status).toBe(400);
    expect(incorrecta.body.error).toMatch(/actual no es correcta/);
    expect(bcrypt.compareSync(PASSWORD, bd.db.usuarios[0].password)).toBe(true);
    // Un error de contrasena actual no cierra la sesion (no es 401).
    expect((await listarUsuarios(res.body.token, 'sid-a')).status).toBe(200);
  });

  test('/me/password con la actual correcta: cambia, conserva esta sesion y revoca las demas', async () => {
    const a = await login('admin', 'sid-a');
    const b = await login('admin', 'sid-b');
    const ok = await cambiarPropia(a.body.token, 'sid-a', { password_actual: PASSWORD, password: 'nueva-clave-123' });
    expect(ok.status).toBe(200);
    expect(bcrypt.compareSync('nueva-clave-123', bd.db.usuarios[0].password)).toBe(true);
    expect((await listarUsuarios(a.body.token, 'sid-a')).status).toBe(200);
    expect((await listarUsuarios(b.body.token, 'sid-b')).status).toBe(401);
  });

  test('admin resetea la contrasena de otro usuario: todas las sesiones de ese usuario se revocan', async () => {
    const admin = await login('admin', 'sid-admin');
    const bot = await login('mcp_bot', 'mcp-1');
    expect((await listarUsuarios(bot.body.token, 'mcp-1')).status).toBe(403);
    const res = await conSesion(request(app).patch('/api/usuarios/7/password'), admin.body.token, 'sid-admin')
      .send({ password: 'clave-nueva-bot' });
    expect(res.status).toBe(200);
    expect((await listarUsuarios(bot.body.token, 'mcp-1')).status).toBe(401);
    // El admin sigue dentro.
    expect((await listarUsuarios(admin.body.token, 'sid-admin')).status).toBe(200);
  });
});

describe('sesiones existentes en la BD antes del despliegue', () => {
  test('una fila de sesion previa (creada al vuelo con el codigo anterior) sigue valiendo', async () => {
    const jwt = require('jsonwebtoken');
    bd.db.sesiones.push({ id: 5, user_id: 1, session_id: 'sid-antiguo', device_id: null, revoked: false, last_seen: new Date().toISOString() });
    const token = jwt.sign({ id: 1, usuario: 'admin', role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '7d' });
    expect((await listarUsuarios(token, 'sid-antiguo')).status).toBe(200);
  });
});

describe('rutas que no usan el JWT de usuario', () => {
  test('el agente del miniPC sigue autenticandose con su propio token (sin sesion)', async () => {
    const res = await request(app).get('/api/ia/agente/trabajo').set('Authorization', 'Bearer cualquiera');
    // Sin IA_AGENTE_TOKEN configurado responde 401 "Agente no autorizado", sin pasar por sesiones.
    expect(res.body.error).toBe('Agente no autorizado');
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('el webhook de WhatsApp no pasa por requireAuth', async () => {
    const res = await request(app).get('/api/whatsapp/webhook').query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'x' });
    expect(res.status).toBe(403);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
