import { describe, expect, it, vi } from 'vitest';
import {
    ScaleFrameError,
    ScaleStabilityTracker,
    SimulatedScaleAdapter,
    WebSerialTextScaleAdapter,
    detectWebSerialScaleSupport,
    parseScaleTextFrame,
    type ScaleFrameParserConfig,
    type ScaleStateSnapshot,
} from '../utils/scaleAdapters';

const CONFIG: ScaleFrameParserConfig = {
    defaultUnit: 'kg',
    maxQuantity: '60',
    maxDecimalPlaces: 3,
    stableReadings: 3,
    stabilityTolerance: '0.002',
};

describe('parseScaleTextFrame', () => {
    it('acepta únicamente la gramática textual acotada', () => {
        expect(parseScaleTextFrame('ST,1.250,kg', CONFIG)).toEqual({
            kind: 'READING',
            quantity: '1.25',
            unit: 'kg',
            deviceStable: true,
        });
        expect(parseScaleTextFrame('US: 1,249 kg', CONFIG)).toEqual({
            kind: 'READING',
            quantity: '1.249',
            unit: 'kg',
            deviceStable: false,
        });
        expect(parseScaleTextFrame('0.500', CONFIG)).toMatchObject({
            kind: 'READING',
            quantity: '0.5',
            unit: 'kg',
        });
    });

    it('traduce sobrecarga y error sin inventar una cantidad', () => {
        expect(parseScaleTextFrame('OL', CONFIG)).toEqual({
            kind: 'OVERLOAD',
            message: 'La balanza reportó sobrecarga',
        });
        expect(parseScaleTextFrame('ERROR 01', CONFIG)).toEqual({
            kind: 'ERROR',
            message: 'La balanza reportó un error',
        });
        expect(parseScaleTextFrame('61.000 kg', CONFIG).kind).toBe('OVERLOAD');
    });

    it('rechaza frames arbitrarios, largos o con precisión excesiva', () => {
        expect(() => parseScaleTextFrame('eval(alert(1))', CONFIG)).toThrow(ScaleFrameError);
        expect(() => parseScaleTextFrame('1.2345 kg', CONFIG)).toThrow('excede 3 decimales');
        expect(() => parseScaleTextFrame('1'.repeat(97), CONFIG)).toThrow('mayor de 96');
        expect(() => parseScaleTextFrame('NaN kg', CONFIG)).toThrow(ScaleFrameError);
    });
});

describe('ScaleStabilityTracker', () => {
    it('exige lecturas repetidas dentro de la tolerancia', () => {
        const tracker = new ScaleStabilityTracker(CONFIG);
        const first = tracker.ingest(parseScaleTextFrame('1.250 kg', CONFIG), 1);
        const second = tracker.ingest(parseScaleTextFrame('1.251 kg', CONFIG), 2);
        const third = tracker.ingest(parseScaleTextFrame('1.249 kg', CONFIG), 3);

        expect(first.state).toBe('UNSTABLE');
        expect(second.state).toBe('UNSTABLE');
        expect(third).toMatchObject({
            state: 'STABLE',
            reading: { quantity: '1.249', unit: 'kg', stable: true, capturedAt: 3 },
        });
    });

    it('reinicia la ventana ante deriva, negativo, inestabilidad o cambio de unidad', () => {
        const tracker = new ScaleStabilityTracker(CONFIG);
        tracker.ingest(parseScaleTextFrame('1.000 kg', CONFIG));
        tracker.ingest(parseScaleTextFrame('1.001 kg', CONFIG));
        expect(tracker.ingest(parseScaleTextFrame('1.100 kg', CONFIG)).state).toBe('UNSTABLE');
        expect(tracker.ingest(parseScaleTextFrame('-0.100 kg', CONFIG)).state).toBe('NEGATIVE');
        expect(tracker.ingest(parseScaleTextFrame('US,1.100,kg', CONFIG)).state).toBe('UNSTABLE');
        expect(tracker.ingest(parseScaleTextFrame('100 g', CONFIG)).state).toBe('UNSTABLE');
    });

    it('cero nunca llega a STABLE aunque el indicador lo marque estable', () => {
        const tracker = new ScaleStabilityTracker(CONFIG);
        const zero = parseScaleTextFrame('ST,0.000,kg', CONFIG);

        for (let index = 0; index < 5; index += 1) {
            expect(tracker.ingest(zero)).toMatchObject({
                state: 'UNSTABLE',
                reading: { quantity: '0', stable: false },
            });
        }
    });
});

