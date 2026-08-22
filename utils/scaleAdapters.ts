import Decimal from 'decimal.js';
import { convertQuantity, formatQuantity, parseQuantity, type QuantityUnit } from './quantity';

/**
 * Capa de lectura de balanzas. Es deliberadamente read-only: este contrato no
 * expone tare, calibración, configuración ni escritura hacia el equipo.
 *
 * Web Serial es un transporte genérico, no una declaración de compatibilidad
 * con una marca o modelo. Cada protocolo real debe validarse con el equipo.
 */
export type ScaleConnectionState =
    | 'DISCONNECTED'
    | 'CONNECTING'
    | 'UNSTABLE'
    | 'STABLE'
    | 'NEGATIVE'
    | 'OVERLOAD'
    | 'ERROR';

export type ScaleAdapterKind = 'SIMULATOR' | 'WEB_SERIAL_TEXT';

export interface ScaleReading {
    quantity: string;
    unit: QuantityUnit;
    stable: boolean;
    capturedAt: number;
}

export interface ScaleStateSnapshot {
    state: ScaleConnectionState;
    reading: ScaleReading | null;
    message: string;
}

export type ScaleStateListener = (snapshot: ScaleStateSnapshot) => void;

export interface ScaleAdapter {
    readonly kind: ScaleAdapterKind;
    readonly label: string;
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    read(): Promise<ScaleReading | null>;
    onState(listener: ScaleStateListener): () => void;
}

export interface ScaleFrameParserConfig {
    /** Unidad usada si el frame no la incluye. */
    defaultUnit: 'g' | 'kg' | 'oz' | 'lb';
    /** Rango operativo de esta integración; no debe confundirse con calibración. */
    minQuantity?: string;
    maxQuantity: string;
    maxFrameLength?: number;
    maxDecimalPlaces?: number;
    stableReadings?: number;
    stabilityTolerance?: string;
}

export interface ParsedScaleFrame {
    kind: 'READING' | 'OVERLOAD' | 'ERROR';
    quantity?: string;
    unit?: 'g' | 'kg' | 'oz' | 'lb';
    deviceStable?: boolean;
    message?: string;
}

export class ScaleFrameError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ScaleFrameError';
    }
}

const DEFAULT_MAX_FRAME_LENGTH = 96;
const ABSOLUTE_MAX_FRAME_LENGTH = 256;
const ABSOLUTE_MAX_DECIMALS = 4;
const MASS_UNITS = new Set(['g', 'kg', 'oz', 'lb']);

const normalizeConfig = (config: ScaleFrameParserConfig): Required<ScaleFrameParserConfig> => {
    const maxFrameLength = config.maxFrameLength ?? DEFAULT_MAX_FRAME_LENGTH;
    const maxDecimalPlaces = config.maxDecimalPlaces ?? ABSOLUTE_MAX_DECIMALS;
    const stableReadings = config.stableReadings ?? 3;
    const stabilityTolerance = config.stabilityTolerance ?? '0.002';
    const minQuantity = config.minQuantity ?? '0';

    if (!MASS_UNITS.has(config.defaultUnit)) throw new ScaleFrameError('La unidad configurada no es compatible');
    if (!Number.isSafeInteger(maxFrameLength) || maxFrameLength < 8 || maxFrameLength > ABSOLUTE_MAX_FRAME_LENGTH) {
        throw new ScaleFrameError(`El frame debe limitarse entre 8 y ${ABSOLUTE_MAX_FRAME_LENGTH} caracteres`);
    }
    if (!Number.isSafeInteger(maxDecimalPlaces) || maxDecimalPlaces < 0 || maxDecimalPlaces > ABSOLUTE_MAX_DECIMALS) {
        throw new ScaleFrameError(`La precisión debe estar entre 0 y ${ABSOLUTE_MAX_DECIMALS} decimales`);
    }
    if (!Number.isSafeInteger(stableReadings) || stableReadings < 2 || stableReadings > 10) {
        throw new ScaleFrameError('La estabilidad requiere entre 2 y 10 lecturas repetidas');
    }

    let min: Decimal;
    let max: Decimal;
    let tolerance: Decimal;
    try {
        min = new Decimal(minQuantity);
        max = new Decimal(config.maxQuantity);
        tolerance = new Decimal(stabilityTolerance);
    } catch {
        throw new ScaleFrameError('Los límites del parser deben ser decimales válidos');
    }
    if (!min.isFinite() || min.isNegative() || !max.isFinite() || !max.greaterThan(min)) {
        throw new ScaleFrameError('El rango configurado de la balanza no es válido');
    }
    if (!tolerance.isFinite() || tolerance.isNegative() || tolerance.decimalPlaces() > ABSOLUTE_MAX_DECIMALS) {
        throw new ScaleFrameError('La tolerancia de estabilidad no es válida');
    }

    return {
        ...config,
        minQuantity: min.toString(),
        maxQuantity: max.toString(),
        maxFrameLength,
        maxDecimalPlaces,
        stableReadings,
        stabilityTolerance: tolerance.toString(),
    };
};

