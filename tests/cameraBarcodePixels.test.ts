import { BinaryBitmap, HybridBinarizer, RGBLuminanceSource, MultiFormatReader, BarcodeFormat, DecodeHintType } from '@zxing/library';
import { expect, it } from 'vitest';

// Patrón EAN-13 sintético conocido: 7501055363018. No son fotogramas físicos.
// Separado del runtime: comprueba que el decoder real lee píxeles, no un mock.
const modules = '101' + '0110001' + '0100111' + '0011001' + '0100111' + '0110001' + '0111001'
    + '01010' + '1000010' + '1010000' + '1000010' + '1110010' + '1100110' + '1001000' + '101';
it('el decoder real reconoce un EAN-13 rasterizado', () => {
    // 5(L), 0(G), 1(L), 0(G), 5(L), 5(G), derecha 3,6,3,0,1,8.
    const bits = '0'.repeat(12) + modules + '0'.repeat(12);
    const width = bits.length * 3, height = 100;
    const pixels = new Uint8ClampedArray(width * height).fill(255);
    for (let y = 10; y < 90; y++) for (let x = 0; x < width; x++) if (bits[Math.floor(x / 3)] === '1') pixels[y * width + x] = 0;
    const reader = new MultiFormatReader();
    const bitmap = new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(pixels, width, height)));
    const result = reader.decode(bitmap, new Map([[DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.EAN_13]]]));
    expect(result.getText()).toBe('7501055363018');
    expect(result.getBarcodeFormat()).toBe(BarcodeFormat.EAN_13);
});
