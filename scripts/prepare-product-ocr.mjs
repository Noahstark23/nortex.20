import { mkdir, copyFile, readdir } from 'node:fs/promises';
import path from 'node:path';
const target = path.resolve('public/product-ocr-v1');
await mkdir(target, {recursive:true});
await copyFile('node_modules/tesseract.js/dist/worker.min.js', `${target}/worker.min.js`);
for (const file of await readdir('node_modules/tesseract.js-core')) {
    if (file.endsWith('.wasm') || file.endsWith('.wasm.js') || file === 'LICENSE') await copyFile(`node_modules/tesseract.js-core/${file}`, `${target}/${file}`);
}
await copyFile('node_modules/@tesseract.js-data/spa/4.0.0_best_int/spa.traineddata.gz', `${target}/spa.traineddata.gz`);