/**
 * Gramática acotada para indicadores de texto comunes:
 *   `1.250 kg`, `ST,1.250,kg`, `US:+0.430 kg`, `OL`, `ERR`.
 * No ejecuta regex ni scripts configurados por el usuario.
 */
export const parseScaleTextFrame = (
    rawFrame: string,
    parserConfig: ScaleFrameParserConfig,
): ParsedScaleFrame => {
    const config = normalizeConfig(parserConfig);
    if (typeof rawFrame !== 'string' || rawFrame.length === 0 || rawFrame.length > config.maxFrameLength) {
        throw new ScaleFrameError(`Frame vacío o mayor de ${config.maxFrameLength} caracteres`);
    }

    const frame = rawFrame.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, '').trim();
    if (!frame) throw new ScaleFrameError('El frame no contiene una lectura');
    if (/^(?:OL|OVERLOAD)(?:\b|$)/i.test(frame)) {
        return { kind: 'OVERLOAD', message: 'La balanza reportó sobrecarga' };
    }
    if (/^(?:ERR|ERROR)(?:\b|$)/i.test(frame)) {
        return { kind: 'ERROR', message: 'La balanza reportó un error' };
    }

    const statusMatch = frame.match(/^(ST|S|US|U)(?:\s*[,;:]\s*|\s+)/i);
    const deviceStable = statusMatch ? /^(ST|S)$/i.test(statusMatch[1]) : undefined;
    const payload = statusMatch ? frame.slice(statusMatch[0].length).trim() : frame;
    const match = payload.match(/^([+-]?\d{1,14}(?:[.,]\d{1,4})?)(?:\s*[,;]\s*|\s*)(g|kg|oz|lb)?$/i);
    if (!match) throw new ScaleFrameError('El frame no coincide con el formato de texto permitido');

    const literal = match[1].replace(',', '.');
    const decimals = literal.includes('.') ? literal.split('.')[1].length : 0;
    if (decimals > config.maxDecimalPlaces) {
        throw new ScaleFrameError(`La lectura excede ${config.maxDecimalPlaces} decimales`);
    }

    const value = new Decimal(literal);
    if (!value.isFinite()) throw new ScaleFrameError('La lectura no es finita');
    const unit = (match[2]?.toLowerCase() ?? config.defaultUnit) as 'g' | 'kg' | 'oz' | 'lb';
    const convertBound = (bound: string): Decimal => {
        const value = new Decimal(bound);
        if (unit === config.defaultUnit || value.isZero()) return value;
        try {
            return convertQuantity(value, config.defaultUnit, unit);
        } catch {
            throw new ScaleFrameError(`La unidad ${unit} no es compatible con la unidad configurada ${config.defaultUnit}`);
        }
    };
    const min = convertBound(config.minQuantity);
    const max = convertBound(config.maxQuantity);
    if (value.greaterThan(0)) parseQuantity(value);
    if (value.greaterThan(0) && (value.lessThan(min) || value.greaterThan(max))) {
        return { kind: 'OVERLOAD', message: `La lectura está fuera del rango 0–${max.toString()} ${unit}` };
    }

    return {
        kind: 'READING',
        quantity: value.toDecimalPlaces(config.maxDecimalPlaces).toFixed().replace(/\.0+$/, ''),
        unit,
        deviceStable,
    };
};

