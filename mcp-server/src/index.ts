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

const rechazar = (res: Response) => {
  res.status(401).json({ error: 'Secreto invalido o ausente' });
};

/** Via 1: Authorization: Bearer <secreto>. */
const authPorHeader = (req: Request, res: Response, next: NextFunction) => {
  const header = req.get('authorization') || '';
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match || !secretoValido(match[1].trim())) return rechazar(res);
  return next();
};

/** Via 2: /mcp/<secreto>, para clientes que no permiten headers. */
const authPorRuta = (req: Request, res: Response, next: NextFunction) => {
  const desdeRuta = String(req.params.secreto || '');
  if (!secretoValido(desdeRuta)) return rechazar(res);
  return next();
};

const handler = createMcpHandler(() => {
  const server = new McpServer({ name: 'cotizadorq', version: '1.0.0' });
  registrarTools(server);
  return server;
});

const app = createMcpExpressApp();
const node = toNodeHandler(handler);

// createMcpExpressApp ya configura express.json(); hay que pasar req.body para
// no volver a consumir el stream.
const servirMcp = (req: Request, res: Response) => void node(req, res, req.body);

app.get('/health', (_req, res) => {
  res.json({ status: 'OK', service: 'cotizadorq-mcp', commit: (process.env.RAILWAY_GIT_COMMIT_SHA || '').slice(0, 7) || null });
});

app.all('/mcp', authPorHeader, servirMcp);
app.all('/mcp/:secreto', authPorRuta, servirMcp);

app.listen(PORT, () => {
  console.log(`cotizadorq-mcp escuchando en :${PORT}`);
});
