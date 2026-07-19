// Gera os PNGs do app a partir de public/icon.svg.
//
// Por que PNG se já temos SVG: o Safari ignora `apple-touch-icon` em SVG e cai
// num screenshot da página como ícone da home screen. Sem o PNG 180x180 o PWA
// fica com cara de site salvo no iOS.
//
// Rodar após qualquer mudança no icon.svg:  npm run icons
import sharp from 'sharp'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const publicDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')

// 180: apple-touch-icon (iOS). 192/512: critério de instalação do Chrome.
const SIZES = [180, 192, 512]

const svg = await readFile(join(publicDir, 'icon.svg'))

await Promise.all(
  SIZES.map((size) =>
    sharp(svg, { density: 384 })
      .resize(size, size)
      .png()
      .toFile(join(publicDir, `icon-${size}.png`))
      .then(() => console.log(`icon-${size}.png`)),
  ),
)