/** Estado puro de estabilidad: exige lecturas repetidas dentro de tolerancia. */
export class ScaleStabilityTracker {
    private readonly config: Required<ScaleFrameParserConfig>;
    private candidates: Decimal[] = [];
    private unit: 'g' | 'kg' | 'oz' | 'lb' | null = null;

    constructor(config: ScaleFrameParserConfig) {
        this.config = normalizeConfig(config);
    }

    reset(): void {
        this.candidates = [];
        this.unit = null;
    }

    ingest(parsed: ParsedScaleFrame, capturedAt = Date.now()): ScaleStateSnapshot {
        if (parsed.kind === 'OVERLOAD') {
            this.reset();
            return { state: 'OVERLOAD', reading: null, message: parsed.message ?? 'Sobrecarga' };
        }
        if (parsed.kind === 'ERROR' || parsed.quantity === undefined || parsed.unit === undefined) {
            this.reset();
            return { state: 'ERROR', reading: null, message: parsed.message ?? 'Lectura inválida' };
        }

        const value = new Decimal(parsed.quantity);
        if (value.isNegative()) {
            this.reset();
            return { state: 'NEGATIVE', reading: null, message: 'La balanza reporta peso negativo' };
        }

        const reading: ScaleReading = {
            quantity: parsed.quantity,
            unit: parsed.unit,
            stable: false,
            capturedAt,
        };
        // Cero es un estado normal en reposo, pero nunca una cantidad vendible
        // ni una lectura que pueda sellarse como STABLE para el POS.
        if (!value.greaterThan(0)) {
            this.reset();
            return { state: 'UNSTABLE', reading, message: 'La balanza está en cero; coloque el producto' };
        }
        if (parsed.deviceStable === false) {
            this.reset();
            return { state: 'UNSTABLE', reading, message: 'Esperando que el peso se estabilice' };
        }

        if (this.unit !== parsed.unit) {
            this.reset();
            this.unit = parsed.unit;
        }
        const tolerance = new Decimal(this.config.stabilityTolerance);
        const anchor = this.candidates[0];
        if (anchor && value.minus(anchor).abs().greaterThan(tolerance)) this.candidates = [];
        this.candidates.push(value);
        if (this.candidates.length > this.config.stableReadings) this.candidates.shift();

        const stable = this.candidates.length >= this.config.stableReadings
            && this.candidates.every(candidate => candidate.minus(value).abs().lessThanOrEqualTo(tolerance));
        if (!stable) return { state: 'UNSTABLE', reading, message: 'Confirmando lecturas repetidas' };

        return {
            state: 'STABLE',
            reading: { ...reading, stable: true },
            message: `Lectura estable: ${formatQuantity(parsed.quantity, parsed.unit)}`,
        };
    }
}

export interface ScaleSupportEnvironment {
    userAgent?: string;
    serialAvailable?: boolean;
    secureContext?: boolean;
}

export interface ScaleSupport {
    supported: boolean;
    environment: 'WEB_SERIAL' | 'ANDROID_WEBVIEW' | 'IOS' | 'INSECURE_CONTEXT' | 'UNSUPPORTED';
    reason: string;
}

export const detectWebSerialScaleSupport = (environment: ScaleSupportEnvironment = {}): ScaleSupport => {
    const nav = typeof navigator === 'undefined' ? undefined : navigator;
    const userAgent = environment.userAgent ?? nav?.userAgent ?? '';
    const serialAvailable = environment.serialAvailable
        ?? Boolean(nav && 'serial' in nav);
    const secureContext = environment.secureContext
        ?? (typeof isSecureContext === 'boolean' ? isSecureContext : false);

    const androidWebView = /Android/i.test(userAgent) && /(?:;\s*wv\)|\bwv\b|Version\/\d+\.\d+.*Chrome)/i.test(userAgent);
    if (androidWebView) {
        return {
            supported: false,
            environment: 'ANDROID_WEBVIEW',
            reason: 'La app Android WebView no expone Web Serial. Use etiquetas impresas o un adaptador nativo validado.',
        };
    }
    if (/(?:iPhone|iPad|iPod)/i.test(userAgent)) {
        return {
            supported: false,
            environment: 'IOS',
            reason: 'Este navegador móvil no expone Web Serial. La lectura directa queda deshabilitada.',
        };
    }
    if (!secureContext) {
        return {
            supported: false,
            environment: 'INSECURE_CONTEXT',
            reason: 'Web Serial requiere HTTPS o un entorno local seguro.',
        };
    }
    if (!serialAvailable) {
        return {
            supported: false,
            environment: 'UNSUPPORTED',
            reason: 'Este navegador no ofrece Web Serial. Puede usar el lector de etiquetas o el simulador de prueba.',
        };
    }
    return {
        supported: true,
        environment: 'WEB_SERIAL',
        reason: 'Web Serial está disponible; falta validar el protocolo con el modelo físico.',
    };
};

