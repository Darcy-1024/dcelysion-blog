const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const dirs = [
  'F:\\dcelysion-blog\\src\\assets\\images\\DesktopWallpaper',
  'F:\\dcelysion-blog\\src\\assets\\images\\MobileWallpaper',
];

async function convert() {
  for (const dir of dirs) {
    const files = fs.readdirSync(dir).filter(f => /\.(jpg|jpeg|png)$/i.test(f));
    console.log(`\n${dir}`);
    for (const file of files) {
      const input = path.join(dir, file);
      const output = path.join(dir, file.replace(/\.(jpg|jpeg|png)$/i, '.avif'));
      console.log(`  ${file} -> ${path.basename(output)}`);
      await sharp(input)
        .avif({ quality: 70, effort: 4 })
        .toFile(output);
    }
  }
  console.log('\nDone.');
}

convert().catch(e => { console.error(e); process.exit(1); });
