// Compressao de imagem no cliente: garante que ela NUNCA impede o envio.
//
// A compressao roda antes do upload (utils/imageCompress.js). Se ela lancar ou
// devolver lixo, o usuario perde a foto sem entender o porque — por isso todo
// caminho de falha tem que cair de volta no arquivo original.
//
// Rodar: node --test frontend/src/utils/__tests__/image-compress.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

import { dataUrlBytes, compressImageToDataUrl } from '../imageCompress.js';

/** File/Blob minimo: so o que o helper consome. */
function fakeFile(bytes, type = 'image/jpeg') {
  return { size: bytes, type };
}

/** Instala um FileReader que devolve sempre o mesmo data URL. */
function stubFileReader(dataUrl) {
  globalThis.FileReader = class {
    readAsDataURL() {
      this.result = dataUrl;
      queueMicrotask(() => this.onload?.());
    }
  };
}

/** Data URL com `n` bytes uteis de payload. */
function dataUrlDe(n, mime = 'image/jpeg') {
  return `data:${mime};base64,${'A'.repeat(Math.ceil(n / 3) * 4)}`;
}

function limparDom() {
  delete globalThis.document;
  delete globalThis.createImageBitmap;
  delete globalThis.Image;
  delete globalThis.URL.createObjectURL;
}

/**
 * Instala um canvas falso que emite `mimeEmitido` com `bytesSaida` bytes.
 * Simula tambem o navegador que ignora o formato pedido e devolve PNG.
 */
function stubCanvas({ mimeEmitido, bytesSaida, largura = 2000, altura = 1000 }) {
  globalThis.createImageBitmap = async () => ({ width: largura, height: altura, close() {} });
  globalThis.document = {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => ({ drawImage() {} }),
      toDataURL: () => dataUrlDe(bytesSaida, mimeEmitido),
    }),
  };
}

test('dataUrlBytes desconta o cabecalho e o padding', () => {
  assert.equal(dataUrlBytes('data:image/webp;base64,QUJD'), 3);       // "ABC"
  assert.equal(dataUrlBytes('data:image/webp;base64,QUJDRA=='), 4);   // padding ==
  assert.equal(dataUrlBytes('data:image/webp;base64,QUJDREU='), 5);   // padding =
  assert.equal(dataUrlBytes(''), 0);
  assert.equal(dataUrlBytes(null), 0);
});

test('sem canvas disponivel, devolve o original intacto', async () => {
  limparDom();
  const original = dataUrlDe(900_000);
  stubFileReader(original);

  const r = await compressImageToDataUrl(fakeFile(900_000));

  assert.equal(r.comprimida, false);
  assert.equal(r.dataUrl, original, 'o data URL original tem que passar sem alteracao');
});

test('comprime quando o resultado e menor', async () => {
  const original = dataUrlDe(900_000);
  stubFileReader(original);
  stubCanvas({ mimeEmitido: 'image/webp', bytesSaida: 120_000 });

  const r = await compressImageToDataUrl(fakeFile(900_000));

  assert.equal(r.comprimida, true);
  assert.ok(r.dataUrl.startsWith('data:image/webp'), 'deve sair como webp');
  assert.ok(r.bytes < r.bytesOriginais);
  limparDom();
});

test('navegador que ignora webp e devolve PNG cai no original', async () => {
  // Safari antigo: toDataURL('image/webp') retorna PNG silenciosamente. Se aceitassemos,
  // enviariamos um PNG bem maior que o JPEG de entrada.
  const original = dataUrlDe(900_000);
  stubFileReader(original);
  stubCanvas({ mimeEmitido: 'image/png', bytesSaida: 100 });

  const r = await compressImageToDataUrl(fakeFile(900_000));

  assert.equal(r.comprimida, false);
  assert.equal(r.dataUrl, original);
  limparDom();
});

test('resultado maior que o original nao e usado', async () => {
  // Reprocessar imagem pequena/ja comprimida costuma inflar.
  const original = dataUrlDe(5_000);
  stubFileReader(original);
  stubCanvas({ mimeEmitido: 'image/webp', bytesSaida: 40_000, largura: 80, altura: 80 });

  const r = await compressImageToDataUrl(fakeFile(5_000));

  assert.equal(r.comprimida, false);
  assert.equal(r.dataUrl, original);
  limparDom();
});

test('erro na decodificacao nao propaga', async () => {
  const original = dataUrlDe(900_000);
  stubFileReader(original);
  globalThis.createImageBitmap = async () => { throw new Error('formato nao suportado'); };
  globalThis.URL.createObjectURL = () => 'blob:x';
  globalThis.URL.revokeObjectURL = () => {};
  globalThis.Image = class {
    set src(_) { queueMicrotask(() => this.onerror?.()); }
  };

  const r = await compressImageToDataUrl(fakeFile(900_000));

  assert.equal(r.comprimida, false, 'falha de decodificacao vira fallback, nao excecao');
  assert.equal(r.dataUrl, original);
  limparDom();
});