abstract class BaseScaleAdapter implements ScaleAdapter {
    abstract readonly kind: ScaleAdapterKind;
    abstract readonly label: string;
    protected snapshot: ScaleStateSnapshot = {
        state: 'DISCONNECTED',
        reading: null,
        message: 'Balanza desconectada',
    };
    private readonly listeners = new Set<ScaleStateListener>();

    abstract connect(): Promise<void>;
    abstract disconnect(): Promise<void>;

    async read(): Promise<ScaleReading | null> {
        return this.snapshot.reading;
    }

    onState(listener: ScaleStateListener): () => void {
        this.listeners.add(listener);
        listener(this.snapshot);
        return () => this.listeners.delete(listener);
    }

    protected emit(snapshot: ScaleStateSnapshot): void {
        this.snapshot = snapshot;
        this.listeners.forEach(listener => listener(snapshot));
    }
}

export class SimulatedScaleAdapter extends BaseScaleAdapter {
    readonly kind = 'SIMULATOR' as const;
    readonly label = 'Simulador (solo prueba)';
    private connected = false;
    private readonly tracker: ScaleStabilityTracker;
    private readonly config: ScaleFrameParserConfig;

    constructor(config: ScaleFrameParserConfig) {
        super();
        this.config = config;
        this.tracker = new ScaleStabilityTracker(config);
    }

    async connect(): Promise<void> {
        this.emit({ state: 'CONNECTING', reading: null, message: 'Iniciando simulador de prueba' });
        this.connected = true;
        this.emit({ state: 'UNSTABLE', reading: null, message: 'Simulador listo; inyecte lecturas de prueba' });
    }

    async disconnect(): Promise<void> {
        this.connected = false;
        this.tracker.reset();
        this.emit({ state: 'DISCONNECTED', reading: null, message: 'Simulador desconectado' });
    }

    /** Hook exclusivo de QA; no representa datos de una balanza física. */
    emitTestFrame(frame: string): ScaleStateSnapshot {
        if (!this.connected) throw new ScaleFrameError('Conecte el simulador antes de emitir una lectura');
        try {
            const next = this.tracker.ingest(parseScaleTextFrame(frame, this.config));
            this.emit(next);
            return next;
        } catch (error) {
            const next: ScaleStateSnapshot = {
                state: 'ERROR',
                reading: null,
                message: error instanceof Error ? error.message : 'Frame de prueba inválido',
            };
            this.emit(next);
            return next;
        }
    }
}

interface SerialReaderLike {
    read(): Promise<{ value?: Uint8Array; done: boolean }>;
    cancel(): Promise<void>;
    releaseLock(): void;
}

interface SerialReadableLike {
    getReader(): SerialReaderLike;
}

interface SerialPortLike {
    readable?: SerialReadableLike | null;
    open(options: { baudRate: number; dataBits?: number; stopBits?: number; parity?: 'none' | 'even' | 'odd'; flowControl?: 'none' | 'hardware' }): Promise<void>;
    close(): Promise<void>;
}

interface SerialApiLike {
    requestPort(): Promise<SerialPortLike>;
}

export interface WebSerialTextScaleOptions {
    parser: ScaleFrameParserConfig;
    baudRate?: number;
    serialApi?: SerialApiLike;
    support?: ScaleSupportEnvironment;
}

const globalSerialApi = (): SerialApiLike | undefined => {
    if (typeof navigator === 'undefined' || !('serial' in navigator)) return undefined;
    return (navigator as Navigator & { serial: SerialApiLike }).serial;
};

