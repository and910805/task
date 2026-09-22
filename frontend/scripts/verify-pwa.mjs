import { access, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const publicDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const requiredFiles = [
  'manifest.webmanifest',
  'offline.html',
  'sw.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
];

for (const file of requiredFiles) {
  await access(resolve(publicDir, file));
}

const readPngDimensions = async (file) => {
  const bytes = await readFile(resolve(publicDir, file));
  if (bytes.toString('ascii', 1, 4) !== 'PNG') {
    throw new Error(`${file} is not a PNG file.`);
  }
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
};

for (const [file, size] of [['icons/icon-192.png', 192], ['icons/icon-512.png', 512], ['icons/apple-touch-icon.png', 180]]) {
  const [width, height] = await readPngDimensions(file);
  if (width !== size || height !== size) {
    throw new Error(`${file} must be ${size}x${size}.`);
  }
}

const manifest = JSON.parse(await readFile(resolve(publicDir, 'manifest.webmanifest'), 'utf8'));
const serviceWorker = await readFile(resolve(publicDir, 'sw.js'), 'utf8');

if (manifest.name !== '立翔水電行' || manifest.display !== 'standalone') {
  throw new Error('Manifest must identify 立翔水電行 as a standalone app.');
}

for (const size of ['192x192', '512x512']) {
  if (!manifest.icons.some((icon) => icon.sizes === size && icon.type === 'image/png')) {
    throw new Error(`Manifest is missing its ${size} PNG icon.`);
  }
}

for (const restrictedPath of ["url.pathname.startsWith('/api/')", "url.pathname.startsWith('/uploads/')"]) {
  if (!serviceWorker.includes(restrictedPath)) {
    throw new Error(`Service worker must bypass ${restrictedPath}.`);
  }
}

if (!serviceWorker.includes("fetch('/index.html')") || !serviceWorker.includes("caches.match('/offline.html')")) {
  throw new Error('Offline navigation must use only the app shell or offline page.');
}

console.log('PWA files and conservative cache boundaries verified.');
