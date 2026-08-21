// HANDLER QUE DECLARA `_req` E USA `req` — 500 EM TODA CHAMADA.
//
// Por que este arquivo existe: `GET /wa/embedded-signup/config` foi declarado como
// `(_req, res)` quando nao lia a requisicao. Depois a lista de permitidos entrou e o corpo
// passou a chamar `isWhatsAppConnectEnabled(req.user?.id)` — com o parametro ainda `_req`.
// `req` nao existe naquele escopo: ReferenceError, 500 em toda chamada.
//
// O sintoma nao denunciava nada. A tela faz `catch {}` e simplesmente NAO renderiza o botao
// de conexao em um clique — exatamente o que ela faz enquanto falta o `config_id`. Ou seja:
// no dia em que o `config_id` fosse configurado, o botao continuaria sumido, sem erro na
// tela e sem pista de onde olhar.
//
// A checagem e textual de proposito: importar as rotas exigiria banco e ambiente.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROUTES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'routes');

// Cada `router.<metodo>(` abre um trecho que vai ate o proximo — aproximacao boa o bastante
// para isolar um handler, porque os handlers sao declarados em sequencia no arquivo.
const ABRE_ROTA = /router\.(get|post|put|patch|delete|all|use)\s*\(/g;
const DECLARA_REQ_IGNORADO = /\(\s*_req\b/;
// `req` sozinho: o lookbehind derruba `_req` (o `_` e caractere de palavra).
const USA_REQ = /(?<![\w$])req\b/;

function semComentarios(trecho) {
  return trecho
    .replace(/\/\*[\s\S]*?\*\//g, '')
    // O `[^:]` preserva `https://` — cortar ali apagaria o resto de uma linha de codigo.
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

function trechosDeHandler(codigo) {
  const inicios = [...codigo.matchAll(ABRE_ROTA)].map((m) => m.index);
  return inicios.map((inicio, i) => ({
    inicio,
    linha: codigo.slice(0, inicio).split('\n').length,
    corpo: codigo.slice(inicio, inicios[i + 1] ?? codigo.length),
  }));
}

test('nenhum handler declara `_req` e usa `req` no corpo', () => {
  const arquivos = readdirSync(ROUTES_DIR).filter((f) => f.endsWith('.js'));
  assert.ok(arquivos.length > 0, 'nenhuma rota encontrada — o teste estaria passando a vazio');

  const culpados = [];
  for (const arquivo of arquivos) {
    const codigo = readFileSync(path.join(ROUTES_DIR, arquivo), 'utf8');
    for (const trecho of trechosDeHandler(codigo)) {
      const corpo = semComentarios(trecho.corpo);
      if (!DECLARA_REQ_IGNORADO.test(corpo)) continue;
      if (USA_REQ.test(corpo)) culpados.push(`${arquivo}:${trecho.linha}`);
    }
  }

  assert.deepEqual(
    culpados,
    [],
    `handler(es) com parametro \`_req\` lendo \`req\` (ReferenceError em tempo de execucao): ${culpados.join(', ')}`
  );
});
