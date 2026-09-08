import { deflateSync } from 'node:zlib';

// Tipografía bitmap mínima para documentos sintéticos; sin servicios gráficos externos.
const glyphs = Object.fromEntries(Object.entries({
 A:'01110/10001/10001/11111/10001/10001/10001',B:'11110/10001/10001/11110/10001/10001/11110',C:'01111/10000/10000/10000/10000/10000/01111',D:'11110/10001/10001/10001/10001/10001/11110',E:'11111/10000/10000/11110/10000/10000/11111',F:'11111/10000/10000/11110/10000/10000/10000',G:'01111/10000/10000/10111/10001/10001/01111',H:'10001/10001/10001/11111/10001/10001/10001',I:'11111/00100/00100/00100/00100/00100/11111',J:'00111/00010/00010/00010/10010/10010/01100',K:'10001/10010/10100/11000/10100/10010/10001',L:'10000/10000/10000/10000/10000/10000/11111',M:'10001/11011/10101/10101/10001/10001/10001',N:'10001/11001/10101/10011/10001/10001/10001',O:'01110/10001/10001/10001/10001/10001/01110',P:'11110/10001/10001/11110/10000/10000/10000',Q:'01110/10001/10001/10001/10101/10010/01101',R:'11110/10001/10001/11110/10100/10010/10001',S:'01111/10000/10000/01110/00001/00001/11110',T:'11111/00100/00100/00100/00100/00100/00100',U:'10001/10001/10001/10001/10001/10001/01110',V:'10001/10001/10001/10001/10001/01010/00100',W:'10001/10001/10001/10101/10101/11011/10001',X:'10001/10001/01010/00100/01010/10001/10001',Y:'10001/10001/01010/00100/00100/00100/00100',Z:'11111/00001/00010/00100/01000/10000/11111',
 '0':'01110/10001/10011/10101/11001/10001/01110','1':'00100/01100/00100/00100/00100/00100/01110','2':'01110/10001/00001/00010/00100/01000/11111','3':'11110/00001/00001/01110/00001/00001/11110','4':'00010/00110/01010/10010/11111/00010/00010','5':'11111/10000/10000/11110/00001/00001/11110','6':'01110/10000/10000/11110/10001/10001/01110','7':'11111/00001/00010/00100/01000/01000/01000','8':'01110/10001/10001/01110/10001/10001/01110','9':'01110/10001/10001/01111/00001/00001/01110',
 '-':'00000/00000/00000/11111/00000/00000/00000','.':'00000/00000/00000/00000/00000/00110/00110',':':'00000/00110/00110/00000/00110/00110/00000','/':'00001/00001/00010/00100/01000/10000/10000',
}).map(([key, value]) => [key, value.split('/')]));
const crcTable = Array.from({length:256},(_, index) => { let c=index; for(let i=0;i<8;i++)c=(c&1)?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
function crc(data) {let value=0xffffffff;for(const byte of data)value=crcTable[(value^byte)&255]^(value>>>8);return (value^0xffffffff)>>>0;}
function chunk(type, data) {const name=Buffer.from(type);const size=Buffer.alloc(4);size.writeUInt32BE(data.length);const check=Buffer.alloc(4);check.writeUInt32BE(crc(Buffer.concat([name,data])));return Buffer.concat([size,name,data,check]);}

export function invoicePng(lines, { blurred=false, rotated=false }={}) {
  let width=960,height=1280,pixels=new Uint8Array(width*height).fill(255);
  for(let row=0;row<lines.length;row++) {
    const text=lines[row].normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().slice(0,51);
    for(let col=0;col<text.length;col++) {
      const glyph=glyphs[text[col]];if(!glyph)continue;
      glyph.forEach((bits,gy)=>[...bits].forEach((bit,gx)=>{if(bit!=='1')return;for(let y=0;y<3;y++)for(let x=0;x<3;x++)pixels[(45+row*42+gy*3+y)*width+30+col*18+gx*3+x]=24;}));
    }
  }
  if(blurred) {
    const source=pixels.slice();
    for(let y=2;y<height-2;y++)for(let x=2;x<width-2;x++){let total=0;for(let yy=-2;yy<=2;yy++)for(let xx=-2;xx<=2;xx++)total+=source[(y+yy)*width+x+xx];pixels[y*width+x]=Math.round(total/25);}
  }
  if(rotated) {const output=new Uint8Array(pixels.length);for(let y=0;y<height;y++)for(let x=0;x<width;x++)output[x*height+(height-1-y)]=pixels[y*width+x];pixels=output;[width,height]=[height,width];}
  const raw=Buffer.alloc((width+1)*height);for(let y=0;y<height;y++)raw.set(pixels.subarray(y*width,(y+1)*width),y*(width+1)+1);
  const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=0;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}
