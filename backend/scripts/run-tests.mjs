// Roda TODOS os arquivos de tests/ passando a lista explicita para `node --test`.
//
// Por que nao um glob: `node --test "tests/*.test.js"` so funciona porque o Node expande o
// padrao sozinho — e isso e suporte que o Node 20 (a versao do CI) NAO tem. Localmente,
// no Node 24, passava; no CI, o Node recebia a string literal e nao achava arquivo nenhum.
// E `node --test tests/` (diretorio) tambem nao e confiavel entre versoes.
//
// Com a lista resolvida aqui, o comando fica identico em qualquer Node e em qualquer SO.
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const backendDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const testsDir = path.join(backendDir, 'tests');

const files = readdirSync(testsDir)
  .filter((f) => f.endsWith('.test.js'))
  .sort()
  .map((f) => path.join('tests', f));

if (!files.length) {
  console.error('[test:all] nenhum arquivo .test.js encontrado em tests/');
  process.exit(1);
}

console.log(`[test:all] ${files.length} arquivo(s) de teste`);
const result = spawnSync(process.execPath, ['--test', ...files], {
  cwd: backendDir,
  stdio: 'inherit',
});
process.exit(result.status ?? 1);
