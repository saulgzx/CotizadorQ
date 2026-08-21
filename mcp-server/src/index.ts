import { timingSafeEqual } from 'node:crypto';
import { createMcpExpressApp } from '@modelcontextprotocol/express';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import type { NextFunction, Request, Response } from 'express';
import { verificarConfig } from './cotizador.js';
import { registrarTools } from './tools.js';

const PORT = Number(process.env.PORT || 8080);
const CONNECTOR_SECRET = (process.env.CONNECTOR_SECRET || '').trim();

// Fallar al arrancar y no en la primera consulta: si falta configuracion,
// Railway marca el deploy en rojo en vez de dejar un servicio roto en silencio.
if (!CONNECTOR_SECRET) {
  console.error('Falta CONNECTOR_SECRET. Cargala en Railway > Variables.');
  process.exit(1);
}
try {
  verificarConfig();
} catch (error) {
  console.error((error as Error).message);
  process.exit(1);
}

/** Comparacion en tiempo constante: evita distinguir el secreto por latencia. */
const secretoValido = (candidato: string): boolean => {
  const a = Buffer.from(candidato);
  const b = Buffer.from(CONNECTOR_SECRET);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
};

// Con el header, 401 es correcto: falta o esta mal la credencial.
const rechazarHeader = (res: Response) => {
  res.status(401).json({ error: 'Secreto invalido o ausente' });
};

// Con el secreto en la ruta, 401 seria contraproducente: el cliente lo lee como
// "hay que autenticarse" y arranca un flujo OAuth que este servidor no ofrece,
// terminando en un error que no apunta a la causa. El secreto es parte de la
// URL, asi que si no coincide la URL es incorrecta: 404.
const rechazarRuta = (res: Response) => {
  res.status(404).json({
    error: 'URL de conexion incorrecta',
    detalle:
      'El secreto incluido en la ruta no coincide con CONNECTOR_SECRET. ' +
      'Verifica que copiaste la URL completa y que el valor en Railway no tenga comillas ni espacios.'
  });
};

/** Via 1: Authorization: Bearer <secreto>. */
const authPorHeader = (req: Request, res: Response, next: NextFunction) => {
  const header = req.get('authorization') || '';
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match || !secretoValido(match[1].trim())) return rechazarHeader(res);
  return next();
};

/**
 * Via 2: /mcp/<secreto>, para clientes que no permiten headers.
 * Se captura con regex y no con :param porque un secreto en base64 puede
 * contener "/" y partiria la ruta en varios segmentos.
 */
const authPorRuta = (req: Request, res: Response, next: NextFunction) => {
  const desdeRuta = decodeURIComponent(String(req.params[0] || ''));
  if (!secretoValido(desdeRuta)) return rechazarRuta(res);
  return next();
};

const handler = createMcpHandler(() => {
  const server = new McpServer({ name: 'cotizadorq', version: '1.0.0' });
  registrarTools(server);
  return server;
});

// createMcpExpressApp valida el header Host contra DNS rebinding y por defecto
// solo acepta localhost: en un dominio publico rechaza todo con 403. Railway
// inyecta RAILWAY_PUBLIC_DOMAIN, asi que el dominio propio se autoriza solo;
// MCP_ALLOWED_HOSTS queda para dominios extra (custom domain, staging).
const allowedHosts = [
  process.env.RAILWAY_PUBLIC_DOMAIN,
  ...(process.env.MCP_ALLOWED_HOSTS || '').split(','),
  'localhost',
  '127.0.0.1'
]
  .map((valor) => String(valor || '').trim())
  .filter(Boolean);

console.log(`Hosts autorizados: ${allowedHosts.join(', ')}`);

const app = createMcpExpressApp({ host: '0.0.0.0', allowedHosts });
const node = toNodeHandler(handler);

// createMcpExpressApp ya configura express.json(); hay que pasar req.body para
// no volver a consumir el stream.
const servirMcp = (req: Request, res: Response) => void node(req, res, req.body);

app.get('/health', (_req, res) => {
  res.json({ status: 'OK', service: 'cotizadorq-mcp', commit: (process.env.RAILWAY_GIT_COMMIT_SHA || '').slice(0, 7) || null });
});

// Este servidor no usa OAuth. Si un cliente cae aca es porque recibio un 401 y
// arranco el flujo de autorizacion: el secreto no coincidio. Se responde algo
// explicito en vez de un "Cannot GET /authorize" que no dice nada.
const sinOauth = (_req: Request, res: Response) => {
  res.status(404).json({
    error: 'Este servidor MCP no usa OAuth',
    detalle:
      'Se autentica con un secreto estatico. Si llegaste aca, el secreto enviado no coincide con CONNECTOR_SECRET. ' +
      'Usa Authorization: Bearer <secreto>, o la URL /mcp/<secreto>.'
  });
};
app.get('/authorize', sinOauth);
app.get('/.well-known/oauth-authorization-server', sinOauth);
app.get('/.well-known/oauth-protected-resource', sinOauth);

app.all('/mcp', authPorHeader, servirMcp);
// Regex en vez de :secreto para que un secreto con "/" no parta la ruta.
app.all(/^\/mcp\/(.+)$/, authPorRuta, servirMcp);

app.listen(PORT, '0.0.0.0', () => {
  console.log(`cotizadorq-mcp escuchando en :${PORT}`);
});
