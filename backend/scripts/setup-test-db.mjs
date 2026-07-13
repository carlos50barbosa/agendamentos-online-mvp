// Cria do zero um banco DESCARTAVEL e aplica schema.sql + todas as migrations.
// Usado pelo smoke test (tests/smoke-routes.test.js), local e no CI.
//
// Uso:  MYSQL_DATABASE=agendamentos_smoke node scripts/setup-test-db.mjs
//
// O guarda de nome e a unica coisa entre este script e um DROP DATABASE no banco de
// desenvolvimento de alguem. Nao afrouxe sem pensar duas vezes.
import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SQL_DIR = path.join(__dirname, '..', 'sql');

// Nomes que este script aceita destruir. Qualquer outro e recusado.
export const DISPOSABLE_DB_RE = /(_smoke|_test|_ci)$/;

// Erros de idempotencia: schema.sql ja traz varias colunas que as migrations antigas
// adicionam. Num banco novo isso e esperado — nao e falha.
const IGNORABLE_ERRNOS = new Set([
  1050, // ER_TABLE_EXISTS_ERROR
  1060, // ER_DUP_FIELDNAME
  1061, // ER_DUP_KEYNAME
  1062, // ER_DUP_ENTRY (seeds re-aplicados)
  1091, // ER_CANT_DROP_FIELD_OR_KEY
  1826, // ER_FK_DUP_NAME
]);

function dbConfig() {
  const database = process.env.MYSQL_DATABASE || process.env.DB_NAME || '';
  return {
    host: process.env.MYSQL_HOST || process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.MYSQL_PORT || process.env.DB_PORT || 3306),
    user: process.env.MYSQL_USER || process.env.DB_USER || 'root',
    password: process.env.MYSQL_PASSWORD || process.env.DB_PASS || '',
    database,
  };
}

export async function setupTestDb({ logger = console } = {}) {
  const cfg = dbConfig();

  if (!cfg.database) {
    throw new Error('MYSQL_DATABASE nao definido.');
  }
  if (!DISPOSABLE_DB_RE.test(cfg.database)) {
    throw new Error(
      `Recusando: "${cfg.database}" nao parece descartavel. ` +
      'O nome do banco precisa terminar em _smoke, _test ou _ci — este script faz DROP DATABASE.'
    );
  }

  const conn = await mysql.createConnection({
    host: cfg.host,
    port: cfg.port,
    user: cfg.user,
    password: cfg.password,
    multipleStatements: true,
  });

  await conn.query(`DROP DATABASE IF EXISTS \`${cfg.database}\``);
  await conn.query(`CREATE DATABASE \`${cfg.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await conn.changeUser({ database: cfg.database });

  const entries = await fs.readdir(SQL_DIR);
  // schema.sql primeiro; as migrations depois, em ordem de nome (que e cronologica).
  const migrations = entries.filter((f) => f.endsWith('.sql') && f !== 'schema.sql').sort();
  const files = ['schema.sql', ...migrations];

  let applied = 0;
  let tolerated = 0;
  for (const file of files) {
    const sql = await fs.readFile(path.join(SQL_DIR, file), 'utf8');
    if (!sql.trim()) continue;
    try {
      await conn.query(sql);
      applied += 1;
    } catch (err) {
      if (IGNORABLE_ERRNOS.has(err?.errno)) {
        tolerated += 1;
        continue;
      }
      await conn.end();
      throw new Error(`Falha em sql/${file}: [${err?.errno}] ${err?.sqlMessage || err?.message}`);
    }
  }

  const [[{ tables }]] = await conn.query(
    'SELECT COUNT(*) AS tables FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?',
    [cfg.database]
  );
  await conn.end();

  logger.log(
    `[setup-test-db] ${cfg.database}: ${applied} arquivo(s) aplicado(s), ` +
    `${tolerated} ja-aplicado(s), ${tables} tabela(s).`
  );
  return { database: cfg.database, applied, tolerated, tables };
}

// Executado direto (node scripts/setup-test-db.mjs)?
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  setupTestDb().catch((err) => {
    console.error(`[setup-test-db] ${err.message}`);
    process.exit(1);
  });
}
