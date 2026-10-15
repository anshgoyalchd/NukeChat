const fs = require('fs');
const path = require('path');

const distDir = path.resolve(__dirname, '../dist');
const assetsDir = path.join(distDir, 'assets');
const swFile = path.join(distDir, 'sw.js');

if (!fs.existsSync(distDir) || !fs.existsSync(swFile)) {
  console.warn('[build-sw] dist or sw.js not found, skipping build-sw.');
  process.exit(0);
}

// Gather all files in assetsDir
const assetFiles = [];
if (fs.existsSync(assetsDir)) {
  const files = fs.readdirSync(assetsDir);
  for (const file of files) {
    assetFiles.push(`/assets/${file}`);
  }
}

// Gather all root static files in dist
const rootFiles = fs.readdirSync(distDir).filter((file) => {
  const fullPath = path.join(distDir, file);
  return (
    !fs.statSync(fullPath).isDirectory() &&
    file !== 'sw.js' &&
    file !== '_redirects' &&
    !file.startsWith('google') &&
    !file.startsWith('63de')
  );
}).map(f => `/${f}`);

// Base static files to precache
const staticAssets = Array.from(new Set([
  '/',
  '/index.html',
  ...rootFiles,
  ...assetFiles,
]));

console.log('[build-sw] Found assets to precache:', staticAssets);

const buildHash = Date.now().toString(36);
const cacheName = `nukechat-v-${buildHash}`;

let swContent = fs.readFileSync(swFile, 'utf-8');

swContent = swContent.replace(
  /const CACHE_NAME = ["'][^"']+["'];/,
  `const CACHE_NAME = "${cacheName}";`
);

swContent = swContent.replace(
  /const STATIC_ASSETS = \[[^\]]*\];/s,
  `const STATIC_ASSETS = ${JSON.stringify(staticAssets, null, 2)};`
);

fs.writeFileSync(swFile, swContent, 'utf-8');
console.log(`[build-sw] Successfully updated ${swFile} with ${staticAssets.length} precached assets (Cache: ${cacheName})`);
