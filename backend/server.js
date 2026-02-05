const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { google } = require('googleapis');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Conexión a PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

const SHEETS_TAB_QNAP = process.env.GOOGLE_SHEETS_TAB_QNAP || 'Hoja 1';
const SHEETS_TAB_AXIS = process.env.GOOGLE_SHEETS_TAB_AXIS || 'Hoja 2';
const SHEETS_TAB_STOCK = process.env.GOOGLE_SHEETS_TAB_STOCK || 'Stock';
const SHEETS_SCOPE_READONLY = 'https://www.googleapis.com/auth/spreadsheets.readonly';
const SHEETS_SCOPE_RW = 'https://www.googleapis.com/auth/spreadsheets';
const DEFAULT_ORIGIN = 'QNAP';
const SHEETS_SYNC_HOURS = parseFloat(process.env.GOOGLE_SHEETS_SYNC_HOURS || '12');
const QNAP_CONSTANTS = { INBOUND_FREIGHT: 1.011, IC: 0.95, INT: 0.12 };
const AXIS_CONSTANTS = { INBOUND_FREIGHT: 1.015, IC: 0.97, INT: 0.12 };
const SESSION_TTL_MIN = parseInt(process.env.SESSION_TTL_MIN || '10', 10);
const ADMIN_SESSION_TTL_MIN = parseInt(process.env.ADMIN_SESSION_TTL_MIN || '43200', 10);
const SESSION_TTL_MS = SESSION_TTL_MIN * 60 * 1000;
const ADMIN_SESSION_TTL_MS = ADMIN_SESSION_TTL_MIN * 60 * 1000;
const ADMIN_JWT_EXPIRES_IN = process.env.ADMIN_JWT_EXPIRES_IN || '30d';
const APP_VERSION = process.env.APP_VERSION || '2026-02-05-stock';

const getSessionTtlMsForRole = (role) =>
  (String(role || '').toLowerCase() === 'admin' ? ADMIN_SESSION_TTL_MS : SESSION_TTL_MS);

const COLUMN_MAP = {
  marca: ['marca', 'brand', 'fabricante'],
  sku: ['sku', 'codigo', 'code', 'partnumber'],
  mpn: ['mpn', 'model', 'modelo'],
  desc: ['descripción', 'descripcion', 'description', 'producto', 'nombre'],
  precio: ['pricedisty', 'precio disty', 'preciodisty', 'precio', 'cost', 'price'],
  gp: ['gp', 'margen', 'margin', 'gp (%)', 'gp %'],
  tiempo: ['tiempo', 'entrega', 'leadtime', 'tiempo entrega']
};

const extractSheetId = (value) => {
  if (!value) return null;
  const marker = '/spreadsheets/d/';
  if (value.includes(marker)) {
    return value.split(marker)[1].split('/')[0];
  }
  return value;
};

const getSheetsClient = (readOnly = true) => {
  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  let privateKey = process.env.GOOGLE_PRIVATE_KEY || '';
  privateKey = privateKey.replace(/\\n/g, '\n').trim();
  if ((privateKey.startsWith('"') && privateKey.endsWith('"')) ||
      (privateKey.startsWith("'") && privateKey.endsWith("'"))) {
    privateKey = privateKey.slice(1, -1).trim();
  }
  const hasBegin = privateKey.includes('BEGIN PRIVATE KEY');
  const hasEnd = privateKey.includes('END PRIVATE KEY');
  if (!clientEmail || !privateKey) {
    throw new Error('Faltan credenciales de Google Sheets');
  }
  if (!hasBegin || !hasEnd) {
    throw new Error('GOOGLE_PRIVATE_KEY invalida');
  }
  const auth = new google.auth.JWT(
    clientEmail,
    null,
    privateKey,
    [readOnly ? SHEETS_SCOPE_READONLY : SHEETS_SCOPE_RW]
  );
  return google.sheets({ version: 'v4', auth });
};

const normalizeHeader = (value) => String(value || '').toLowerCase().trim();

const findHeaderIndex = (headers, keys) => {
  for (const key of keys) {
    const idx = headers.findIndex(h => normalizeHeader(h) === normalizeHeader(key));
    if (idx !== -1) return idx;
  }
  return -1;
};

const parseGpValue = (value, fallback = 0.15) => {
  const parsed = parseFloat(value);
  if (Number.isNaN(parsed)) return fallback;
  return parsed > 1 ? parsed / 100 : parsed;
};

const parseNumber = (value, fallback = 0) => {
  const parsed = parseFloat(value);
  return Number.isNaN(parsed) ? fallback : parsed;
};

const formatSheetDate = (value) => {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value === 'number') {
    const excelEpoch = new Date(Date.UTC(1899, 11, 30));
    const ms = Math.round(value) * 86400 * 1000;
    const date = new Date(excelEpoch.getTime() + ms);
    if (Number.isNaN(date.getTime())) return '';
    return date.toISOString().slice(0, 10);
  }
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) return String(value).trim();
  return parsed.toISOString().slice(0, 10);
};

const normalizeLookupKey = (value) => String(value || '').trim().toLowerCase();

const mergePlannedDate = (map, key, dateValue) => {
  if (!key || !dateValue) return;
  const existing = map.get(key);
  if (!existing) {
    map.set(key, dateValue);
    return;
  }
  const existingDate = new Date(existing);
  const nextDate = new Date(dateValue);
  if (!Number.isNaN(existingDate.getTime()) && !Number.isNaN(nextDate.getTime())) {
    if (nextDate < existingDate) map.set(key, dateValue);
  }
};

const addDaysToIso = (isoDate, days) => {
  if (!isoDate) return '';
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return '';
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

const calcularPrecioClienteQnap = (precioDisty, gp = 0.15) => {
  const costoXUS = precioDisty * QNAP_CONSTANTS.INBOUND_FREIGHT;
  const costoFinalXUS = costoXUS / QNAP_CONSTANTS.IC;
  const costoXCL = costoFinalXUS * (1 + QNAP_CONSTANTS.INT);
  return costoXCL / (1 - gp);
};

const getAxisPartnerRebate = (producto, category) => {
  const selected = category || 'Partner Autorizado';
  if (selected === 'Partner Silver') return parseNumber(producto.rebate_partner_silver, 0);
  if (selected === 'Partner Gold') return parseNumber(producto.rebate_partner_gold, 0);
  if (selected === 'Partner Multiregional') return parseNumber(producto.rebate_partner_multiregional, 0);
  return parseNumber(producto.rebate_partner_autorizado, 0);
};

const calcularPrecioClienteAxis = (precioDisty, gp, partnerRebate, projectRebate) => {
  const costoXUS = precioDisty * AXIS_CONSTANTS.INBOUND_FREIGHT;
  const costoFinalXUS = costoXUS / AXIS_CONSTANTS.IC;
  const costoXCL = costoFinalXUS * (1 + AXIS_CONSTANTS.INT);
  const rebateTotal = (partnerRebate || 0) + (projectRebate || 0);
  const costoFinalXCL = Math.max(costoXCL - rebateTotal, 0);
  return costoFinalXCL / (1 - gp);
};

const parseActivoValue = (value) => {
  if (value === undefined || value === null || value === '') return true;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const normalized = String(value).toLowerCase().trim();
  if (['false', 'no', '0', 'inactivo', 'inactive', 'off'].includes(normalized)) return false;
  return true;
};

const getActivoColumnIndex = (origen, headers) => {
  const headerIdx = findHeaderIndex(headers, ['activo', 'active', 'status']);
  if (headerIdx >= 0) return headerIdx;
  return origen === 'AXIS' ? 10 : 7;
};

const getSheetColumnIndexes = (origen, headers) => {
  const idx = {
    marca: findHeaderIndex(headers, COLUMN_MAP.marca),
    sku: findHeaderIndex(headers, COLUMN_MAP.sku),
    mpn: findHeaderIndex(headers, COLUMN_MAP.mpn),
    desc: findHeaderIndex(headers, COLUMN_MAP.desc),
    precio: findHeaderIndex(headers, COLUMN_MAP.precio),
    gp: findHeaderIndex(headers, COLUMN_MAP.gp),
    tiempo: findHeaderIndex(headers, COLUMN_MAP.tiempo),
    activo: getActivoColumnIndex(origen, headers),
    rebate_partner_autorizado: -1,
    rebate_partner_silver: -1,
    rebate_partner_gold: -1,
    rebate_partner_multiregional: -1
  };
  if (origen === 'AXIS') {
    idx.rebate_partner_autorizado = 5;
    idx.rebate_partner_silver = 6;
    idx.rebate_partner_gold = 7;
    idx.rebate_partner_multiregional = 8;
    if (idx.tiempo < 0) idx.tiempo = 9;
  }
  return idx;
};

const getStockColumnIndexes = (headers) => {
  const idxMpn = findHeaderIndex(headers, ['MPN']);
  const idxQty = findHeaderIndex(headers, ['OH Quantity', 'OH Qty', 'OHQ', 'Quantity', 'Qty', 'Stock', 'On Hand']);
  return {
    mpn: idxMpn >= 0 ? idxMpn : 4,
    qty: idxQty >= 0 ? idxQty : 6
  };
};

const toColumnLetter = (index) => {
  let result = '';
  let n = index + 1;
  while (n > 0) {
    const rem = (n - 1) % 26;
    result = String.fromCharCode(65 + rem) + result;
    n = Math.floor((n - 1) / 26);
  }
  return result;
};

const ensureRowLength = (row, length) => {
  const next = Array.isArray(row) ? [...row] : [];
  while (next.length < length) next.push('');
  return next;
};

const applyProductoToRow = (row, producto, idx, activoValue) => {
  const next = Array.isArray(row) ? [...row] : [];
  const setValue = (index, value) => {
    if (index < 0) return;
    next[index] = value === undefined || value === null ? '' : value;
  };
  setValue(idx.marca, producto.marca || '');
  setValue(idx.sku, producto.sku || '');
  setValue(idx.mpn, producto.mpn || '');
  setValue(idx.desc, producto.descripcion || producto.desc || '');
  setValue(idx.precio, producto.precio_disty ?? producto.precio ?? 0);
  setValue(idx.gp, producto.gp ?? 0.15);
  setValue(idx.tiempo, producto.tiempo_entrega || producto.tiempo || '');
  setValue(idx.activo, activoValue);
  if (idx.rebate_partner_autorizado >= 0) {
    setValue(idx.rebate_partner_autorizado, producto.rebate_partner_autorizado ?? 0);
    setValue(idx.rebate_partner_silver, producto.rebate_partner_silver ?? 0);
    setValue(idx.rebate_partner_gold, producto.rebate_partner_gold ?? 0);
    setValue(idx.rebate_partner_multiregional, producto.rebate_partner_multiregional ?? 0);
  }
  const maxIndex = Math.max(...Object.values(idx).filter(v => typeof v === 'number' && v >= 0));
  return ensureRowLength(next, Math.max(next.length, maxIndex + 1));
};

const getSheetIdByName = async (sheets, spreadsheetId, tabName) => {
  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: 'sheets.properties'
  });
  const sheet = (meta.data.sheets || []).find(s => s.properties?.title === tabName);
  return sheet?.properties?.sheetId;
};

