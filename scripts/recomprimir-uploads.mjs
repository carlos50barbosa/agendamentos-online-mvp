// Recomprime uploads existentes NO MESMO caminho e extensao (1600px, qualidade 82).
// URLs e banco ficam inalterados — nenhum UPDATE e' necessario.
//
// Manutencao pontual: rodado em 18/07/2026 sobre o acervo legado (71 arquivos anteriores
// a compressao no cliente), 12573 KB -> 4586 KB. Uploads novos ja sobem comprimidos, entao
// so' faz sentido rodar de novo se um acervo grande entrar por fora.
//
// Uso:
//   node scripts/recomprimir-uploads.mjs --dry     # mede, nao escreve nada
//   node scripts/recomprimir-uploads.mjs           # aplica
//   SHARP_FROM=/caminho/com/sharp UPLOADS_DIR=... node scripts/recomprimir-uploads.mjs
//
// FACA BACKUP ANTES (scripts/backup-uploads.sh) — este script sobrescreve os originais.
//
// Seguranca:
//  - escreve em .tmp, RELE o resultado com sharp e so' entao renomeia (atomico)
//  - so' substitui se encolher >=5% E as dimensoes baterem com o esperado
//  - aborta tudo no primeiro erro (nao segue com o acervo meio convertido)
//  - preserva modo 0644 (o nginx precisa ler via `other`)
import { readdirSync, statSync, writeFileSync, renameSync, unlinkSync, chmodSync } from 'node:fs';
import { join, extname } from 'node:path';
import { createRequire } from 'node:module';

// sharp NAO e' dependencia deste projeto — a compressao de uploads novos acontece no
// navegador (frontend/src/utils/imageCompress.js). Aponte SHARP_FROM para qualquer
// diretorio que tenha sharp instalado.
const require = createRequire(process.env.SHARP_FROM || '/var/www/catalogo-digital/');
const sharp = require('sharp');

const SRC = process.env.UPLOADS_DIR || '/opt/apps/agendamentos-online-mvp/backend/uploads';
const MAX_DIM = 1600;
const Q = 82;
const GANHO_MINIMO = 0.05;
const DRY = process.argv.includes('--dry');

function listar(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...listar(p));
    else out.push(p);
  }
  return out;
}

const kb = (n) => (n / 1024).toFixed(0) + ' KB';
let antesTotal = 0, depoisTotal = 0, trocados = 0, mantidos = 0;

for (const f of listar(SRC)) {
  const antes = statSync(f).size;
  antesTotal += antes;
  const ext = extname(f).toLowerCase();
  const rel = f.replace(SRC + '/', '');

  const meta = await sharp(f, { failOn: 'none' }).metadata();
  const maiorLado = Math.max(meta.width || 0, meta.height || 0);
  const precisaResize = maiorLado > MAX_DIM;

  let pipe = sharp(f, { failOn: 'none' });
  if (precisaResize) {
    pipe = pipe.resize({ width: MAX_DIM, height: MAX_DIM, fit: 'inside', withoutEnlargement: true });
  }
  pipe = ext === '.png' ? pipe.png({ compressionLevel: 9, palette: true })
       : ext === '.webp' ? pipe.webp({ quality: Q })
       : pipe.jpeg({ quality: Q, mozjpeg: true });

  const buf = await pipe.toBuffer();

  if (buf.length > antes * (1 - GANHO_MINIMO)) {
    depoisTotal += antes; mantidos++;
    console.log(`  mantido  ${kb(antes).padStart(8)}  ${rel}`);
    continue;
  }

  const esperadoMaior = precisaResize ? MAX_DIM : maiorLado;

  if (DRY) {
    depoisTotal += buf.length; trocados++;
    console.log(`  [dry]    ${kb(antes).padStart(8)} -> ${kb(buf.length).padStart(8)}  ${rel}`);
    continue;
  }

  const tmp = f + '.tmp';
  writeFileSync(tmp, buf);

  // Rele do DISCO: garante que o que foi gravado e' uma imagem valida e do tamanho certo.
  const check = await sharp(tmp).metadata();
  const okDim = Math.max(check.width || 0, check.height || 0) === esperadoMaior;
  const okFmt = (check.format === 'jpeg' && (ext === '.jpg' || ext === '.jpeg'))
             || (check.format === 'png' && ext === '.png')
             || (check.format === 'webp' && ext === '.webp');

  if (!okDim || !okFmt) {
    unlinkSync(tmp);
    throw new Error(`VERIFICACAO FALHOU em ${rel}: dim=${check.width}x${check.height} (esperado maior lado ${esperadoMaior}), formato=${check.format}, ext=${ext}. Original intacto, nada foi substituido.`);
  }

  chmodSync(tmp, 0o644);
  renameSync(tmp, f);   // atomico no mesmo filesystem
  depoisTotal += buf.length; trocados++;
  console.log(`  OK       ${kb(antes).padStart(8)} -> ${kb(buf.length).padStart(8)}  (${meta.width}x${meta.height} -> ${check.width}x${check.height})  ${rel}`);
}

console.log('--- total ---');
console.log(`${trocados} recomprimidos, ${mantidos} mantidos`);
console.log(`antes:  ${kb(antesTotal)}`);
console.log(`depois: ${kb(depoisTotal)}`);
console.log(`ganho:  ${(100 - depoisTotal / antesTotal * 100).toFixed(1)}%`);
