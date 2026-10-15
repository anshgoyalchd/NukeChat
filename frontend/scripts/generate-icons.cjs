const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');
const req = createRequire(path.resolve(__dirname, '../../package.json'));
const puppeteer = req('puppeteer-core');

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const publicDir = path.resolve(__dirname, '../public');

async function generateIcons() {
  console.log('[generate-icons] Launching headless browser...');
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();

    // Standard Icon SVG: Sleek rounded white badge with emoji bomb and gradient border
    const standardSvg = (size) => `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
        <defs>
          <linearGradient id="border" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#F43F5E" />
            <stop offset="50%" stop-color="#6366F1" />
            <stop offset="100%" stop-color="#10B981" />
          </linearGradient>
        </defs>
        <rect width="${size}" height="${size}" rx="${size * 0.22}" fill="#FFFFFF" />
        <rect x="${size * 0.03}" y="${size * 0.03}" width="${size * 0.94}" height="${size * 0.94}" rx="${size * 0.2}" fill="none" stroke="url(#border)" stroke-width="${Math.max(2, size * 0.03)}" />
        <text x="50%" y="54%" font-size="${size * 0.52}" text-anchor="middle" dominant-baseline="middle" font-family="Apple Color Emoji, Segoe UI Emoji, sans-serif">💣</text>
      </svg>
    `;

    // Maskable Icon SVG: Full bleed white background with 20% safe-zone margin
    const maskableSvg = (size) => `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
        <rect width="${size}" height="${size}" fill="#FFFFFF" />
        <circle cx="${size * 0.5}" cy="${size * 0.5}" r="${size * 0.38}" fill="#F4F4F5" stroke="#E4E4E7" stroke-width="${Math.max(2, size * 0.02)}" />
        <text x="50%" y="54%" font-size="${size * 0.42}" text-anchor="middle" dominant-baseline="middle" font-family="Apple Color Emoji, Segoe UI Emoji, sans-serif">💣</text>
      </svg>
    `;

    const iconConfigs = [
      { name: 'icon-192.png', size: 192, svg: standardSvg(192) },
      { name: 'icon-512.png', size: 512, svg: standardSvg(512) },
      { name: 'icon-maskable-192.png', size: 192, svg: maskableSvg(192) },
      { name: 'icon-maskable-512.png', size: 512, svg: maskableSvg(512) },
      { name: 'apple-touch-icon.png', size: 180, svg: standardSvg(180) }
    ];

    for (const config of iconConfigs) {
      await page.setViewport({ width: config.size, height: config.size, deviceScaleFactor: 1 });
      await page.setContent(`
        <!DOCTYPE html>
        <html>
          <body style="margin: 0; padding: 0; overflow: hidden; background: transparent; display: flex; align-items: center; justify-content: center; width: ${config.size}px; height: ${config.size}px;">
            ${config.svg}
          </body>
        </html>
      `);

      const outPath = path.join(publicDir, config.name);
      await page.screenshot({ path: outPath, omitBackground: true });
      console.log(`[generate-icons] Saved: ${config.name} (${config.size}x${config.size})`);
    }

    // Also update icon.svg to match
    fs.writeFileSync(path.join(publicDir, 'icon.svg'), standardSvg(512), 'utf-8');
    console.log('[generate-icons] Updated icon.svg');

  } finally {
    await browser.close();
  }
}

generateIcons().catch(err => {
  console.error('[generate-icons] Failed:', err);
  process.exit(1);
});
