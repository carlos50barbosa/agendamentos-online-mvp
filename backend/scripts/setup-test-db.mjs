// Cria do zero um banco DESCARTAVEL e aplica schema.sql + todas as migrations.
// Usado pelo smoke test (tests/smoke-routes.test.js), local e no CI.
//
// Uso:  MYSQL_DATABASE=agendamentos_smoke node scripts/setup-test-db.mjs
//       node scripts/setup-test-db.mjs --dry-run     (nao toca no banco; so imprime o plano)
//
// Duas armadilhas dos .sql deste repo, descobertas quando o CI quebrou:
//
// 1. 30 arquivos comecam com `USE agendamentos;`. Executado como esta, isso TROCA o banco
//    no meio do setup e despeja as migrations no banco de verdade. Aqui o USE e ignorado —
//    a conexao ja esta no banco certo.
// 2. Quatro migrations usam `ADD COLUMN IF NOT EXISTS`, que e sintaxe MariaDB. O MySQL
//    responde erro 1064 (syntax error). Como o proprio arquivo asaas-split admite
//    ("Idempotente (ADD COLUMN IF NOT EXISTS, MariaDB)"), aqui a clausula e EMULADA:
//    consulta-se o information_schema por coluna e so as ausentes sao adicionadas.
//    Emular por COLUNA (e nao apenas remover o IF NOT EXISTS) importa: um ALTER com 10
//    clausulas onde 1 coluna ja existe falharia inteiro, e as outras 9 nunca entrariam.
import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SQL_DIR = path.join(__dirname, '..', 'sql');

// Nomes que este script aceita destruir. Qualquer outro e recusado — ele faz DROP DATABASE.
export const DISPOSABLE_DB_RE = /(_smoke|_test|_ci)$/;

// Erros de idempotencia: schema.sql ja traz varias colunas/tabelas que as migrations
// antigas adicionam. Num banco novo isso e esperado — nao e falha.
const IGNORABLE_ERRNOS = new Set([
  1050, // ER_TABLE_EXISTS_ERROR
  1060, // ER_DUP_FIELDNAME
  1061, // ER_DUP_KEYNAME
  1062, // ER_DUP_ENTRY (seeds re-aplicados)
  1091, // ER_CANT_DROP_FIELD_OR_KEY
  1826, // ER_FK_DUP_NAME
]);

