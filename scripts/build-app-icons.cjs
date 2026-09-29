// Code-drawn Basement monogram; raster sizes required by app manifests.
const fs = require('node:fs');
const sharp = require('sharp');
const path = require('node:path');
async function main() {
  const dir = path.join(__dirname, '../public/icons'); fs.mkdirSync(dir, { recursive: true });
  const art = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><rect width="512" height="512" rx="0" fill="#0b0e16"/><path d="M168 116h102c72 0 111 29 111 77 0 28-15 51-42 63 35 11 52 34 52 65 0 50-41 79-114 79H168V116zm66 56v57h32c33 0 48-9 48-29s-15-28-48-28h-32zm0 109v63h40c33 0 49-10 49-31s-16-32-49-32h-40z" fill="#fff"/><path d="M105 174h40v20h-40zm0 65h40v20h-40zm0 66h40v20h-40z" fill="#9749f5"/></svg>`;
  for (const [name, size] of [['icon-192',192],['icon-512',512],['maskable-512',512],['apple-touch-icon',180]]) await sharp(Buffer.from(art)).resize(size,size).png().toFile(path.join(dir,`${name}.png`));
  await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><path d="M22 12h30c28 0 32 29 14 36 22 9 16 36-12 36H22V12zm17 16v13h12c12 0 12-13 0-13H39zm0 29v12h14c12 0 12-12 0-12H39z" fill="white"/></svg>')).png().toFile(path.join(dir,'badge.png'));
}
main().catch(error => { console.error(error); process.exitCode=1; });