export class WebSerialTextScaleAdapter extends BaseScaleAdapter {
    readonly kind = 'WEB_SERIAL_TEXT' as const;
    readonly label = 'Web Serial genérico (requiere validar modelo)';
    private readonly options: WebSerialTextScaleOptions;
    private readonly tracker: ScaleStabilityTracker;
    private port: SerialPortLike | null = null;
    private reader: SerialReaderLike | null = null;
    private readingLoop: Promise<void> | null = null;
    private connected = false;

    constructor(options: WebSerialTextScaleOptions) {
        super();
        this.options = options;
        this.tracker = new ScaleStabilityTracker(options.parser);
    }

    async connect(): Promise<void> {
        if (this.connected) return;
        const serialApi = this.options.serialApi ?? globalSerialApi();
        const support = detectWebSerialScaleSupport({
            ...this.options.support,
            serialAvailable: this.options.support?.serialAvailable ?? Boolean(serialApi),
        });
        if (!support.supported || !serialApi) {
            this.emit({ state: 'ERROR', reading: null, message: support.reason });
            throw new ScaleFrameError(support.reason);
        }

        const baudRate = this.options.baudRate ?? 9600;
        if (!Number.isSafeInteger(baudRate) || baudRate < 1200 || baudRate > 921600) {
            throw new ScaleFrameError('El baud rate está fuera del rango permitido');
        }

        this.emit({ state: 'CONNECTING', reading: null, message: 'Esperando selección del puerto serial' });
        try {
            const port = await serialApi.requestPort();
            await port.open({ baudRate, dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none' });
            if (!port.readable) throw new ScaleFrameError('El puerto no expone un canal de lectura');
            this.port = port;
            this.reader = port.readable.getReader();
            this.connected = true;
            this.emit({ state: 'UNSTABLE', reading: null, message: 'Puerto abierto; esperando lectura estable' });
            this.readingLoop = this.consumeReadOnly(this.reader);
        } catch (error) {
            this.connected = false;
            const message = error instanceof Error ? error.message : 'No fue posible abrir el puerto serial';
            this.emit({ state: 'ERROR', reading: null, message });
            throw error;
        }
    }

    async disconnect(): Promise<void> {
        this.connected = false;
        const reader = this.reader;
        this.reader = null;
        if (reader) {
            try { await reader.cancel(); } catch { /* el puerto puede haberse desconectado */ }
            try { reader.releaseLock(); } catch { /* lock ya liberado */ }
        }
        if (this.readingLoop) {
            try { await this.readingLoop; } catch { /* el estado ya refleja el error */ }
            this.readingLoop = null;
        }
        if (this.port) {
            try { await this.port.close(); } catch { /* dispositivo retirado */ }
            this.port = null;
        }
        this.tracker.reset();
        this.emit({ state: 'DISCONNECTED', reading: null, message: 'Balanza desconectada' });
    }

    private async consumeReadOnly(reader: SerialReaderLike): Promise<void> {
        const decoder = new TextDecoder();
        let buffer = '';
        const maxBuffer = Math.min(this.options.parser.maxFrameLength ?? DEFAULT_MAX_FRAME_LENGTH, ABSOLUTE_MAX_FRAME_LENGTH);

        try {
            while (this.connected) {
                const { value, done } = await reader.read();
                if (done || !this.connected) break;
                if (!value) continue;
                buffer += decoder.decode(value, { stream: true });
                if (buffer.length > maxBuffer * 4) {
                    buffer = '';
                    this.tracker.reset();
                    this.emit({ state: 'ERROR', reading: null, message: 'El dispositivo excedió el búfer de lectura permitido' });
                    continue;
                }

                const frames = buffer.split(/[\r\n]+/);
                buffer = frames.pop() ?? '';
                for (const frame of frames) {
                    if (!frame.trim()) continue;
                    try {
                        this.emit(this.tracker.ingest(parseScaleTextFrame(frame, this.options.parser)));
                    } catch (error) {
                        this.tracker.reset();
                        this.emit({
                            state: 'ERROR',
                            reading: null,
                            message: error instanceof Error ? error.message : 'Frame serial inválido',
                        });
                    }
                }
            }
        } catch (error) {
            if (this.connected) {
                this.emit({
                    state: 'ERROR',
                    reading: null,
                    message: error instanceof Error ? error.message : 'Se perdió la lectura serial',
                });
            }
        }
    }
}
