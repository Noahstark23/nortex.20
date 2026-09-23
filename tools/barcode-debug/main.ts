import photoUrl from './fixtures/ean13.png';
import { startCameraBarcode } from '../../utils/cameraBarcode';

// Fixture local: cambia solamente el origen del video, conserva lector y callbacks reales.
const canvas = document.querySelector<HTMLCanvasElement>('#source')!;
const video = document.querySelector<HTMLVideoElement>('#video')!;
const output = document.querySelector('#result')!;
const getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
let capture: ReturnType<typeof startCameraBarcode> | undefined;
let interval: ReturnType<typeof setInterval>;
let timeout: ReturnType<typeof setTimeout>;
const modules = '101' + '0110001' + '0100111' + '0011001' + '0100111' + '0110001' + '0111001'
    + '01010' + '1000010' + '1010000' + '1000010' + '1110010' + '1100110' + '1001000' + '101';

function run(rotate: boolean, offcenter = false, photo?: HTMLImageElement, resize = false) {
    capture?.stop();
    clearInterval(interval);
    clearTimeout(timeout);
    output.textContent = 'Leyendo…';
    canvas.width = 640; canvas.height = 480;
    const started = performance.now();
    const draw = () => {
        const changed = resize && performance.now() - started > 800;
        if (changed && canvas.width !== 1280) { canvas.width = 1280; canvas.height = 720; }
        const ctx = canvas.getContext('2d')!;
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        if (resize && !changed) return;
        if (photo) { ctx.drawImage(photo, 0, 0, 640, 480); return; }
        ctx.save();
        ctx.translate(changed ? 1000 : 320, offcenter ? 70 : 240);
        if (rotate) ctx.rotate(Math.PI / 2);
        const bits = '0'.repeat(12) + modules + '0'.repeat(12);
        ctx.fillStyle = 'black';
        for (let x = 0; x < bits.length; x++) {
            if (bits[x] === '1') ctx.fillRect(x * 3 - bits.length * 1.5, -60, 3, 120);
        }
        ctx.restore();
    };
    draw();
    interval = setInterval(draw, 80);
    const stream = canvas.captureStream(12);
    navigator.mediaDevices.getUserMedia = async () => {
        navigator.mediaDevices.getUserMedia = getUserMedia;
        return stream;
    };
    capture = startCameraBarcode(video, code => {
        output.textContent = 'LEÍDO: ' + code;
        clearInterval(interval);
    }, error => {
        output.textContent = 'ERROR: ' + error;
        clearInterval(interval);
    });
    timeout = setTimeout(() => {
        if (output.textContent === 'Leyendo…') {
            output.textContent = `SIN LECTURA tras 5 segundos; video ${video.videoWidth} × ${video.videoHeight}; track ${stream.getVideoTracks()[0]?.readyState}`;
        }
    }, 5000);
}

document.querySelector('#horizontal')!.addEventListener('click', () => run(false));
document.querySelector('#vertical')!.addEventListener('click', () => run(true));
document.querySelector('#offcenter')!.addEventListener('click', () => run(false, true));
window.addEventListener('pagehide', () => {
    capture?.stop();
    clearInterval(interval);
    clearTimeout(timeout);
});

document.querySelector('#photo')!.addEventListener('click', async () => {
    const photo = new Image(); photo.src = photoUrl;
    await photo.decode(); run(false, false, photo);
});

document.querySelector('#resize')!.addEventListener('click', () => run(false, false, undefined, true));
