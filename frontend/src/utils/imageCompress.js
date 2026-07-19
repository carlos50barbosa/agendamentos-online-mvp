// Compressao de imagem no cliente, antes do upload.
//
// Os uploads sobem como data URL base64 dentro do JSON (ver backend/src/lib/avatar.js
// e irmaos), entao o que sai daqui e' exatamente o que trafega e o que fica em disco.
// Reduzir aqui corta banda de subida e de descida de uma vez.
//
// Principio: compressao e' best-effort. Qualquer falha (canvas bloqueado, formato que
// o navegador nao decodifica, resultado maior que o original) cai de volta no arquivo
// original intacto — nunca impede o usuario de enviar a foto.

const MAX_DIMENSAO_PADRAO = 1600;
const QUALIDADE_PADRAO = 0.82;

// Teto de ENTRADA. Nao e' o limite do upload (esse e' checado depois de comprimir):
// serve so para nao mandar o navegador decodificar um arquivo absurdo e travar a aba.
export const MAX_ENTRADA_BYTES = 25 * 1024 * 1024;

// O backend so aceita png/jpeg/webp (regex em backend/src/lib/*_images.js).
// Nao emita nada fora dessa lista.
const SAIDA_PADRAO = 'image/webp';

/** Le um File/Blob como data URL. */
export function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('Falha ao ler o arquivo.'));
    reader.readAsDataURL(file);
  });
}

/** Bytes reais representados por um data URL base64 (descontando o cabecalho). */
export function dataUrlBytes(dataUrl) {
  if (typeof dataUrl !== 'string') return 0;
  const i = dataUrl.indexOf(',');
  if (i < 0) return 0;
  const b64 = dataUrl.slice(i + 1);
  const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((b64.length * 3) / 4) - padding);
}

/** Decodifica o arquivo respeitando a orientacao EXIF (senao fotos de celular deitam). */
async function decodificar(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      // Safari antigo nao aceita a opcao; cai no <img> abaixo.
    }
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Nao foi possivel decodificar a imagem.'));
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

function alvoRedimensionado(largura, altura, maxDimensao) {
  const maior = Math.max(largura, altura);
  if (!maior || maior <= maxDimensao) return { largura, altura, redimensionou: false };
  const fator = maxDimensao / maior;
  return {
    largura: Math.round(largura * fator),
    altura: Math.round(altura * fator),
    redimensionou: true,
  };
}

function canvasParaDataUrl(canvas, mime, qualidade) {
  const dataUrl = canvas.toDataURL(mime, qualidade);
  // Navegador sem suporte ao formato devolve PNG silenciosamente. Detecta pelo prefixo.
  if (!dataUrl.startsWith(`data:${mime}`)) return null;
  return dataUrl;
}

/**
 * Comprime uma imagem para data URL.
 *
 * Sempre resolve — em caso de falha devolve o original com `comprimida: false`.
 *
 * @returns {Promise<{dataUrl: string, bytes: number, bytesOriginais: number, comprimida: boolean}>}
 */
export async function compressImageToDataUrl(file, opts = {}) {
  const {
    maxDimensao = MAX_DIMENSAO_PADRAO,
    qualidade = QUALIDADE_PADRAO,
    mimeSaida = SAIDA_PADRAO,
  } = opts;

  const original = await readFileAsDataUrl(file);
  const bytesOriginais = file.size || dataUrlBytes(original);
  const semCompressao = { dataUrl: original, bytes: bytesOriginais, bytesOriginais, comprimida: false };

  try {
    const fonte = await decodificar(file);
    const largura = fonte.width;
    const altura = fonte.height;
    if (!largura || !altura) return semCompressao;

    const alvo = alvoRedimensionado(largura, altura, maxDimensao);
    const canvas = document.createElement('canvas');
    canvas.width = alvo.largura;
    canvas.height = alvo.altura;

    const ctx = canvas.getContext('2d');
    if (!ctx) return semCompressao;
    ctx.drawImage(fonte, 0, 0, alvo.largura, alvo.altura);
    if (typeof fonte.close === 'function') fonte.close();

    const comprimida = canvasParaDataUrl(canvas, mimeSaida, qualidade);
    if (!comprimida) return semCompressao;

    const bytes = dataUrlBytes(comprimida);
    // Imagem pequena ou ja bem comprimida pode crescer ao reprocessar. Fica o menor.
    if (bytes >= bytesOriginais) return semCompressao;

    return { dataUrl: comprimida, bytes, bytesOriginais, comprimida: true };
  } catch {
    return semCompressao;
  }
}