const getSheetData = async (sheets, spreadsheetId, tabName, valueRenderOption = 'UNFORMATTED_VALUE') => {
  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: tabName,
    valueRenderOption
  });
  const rows = data.values || [];
  const headers = rows.length > 0 ? rows[0].map(h => String(h || '').trim()) : [];
  return { rows, headers };
};

const findRowIndexByKey = (rows, idx, producto) => {
  const skuValue = String(producto.sku || '').trim().toLowerCase();
  const descValue = String(producto.descripcion || producto.desc || '').trim().toLowerCase();
  if (rows.length <= 1) return -1;
  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i] || [];
    const skuCell = idx.sku >= 0 ? String(row[idx.sku] || '').trim().toLowerCase() : '';
    const descCell = idx.desc >= 0 ? String(row[idx.desc] || '').trim().toLowerCase() : '';
    if (skuValue && skuCell === skuValue) return i + 1;
    if (!skuValue && descValue && descCell === descValue) return i + 1;
  }
  return -1;
};

const writeProductoToSheet = async (origen, producto, action = 'upsert') => {
  const spreadsheetId = extractSheetId(process.env.GOOGLE_SHEETS_ID || process.env.GOOGLE_SHEETS_URL);
  if (!spreadsheetId) throw new Error('GOOGLE_SHEETS_ID no configurado');
  const tabName = origen === 'AXIS' ? SHEETS_TAB_AXIS : SHEETS_TAB_QNAP;
  const sheets = getSheetsClient(false);
  const { rows, headers } = await getSheetData(sheets, spreadsheetId, tabName);
  const idx = getSheetColumnIndexes(origen, headers);
  const rowIndex = findRowIndexByKey(rows, idx, producto);

  if (action === 'delete') {
    if (rowIndex <= 1) return;
    const sheetId = await getSheetIdByName(sheets, spreadsheetId, tabName);
    if (sheetId === undefined || sheetId === null) {
      throw new Error('No se encontro la hoja en Google Sheets');
    }
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            deleteDimension: {
              range: {
                sheetId,
                dimension: 'ROWS',
                startIndex: rowIndex - 1,
                endIndex: rowIndex
              }
            }
          }
        ]
      }
    });
    return;
  }

  const existingRow = rowIndex > 1 ? rows[rowIndex - 1] : [];
  const rowValues = applyProductoToRow(existingRow, producto, idx, true);
  const endCol = toColumnLetter(rowValues.length - 1);
  if (rowIndex > 1) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${tabName}!A${rowIndex}:${endCol}${rowIndex}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [rowValues] }
    });
  } else {
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: tabName,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [rowValues] }
    });
  }
};