describe('detección de transporte', () => {
    it('explica explícitamente que Android WebView no ofrece Web Serial', () => {
        const support = detectWebSerialScaleSupport({
            userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel Build/UP1A; wv) Version/4.0 Chrome/124 Mobile Safari/537.36',
            serialAvailable: false,
            secureContext: true,
        });
        expect(support).toMatchObject({ supported: false, environment: 'ANDROID_WEBVIEW' });
        expect(support.reason).toContain('no expone Web Serial');
    });

    it('distingue contexto inseguro, navegador sin API y soporte disponible', () => {
        expect(detectWebSerialScaleSupport({ userAgent: 'Chrome', serialAvailable: true, secureContext: false }).environment)
            .toBe('INSECURE_CONTEXT');
        expect(detectWebSerialScaleSupport({ userAgent: 'Firefox', serialAvailable: false, secureContext: true }).environment)
            .toBe('UNSUPPORTED');
        expect(detectWebSerialScaleSupport({ userAgent: 'Chrome', serialAvailable: true, secureContext: true }))
            .toMatchObject({ supported: true, environment: 'WEB_SERIAL' });
    });
});

describe('adaptadores read-only', () => {
    it('el simulador está rotulado como prueba y publica todos sus estados', async () => {
        const adapter = new SimulatedScaleAdapter(CONFIG);
        const states: ScaleStateSnapshot[] = [];
        const unsubscribe = adapter.onState(state => states.push(state));

        expect(adapter.label).toContain('solo prueba');
        await adapter.connect();
        adapter.emitTestFrame('1.250 kg');
        adapter.emitTestFrame('1.251 kg');
        adapter.emitTestFrame('1.249 kg');
        expect(await adapter.read()).toMatchObject({ quantity: '1.249', stable: true });
        await adapter.disconnect();
        unsubscribe();

        expect(states.map(state => state.state)).toEqual([
            'DISCONNECTED',
            'CONNECTING',
            'UNSTABLE',
            'UNSTABLE',
            'UNSTABLE',
            'STABLE',
            'DISCONNECTED',
        ]);
    });

    it('Web Serial abre únicamente el canal legible y jamás escribe al dispositivo', async () => {
        let cancelled = false;
        const writableGetter = vi.fn(() => {
            throw new Error('No debe tocar writable');
        });
        const reader = {
            read: vi.fn(async () => ({ done: true as const })),
            cancel: vi.fn(async () => { cancelled = true; }),
            releaseLock: vi.fn(),
        };
        const port = {
            readable: { getReader: () => reader },
            open: vi.fn(async () => undefined),
            close: vi.fn(async () => undefined),
            get writable() { return writableGetter(); },
        };
        const adapter = new WebSerialTextScaleAdapter({
            parser: CONFIG,
            support: { userAgent: 'Chrome', serialAvailable: true, secureContext: true },
            serialApi: { requestPort: vi.fn(async () => port) },
        });

        await adapter.connect();
        await adapter.disconnect();

        expect(port.open).toHaveBeenCalledWith(expect.objectContaining({ baudRate: 9600 }));
        expect(writableGetter).not.toHaveBeenCalled();
        expect(cancelled).toBe(true);
        expect(port.close).toHaveBeenCalledOnce();
    });

    it('falla cerrado con explicación cuando Web Serial no está disponible', async () => {
        const adapter = new WebSerialTextScaleAdapter({
            parser: CONFIG,
            support: { userAgent: 'Firefox', serialAvailable: false, secureContext: true },
        });
        await expect(adapter.connect()).rejects.toThrow('no ofrece Web Serial');
        expect(await adapter.read()).toBeNull();
    });
});