// Divide um arquivo .sql em statements, respeitando aspas ('", crase) e pulando
// comentarios (--, #, /* */). Um split ingenuo por ';' quebraria em qualquer comentario
// ou string que contenha ponto-e-virgula.
export function splitStatements(sql) {
  const out = [];
  let cur = '';
  let quote = null;
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    const next = sql[i + 1];

    if (quote) {
      cur += c;
      if (c === '\\' && quote !== '`') { cur += next ?? ''; i += 2; continue; }
      if (c === quote) quote = null;
      i += 1;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { quote = c; cur += c; i += 1; continue; }
    if ((c === '-' && next === '-') || c === '#') {
      while (i < sql.length && sql[i] !== '\n') i += 1;
      continue;
    }
    if (c === '/' && next === '*') {
      i += 2;
      while (i < sql.length && !(sql[i] === '*' && sql[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    if (c === ';') {
      const stmt = cur.trim();
      if (stmt) out.push(stmt);
      cur = '';
      i += 1;
      continue;
    }
    cur += c;
    i += 1;
  }
  const tail = cur.trim();
  if (tail) out.push(tail);
  return out;
}

// Divide as clausulas de um ALTER pelas virgulas de TOPO — as de dentro de parenteses
// nao contam (ex.: ENUM('PERCENT','FIXED') tem virgula que nao separa clausula).
export function splitTopLevelCommas(text) {
  const parts = [];
  let cur = '';
  let depth = 0;
  let quote = null;
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    const next = text[i + 1];
    if (quote) {
      cur += c;
      if (c === '\\' && quote !== '`') { cur += next ?? ''; i += 2; continue; }
      if (c === quote) quote = null;
      i += 1;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { quote = c; cur += c; i += 1; continue; }
    if (c === '(') depth += 1;
    if (c === ')') depth -= 1;
    if (c === ',' && depth === 0) {
      if (cur.trim()) parts.push(cur.trim());
      cur = '';
      i += 1;
      continue;
    }
    cur += c;
    i += 1;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

const IS_USE = /^USE\s+/i;
const ALTER_HEAD = /^ALTER\s+TABLE\s+`?(\w+)`?\s+([\s\S]+)$/i;
const ADD_COL_INE = /^ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+`?(\w+)`?\s+([\s\S]+)$/i;
const ADD_COL = /^ADD\s+(?:COLUMN\s+)?(?!INDEX|KEY|CONSTRAINT|PRIMARY|UNIQUE|FULLTEXT|FOREIGN)`?(\w+)`?\s+([\s\S]+)$/i;

// TODA coluna que os .sql adicionam via ADD COLUMN (com ou sem IF NOT EXISTS). Conferidas
// uma a uma no fim: sem isso, um ALTER tolerado em silencio deixaria o banco de teste
// incompleto e o smoke passaria contra um schema que nao e o de producao — o pior desfecho
// possivel. Foi assim que `usuarios.avatar_url` sumiu na primeira versao deste script.
export function declaredAddedColumns(files) {
  const wanted = [];
  for (const { sql } of files) {
    for (const stmt of splitStatements(sql)) {
      const head = ALTER_HEAD.exec(stmt);
      if (!head) continue;
      for (const clause of splitTopLevelCommas(head[2])) {
        const m = ADD_COL_INE.exec(clause) || ADD_COL.exec(clause);
        if (m) wanted.push({ table: head[1].toLowerCase(), column: m[1].toLowerCase() });
      }
    }
  }
  return wanted;
}

function dbConfig() {
  return {
    host: process.env.MYSQL_HOST || process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.MYSQL_PORT || process.env.DB_PORT || 3306),
    user: process.env.MYSQL_USER || process.env.DB_USER || 'root',
    password: process.env.MYSQL_PASSWORD || process.env.DB_PASS || '',
    database: process.env.MYSQL_DATABASE || process.env.DB_NAME || '',
  };
}

async function readSqlFiles() {
  const entries = await fs.readdir(SQL_DIR);
  // schema.sql primeiro; as migrations depois, em ordem de nome (que e cronologica).
  const migrations = entries.filter((f) => f.endsWith('.sql') && f !== 'schema.sql').sort();
  const files = [];
  for (const name of ['schema.sql', ...migrations]) {
    const sql = await fs.readFile(path.join(SQL_DIR, name), 'utf8');
    if (sql.trim()) files.push({ name, sql });
  }
  return files;
}

export async function setupTestDb({ logger = console, dryRun = false } = {}) {
  const cfg = dbConfig();
  const files = await readSqlFiles();

  if (dryRun) {
    let statements = 0;
    let uses = 0;
    let emulated = 0;
    for (const { sql } of files) {
      for (const stmt of splitStatements(sql)) {
        statements += 1;
        if (IS_USE.test(stmt)) { uses += 1; continue; }
        const head = ALTER_HEAD.exec(stmt);
        if (head) {
          for (const clause of splitTopLevelCommas(head[2])) {
            if (ADD_COL_INE.test(clause)) emulated += 1;
          }
        }
      }
    }
    const wanted = declaredAddedColumns(files);
    logger.log(
      `[setup-test-db][dry-run] ${files.length} arquivo(s), ${statements} statement(s), ` +
      `${uses} USE ignorado(s), ${emulated} ADD COLUMN IF NOT EXISTS emulado(s) ` +
      `(${wanted.length} coluna(s) a conferir no fim).`
    );
    return { dryRun: true, files: files.length, statements, uses, emulated };
  }

  if (!cfg.database) throw new Error('MYSQL_DATABASE nao definido.');
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
  });

  await conn.query(`DROP DATABASE IF EXISTS \`${cfg.database}\``);
  await conn.query(`CREATE DATABASE \`${cfg.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await conn.changeUser({ database: cfg.database });

  // Os .sql nao estao em ordem topologica: schema.sql cria `agendamentos` com FK para
  // `client_loyalty_subscriptions`, que so nasce numa migration posterior (erro 1824).
  // Em producao isso nunca apareceu porque o banco foi crescendo aos poucos. Desligar a
  // checagem durante a carga e o que o mysqldump faz — as constraints continuam sendo
  // criadas; so a validacao imediata e adiada.
  await conn.query('SET FOREIGN_KEY_CHECKS = 0');

  const columnExists = async (table, column) => {
    const [rows] = await conn.query(
      `SELECT 1 FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
      [cfg.database, table, column]
    );
    return rows.length > 0;
  };

  const stats = { executed: 0, tolerated: 0, usesIgnored: 0, columnsAdded: 0, columnsPresent: 0 };

  for (const { name, sql } of files) {
    for (const stmt of splitStatements(sql)) {
      if (IS_USE.test(stmt)) { stats.usesIgnored += 1; continue; }

      const head = ALTER_HEAD.exec(stmt);

      try {
        if (head) {
          // TODO ALTER e quebrado em clausulas e executado uma a uma. Se ele fosse
          // executado inteiro, uma unica coluna ja existente (erro 1060, tolerado)
          // derrubaria o ALTER INTEIRO e as clausulas irmas nunca entrariam — foi assim
          // que `usuarios.avatar_url` sumiu, e o auth passou a devolver 401 em tudo.
          const table = head[1];
          for (const clause of splitTopLevelCommas(head[2])) {
            const ine = ADD_COL_INE.exec(clause);
            try {
              if (ine) {
                const [, column, definition] = ine;
                if (await columnExists(table, column)) { stats.columnsPresent += 1; continue; }
                await conn.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
                stats.columnsAdded += 1;
              } else {
                await conn.query(`ALTER TABLE \`${table}\` ${clause}`);
              }
            } catch (err) {
              if (IGNORABLE_ERRNOS.has(err?.errno)) { stats.tolerated += 1; continue; }
              throw err;
            }
          }
        } else {
          await conn.query(stmt);
        }
        stats.executed += 1;
      } catch (err) {
        if (IGNORABLE_ERRNOS.has(err?.errno)) { stats.tolerated += 1; continue; }
        await conn.end();
        throw new Error(
          `Falha em sql/${name}: [${err?.errno}] ${err?.sqlMessage || err?.message}\n` +
          `statement: ${String(stmt).slice(0, 220)}`
        );
      }
    }
  }

  // Nenhuma coluna pode ter ficado para tras. Sem esta conferencia, uma falha silenciosa
  // na emulacao produziria um banco incompleto — e o smoke passaria contra um schema que
  // nao e o de producao, que e o pior desfecho possivel.
  const wanted = declaredAddedColumns(files);
  const missing = [];
  for (const { table, column } of wanted) {
    if (!(await columnExists(table, column))) missing.push(`${table}.${column}`);
  }
  if (missing.length) {
    await conn.end();
    throw new Error(
      `O setup deixou ${missing.length} coluna(s) para tras (ALTER tolerado em silencio?): ` +
      missing.join(', ')
    );
  }

  await conn.query('SET FOREIGN_KEY_CHECKS = 1');

  const [[{ tables }]] = await conn.query(
    'SELECT COUNT(*) AS tables FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?',
    [cfg.database]
  );
  await conn.end();

  logger.log(
    `[setup-test-db] ${cfg.database}: ${tables} tabela(s) | ${stats.executed} statement(s), ` +
    `${stats.tolerated} ja-aplicado(s), ${stats.usesIgnored} USE ignorado(s) | ` +
    `ADD COLUMN emulado: ${stats.columnsAdded} adicionada(s), ${stats.columnsPresent} ja existia(m) | ` +
    `${wanted.length} coluna(s) conferida(s).`
  );
  return { database: cfg.database, tables, ...stats };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  setupTestDb({ dryRun: process.argv.includes('--dry-run') }).catch((err) => {
    console.error(`[setup-test-db] ${err.message}`);
    process.exit(1);
  });
}