const syncProductosFromSheet = async (options = {}) => {
  const sheetId = extractSheetId(process.env.GOOGLE_SHEETS_ID || process.env.GOOGLE_SHEETS_URL);
  if (!sheetId) {
    return { skipped: true, reason: 'GOOGLE_SHEETS_ID no configurado' };
  }
  const origen = options.origen || DEFAULT_ORIGIN;
  const tabName = options.tab || (origen === 'AXIS' ? SHEETS_TAB_AXIS : SHEETS_TAB_QNAP);
  const sheets = getSheetsClient();
  const { rows, headers } = await getSheetData(sheets, sheetId, tabName);
  if (rows.length <= 1) {
    await pool.query('UPDATE productos SET activo = false WHERE origen = $1', [origen]);
    return { inserted: 0, updated: 0, skipped: rows.length, total: rows.length };
  }

  const idx = getSheetColumnIndexes(origen, headers);

  const client = await pool.connect();
  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  try {
    await client.query('BEGIN');
    await client.query('UPDATE productos SET activo = false WHERE origen = $1', [origen]);
    for (let i = 1; i < rows.length; i += 1) {
      const row = rows[i] || [];
      const sku = idx.sku >= 0 ? String(row[idx.sku] || '').trim() : '';
      const descripcion = idx.desc >= 0 ? String(row[idx.desc] || '').trim() : '';
      if (!sku && !descripcion) {
        skipped += 1;
        continue;
      }
      const axisTiempoEntrega = origen === 'AXIS' ? String(row[9] || '').trim() : '';
      const activo = parseActivoValue(idx.activo >= 0 ? row[idx.activo] : true);
      const producto = {
        origen,
        marca: idx.marca >= 0 ? String(row[idx.marca] || '').trim() : '',
        rebate_partner_autorizado: origen === 'AXIS' ? parseNumber(row.length > 5 ? row[5] : 0, 0) : 0,
        rebate_partner_silver: origen === 'AXIS' ? parseNumber(row.length > 6 ? row[6] : 0, 0) : 0,
        rebate_partner_gold: origen === 'AXIS' ? parseNumber(row.length > 7 ? row[7] : 0, 0) : 0,
        rebate_partner_multiregional: origen === 'AXIS' ? parseNumber(row.length > 8 ? row[8] : 0, 0) : 0,
        sku,
        mpn: idx.mpn >= 0 ? String(row[idx.mpn] || '').trim() : '',
        descripcion,
        precio_disty: parseNumber(idx.precio >= 0 ? row[idx.precio] : 0, 0),
        gp: parseGpValue(idx.gp >= 0 ? row[idx.gp] : 0, 0.15),
        tiempo_entrega: axisTiempoEntrega || (idx.tiempo >= 0 ? String(row[idx.tiempo] || '').trim() : '') || 'ETA por confirmar',
        activo
      };

      const existing = await client.query(
        'SELECT id FROM productos WHERE origen = $1 AND ((sku = $2 AND $2 <> \'\') OR ($2 = \'\' AND descripcion = $3)) ORDER BY id DESC LIMIT 1',
        [producto.origen, producto.sku, producto.descripcion]
      );
      if (existing.rows.length > 0) {
        await client.query(
          `UPDATE productos
           SET origen = $1, marca = $2, sku = $3, mpn = $4, descripcion = $5, precio_disty = $6, gp = $7, rebate_partner_autorizado = $8, rebate_partner_silver = $9, rebate_partner_gold = $10, rebate_partner_multiregional = $11, tiempo_entrega = $12, activo = $13, updated_at = CURRENT_TIMESTAMP
           WHERE id = $14`,
          [producto.origen, producto.marca, producto.sku, producto.mpn, producto.descripcion, producto.precio_disty, producto.gp, producto.rebate_partner_autorizado, producto.rebate_partner_silver, producto.rebate_partner_gold, producto.rebate_partner_multiregional, producto.tiempo_entrega, producto.activo, existing.rows[0].id]
        );
        updated += 1;
      } else {
        await client.query(
          `INSERT INTO productos (origen, marca, sku, mpn, descripcion, precio_disty, gp, rebate_partner_autorizado, rebate_partner_silver, rebate_partner_gold, rebate_partner_multiregional, tiempo_entrega, activo)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
          [producto.origen, producto.marca, producto.sku, producto.mpn, producto.descripcion, producto.precio_disty, producto.gp, producto.rebate_partner_autorizado, producto.rebate_partner_silver, producto.rebate_partner_gold, producto.rebate_partner_multiregional, producto.tiempo_entrega, producto.activo]
        );
        inserted += 1;
      }
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  return { inserted, updated, skipped, total: rows.length - 1 };
};

const startSheetsSyncJob = () => {
  if (!Number.isFinite(SHEETS_SYNC_HOURS) || SHEETS_SYNC_HOURS <= 0) return;
  const intervalMs = SHEETS_SYNC_HOURS * 60 * 60 * 1000;
  setInterval(async () => {
    try {
      const qnap = await syncProductosFromSheet({ origen: 'QNAP' });
      const axis = await syncProductosFromSheet({ origen: 'AXIS' });
      if (!qnap?.skipped) {
        console.log(`Sync QNAP OK: ${qnap.inserted} nuevos, ${qnap.updated} actualizados, ${qnap.skipped} omitidos`);
      }
      if (!axis?.skipped) {
        console.log(`Sync AXIS OK: ${axis.inserted} nuevos, ${axis.updated} actualizados, ${axis.skipped} omitidos`);
      }
    } catch (error) {
      console.error('Error en sync de Google Sheets:', error);
    }
  }, intervalMs);
};

// Inicializar base de datos
const initDB = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS usuarios (
        id SERIAL PRIMARY KEY,
        usuario VARCHAR(50) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        nombre VARCHAR(100),
        empresa VARCHAR(150),
        logo_url TEXT,
        role VARCHAR(20) DEFAULT 'client',
        gp DECIMAL(5,4) DEFAULT 0.15,
        gp_qnap DECIMAL(5,4) DEFAULT 0.15,
        gp_axis DECIMAL(5,4) DEFAULT 0.15,
        partner_category VARCHAR(50) DEFAULT 'Partner Autorizado',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS productos (
        id SERIAL PRIMARY KEY,
        origen VARCHAR(50) DEFAULT 'QNAP',
        marca VARCHAR(100),
        sku VARCHAR(100),
        mpn VARCHAR(100),
        descripcion TEXT,
        precio_disty DECIMAL(12,2) DEFAULT 0,
        gp DECIMAL(5,4) DEFAULT 0.15,
        rebate_partner_autorizado DECIMAL(12,2) DEFAULT 0,
        rebate_partner_silver DECIMAL(12,2) DEFAULT 0,
        rebate_partner_gold DECIMAL(12,2) DEFAULT 0,
        rebate_partner_multiregional DECIMAL(12,2) DEFAULT 0,
        tiempo_entrega VARCHAR(50) DEFAULT 'ETA por confirmar',
        activo BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS cotizaciones (
        id SERIAL PRIMARY KEY,
        cliente_nombre VARCHAR(100),
        cliente_empresa VARCHAR(100),
        cliente_email VARCHAR(100),
        cliente_telefono VARCHAR(50),
        total DECIMAL(12,2),
        cliente_final VARCHAR(150),
        fecha_ejecucion DATE,
        fecha_implementacion DATE,
        vms VARCHAR(100),
        usuario_id INTEGER REFERENCES usuarios(id),
        usuario VARCHAR(50),
        estado VARCHAR(20) DEFAULT 'revision',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS cotizacion_items (
        id SERIAL PRIMARY KEY,
        cotizacion_id INTEGER REFERENCES cotizaciones(id) ON DELETE CASCADE,
        producto_id INTEGER REFERENCES productos(id),
        marca VARCHAR(100),
        sku VARCHAR(100),
        mpn VARCHAR(100),
        descripcion TEXT,
        precio_disty DECIMAL(12,2),
        gp DECIMAL(5,4),
        cantidad INTEGER DEFAULT 1,
        precio_unitario DECIMAL(12,2),
        precio_total DECIMAL(12,2),
        tiempo_entrega VARCHAR(50)
      );

      CREATE TABLE IF NOT EXISTS sesiones (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE,
        session_id VARCHAR(120) NOT NULL,
        device_id VARCHAR(120),
        ip_address VARCHAR(80),
        user_agent TEXT,
        started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        revoked BOOLEAN DEFAULT false
      );

      CREATE TABLE IF NOT EXISTS login_logs (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
        usuario VARCHAR(50),
        success BOOLEAN DEFAULT false,
        ip_address VARCHAR(80),
        user_agent TEXT,
        device_id VARCHAR(120),
        session_id VARCHAR(120),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS bo_meta (
        id SERIAL PRIMARY KEY,
        bo VARCHAR(100) UNIQUE NOT NULL,
        project_name TEXT,
        po_axis TEXT,
        estimated_invoice_date DATE,
        s_and_d_status VARCHAR(20),
        invoiced BOOLEAN DEFAULT false,
        invoiced_at TIMESTAMP,
        customer_name TEXT,
        alloc_pct DECIMAL(12,4),
        customer_po TEXT,
        last_seen_at TIMESTAMP,
        purchase_status VARCHAR(20),
        purchase_dispatch VARCHAR(20),
        purchase_shipping VARCHAR(20),
        purchase_so TEXT,
        deleted BOOLEAN DEFAULT false,
        deleted_at TIMESTAMP,
        deleted_comment TEXT,
        deleted_by INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS bo_deleted_logs (
        id SERIAL PRIMARY KEY,
        bo VARCHAR(100) NOT NULL,
        deleted_by INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
        deleted_by_usuario VARCHAR(50),
        comment TEXT,
        snapshot JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await pool.query(`ALTER TABLE productos ADD COLUMN IF NOT EXISTS origen VARCHAR(50) DEFAULT 'QNAP';`);
    await pool.query(`ALTER TABLE productos ADD COLUMN IF NOT EXISTS rebate_partner_autorizado DECIMAL(12,2) DEFAULT 0;`);
    await pool.query(`ALTER TABLE productos ADD COLUMN IF NOT EXISTS rebate_partner_silver DECIMAL(12,2) DEFAULT 0;`);
    await pool.query(`ALTER TABLE productos ADD COLUMN IF NOT EXISTS rebate_partner_gold DECIMAL(12,2) DEFAULT 0;`);
    await pool.query(`ALTER TABLE productos ADD COLUMN IF NOT EXISTS rebate_partner_multiregional DECIMAL(12,2) DEFAULT 0;`);
    await pool.query(`ALTER TABLE productos ADD COLUMN IF NOT EXISTS activo BOOLEAN DEFAULT true;`);
    await pool.query(`UPDATE productos SET origen = 'QNAP' WHERE origen IS NULL;`);
    await pool.query(`UPDATE productos SET activo = true WHERE activo IS NULL;`);

    await pool.query(`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS role VARCHAR(20) DEFAULT 'client';`);
    await pool.query(`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS empresa VARCHAR(150);`);
    await pool.query(`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS logo_url TEXT;`);

    await pool.query(`ALTER TABLE bo_meta ADD COLUMN IF NOT EXISTS project_name TEXT;`);
    await pool.query(`ALTER TABLE bo_meta ADD COLUMN IF NOT EXISTS po_axis TEXT;`);
    await pool.query(`ALTER TABLE bo_meta ADD COLUMN IF NOT EXISTS estimated_invoice_date DATE;`);
    await pool.query(`ALTER TABLE bo_meta ADD COLUMN IF NOT EXISTS s_and_d_status VARCHAR(20);`);
    await pool.query(`ALTER TABLE bo_meta ADD COLUMN IF NOT EXISTS invoiced BOOLEAN DEFAULT false;`);
    await pool.query(`ALTER TABLE bo_meta ADD COLUMN IF NOT EXISTS invoiced_at TIMESTAMP;`);
    await pool.query(`ALTER TABLE bo_meta ADD COLUMN IF NOT EXISTS customer_name TEXT;`);
    await pool.query(`ALTER TABLE bo_meta ADD COLUMN IF NOT EXISTS alloc_pct DECIMAL(12,4);`);
    await pool.query(`ALTER TABLE bo_meta ADD COLUMN IF NOT EXISTS customer_po TEXT;`);
    await pool.query(`ALTER TABLE bo_meta ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMP;`);
    await pool.query(`ALTER TABLE bo_meta ADD COLUMN IF NOT EXISTS purchase_status VARCHAR(20);`);
    await pool.query(`ALTER TABLE bo_meta ADD COLUMN IF NOT EXISTS purchase_dispatch VARCHAR(20);`);
    await pool.query(`ALTER TABLE bo_meta ADD COLUMN IF NOT EXISTS purchase_shipping VARCHAR(20);`);
    await pool.query(`ALTER TABLE bo_meta ADD COLUMN IF NOT EXISTS purchase_so TEXT;`);
    await pool.query(`ALTER TABLE bo_meta ADD COLUMN IF NOT EXISTS deleted BOOLEAN DEFAULT false;`);
    await pool.query(`ALTER TABLE bo_meta ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;`);
    await pool.query(`ALTER TABLE bo_meta ADD COLUMN IF NOT EXISTS deleted_comment TEXT;`);
    await pool.query(`ALTER TABLE bo_meta ADD COLUMN IF NOT EXISTS deleted_by INTEGER REFERENCES usuarios(id) ON DELETE SET NULL;`);
    await pool.query(`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS gp DECIMAL(5,4) DEFAULT 0.15;`);
    await pool.query(`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS gp_qnap DECIMAL(5,4) DEFAULT 0.15;`);
    await pool.query(`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS gp_axis DECIMAL(5,4) DEFAULT 0.15;`);
    await pool.query(`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS partner_category VARCHAR(50) DEFAULT 'Partner Autorizado';`);

    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS sesiones_user_session_idx ON sesiones(user_id, session_id);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS sesiones_active_idx ON sesiones(user_id, revoked, last_seen);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS login_logs_user_idx ON login_logs(user_id, created_at);`);
    await pool.query(`UPDATE usuarios SET gp_qnap = gp WHERE gp_qnap IS NULL;`);
    await pool.query(`UPDATE usuarios SET gp_axis = gp WHERE gp_axis IS NULL;`);

    await pool.query(`ALTER TABLE cotizaciones ALTER COLUMN estado SET DEFAULT 'revision';`);
    await pool.query(`ALTER TABLE cotizaciones ADD COLUMN IF NOT EXISTS cliente_final VARCHAR(150);`);
    await pool.query(`ALTER TABLE cotizaciones ADD COLUMN IF NOT EXISTS fecha_ejecucion DATE;`);
    await pool.query(`ALTER TABLE cotizaciones ADD COLUMN IF NOT EXISTS fecha_implementacion DATE;`);
    await pool.query(`ALTER TABLE cotizaciones ADD COLUMN IF NOT EXISTS vms VARCHAR(100);`);
    await pool.query(`ALTER TABLE cotizaciones ADD COLUMN IF NOT EXISTS usuario_id INTEGER REFERENCES usuarios(id);`);
    await pool.query(`ALTER TABLE cotizaciones ADD COLUMN IF NOT EXISTS usuario VARCHAR(50);`);

    // Crear usuario admin por defecto si no existe
    const userExists = await pool.query('SELECT * FROM usuarios WHERE usuario = $1', ['Agonz']);
    if (userExists.rows.length === 0) {
      const hashedPassword = await bcrypt.hash('Test2026!', 10);
      await pool.query(
        'INSERT INTO usuarios (usuario, password, nombre, role) VALUES ($1, $2, $3, $4)',
        ['Agonz', hashedPassword, 'Administrador', 'admin']
      );
      console.log('Usuario admin creado');
    }

    await pool.query("UPDATE usuarios SET role = 'admin' WHERE usuario = 'Agonz' AND (role IS NULL OR role <> 'admin');");

    console.log('Base de datos inicializada correctamente');
  } catch (error) {
    console.error('Error inicializando DB:', error);
  }
};


const getRequestIp = (req) => {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  return req.ip;
};

const getSessionHeaders = (req) => ({
  sessionId: req.headers['x-session-id'] || req.headers['x-sessionid'],
  deviceId: req.headers['x-device-id'] || req.headers['x-deviceid']
});

const recordLoginAttempt = async ({ userId, usuario, success, req, sessionId, deviceId }) => {
  try {
    const ip = getRequestIp(req);
    const userAgent = req.headers['user-agent'] || '';
    await pool.query(
      `INSERT INTO login_logs (user_id, usuario, success, ip_address, user_agent, device_id, session_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [userId || null, usuario || null, Boolean(success), ip || null, userAgent || null, deviceId || null, sessionId || null]
    );
  } catch (error) {
    console.error('Error registrando login:', error);
  }
};

const upsertSession = async (user, req) => {
  const { sessionId, deviceId } = getSessionHeaders(req);
  if (!sessionId) return { sessionId: null, revokedSessions: [] };
  const ip = getRequestIp(req);
  const userAgent = req.headers['user-agent'] || '';
  const ttlDate = new Date(Date.now() - getSessionTtlMsForRole(user?.role));
  const limit = user?.role === 'admin' ? 2 : 1;

  await pool.query('DELETE FROM sesiones WHERE user_id = $1 AND last_seen < $2', [user.id, ttlDate]);

  const existing = await pool.query(
    'SELECT id FROM sesiones WHERE user_id = $1 AND session_id = $2',
    [user.id, sessionId]
  );
  if (existing.rows.length > 0) {
    await pool.query(
      `UPDATE sesiones
       SET device_id = $1, ip_address = $2, user_agent = $3, last_seen = CURRENT_TIMESTAMP, revoked = false
       WHERE id = $4`,
      [deviceId || null, ip || null, userAgent || null, existing.rows[0].id]
    );
    return { sessionId, revokedSessions: [] };
  }

  const active = await pool.query(
    `SELECT id, session_id, last_seen
     FROM sesiones
     WHERE user_id = $1 AND revoked = false AND last_seen >= $2
     ORDER BY last_seen ASC`,
    [user.id, ttlDate]
  );
  const revokedSessions = [];
  const rows = active.rows || [];
  while (rows.length >= limit) {
    const oldest = rows.shift();
    revokedSessions.push(oldest.session_id);
    await pool.query('UPDATE sesiones SET revoked = true WHERE id = $1', [oldest.id]);
  }

  await pool.query(
    `INSERT INTO sesiones (user_id, session_id, device_id, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5)`,
    [user.id, sessionId, deviceId || null, ip || null, userAgent || null]
  );

  return { sessionId, revokedSessions };
};

const validateSession = async (userId, sessionId, req, role) => {
  if (!sessionId) return { ok: false, reason: 'Sesion requerida' };
  const ttlDate = new Date(Date.now() - getSessionTtlMsForRole(role));
  const result = await pool.query(
    'SELECT id, revoked, last_seen, device_id FROM sesiones WHERE user_id = $1 AND session_id = $2',
    [userId, sessionId]
  );
  if (result.rows.length === 0) {
    return { ok: false, reason: 'missing' };
  }
  const session = result.rows[0];
  const lastSeen = session.last_seen ? new Date(session.last_seen) : null;
  if (session.revoked) return { ok: false, reason: 'Sesion revocada' };
  if (!lastSeen || lastSeen.getTime() < ttlDate.getTime()) {
    return { ok: false, reason: 'Sesion expirada' };
  }
  const ip = getRequestIp(req);
  const userAgent = req.headers['user-agent'] || '';
  const { deviceId } = getSessionHeaders(req);
  await pool.query(
    `UPDATE sesiones
     SET last_seen = CURRENT_TIMESTAMP,
         ip_address = COALESCE($2, ip_address),
         user_agent = COALESCE($3, user_agent),
         device_id = COALESCE($4, device_id)
     WHERE id = $1`,
    [session.id, ip || null, userAgent || null, deviceId || session.device_id || null]
  );
  return { ok: true };
};

// Middleware de autenticación
const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.status(401).json({ error: 'Token requerido' });

  try {
    const user = jwt.verify(token, process.env.JWT_SECRET || 'secreto_super_seguro_2024');
    req.user = user;
    const { sessionId } = getSessionHeaders(req);
    const validation = await validateSession(user.id, sessionId, req, user.role);
    if (!validation.ok) {
      if (validation.reason === 'missing') {
        await upsertSession({ id: user.id, role: user.role }, req);
      } else {
        return res.status(401).json({ error: validation.reason || 'Sesion invalida' });
      }
    }
    next();
  } catch (error) {
    return res.status(403).json({ error: 'Token inv??lido' });
  }
};

const requireAdmin = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(403).json({ error: 'Permiso denegado' });
    const result = await pool.query('SELECT role FROM usuarios WHERE id = $1', [userId]);
    if (result.rows.length === 0 || result.rows[0].role !== 'admin') {
      return res.status(403).json({ error: 'Permiso denegado' });
    }
    next();
  } catch (error) {
    console.error('Error validando admin:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
};
// ==================== RUTAS ====================

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'OK', message: 'API Cotizador funcionando', version: APP_VERSION });
});

// LOGIN
app.post('/api/login', async (req, res) => {
  try {
    const { usuario, password } = req.body;
    const { sessionId, deviceId } = getSessionHeaders(req);

    const result = await pool.query('SELECT * FROM usuarios WHERE usuario = $1', [usuario]);

    if (result.rows.length === 0) {
      await recordLoginAttempt({ userId: null, usuario, success: false, req, sessionId, deviceId });
      return res.status(401).json({ error: 'Usuario o contrase??a incorrectos' });
    }

    const user = result.rows[0];
    const validPassword = await bcrypt.compare(password, user.password);

    if (!validPassword) {
      await recordLoginAttempt({ userId: user.id, usuario: user.usuario, success: false, req, sessionId, deviceId });
      return res.status(401).json({ error: 'Usuario o contrase??a incorrectos' });
    }

    const sessionInfo = await upsertSession(user, req);
    await recordLoginAttempt({ userId: user.id, usuario: user.usuario, success: true, req, sessionId: sessionInfo.sessionId || sessionId, deviceId });

    const token = jwt.sign(
      {
        id: user.id,
        usuario: user.usuario,
        empresa: user.empresa || '',
        role: user.role,
        partner_category: user.partner_category
      },
      process.env.JWT_SECRET || 'secreto_super_seguro_2024',
      { expiresIn: (user.role === 'admin' ? ADMIN_JWT_EXPIRES_IN : '24h') }
    );

    res.json({
      token,
      user: {
        id: user.id,
        usuario: user.usuario,
        nombre: user.nombre,
        empresa: user.empresa || '',
        logo_url: user.logo_url || '',
        role: user.role,
        partner_category: user.partner_category
      },
      session: {
        session_id: sessionInfo.sessionId,
        revoked_sessions: sessionInfo.revokedSessions || []
      }
    });
  } catch (error) {
    console.error('Error en login:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// LOGOUT
app.post('/api/logout', authenticateToken, async (req, res) => {
  try {
    const { sessionId } = getSessionHeaders(req);
    if (!sessionId) return res.status(400).json({ error: 'Sesion requerida' });
    await pool.query('UPDATE sesiones SET revoked = true WHERE user_id = $1 AND session_id = $2', [req.user.id, sessionId]);
    res.json({ ok: true });
  } catch (error) {
    console.error('Error cerrando sesi?n:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// SESIONES - Listar activas (admin)
app.get('/api/sessions', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT s.session_id, s.device_id, s.ip_address, s.user_agent, s.started_at, s.last_seen,
              u.id AS user_id, u.usuario, u.nombre, u.empresa, u.role
       FROM sesiones s
       JOIN usuarios u ON u.id = s.user_id
       WHERE s.revoked = false
         AND s.last_seen >= (
           CASE
             WHEN u.role = 'admin' THEN NOW() - ($1 || ' minutes')::interval
             ELSE NOW() - ($2 || ' minutes')::interval
           END
         )
       ORDER BY s.last_seen DESC`,
      [ADMIN_SESSION_TTL_MIN, SESSION_TTL_MIN]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error obteniendo sesiones:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// SESIONES - Listar por usuario (admin)
app.get('/api/usuarios/:id/sessions', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const userId = req.params.id;
    const result = await pool.query(
      `SELECT session_id, device_id, ip_address, user_agent, started_at, last_seen, revoked,
              CASE
                WHEN revoked = false AND last_seen >= (
                  CASE
                    WHEN u.role = 'admin' THEN NOW() - ($2 || ' minutes')::interval
                    ELSE NOW() - ($3 || ' minutes')::interval
                  END
                ) THEN true ELSE false
              END AS active
       FROM sesiones s
       JOIN usuarios u ON u.id = s.user_id
       WHERE s.user_id = $1
       ORDER BY last_seen DESC`,
      [userId, ADMIN_SESSION_TTL_MIN, SESSION_TTL_MIN]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error obteniendo sesiones del usuario:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// LOGS - Listar logs de login por usuario (admin)
app.get('/api/usuarios/:id/login-logs', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const userId = req.params.id;
    const limitRaw = parseInt(req.query.limit || '100', 10);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 500) : 100;
    const result = await pool.query(
      `SELECT id, usuario, success, ip_address, user_agent, device_id, session_id, created_at
       FROM login_logs
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [userId, limit]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error obteniendo logs:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// SESIONES - Revocar sesi??n (admin)
app.post('/api/sessions/:sessionId/revoke', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const result = await pool.query('UPDATE sesiones SET revoked = true WHERE session_id = $1 RETURNING session_id', [sessionId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Sesion no encontrada' });
    }
    res.json({ ok: true, session_id: result.rows[0].session_id });
  } catch (error) {
    console.error('Error revocando sesi?n:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});


// USUARIOS - Listar
app.get('/api/usuarios', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query('SELECT id, usuario, nombre, empresa, logo_url, role, gp, gp_qnap, gp_axis, partner_category, created_at FROM usuarios ORDER BY id DESC');
    res.json(result.rows);
  } catch (error) {
    console.error('Error obteniendo usuarios:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// USUARIOS - Crear
app.post('/api/usuarios', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { usuario, password, nombre, empresa, logo_url, role, gp, gp_qnap, gp_axis, partner_category } = req.body;
    if (!usuario || !password) {
      return res.status(400).json({ error: 'Usuario y contrasena son requeridos' });
    }
    const exists = await pool.query('SELECT id FROM usuarios WHERE usuario = $1', [usuario]);
    if (exists.rows.length > 0) {
      return res.status(400).json({ error: 'Usuario ya existe' });
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    const gpValue = parseGpValue(gp ?? 0.15, 0.15);
    const gpQnapValue = parseGpValue(gp_qnap ?? gpValue, gpValue);
    const gpAxisValue = parseGpValue(gp_axis ?? gpValue, gpValue);
    const result = await pool.query(
      'INSERT INTO usuarios (usuario, password, nombre, empresa, logo_url, role, gp, gp_qnap, gp_axis, partner_category) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id, usuario, nombre, empresa, logo_url, role, gp, gp_qnap, gp_axis, partner_category, created_at',
      [usuario, hashedPassword, nombre || '', empresa || '', logo_url || '', role || 'client', gpValue, gpQnapValue, gpAxisValue, partner_category || 'Partner Autorizado']
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creando usuario:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// USUARIOS - Actualizar datos
app.put('/api/usuarios/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { usuario, nombre, empresa, logo_url, role, gp, gp_qnap, gp_axis, partner_category } = req.body;
    const gpValue = parseGpValue(gp ?? 0.15, 0.15);
    const gpQnapValue = parseGpValue(gp_qnap ?? gpValue, gpValue);
    const gpAxisValue = parseGpValue(gp_axis ?? gpValue, gpValue);
    const result = await pool.query(
      `UPDATE usuarios
       SET usuario = COALESCE($1, usuario),
           nombre = COALESCE($2, nombre),
           empresa = COALESCE($3, empresa),
           logo_url = COALESCE($4, logo_url),
           role = COALESCE($5, role),
           gp = COALESCE($6, gp),
           gp_qnap = COALESCE($7, gp_qnap),
           gp_axis = COALESCE($8, gp_axis),
           partner_category = COALESCE($9, partner_category)
       WHERE id = $10
       RETURNING id, usuario, nombre, empresa, logo_url, role, gp, gp_qnap, gp_axis, partner_category, created_at`,
      [usuario, nombre, empresa, logo_url, role, gpValue, gpQnapValue, gpAxisValue, partner_category, id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error actualizando usuario:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// USUARIOS - Resetear contrasena
app.patch('/api/usuarios/me/password', authenticateToken, async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(403).json({ error: 'Permiso denegado' });
    const { password } = req.body;
    if (!password) return res.status(400).json({ error: 'Contraseña requerida' });
    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await pool.query('UPDATE usuarios SET password = $1 WHERE id = $2 RETURNING id', [hashedPassword, userId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }
    res.json({ ok: true });
  } catch (error) {
    console.error('Error actualizando contraseña propia:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

app.patch('/api/usuarios/:id/password', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { password } = req.body;
    if (!password) return res.status(400).json({ error: 'Contrase�a requerida' });
    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await pool.query('UPDATE usuarios SET password = $1 WHERE id = $2 RETURNING id', [hashedPassword, id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }
    res.json({ message: 'Contrase�a actualizada' });
  } catch (error) {
    console.error('Error actualizando contrase�a:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// USUARIOS - Eliminar
app.delete('/api/usuarios/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('DELETE FROM usuarios WHERE id = $1 RETURNING id', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }
    res.json({ message: 'Usuario eliminado' });
  } catch (error) {
    console.error('Error eliminando usuario:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// SHEETS - Listar pesta?as (admin)
app.get('/api/sheets/tabs', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const spreadsheetId = extractSheetId(process.env.GOOGLE_SHEETS_ID || process.env.GOOGLE_SHEETS_URL);
    if (!spreadsheetId) return res.status(400).json({ error: 'GOOGLE_SHEETS_ID no configurado' });
    const sheets = getSheetsClient(true);
    const meta = await sheets.spreadsheets.get({
      spreadsheetId,
      fields: 'sheets.properties'
    });
    const tabs = (meta.data.sheets || []).map(s => ({
      id: s.properties?.sheetId,
      title: s.properties?.title
    })).filter(t => t.title);
    res.json({ spreadsheetId, tabs });
  } catch (error) {
    console.error('Error listando pesta?as:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});


// SHEETS - Analizar hojas (admin)
app.get('/api/sheets/analyze', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const spreadsheetId = extractSheetId(process.env.GOOGLE_SHEETS_ID || process.env.GOOGLE_SHEETS_URL);
    if (!spreadsheetId) return res.status(400).json({ error: 'GOOGLE_SHEETS_ID no configurado' });

    const tabsParam = (req.query.tabs || '').trim();
    const tabs = tabsParam ? tabsParam.split(',').map(t => t.trim()).filter(Boolean) : [];
    if (tabs.length === 0) return res.status(400).json({ error: 'Debe indicar tabs=OSO,OPO,OOR' });

    const sheets = getSheetsClient(true);

    
    const ANALYSIS_TAB_MAP = {
      OSO: {
        sku: ['Central SKU'],
        desc: ['Product Name Trax'],
        mpn: ['MPN'],
        precio: [],
        bo: ['Trans No']
      },
      OOR: {
        sku: ['Sales Part'],
        desc: ['Sales Part Description'],
        mpn: ["Customer's Part No"],
        precio: ['Base Sale Unit Price'],
        bo: ['Order No']
      }
    };

    const analyzeTab = async (tabName, options = {}) => {
      const { rows, headers } = await getSheetData(sheets, spreadsheetId, tabName);
      const custom = ANALYSIS_TAB_MAP[tabName] || {};
      const idxSku = findHeaderIndex(headers, custom.sku || COLUMN_MAP.sku);
      const idxDesc = findHeaderIndex(headers, custom.desc || COLUMN_MAP.desc);
      const idxPrice = findHeaderIndex(headers, custom.precio || COLUMN_MAP.precio);
      const idxActivo = findHeaderIndex(headers, ['activo', 'active']);
      const idxBo = findHeaderIndex(headers, custom.bo || []);

      const totalRows = Math.max(rows.length - 1, 0);
      let dataRows = 0;
      let missingSku = 0;
      let missingDesc = 0;
      let activeCount = 0;
      let inactiveCount = 0;
      let priceCount = 0;
      let priceSum = 0;
      let priceMin = null;
      let priceMax = null;
      let boMissing = 0;
      let boCount = 0;
      const skuMap = new Map();

      for (let i = 1; i < rows.length; i += 1) {
        const row = rows[i] || [];
        const sku = idxSku >= 0 ? String(row[idxSku] || '').trim() : '';
        const desc = idxDesc >= 0 ? String(row[idxDesc] || '').trim() : '';
        const bo = idxBo >= 0 ? String(row[idxBo] || '').trim() : '';
        if (options.boSet && options.boSet.size > 0) {
          if (!bo || !options.boSet.has(bo.toLowerCase())) {
            options.excludedByBo += 1;
            continue;
          }
        }
        if (!sku && !desc) continue;
        if (idxBo >= 0) {
          if (!bo) boMissing += 1;
          else boCount += 1;
        }
        dataRows += 1;
        if (!sku) missingSku += 1;
        if (!desc) missingDesc += 1;

        if (sku) {
          const key = sku.toLowerCase();
          skuMap.set(key, (skuMap.get(key) || 0) + 1);
        }

        if (idxActivo >= 0) {
          const value = row[idxActivo];
          if (parseActivoValue(value)) activeCount += 1;
          else inactiveCount += 1;
        }

        if (idxPrice >= 0) {
          const price = parseNumber(row[idxPrice], NaN);
          if (!Number.isNaN(price)) {
            priceCount += 1;
            priceSum += price;
            priceMin = priceMin === null ? price : Math.min(priceMin, price);
            priceMax = priceMax === null ? price : Math.max(priceMax, price);
          }
        }
      }

      let duplicates = 0;
      skuMap.forEach((count) => {
        if (count > 1) duplicates += (count - 1);
      });

      return {
        tab: tabName,
        totalRows,
        dataRows,
        missingSku,
        missingDesc,
        duplicateSkuCount: duplicates,
        price: {
          count: priceCount,
          avg: priceCount ? Number((priceSum / priceCount).toFixed(2)) : 0,
          min: priceMin ?? 0,
          max: priceMax ?? 0
        },
        bo: idxBo >= 0 ? { count: boCount, missing: boMissing, excludedByBo: options.excludedByBo || 0 } : null,
        activo: idxActivo >= 0 ? { active: activeCount, inactive: inactiveCount } : null,
        columns: {
          hasSku: idxSku >= 0,
          hasDesc: idxDesc >= 0,
          hasPrecio: idxPrice >= 0,
          hasActivo: idxActivo >= 0,
          hasBo: idxBo >= 0
        }
      };
    };

    const results = [];
    let boSet = null;
    const needsOor = tabs.includes('OOR');
    if (needsOor) {
      try {
        const osoResult = await analyzeTab('OSO', { excludedByBo: 0 });
        results.push(osoResult);
        const { rows, headers } = await getSheetData(sheets, spreadsheetId, 'OSO');
        const idxBoOso = findHeaderIndex(headers, (ANALYSIS_TAB_MAP.OSO?.bo || ['Trans No']));
        boSet = new Set();
        for (let i = 1; i < rows.length; i += 1) {
          const row = rows[i] || [];
          const bo = idxBoOso >= 0 ? String(row[idxBoOso] || '').trim() : '';
          if (bo) boSet.add(bo.toLowerCase());
        }
      } catch (error) {
        results.push({ tab: 'OSO', error: error.message || 'Error analizando hoja' });
      }
    }

    for (const tabName of tabs) {
      if (tabName === 'OSO' && needsOor) continue;
      try {
        const options = { boSet: tabName === 'OOR' ? boSet : null, excludedByBo: 0 };
        results.push(await analyzeTab(tabName, options));
      } catch (error) {
        results.push({ tab: tabName, error: error.message || 'Error analizando hoja' });
      }
    }

    res.json({ spreadsheetId, results });
  } catch (error) {
    console.error('Error analizando hojas:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});


// OSO - Ordenes activas (admin)
app.get('/api/oso/orders', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const spreadsheetId = extractSheetId(process.env.GOOGLE_SHEETS_ID || process.env.GOOGLE_SHEETS_URL);
    if (!spreadsheetId) return res.status(400).json({ error: 'GOOGLE_SHEETS_ID no configurado' });

    const sheets = getSheetsClient(true);
    const { rows, headers } = await getSheetData(sheets, spreadsheetId, 'OSO');

    const idxBrand = findHeaderIndex(headers, ['Manuf. Brand', 'Brand', 'Marca']);
    const idxSku = findHeaderIndex(headers, ['Central SKU']);
    const idxMpn = findHeaderIndex(headers, ['MPN']);
    const idxDesc = findHeaderIndex(headers, ['Product Name Trax']);
    const idxCustomerName = findHeaderIndex(headers, ['Charge Customer Name']);
    const idxCustomerPO = findHeaderIndex(headers, ['Customer PO']);
    const idxAllocQty = findHeaderIndex(headers, ['Alloc Quantity']);
    const idxAllocPct = findHeaderIndex(headers, ['Alloc %']);
    const idxBo = findHeaderIndex(headers, ['Trans No']);

    const idxOrderQty = findHeaderIndex(headers, ['Order Quantity', 'Order Qty', 'Cantidad de la orden', 'Qty Order']);
    const idxShippedQty = findHeaderIndex(headers, ['Ship Quantity', 'Shipped Qty', 'Qty Shipped', 'Cantidad despachada', 'Ship Qty']);

    const fallbackOrderIdx = 10; // Columna K (0-based)
    const fallbackShippedIdx = 11; // Columna L (0-based)

    const ordersMap = new Map();

    for (let i = 1; i < rows.length; i += 1) {
      const row = rows[i] || [];
      const bo = idxBo >= 0 ? String(row[idxBo] || '').trim() : '';
      if (!bo) continue;

      const brand = idxBrand >= 0 ? String(row[idxBrand] || '').trim() : '';
      const sku = idxSku >= 0 ? String(row[idxSku] || '').trim() : '';
      const mpn = idxMpn >= 0 ? String(row[idxMpn] || '').trim() : '';
      const desc = idxDesc >= 0 ? String(row[idxDesc] || '').trim() : '';
      const customerName = idxCustomerName >= 0 ? String(row[idxCustomerName] || '').trim() : '';
      const customerPO = idxCustomerPO >= 0 ? String(row[idxCustomerPO] || '').trim() : '';
      const allocQty = idxAllocQty >= 0 ? parseNumber(row[idxAllocQty], 0) : 0;
      const allocPct = idxAllocPct >= 0 ? parseNumber(row[idxAllocPct], 0) : 0;

      const orderQtyCell = idxOrderQty >= 0 ? row[idxOrderQty] : row[fallbackOrderIdx];
      const shippedQtyCell = idxShippedQty >= 0 ? row[idxShippedQty] : row[fallbackShippedIdx];
      const orderQty = parseNumber(orderQtyCell, 0);
      const shippedQty = parseNumber(shippedQtyCell, 0);

      if (!ordersMap.has(bo)) {
        ordersMap.set(bo, {
          bo,
          brand,
          customerName,
          customerPO,
          allocPct,
          lines: []
        });
      }

      ordersMap.get(bo).lines.push({
        brand,
        sku,
        mpn,
        desc,
        allocQty,
        orderQty,
        shippedQty
      });
    }

    const orders = Array.from(ordersMap.values()).sort((a, b) => a.bo.localeCompare(b.bo));
    if (orders.length > 0) {
      const boList = orders.map(order => order.bo);
      const boMetaResult = await pool.query(
        'SELECT bo, po_axis FROM bo_meta WHERE bo = ANY($1::text[])',
        [boList]
      );
      const poByBo = boMetaResult.rows.reduce((acc, row) => {
        if (row.bo) acc[row.bo] = row.po_axis;
        return acc;
      }, {});

      const oorData = await getSheetData(sheets, spreadsheetId, 'OOR');
      const oorHeaders = oorData.headers || [];
      const oorRows = oorData.rows || [];
      const idxCustomerPo = findHeaderIndex(oorHeaders, ['Customer PO No']);
      const idxPlannedShip = findHeaderIndex(oorHeaders, ['Planned Ship Date']);
      const idxSalesPart = findHeaderIndex(oorHeaders, ['Sales Part', 'SKU', 'Sales Part No', 'Part No']);
      const idxSalesDesc = findHeaderIndex(oorHeaders, ['Sales Part Description', 'Description', 'Product Description']);
      const idxCustomerPart = findHeaderIndex(oorHeaders, ["Customer's Part No", 'Customer Part No', 'Customer Part']);
      const idxPromiseDate = findHeaderIndex(oorHeaders, ['Promise Date', 'Promised Ship Date', 'Planned Date', 'Ship Date', 'Requested Ship Date']);
      const fallbackPlannedShipIdx = 22; // Columna W (0-based)
      const plannedByPo = new Map();
      const oorByPo = new Map();
      if (idxCustomerPo >= 0) {
        const plannedIdx = idxPlannedShip >= 0 ? idxPlannedShip : (idxPromiseDate >= 0 ? idxPromiseDate : fallbackPlannedShipIdx);
        for (let i = 1; i < oorRows.length; i += 1) {
          const row = oorRows[i] || [];
          const po = String(row[idxCustomerPo] || '').trim();
          const plannedShipDate = formatSheetDate(row[plannedIdx]);
          if (po && plannedShipDate) {
            if (!plannedByPo.has(po)) {
              plannedByPo.set(po, plannedShipDate);
            }
            if (!oorByPo.has(po)) {
              oorByPo.set(po, {
                sku: new Map(),
                mpn: new Map(),
                desc: new Map()
              });
            }
            const entry = oorByPo.get(po);
            const skuKey = normalizeLookupKey(idxSalesPart >= 0 ? row[idxSalesPart] : '');
            const mpnKey = normalizeLookupKey(idxSalesPart >= 0 ? row[idxSalesPart] : '');
            const descKey = normalizeLookupKey(idxSalesDesc >= 0 ? row[idxSalesDesc] : '');
            mergePlannedDate(entry.sku, skuKey, plannedShipDate);
            mergePlannedDate(entry.mpn, mpnKey, plannedShipDate);
            mergePlannedDate(entry.desc, descKey, plannedShipDate);
          }
        }
      }

      orders.forEach(order => {
        const poAxis = (poByBo[order.bo] || '').trim();
        order.plannedShipDate = poAxis && plannedByPo.has(poAxis) ? plannedByPo.get(poAxis) : '';
        order.etaEstimated = order.plannedShipDate ? addDaysToIso(order.plannedShipDate, 14) : '';
        if (poAxis && oorByPo.has(poAxis)) {
          const entry = oorByPo.get(poAxis);
          (order.lines || []).forEach(line => {
            const skuKey = normalizeLookupKey(line.sku);
            const mpnKey = normalizeLookupKey(line.mpn);
            const descKey = normalizeLookupKey(line.desc);
            line.tiempoEntrega =
              (mpnKey && entry.mpn.get(mpnKey)) ||
              (skuKey && entry.sku.get(skuKey)) ||
              (descKey && entry.desc.get(descKey)) ||
              '';
          });
        }
      });
    }
    if (orders.length > 0) {
      const now = new Date().toISOString();
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        for (const order of orders) {
          await client.query(
            `INSERT INTO bo_meta (bo, customer_name, alloc_pct, customer_po, last_seen_at)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (bo) DO UPDATE
             SET customer_name = EXCLUDED.customer_name,
                 alloc_pct = EXCLUDED.alloc_pct,
                 customer_po = EXCLUDED.customer_po,
                 last_seen_at = EXCLUDED.last_seen_at,
                 deleted = false,
                 deleted_at = NULL,
                 deleted_comment = NULL,
                 deleted_by = NULL,
                 updated_at = CURRENT_TIMESTAMP`,
            [order.bo, order.customerName || null, order.allocPct ?? null, order.customerPO || null, now]
          );
        }
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error actualizando bo_meta:', error);
      } finally {
        client.release();
      }
    }
    res.json({ count: orders.length, orders });
  } catch (error) {
    console.error('Error leyendo OSO:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// BO Meta - Obtener todos (admin)
app.get('/api/bo-meta', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM bo_meta ORDER BY bo ASC');
    res.json(result.rows);
  } catch (error) {
    console.error('Error obteniendo bo_meta:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// BO Meta - Guardar datos manuales (admin)
app.put('/api/bo-meta/:bo', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const bo = String(req.params.bo || '').trim();
    if (!bo) return res.status(400).json({ error: 'BO requerido' });
    const normalizeEmpty = (value) => {
      if (value === undefined || value === null) return null;
      const trimmed = String(value).trim();
      return trimmed === '' ? null : trimmed;
    };
    const {
      projectName,
      poAxis,
      estimatedInvoiceDate,
      sAndDStatus,
      invoiced,
      invoicedAt,
      purchaseStatus,
      purchaseDispatch,
      purchaseShipping,
      purchaseSo
    } = req.body || {};

    const result = await pool.query(
      `INSERT INTO bo_meta (bo, project_name, po_axis, estimated_invoice_date, s_and_d_status, invoiced, invoiced_at, purchase_status, purchase_dispatch, purchase_shipping, purchase_so, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, CURRENT_TIMESTAMP)
       ON CONFLICT (bo) DO UPDATE SET
         project_name = COALESCE($2, bo_meta.project_name),
         po_axis = COALESCE($3, bo_meta.po_axis),
         estimated_invoice_date = COALESCE($4, bo_meta.estimated_invoice_date),
         s_and_d_status = COALESCE($5, bo_meta.s_and_d_status),
         invoiced = COALESCE($6, bo_meta.invoiced),
         invoiced_at = COALESCE($7, bo_meta.invoiced_at),
         purchase_status = COALESCE($8, bo_meta.purchase_status),
         purchase_dispatch = COALESCE($9, bo_meta.purchase_dispatch),
         purchase_shipping = COALESCE($10, bo_meta.purchase_shipping),
         purchase_so = COALESCE($11, bo_meta.purchase_so),
         updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [
        bo,
        normalizeEmpty(projectName),
        normalizeEmpty(poAxis),
        normalizeEmpty(estimatedInvoiceDate),
        normalizeEmpty(sAndDStatus),
        typeof invoiced === 'boolean' ? invoiced : null,
        normalizeEmpty(invoicedAt),
        normalizeEmpty(purchaseStatus),
        normalizeEmpty(purchaseDispatch),
        normalizeEmpty(purchaseShipping),
        normalizeEmpty(purchaseSo)
      ]
    );
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error guardando bo_meta:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// STOCK - Leer hoja Stock (MPN / OH Quantity)
app.get('/api/stock', authenticateToken, async (req, res) => {
  try {
    const spreadsheetId = extractSheetId(process.env.GOOGLE_SHEETS_ID || process.env.GOOGLE_SHEETS_URL);
    if (!spreadsheetId) return res.status(400).json({ error: 'GOOGLE_SHEETS_ID no configurado' });

    const sheets = getSheetsClient(true);
    const { rows, headers } = await getSheetData(sheets, spreadsheetId, SHEETS_TAB_STOCK, 'FORMATTED_VALUE');
    if (rows.length <= 1) {
      return res.json({ items: [] });
    }

    const idx = getStockColumnIndexes(headers);
    const items = [];

    for (let i = 1; i < rows.length; i += 1) {
      const row = rows[i] || [];
      const mpn = idx.mpn >= 0 ? String(row[idx.mpn] || '').trim() : '';
      if (!mpn) continue;
      const rawQty = idx.qty >= 0 ? row[idx.qty] : '';
      const parsedQty = parseNumber(rawQty, NaN);
      const quantity = Number.isNaN(parsedQty) ? String(rawQty || '').trim() : parsedQty;
      items.push({ mpn, quantity });
    }

    res.json({ items });
  } catch (error) {
    console.error('Error leyendo stock:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// BO Meta - Eliminar (admin) con comentario
app.post('/api/bo-meta/:bo/delete', authenticateToken, requireAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    const bo = String(req.params.bo || '').trim();
    if (!bo) return res.status(400).json({ error: 'BO requerido' });
    const comment = String(req.body?.comment || '').trim();
    if (!comment) return res.status(400).json({ error: 'Comentario requerido' });

    const userId = req.user?.id || null;
    let usuario = null;
    if (userId) {
      const userResult = await client.query('SELECT usuario FROM usuarios WHERE id = $1', [userId]);
      usuario = userResult.rows[0]?.usuario || null;
    }

    await client.query('BEGIN');
    let meta = null;
    const existing = await client.query('SELECT * FROM bo_meta WHERE bo = $1', [bo]);
    if (existing.rows.length === 0) {
      const insertResult = await client.query(
        `INSERT INTO bo_meta (bo, deleted, deleted_at, deleted_comment, deleted_by, updated_at)
         VALUES ($1, true, CURRENT_TIMESTAMP, $2, $3, CURRENT_TIMESTAMP)
         RETURNING *`,
        [bo, comment, userId]
      );
      meta = insertResult.rows[0];
    } else {
      await client.query(
        `UPDATE bo_meta
         SET deleted = true,
             deleted_at = CURRENT_TIMESTAMP,
             deleted_comment = $2,
             deleted_by = $3,
             updated_at = CURRENT_TIMESTAMP
         WHERE bo = $1`,
        [bo, comment, userId]
      );
      const updated = await client.query('SELECT * FROM bo_meta WHERE bo = $1', [bo]);
      meta = updated.rows[0];
    }

    await client.query(
      `INSERT INTO bo_deleted_logs (bo, deleted_by, deleted_by_usuario, comment, snapshot)
       VALUES ($1, $2, $3, $4, $5)`,
      [bo, userId, usuario, comment, meta ? JSON.stringify(meta) : null]
    );
    await client.query('COMMIT');
    res.json({ ok: true, bo, comment });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error eliminando bo_meta:', error);
    res.status(500).json({ error: 'Error del servidor' });
  } finally {
    client.release();
  }
});

// PRODUCTOS - Obtener todos
app.get('/api/productos', authenticateToken, async (req, res) => {
  try {
    const origen = req.query.origen;
    const isAdmin = !req.user?.role || req.user.role === 'admin';
    const result = origen
      ? await pool.query('SELECT * FROM productos WHERE origen = $1 ORDER BY id DESC', [origen])
      : await pool.query('SELECT * FROM productos WHERE activo = true ORDER BY id DESC');
    if (isAdmin) {
      return res.json(result.rows);
    }
    const userResult = await pool.query('SELECT gp, gp_qnap, gp_axis, partner_category FROM usuarios WHERE id = $1', [req.user.id]);
    const userRow = userResult.rows[0] || {};
    const gpQnap = parseGpValue(userRow.gp_qnap ?? userRow.gp ?? 0.15, 0.15);
    const gpAxis = parseGpValue(userRow.gp_axis ?? userRow.gp ?? 0.15, 0.15);
    const partnerCategory = userRow.partner_category || 'Partner Autorizado';
    const payload = result.rows.map((producto) => {
      const origenValue = producto.origen || DEFAULT_ORIGIN;
      const precioDisty = parseNumber(producto.precio_disty, 0);
      const precioCliente = origenValue === 'AXIS'
        ? calcularPrecioClienteAxis(precioDisty, gpAxis, getAxisPartnerRebate(producto, partnerCategory), 0)
        : calcularPrecioClienteQnap(precioDisty, gpQnap);
      return {
        id: producto.id,
        origen: origenValue,
        marca: producto.marca || '',
        sku: producto.sku || '',
        mpn: producto.mpn || '',
        descripcion: producto.descripcion || '',
        tiempo_entrega: producto.tiempo_entrega || '',
        precio_cliente: Number(precioCliente.toFixed(2))
      };
    });
    res.json(payload);
  } catch (error) {
    console.error('Error obteniendo productos:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// PRODUCTOS - Crear uno
app.post('/api/productos', authenticateToken, async (req, res) => {
  const client = await pool.connect();
  try {
    const { marca, sku, mpn, descripcion, precio_disty, gp, tiempo_entrega, origen } = req.body;

    await client.query('BEGIN');
    const result = await client.query(
      `INSERT INTO productos (origen, marca, sku, mpn, descripcion, precio_disty, gp, rebate_partner_autorizado, rebate_partner_silver, rebate_partner_gold, rebate_partner_multiregional, tiempo_entrega, activo)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING *`,
      [origen || DEFAULT_ORIGIN, marca, sku, mpn, descripcion, precio_disty || 0, gp || 0.15, 0, 0, 0, 0, tiempo_entrega || 'ETA por confirmar', true]
    );

    await writeProductoToSheet(result.rows[0].origen || DEFAULT_ORIGIN, result.rows[0], 'upsert');
    await client.query('COMMIT');
    res.status(201).json(result.rows[0]);
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      console.error('Error haciendo rollback:', rollbackError);
    }
    console.error('Error creando producto:', error);
    res.status(500).json({ error: 'Error del servidor' });
  } finally {
    client.release();
  }
});

// PRODUCTOS - Crear muchos (bulk import desde Excel)
app.post('/api/productos/bulk', authenticateToken, async (req, res) => {
  const client = await pool.connect();
  try {
    const { productos, origen } = req.body;

    if (!productos || !Array.isArray(productos)) {
      return res.status(400).json({ error: 'Se requiere un array de productos' });
    }

    const insertedProducts = [];
    const origenFinal = origen || DEFAULT_ORIGIN;

    await client.query('BEGIN');
    for (const p of productos) {
      const result = await client.query(
        `INSERT INTO productos (origen, marca, sku, mpn, descripcion, precio_disty, gp, rebate_partner_autorizado, rebate_partner_silver, rebate_partner_gold, rebate_partner_multiregional, tiempo_entrega, activo)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING *`,
        [origenFinal, p.marca || '', p.sku || '', p.mpn || '', p.descripcion || '', p.precio_disty || 0, p.gp || 0.15, 0, 0, 0, 0, p.tiempo_entrega || 'ETA por confirmar', true]
      );
      insertedProducts.push(result.rows[0]);
      await writeProductoToSheet(origenFinal, result.rows[0], 'upsert');
    }

    await client.query('COMMIT');
    res.status(201).json({
      message: `${insertedProducts.length} productos importados`,
      productos: insertedProducts
    });
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      console.error('Error haciendo rollback:', rollbackError);
    }
    console.error('Error importando productos:', error);
    res.status(500).json({ error: 'Error del servidor' });
  } finally {
    client.release();
  }
});

// PRODUCTOS - Sync desde Google Sheets (manual)
app.post('/api/productos/sync', authenticateToken, async (req, res) => {
  try {
    const origen = req.query.origen;
    if (origen) {
      const result = await syncProductosFromSheet({ origen });
      if (result?.skipped) {
        return res.status(400).json({ error: 'Sync no configurado', detail: result.reason });
      }
      return res.json({ message: 'Sync completado', ...result });
    }
    const qnap = await syncProductosFromSheet({ origen: 'QNAP' });
    const axis = await syncProductosFromSheet({ origen: 'AXIS' });
    res.json({
      message: 'Sync completado',
      qnap,
      axis
    });
  } catch (error) {
    console.error('Error en sync manual:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// PRODUCTOS - Actualizar
app.put('/api/productos/:id', authenticateToken, async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const { marca, sku, mpn, descripcion, precio_disty, gp, tiempo_entrega, origen, rebate_partner_autorizado, rebate_partner_silver, rebate_partner_gold, rebate_partner_multiregional } = req.body;

    await client.query('BEGIN');
    const result = await client.query(
      `UPDATE productos 
       SET origen = $1, marca = $2, sku = $3, mpn = $4, descripcion = $5, precio_disty = $6, gp = $7, rebate_partner_autorizado = COALESCE($8, rebate_partner_autorizado), rebate_partner_silver = COALESCE($9, rebate_partner_silver), rebate_partner_gold = COALESCE($10, rebate_partner_gold), rebate_partner_multiregional = COALESCE($11, rebate_partner_multiregional), tiempo_entrega = $12, activo = true, updated_at = CURRENT_TIMESTAMP
       WHERE id = $13 RETURNING *`,
      [origen || DEFAULT_ORIGIN, marca, sku, mpn, descripcion, precio_disty, gp, rebate_partner_autorizado, rebate_partner_silver, rebate_partner_gold, rebate_partner_multiregional, tiempo_entrega, id]
    );

    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Producto no encontrado' });
    }

    await writeProductoToSheet(result.rows[0].origen || DEFAULT_ORIGIN, result.rows[0], 'upsert');
    await client.query('COMMIT');
    res.json(result.rows[0]);
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      console.error('Error haciendo rollback:', rollbackError);
    }
    console.error('Error actualizando producto:', error);
    res.status(500).json({ error: 'Error del servidor' });
  } finally {
    client.release();
  }
});

// PRODUCTOS - Eliminar
app.delete('/api/productos/:id', authenticateToken, async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    await client.query('BEGIN');
    const existing = await client.query('SELECT * FROM productos WHERE id = $1', [id]);
    if (existing.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Producto no encontrado' });
    }
    const producto = existing.rows[0];
    await client.query('UPDATE productos SET activo = false, updated_at = CURRENT_TIMESTAMP WHERE id = $1', [id]);
    await writeProductoToSheet(producto.origen || DEFAULT_ORIGIN, producto, 'delete');
    await client.query('COMMIT');
    res.json({ message: 'Producto eliminado', producto: { ...producto, activo: false } });
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      console.error('Error haciendo rollback:', rollbackError);
    }
    console.error('Error eliminando producto:', error);
    res.status(500).json({ error: 'Error del servidor' });
  } finally {
    client.release();
  }
});

// COTIZACIONES - Guardar
app.post('/api/cotizaciones', authenticateToken, async (req, res) => {
  try {
    const { cliente, items, total } = req.body;
    const usuarioId = req.user?.id || null;
    const usuarioName = req.user?.usuario || null;
    const isAdmin = !req.user?.role || req.user.role === 'admin';
    let totalFinal = total;
    let itemsFinal = items;

    if (!isAdmin) {
      const userResult = await pool.query('SELECT gp, gp_qnap, gp_axis, partner_category FROM usuarios WHERE id = $1', [usuarioId]);
      const userRow = userResult.rows[0] || {};
      const gpQnap = parseGpValue(userRow.gp_qnap ?? userRow.gp ?? 0.15, 0.15);
      const gpAxis = parseGpValue(userRow.gp_axis ?? userRow.gp ?? 0.15, 0.15);
      const partnerCategory = userRow.partner_category || 'Partner Autorizado';
      let totalSum = 0;
      const computedItems = [];
      for (const item of items || []) {
        const productoId = item.producto_id;
        const cantidad = parseInt(item.cantidad || item.cant || 1);
        const prodResult = await pool.query('SELECT * FROM productos WHERE id = $1', [productoId]);
        if (prodResult.rows.length === 0) {
          return res.status(400).json({ error: `Producto no encontrado: ${productoId}` });
        }
        const producto = prodResult.rows[0];
        const origenValue = producto.origen || DEFAULT_ORIGIN;
        const precioDisty = parseNumber(producto.precio_disty, 0);
        const gpUsed = origenValue === 'AXIS' ? gpAxis : gpQnap;
        const precioUnitario = origenValue === 'AXIS'
          ? calcularPrecioClienteAxis(precioDisty, gpUsed, getAxisPartnerRebate(producto, partnerCategory), 0)
          : calcularPrecioClienteQnap(precioDisty, gpUsed);
        const precioTotal = precioUnitario * cantidad;
        totalSum += precioTotal;
        computedItems.push({
          producto_id: productoId,
          marca: producto.marca || '',
          sku: producto.sku || '',
          mpn: producto.mpn || '',
          descripcion: producto.descripcion || '',
          precio_disty: precioDisty,
          gp: gpUsed,
          cantidad,
          precio_unitario: Number(precioUnitario.toFixed(2)),
          precio_total: Number(precioTotal.toFixed(2)),
          tiempo_entrega: producto.tiempo_entrega || ''
        });
      }
      itemsFinal = computedItems;
      totalFinal = Number(totalSum.toFixed(2));
    }
    
    // Crear cotizaci?n
    const cotResult = await pool.query(
      `INSERT INTO cotizaciones (
        cliente_nombre,
        cliente_empresa,
        cliente_email,
        cliente_telefono,
        total,
        cliente_final,
        fecha_ejecucion,
        fecha_implementacion,
        vms,
        usuario_id,
        usuario,
        estado
      ) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
      [
        cliente.nombre,
        cliente.empresa,
        cliente.email,
        cliente.telefono,
        totalFinal,
        cliente.cliente_final || null,
        cliente.fecha_ejecucion || null,
        cliente.fecha_implementacion || null,
        cliente.vms || null,
        usuarioId,
        usuarioName,
        'revision'
      ]
    );
    
    const cotizacionId = cotResult.rows[0].id;
    
    // Insertar items
    for (const item of itemsFinal || []) {
      await pool.query(
        `INSERT INTO cotizacion_items 
         (cotizacion_id, producto_id, marca, sku, mpn, descripcion, precio_disty, gp, cantidad, precio_unitario, precio_total, tiempo_entrega)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [cotizacionId, item.producto_id, item.marca, item.sku, item.mpn, item.descripcion, 
         item.precio_disty, item.gp, item.cantidad, item.precio_unitario, item.precio_total, item.tiempo_entrega]
      );
    }
    
    res.status(201).json({ 
      message: 'Cotizaci?n guardada',
      cotizacion: cotResult.rows[0]
    });
  } catch (error) {
    console.error('Error guardando cotizaci?n:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// COTIZACIONES - Actualizar estado
app.patch('/api/cotizaciones/:id/estado', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { estado } = req.body;
    const allowed = ['enviada', 'revision', 'rechazada', 'aprobada', 'pendiente'];
    if (!estado || !allowed.includes(estado)) {
      return res.status(400).json({ error: 'Estado invalido' });
    }
    const normalized = estado === 'pendiente' ? 'revision' : estado;
    const result = await pool.query(
      'UPDATE cotizaciones SET estado = $1 WHERE id = $2 RETURNING *',
      [normalized, id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Cotización no encontrada' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error actualizando estado:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// COTIZACIONES - Actualizar (solo admin)
app.put('/api/cotizaciones/:id', authenticateToken, requireAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const { cliente, items, total } = req.body;
    const totalValue = Number.isFinite(Number(total)) ? Number(total) : null;
    const normalizeDate = (value) => {
      if (value === undefined || value === null) return null;
      const trimmed = String(value).trim();
      return trimmed === '' ? null : trimmed;
    };
    await client.query('BEGIN');
    const result = await client.query(
      `UPDATE cotizaciones
       SET cliente_nombre = COALESCE($1, cliente_nombre),
           cliente_empresa = COALESCE($2, cliente_empresa),
           cliente_email = COALESCE($3, cliente_email),
           cliente_telefono = COALESCE($4, cliente_telefono),
           cliente_final = COALESCE($5, cliente_final),
           fecha_ejecucion = COALESCE($6, fecha_ejecucion),
           fecha_implementacion = COALESCE($7, fecha_implementacion),
           vms = COALESCE($8, vms),
           total = COALESCE($9, total)
       WHERE id = $10
       RETURNING *`,
      [
        cliente?.nombre ?? null,
        cliente?.empresa ?? null,
        cliente?.email ?? null,
        cliente?.telefono ?? null,
        cliente?.cliente_final ?? null,
        normalizeDate(cliente?.fecha_ejecucion),
        normalizeDate(cliente?.fecha_implementacion),
        cliente?.vms ?? null,
        totalValue,
        id
      ]
    );
    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Cotización no encontrada' });
    }
    if (Array.isArray(items)) {
      await client.query('DELETE FROM cotizacion_items WHERE cotizacion_id = $1', [id]);
      for (const item of items) {
        const cantidad = parseInt(item.cantidad || 1, 10);
        const precioUnitario = parseNumber(item.precio_unitario, 0);
        const precioTotal = Number.isFinite(Number(item.precio_total))
          ? Number(item.precio_total)
          : (precioUnitario * (Number.isNaN(cantidad) ? 1 : cantidad));
        await client.query(
          `INSERT INTO cotizacion_items
           (cotizacion_id, producto_id, marca, sku, mpn, descripcion, precio_disty, gp, cantidad, precio_unitario, precio_total, tiempo_entrega)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
          [
            id,
            item.producto_id || null,
            item.marca || '',
            item.sku || '',
            item.mpn || '',
            item.descripcion || '',
            parseNumber(item.precio_disty, 0),
            parseNumber(item.gp, 0),
            Number.isNaN(cantidad) ? 1 : cantidad,
            precioUnitario,
            precioTotal,
            item.tiempo_entrega || ''
          ]
        );
      }
    }
    await client.query('COMMIT');
    res.json(result.rows[0]);
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      console.error('Error haciendo rollback:', rollbackError);
    }
    console.error('Error actualizando cotización:', error);
    res.status(500).json({ error: 'Error del servidor' });
  } finally {
    client.release();
  }
});

// COTIZACIONES - Funnel (admin)
app.get('/api/cotizaciones/funnel', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const daysRaw = parseInt(req.query.days || '30', 10);
    const days = Number.isFinite(daysRaw) && daysRaw > 0 ? Math.min(daysRaw, 365) : 30;
    const empresa = (req.query.empresa || '').trim();
    const from = (req.query.from || '').trim();
    const to = (req.query.to || '').trim();
    const isValidDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value);
    const hasRange = isValidDate(from) || isValidDate(to);

    const params = [];
    let whereSql = 'WHERE 1=1';
    if (hasRange) {
      if (isValidDate(from)) {
        params.push(from);
        whereSql += ` AND created_at::date >= $${params.length}`;
      }
      if (isValidDate(to)) {
        params.push(to);
        whereSql += ` AND created_at::date <= $${params.length}`;
      }
    } else {
      params.push(String(days));
      whereSql += ` AND created_at >= NOW() - ($${params.length} || ' days')::interval`;
    }

    if (empresa) {
      params.push(`%${empresa}%`);
      whereSql += ` AND cliente_empresa ILIKE $${params.length}`;
    }

    const result = await pool.query(
      `SELECT
         CASE WHEN estado = 'pendiente' OR estado IS NULL THEN 'revision' ELSE estado END AS estado,
         COUNT(*)::int AS count,
         COALESCE(SUM(total), 0)::numeric AS amount
       FROM cotizaciones
       ${whereSql}
       GROUP BY 1`,
      params
    );

    res.json({ days: hasRange ? null : days, from: isValidDate(from) ? from : '', to: isValidDate(to) ? to : '', empresa, stages: result.rows });
  } catch (error) {
    console.error('Error obteniendo funnel:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// COTIZACIONES - Obtener todas
app.get('/api/cotizaciones', authenticateToken, async (req, res) => {
  try {
    const includeItems = req.query.includeItems === '1';
    const isAdmin = !req.user?.role || req.user.role === 'admin';
    const result = isAdmin
      ? await pool.query('SELECT c.*, u.role AS usuario_role FROM cotizaciones c LEFT JOIN usuarios u ON c.usuario_id = u.id ORDER BY c.created_at DESC')
      : await pool.query('SELECT c.*, u.role AS usuario_role FROM cotizaciones c LEFT JOIN usuarios u ON c.usuario_id = u.id WHERE c.usuario_id = $1 ORDER BY c.created_at DESC', [req.user.id]);
    if (!includeItems) {
      return res.json(result.rows);
    }
    const ids = result.rows.map(row => row.id);
    if (ids.length === 0) {
      return res.json([]);
    }
    const itemsResult = await pool.query(
      'SELECT * FROM cotizacion_items WHERE cotizacion_id = ANY($1::int[])',
      [ids]
    );
    const itemsByCotizacion = itemsResult.rows.reduce((acc, item) => {
      if (!acc[item.cotizacion_id]) acc[item.cotizacion_id] = [];
      acc[item.cotizacion_id].push(item);
      return acc;
    }, {});
    const payload = result.rows.map(row => ({
      ...row,
      items: itemsByCotizacion[row.id] || []
    }));
    res.json(payload);
  } catch (error) {
    console.error('Error obteniendo cotizaciones:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// COTIZACIONES - Eliminar
app.delete('/api/cotizaciones/:id', authenticateToken, async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    await client.query('BEGIN');
    await client.query('DELETE FROM cotizacion_items WHERE cotizacion_id = $1', [id]);
    const result = await client.query('DELETE FROM cotizaciones WHERE id = $1 RETURNING *', [id]);

    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'CotizaciÃ³n no encontrada' });
    }

    await client.query('COMMIT');
    res.json({ message: 'CotizaciÃ³n eliminada', cotizacion: result.rows[0] });
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      console.error('Error haciendo rollback:', rollbackError);
    }
    console.error('Error eliminando cotizaciÃ³n:', error);
    res.status(500).json({ error: 'Error del servidor' });
  } finally {
    client.release();
  }
});

// COTIZACIONES - Obtener una con items
app.get('/api/cotizaciones/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const isAdmin = !req.user?.role || req.user.role === 'admin';
    const cotizacion = isAdmin
      ? await pool.query('SELECT c.*, u.role AS usuario_role FROM cotizaciones c LEFT JOIN usuarios u ON c.usuario_id = u.id WHERE c.id = $1', [id])
      : await pool.query('SELECT c.*, u.role AS usuario_role FROM cotizaciones c LEFT JOIN usuarios u ON c.usuario_id = u.id WHERE c.id = $1 AND c.usuario_id = $2', [id, req.user.id]);
    if (cotizacion.rows.length === 0) {
      return res.status(404).json({ error: 'Cotizaci?n no encontrada' });
    }
    
    const items = await pool.query('SELECT * FROM cotizacion_items WHERE cotizacion_id = $1', [id]);
    
    res.json({
      ...cotizacion.rows[0],
      items: items.rows
    });
  } catch (error) {
    console.error('Error obteniendo cotizaci?n:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Iniciar servidor
app.listen(PORT, async () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
  await initDB();
  try {
    const initialQnap = await syncProductosFromSheet({ origen: 'QNAP' });
    const initialAxis = await syncProductosFromSheet({ origen: 'AXIS' });
    if (!initialQnap?.skipped) {
      console.log(`Sync inicial QNAP OK: ${initialQnap.inserted} nuevos, ${initialQnap.updated} actualizados, ${initialQnap.skipped} omitidos`);
    }
    if (!initialAxis?.skipped) {
      console.log(`Sync inicial AXIS OK: ${initialAxis.inserted} nuevos, ${initialAxis.updated} actualizados, ${initialAxis.skipped} omitidos`);
    }
  } catch (error) {
    console.error('Error en sync inicial:', error);
  }
  // Auto sync disabled; manual sync only.
});




















