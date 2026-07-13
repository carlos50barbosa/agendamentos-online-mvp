# Testes

## Por que este documento existe

Em 12/07/2026 o `GET /establishments/:id/clients` (a página `/clientes`) ficou **500 em
produção por três deploys seguidos**:

```
Unknown column 'base.billable_appointments' in 'SELECT'   (sqlState 42S22)
```

Nenhum teste pegou. O motivo é estrutural: os testes de rota **mockam `pool.query`**, e um
mock nunca reclama de coluna inexistente. A SQL só é validada quando o MySQL a analisa —
e isso nunca acontecia antes de produção.

No mesmo dia apareceu o outro lado do problema: `tests/wa-institutional-autoreply.test.js`
estava **vermelho** e ninguém sabia, porque o arquivo **não era executado por nenhum
script npm**. E `tests/route-hardening.test.js` **travava o processo** (pool do MySQL sem
teardown), o que impedia rodar a suíte inteira de uma vez.

Os três problemas têm a mesma raiz: **nada exercitava o código de verdade**.

## O que roda hoje

| script | o que faz |
|---|---|
| `npm run test:all` | **Tudo** em `tests/*.test.js` (inclui o smoke). É o gate do CI. |
| `npm run test:smoke` | Cria o banco descartável e roda só o smoke das rotas. |
| `npm run db:setup:smoke` | Recria o banco descartável (schema + todas as migrations). |
| `npm run test:plan` | Fluxos de plano/billing (script, não é arquivo de teste). |
| `test:asaas`, `test:wa`, `test:crm`, `test:reports` | Recortes da suíte, para rodar rápido no dia a dia. |

O CI (`.github/workflows/deploy.yml`) sobe um **MariaDB 10.11** — a mesma engine da VPS —,
aplica o schema e roda `test:all` + `test:plan`. Sem isso, nenhum deploy sai.

## Atenção: produção é MariaDB, o ambiente local pode ser MySQL

São engines diferentes, e isso já mordeu. Quatro migrations usam
`ADD COLUMN IF NOT EXISTS`, que é **sintaxe MariaDB** — o MySQL responde erro 1064. Por
isso `scripts/setup-test-db.mjs` **emula** a cláusula (consulta o `information_schema` e
adiciona só as colunas ausentes), e assim o mesmo comando funciona nas duas engines.

O script também ignora os `USE agendamentos;` que abrem 30 dos 58 arquivos `.sql` — sem
isso, o primeiro `USE` trocaria de banco no meio do setup e despejaria as migrations no
banco de desenvolvimento.

## O smoke das rotas (`tests/smoke-routes.test.js`)

Sobe o app **como processo** (`node src/index.js`, porta livre), semeia um estabelecimento
com cliente, profissional, serviço e agendamentos, e chama ~26 rotas GET por HTTP.

Duas decisões que importam:

- **A asserção é `200`, não `< 500`.** Um 400/404 significaria que a requisição morreu
  *antes* da query — o teste passaria sem nunca ter exercitado a SQL, que é exatamente o
  que se quer cobrir.
- **A saída do servidor é capturada.** Quando uma rota devolve 500, o erro de SQL está no
  log do processo, não no corpo da resposta (que é genérico). Sem isso a falha seria
  indiagnosticável no CI.

### Rodando localmente

Precisa de um MySQL e de um usuário com permissão de `CREATE DATABASE`:

```bash
cd backend
MYSQL_DATABASE=agendamentos_smoke npm run test:smoke
```

O nome do banco **precisa terminar em `_smoke`, `_test` ou `_ci`**. `scripts/setup-test-db.mjs`
faz `DROP DATABASE` — o guarda de nome é a única coisa entre ele e o banco de
desenvolvimento de alguém. Se o nome não bater, ele se recusa a rodar.

Sem banco descartável, o smoke **pula** (com o motivo impresso) e o resto de `test:all`
roda normal. No CI, `SMOKE_REQUIRE_DB=1` faz ele **falhar** em vez de pular: um smoke que
pula sozinho quando o ambiente está torto é um verde falso — pior que teste nenhum.

## Ao adicionar uma rota

Se a rota nova roda SQL de leitura, **acrescente-a à lista do smoke**. É barato (uma linha)
e é a única camada que confere a query contra o schema real.
