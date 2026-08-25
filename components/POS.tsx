import React, { useState, useMemo, useEffect, useLayoutEffect, useCallback, useRef, useDeferredValue } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Product, CartItem, Shift, CashMovement } from '../types';
import { effectiveTier, effectiveUnitPrice } from '../utils/pricing';
import { ArrowDownCircle, ArrowUpCircle, ShoppingCart, Plus, Minus, Trash2, Search, CreditCard, Banknote, QrCode, Tag, PackagePlus, Package, X, Save, User, Clock, Lock, ArrowRight, AlertTriangle, DollarSign, Check, Loader2, Ban, ShieldAlert, MessageCircle, Printer, FileText, RotateCcw, Zap, Upload, ScanBarcode, Volume2, VolumeX, Wallet, ParkingCircle, Keyboard, Percent, RefreshCw, WifiOff, Landmark, SlidersHorizontal, ChevronDown, ChevronUp, MoreHorizontal, PlayCircle } from 'lucide-react';
import { formatMoney, formatUSD } from '../utils/money';
import { EmptyState } from './ui/EmptyState';
import { IconButton } from './ui/IconButton';
import { printTicket, printA4, sendToWhatsApp, InvoiceData } from './InvoiceTemplate';
import { maybeAutostartTour } from '../utils/tours';
import { trackEvent } from '../utils/analytics';
import { resolvePosSimple, UI_MODE_KEY } from '../utils/navigation';
import { parseWorkbookRows, importInChunks } from '../utils/importProducts';
import { evaluarCarrito, textoAviso, textoResumen, AvisoStock } from '../utils/stockAlert';
import { indexarProductos, buscarProductos } from '../utils/posSearch';
import {
    claveCarrito, claveAparcados, leerCarritoGuardado, serializarCarrito,
    decidirRestauracion, resumenGuardado, leerAparcados, serializarAparcados,
    claveCarritoLegacy, claveAparcadosLegacy, claveLineaCarrito,
    CarritoGuardado, LineaGuardada, AparcadoGuardado,
} from '../utils/cartPersistence';
import { useReportarVenta } from './VentaEnCursoContext';
import { ReceiptTicket } from './ReceiptTicket';
import { thermalPrinter } from '../utils/thermalPrinter';
import { buildPostSalePrintOptions } from '../utils/postSalePrintOptions';
// xlsx (~430 KB) se importa dinámicamente en handleFileUpload — fuera del bundle inicial.
import {
    generateOfflineId, saveSaleOffline, getPendingSales, markSalesSynced, recordOfflineSyncResults,
    getScaleContext, saveScaleContext,
    normalizeActiveScaleContext,
    OfflineScaleContext,
} from '../lib/db';
import { convertQuantity, formatQuantity, formatQuantityValue, QuantityValidationError, validateNonNegativeQuantity, validateQuantity } from '../utils/quantity';
import { isPlaceholderTaxId } from '../utils/tenantTaxId';
import { routeScaleLabel, ScaleLabelError } from '../utils/scaleLabels';
import {
    acceptedScaleLabelUnitPrice,
    canApproveExceptionalScaleLabel,
    decideScalePreviewAcceptance,
} from '../utils/scaleLabelAcceptance';
import Decimal from 'decimal.js';

// ── Utilidades financieras del POS (string controlado + Decimal.js) ──────────
// `discount` y `basePrice` son estado comercial de la línea, no del producto.
// basePrice preserva el precio de DETALLE original de la línea: item.price es el
// precio cobrado (puede pasar a mayoreo y volver al bajar la cantidad).
type CartLine = CartItem & { discount?: number; basePrice?: number };

const effectiveSaleMode = (product: Pick<Product, 'saleMode'>): 'COUNTED' | 'MEASURED' =>
    product.saleMode === 'COUNTED' ? 'COUNTED' : 'MEASURED';

const effectiveQuantityStep = (product: Pick<Product, 'saleMode' | 'quantityStep'>): number => {
    if (Number.isFinite(product.quantityStep) && Number(product.quantityStep) > 0) {
        return Number(product.quantityStep);
    }
    // Compatibilidad D6: los productos legacy ya admitían fracciones. Solo un
    // COUNTED explícito puede imponer enteros; null/undefined conserva 4 decimales.
    return product.saleMode === 'COUNTED' ? 1 : 0.0001;
};

const lineKey = (item: CartItem): string => claveLineaCarrito(item as unknown as LineaGuardada);

const isQuotationCartLine = (item: Pick<CartItem, 'quotationItemId'>): boolean =>
    typeof item.quotationItemId === 'string' && item.quotationItemId.trim() !== '';

const isPackCartLine = (item: Pick<CartItem, 'presentation' | 'packUnit'>): boolean => {
    const presentationUnit = item.presentation?.unit?.trim().toLowerCase();
    const packUnit = item.packUnit?.trim().toLowerCase();
    return Boolean(presentationUnit && packUnit && presentationUnit === packUnit);
};

// ── Venta por mayor: la regla de precios vive en utils/pricing.ts (pura,
// testeada en tests/pricing.test.ts e importable por cualquier canal). ─────────
// Etiqueta del nivel activo de una línea (para el badge del carrito).
const lineTierBadge = (item: CartLine, wholesaleCustomer: boolean): string | null => {
    const base = item.basePrice ?? item.price;
    const presentation = isPackCartLine(item) ? 'PACK' : 'BASE';
    const { kind } = effectiveTier(
        { basePrice: base, wholesalePrice: item.wholesalePrice, wholesaleMinQty: item.wholesaleMinQty, packSize: item.packSize, packPrice: item.packPrice },
        item.quantity,
        wholesaleCustomer,
        presentation,
    );
    if (kind === 'MAYOREO') return 'MAYOREO';
    if (kind === 'EMPAQUE') return (item.packUnit || 'EMPAQUE').toUpperCase();
    return null;
};

// Sanitiza la entrada cruda de un input de dinero/cantidad a un string decimal
// seguro: solo dígitos y UN punto. Nunca usamos type="number" (quirks de float y
// separador local); el input es texto controlado y el estado se parsea con Decimal.
const sanitizeDecimalInput = (raw: string): string => {
    const cleaned = raw.replace(/[^\d.]/g, '');
    const dot = cleaned.indexOf('.');
    return dot === -1 ? cleaned : cleaned.slice(0, dot + 1) + cleaned.slice(dot + 1).replace(/\./g, '');
};

// Parser tolerante a string vacío/parcial ("", ".") → Decimal(0). Nunca lanza.
const toDecimal = (v: string | number): Decimal => {
    try {
        const d = new Decimal(v === '' || v === '.' ? 0 : v);
        return d.isFinite() ? d : new Decimal(0);
    } catch {
        return new Decimal(0);
    }
};

// ── Denominaciones sugeridas para el cobro en efectivo ──────────────────────
// POR QUÉ: los botones rápidos estaban FIJOS (100 / 200 / 500 / 1000). Con un
// total de C$645, tres de los cuatro producían un pago MENOR al total: el cajero
// tocaba "500", el modal marcaba FALTANTE y el atajo terminaba estorbando.
// REGLA (invariante): un botón de denominación NUNCA puede resultar en un pago
// menor al total. Por eso cada sugerencia es el siguiente múltiplo ESTRICTAMENTE
// mayor al total de cada escalón de billete usable — el monto exacto ya tiene su
// propio botón. Para 645 → 650 (escalón 50), 700 (100), 1000 (500 y 1000).
// Pura a propósito (sin React ni fetch): entra a la red de mutación.
const ESCALONES_EFECTIVO_NIO = [50, 100, 500, 1000];

export const denominacionesSugeridas = (
    total: Decimal.Value,
    escalones: number[] = ESCALONES_EFECTIVO_NIO,
    maximo = 3,
): Decimal[] => {
    const totalD = toDecimal(total as string | number);
    if (!totalD.isFinite() || totalD.lessThanOrEqualTo(0)) return [];

    const vistos = new Set<string>();
    const sugeridas: Decimal[] = [];
    for (const escalon of escalones) {
        const paso = toDecimal(escalon);
        if (paso.lessThanOrEqualTo(0)) continue;
        // floor(total/paso) + 1 → siempre estrictamente mayor al total, incluso
        // cuando el total ya es múltiplo exacto del escalón (500 → 550, no 500).
        const monto = totalD.div(paso).floor().plus(1).times(paso);
        const clave = monto.toFixed(2);
        if (vistos.has(clave)) continue;
        vistos.add(clave);
        sugeridas.push(monto);
    }
    return sugeridas.sort((a, b) => a.comparedTo(b)).slice(0, maximo);
};

// ── Rótulo honesto del acceso rápido de productos ───────────────────────────
// POR QUÉ: la sección decía "Más vendidos" el día 1, cuando lo que lista son los
// primeros productos del catálogo y NUNCA se vendió nada. El dueño ve el nombre
// de un producto que jamás vendió bajo ese título y deja de creerle a los
// números del sistema. Solo se afirma "Más vendidos" si (a) la lista viene de un
// ranking real y (b) hay suficientes ventas para que ese ranking signifique algo.
const MIN_VENTAS_PARA_RANKING = 20;

export const rotuloProductosRapidos = (esRanking: boolean, ventasRegistradas: number): string =>
    esRanking && ventasRegistradas >= MIN_VENTAS_PARA_RANKING ? 'Más vendidos' : 'Tus productos';

/**
 * Tarjeta de producto de la grilla — MEMOIZADA (P0-2).
 *
 * Sin esto, cada tecla en la búsqueda vuelve a renderizar todas las tarjetas
 * visibles aunque ninguna cambió. Con la grilla ya acotada el costo baja solo,
 * pero el re-render sigue siendo gratis de evitar: las props son primitivas y
 * `onAgregar` es estable.
 */
const TarjetaProducto = React.memo<{
    product: Product;
    bloqueada: boolean;
    onAgregar: (p: Product) => void;
}>(({ product, bloqueada, onAgregar }) => (
    <button
        onClick={() => onAgregar(product)}
        disabled={bloqueada}
        title={product.stock <= 0 ? 'Sin existencia en el sistema' : undefined}
        className="h-24 bg-surface-900 hover:bg-surface-800 border border-white/[0.06] rounded-card px-3 py-2 hover:border-brand/50 transition-colors text-left flex flex-col justify-between text-slate-100 active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-brand/40"
    >
        <div className="min-w-0 flex items-start gap-2">
            {/* Miniatura solo si el producto TIENE foto: nunca un hueco vacío. */}
            {product.imageUrl && (
                <img
                    src={product.imageUrl}
                    alt=""
                    loading="lazy"
                    className="w-10 h-10 rounded-control object-cover border border-white/[0.06] shrink-0"
                />
            )}
            <h3 className="font-semibold text-sm text-slate-100 leading-tight line-clamp-2 min-w-0">{product.name}</h3>
        </div>
        <div className="flex justify-between items-end gap-1">
            <span className="text-[15px] sm:text-[17px] font-bold text-brand nx-num whitespace-nowrap">{formatMoney(product.price)}</span>
            {/* El stock negativo se muestra tal cual (−3), no disfrazado de
                AGOTADO: es la señal de que el inventario ya se descuadró.
                A 12px y no 11px — a 11px fallaba el contraste AA (P2-1). */}
            <span className={`text-xs px-1.5 py-0.5 rounded-control shrink-0 ${product.stock <= 0 ? 'bg-danger-soft text-danger font-bold' : product.stock <= 5 ? 'bg-warning-soft text-amber-400' : 'text-slate-400'}`}>
                {product.stock === 0 ? 'AGOTADO' : product.stock}
            </span>
        </div>
    </button>
));
TarjetaProducto.displayName = 'TarjetaProducto';

// Acá vivía PIN_DUENO_POR_DEFECTO = '1234', el PIN que el backend siembra al
// registrar el negocio: el modal lo IMPRIMÍA en pantalla y además lo precargaba.
// Un secreto que la propia pantalla revela y rellena no es un control de acceso,
// es un trámite — y encima caía a medio cobro, con el cliente enfrente. Ahora la
// apertura no pide PIN salvo que el negocio lo exija (`requireCashierPin`), y el
// servidor resuelve al cajero desde el JWT (backend/services/shiftIdentity.ts).

/**
 * Identidad del cliente para namespacear el carrito guardado. Mismo par de
 * claves que ya usa la cola offline (`nortex_tenant_data` + `nortex_user`).
 * Devuelve null si falta cualquiera de las dos: sin identidad NO se persiste
 * nada, antes que arriesgar mezclar los carritos de dos cajeros.
 */
const identidadLocal = (): { tenantId: string; userId: string } | null => {
    try {
        const tenantId = JSON.parse(localStorage.getItem('nortex_tenant_data') || '{}')?.id;
        const userId = JSON.parse(localStorage.getItem('nortex_user') || '{}')?.id;
        if (typeof tenantId === 'string' && tenantId && typeof userId === 'string' && userId) {
            return { tenantId, userId };
        }
    } catch { /* storage ilegible → no se persiste */ }
    return null;
};

/** Línea del carrito → forma serializable. Se conserva TODO (mayoreo, empaque,
 *  basePrice) porque al restaurar la línea tiene que poder repreciarse igual. */
const aLineaGuardada = (item: CartItem): LineaGuardada => ({ ...(item as unknown as Record<string, unknown>) } as unknown as LineaGuardada);

// Movimiento de caja tal como puede llegar del backend: los registros derivados
// (p. ej. una venta en efectivo) no son filas de CashMovement y pueden traer
// menos campos. Se modela flojo a propósito — el render normaliza.
type MovimientoCrudo = Partial<CashMovement> & { date?: string };

// Descripción legible cuando el movimiento derivado no trae texto propio.
const DESCRIPCION_POR_CATEGORIA: Record<string, string> = {
    VENTA: 'Venta en efectivo',
    VENTA_EFECTIVO: 'Venta en efectivo',
    INYECCION_CAPITAL: 'Inyección de capital',
    GASTO_OPERATIVO: 'Gasto operativo',
    PAGO_PROVEEDOR: 'Pago a proveedor',
    RETIRO_PERSONAL: 'Retiro personal',
    CAMBIO: 'Cambio de billete',
    AJUSTE: 'Ajuste de caja',
};

// ── Validación nativa en español ────────────────────────────────────────────
// El navegador muestra "Please fill out this field." en una app 100% en español.
// Este spread reemplaza ese globo por un mensaje nuestro (y lo limpia al teclear
// para que el campo no quede inválido para siempre).
type CampoValidable = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
const MENSAJE_REQUERIDO = 'Completá este campo.';
const validacionEs = (mensaje: string = MENSAJE_REQUERIDO) => ({
    onInvalid: (e: React.FormEvent<CampoValidable>) => e.currentTarget.setCustomValidity(mensaje),
    onInput: (e: React.FormEvent<CampoValidable>) => e.currentTarget.setCustomValidity(''),
});

// Input numérico controlado para estado `number` (cantidad, % descuento por
// ítem): mantiene un BORRADOR string para que se puedan teclear decimales
// ("1." no se "come" el punto) y commitea el número parseado. Nunca type="number".
const NumberDraftInput: React.FC<{
    value: number;
    onCommit: (n: number) => void;
    className?: string;
    placeholder?: string;
    ariaLabel?: string;
    allowZero?: boolean;
    ariaInvalid?: boolean;
    describedBy?: string;
}> = ({ value, onCommit, className, placeholder, ariaLabel, allowZero, ariaInvalid, describedBy }) => {
    const [draft, setDraft] = useState<string>(value ? String(value) : '');
    const lastCommitted = useRef<number>(value);

    useEffect(() => {
        // Resync solo si el valor externo cambió por algo distinto a este input
        // (botones +/-, reset de carrito) — no pisamos el borrador propio.
        if (value !== lastCommitted.current) {
            setDraft(value ? String(value) : '');
            lastCommitted.current = value;
        }
    }, [value]);

    return (
        <input
            type="text"
            inputMode="decimal"
            placeholder={placeholder}
            aria-label={ariaLabel}
            aria-invalid={ariaInvalid || undefined}
            aria-describedby={describedBy}
            className={className}
            value={draft}
            onChange={(e) => {
                const s = sanitizeDecimalInput(e.target.value);
                setDraft(s);
                if (s === '' && !allowZero) return; // permitir borrar sin forzar 0
                const n = toDecimal(s).toNumber();
                lastCommitted.current = n;
                onCommit(n);
            }}
        />
    );
};

interface Customer {
    id: string;
    name: string;
    phone?: string;
    creditLimit: number;
    currentDebt: number;
    isBlocked: boolean;
    isWholesale?: boolean; // cliente mayorista → mayoreo desde la unidad 1
}

interface HeldCart {
    id: string;
    label: string;
    items: CartItem[];
    customer: Customer | null;
    heldAt: Date;
    /** Persistencia (P0-1): el cliente se guarda por id y se re-resuelve contra
     *  la lista viva; `shiftId` dice a qué turno pertenece el aparcado. */
    clienteId?: string | null;
    globalDiscount?: string;
    shiftId?: string;
}

interface ParkingNotice {
    tone: 'success' | 'warning';
    message: string;
    heldId?: string;
}

// Post-sale state
interface CompletedSale {
    items: CartItem[];
    subtotal: number;
    discount: number; // monto rebajado (línea + global) para que el ticket cuadre
    tax: number;
    grandTotal: number;
    paymentMethod: string;
    customerName: string;
    customerPhone?: string;
    saleId?: string;
    date: string;
    invoiceNumber?: number;
    invoiceSeries?: string;
    // Efectivo recibido AL MOMENTO del cobro (string decimal crudo, sin float).
    // Va en la venta y no en un estado suelto porque el estado se limpia apenas
    // termina el cobro: por eso la pantalla de éxito nunca mostraba el vuelto.
    cashReceived?: string;
    usdReceived?: string;
}

interface ScalePreviewResponse {
    classification: 'SCALE_LABEL';
    profileVersionId: string;
    profileVersion?: number;
    product: {
        id: string;
        name: string;
        unit: string;
        price: string | number;
        saleMode?: 'COUNTED' | 'MEASURED' | null;
        quantityStep?: string | number | null;
        [extra: string]: unknown;
    };
    plu: string;
    sourceValue: string;
    sourceUnit: string;
    baseQuantity: string;
    encodedPrice?: string;
    pricingPolicy: 'RECALCULATE' | 'REQUIRE_MATCH' | 'ACCEPT_LABEL_TOTAL';
}

interface PendingDuplicateScaleLabel {
    rawCode: string;
    preview: ScalePreviewResponse;
    requiresManagerOverride: boolean;
}

interface ReturnSaleLine {
    saleItemId: string;
    productId: string;
    productNameAtSale: string;
    unitAtSale: string;
    saleModeAtSale: 'COUNTED' | 'MEASURED';
    presentationAtSale: 'BASE' | 'PACK';
    presentationQuantityAtSale: string;
    quantity: string;
    returnedQuantity: string;
    returnableQuantity: string;
    quantityStep: string;
    priceAtSale: string;
    refundUnitPrice: string;
    measurement?: { source: string; sourceValue: string; sourceUnit: string } | null;
}

interface ReturnSaleData {
    id: string;
    total: string | number;
    paymentMethod: string;
    balance: string;
    allowedRefundMethods: ReturnRefundMethod[];
    items: ReturnSaleLine[];
    /**
     * Fecha de anulación (DGI-5), o null si la factura está vigente.
     *
     * Se mira ESTE campo y no `status`: un `cancelledAt` no nulo es
     * inequívoco y evita traer al frontend el literal del estado, que vive
     * en el backend (`saleCancellation.ts`) y es la única fuente. La decisión
     * autoritativa igual la toma el servidor; acá solo se evita mostrarle al
     * cajero un formulario que va a ser rechazado.
     */
    cancelledAt: string | null;
}

type ReturnRefundMethod = 'CASH' | 'CARD' | 'QR' | 'TRANSFER';

const RETURN_REFUND_METHOD_LABELS: Record<ReturnRefundMethod, string> = {
    CASH: 'Efectivo',
    CARD: 'Tarjeta',
    QR: 'QR',
    TRANSFER: 'Transferencia',
};

interface ReturnItemSelection extends ReturnSaleLine {
    quantityDraft: string;
}

interface PendingScaleLabelOverride {
    rawCode: string;
    preview: ScalePreviewResponse;
}

class ScalePreviewRequestError extends Error {
    constructor(readonly code: string | undefined, message: string) {
        super(message);
        this.name = 'ScalePreviewRequestError';
    }
}

const DUPLICATE_SCALE_SCAN_WINDOW_MS = 4_000;

const trackQuantityStepFailure = (
    error: unknown,
    source: 'manual' | 'scale_label' | 'pack' | 'cart',
): void => {
    if (
        error instanceof QuantityValidationError
        && ['INVALID_STEP', 'STEP_MISMATCH', 'COUNTED_REQUIRES_INTEGER'].includes(error.code)
    ) {
        // No enviar cantidad, SKU ni código de etiqueta: solo señal operativa.
        trackEvent('quantity_step_error', { source, error_code: error.code });
    }
};

const currentOperatorRole = (): string => {
    try {
        const encoded = (localStorage.getItem('nortex_token') || '').split('.')[1];
        if (!encoded) return '';
        return JSON.parse(atob(encoded)).role || '';
    } catch {
        return '';
    }
};

// ==========================================
// BEEP SOUND (Base64 tiny beep)
// ==========================================
const playBeep = () => {
    try {
        const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.value = 1200;
        osc.type = 'sine';
        gain.gain.value = 0.3;
        osc.start();
        osc.stop(ctx.currentTime + 0.1);
    } catch (e) {
        // Silently fail if audio not available
    }
};

const playErrorBeep = () => {
    try {
        const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.value = 300;
        osc.type = 'square';
        gain.gain.value = 0.2;
        osc.start();
        osc.stop(ctx.currentTime + 0.25);
    } catch (e) { }
};

const POS: React.FC = () => {
    const location = useLocation();
    const navigate = useNavigate();
    const firstSaleMode = useMemo(
        () => new URLSearchParams(location.search).get('first_sale') === '1',
        [location.search],
    );
    // Inicia VACÍO (no MOCK_PRODUCTS): los mocks de demo ("Cemento Sol", precios
    // que no son del tenant) online desaparecían tras fetchProducts, pero OFFLINE
    // persistían y se podían agregar al carrito → venta encolada con IDs mock
    // inexistentes → el sync fallaba. El catálogo real llega de /api/products.
    const [products, setProducts] = useState<Product[]>([]);
    // Distingue "no tenés productos" de "no pudimos cargarlos" (auditoría C8).
    const [productsError, setProductsError] = useState(false);
    // Rótulo del acceso rápido: hoy esa lista sale del catálogo (`products`), no
    // de un endpoint de más-vendidos, así que NO hay ranking ni conteo de ventas
    // que respalde la etiqueta. Quedan explícitos para que el día que exista el
    // ranking el rótulo cambie solo — y no antes (ver `rotuloProductosRapidos`).
    const rankingDisponible = false;
    const ventasRegistradas = 0;
    // ── P0-1 · El carrito sobrevive ────────────────────────────────────────
    // El sidebar está montado ALREDEDOR del POS (App.tsx), así que un clic en
    // "Mis Productos" desmontaba este componente y borraba la venta en curso.
    // La cura de fondo es que el carrito sea durable: si vuelve intacto, el bug
    // deja de existir sin tocar el router. Ver utils/cartPersistence.ts.
    const [identidad] = useState(identidadLocal);
    const [rescate] = useState<CarritoGuardado | null>(() => {
        if (!identidad) return null;
        const actual = localStorage.getItem(claveCarrito(identidad.tenantId, identidad.userId));
        const legacy = localStorage.getItem(claveCarritoLegacy(identidad.tenantId, identidad.userId));
        return leerCarritoGuardado(actual ?? legacy);
    });
    // Hidratación OPTIMISTA: el carrito se pinta en el primer render, sin
    // esperar a que resuelva /shifts/current. En el caso común (salir y volver
    // dentro del mismo turno) no hay parpadeo de "Carrito vacío". Si al llegar
    // el turno resulta ser otro, se retira y se ofrece — ver el efecto de
    // validación más abajo. Un blip en el caso raro vale el cero-blip en el
    // caso de todos los días.
    const [cart, setCart] = useState<CartItem[]>(() => (rescate?.lineas ?? []) as unknown as CartItem[]);
    // Venta a medias que NO se puede atribuir al turno actual: no entra sola.
    const [ventaPendiente, setVentaPendiente] = useState<CarritoGuardado | null>(null);
    // Hasta que la validación no corrió, NO se escribe: si no, el primer guardado
    // pisaría el turno del payload rescatado con el turno de ahora.
    const [persistenciaLista, setPersistenciaLista] = useState(false);
    const [clienteARestaurar, setClienteARestaurar] = useState<string | null>(null);
    // Cerrar la caja con una venta a medias adentro: no se puede cuadrar un
    // arqueo con mercadería en el limbo. O entra, o se aparca, o se descarta —
    // y eso lo decide el cajero, no nosotros.
    const [bloqueoCierre, setBloqueoCierre] = useState(false);
    // Línea recién quitada del carrito, con su posición para poder devolverla
    // donde estaba (P0-4). Se limpia sola a los 5 segundos.
    const [quitadoReciente, setQuitadoReciente] = useState<{ item: CartItem; posicion: number } | null>(null);
    // Línea con el campo de descuento ABIERTO (P1-1). Una sola a la vez: dos
    // campos abiertos en un ticket largo es exactamente el ruido que se saca.
    const [lineaConDescuento, setLineaConDescuento] = useState<string | null>(null);
    // Línea que acaba de recibir un producto (P1-4): destella 400ms para que el
    // cajero vea QUÉ entró sin despegar la vista del producto que tiene en la mano.
    // El contador fuerza un render incluso al agregar dos veces el mismo SKU.
    const [lineaResaltada, setLineaResaltada] = useState<{ id: string; n: number } | null>(null);
    // Anulación de comprobantes (DGI-5). Vive junto a la búsqueda de la factura
    // en el modal de devoluciones porque es donde el cajero YA llega con la
    // factura en la mano — no tiene sentido una segunda pantalla para buscar lo
    // mismo. El motivo es obligatorio: termina en el expediente fiscal.
    const [mostrarAnular, setMostrarAnular] = useState(false);
    const [motivoAnulacion, setMotivoAnulacion] = useState('');
    const [anulando, setAnulando] = useState(false);
    const [errorAnulacion, setErrorAnulacion] = useState('');
    const contadorResaltado = useRef(0);

    // 🅿️ PARQUEO DE VENTAS STATE
    // Antes era memoria pura: F4 "Aparcar" perdía todo con F5, o sea que el
    // diálogo que ofrece "Aparcar y salir" habría sido una promesa falsa.
    const [heldCarts, setHeldCarts] = useState<HeldCart[]>(() => {
        const id = identidad;
        if (!id) return [];
        const actual = localStorage.getItem(claveAparcados(id.tenantId, id.userId));
        const legacy = localStorage.getItem(claveAparcadosLegacy(id.tenantId, id.userId));
        return leerAparcados(actual ?? legacy).map(a => ({
            id: a.id,
            label: a.label,
            items: a.lineas as unknown as CartItem[],
            customer: null,
            clienteId: a.clienteId,
            globalDiscount: a.descuentoGlobal,
            heldAt: new Date(a.heldAt),
            shiftId: a.shiftId,
        }));
    });
    const [showHeldCarts, setShowHeldCarts] = useState(false);
    const [parkingNotice, setParkingNotice] = useState<ParkingNotice | null>(null);
    const [heldCartToDiscard, setHeldCartToDiscard] = useState<string | null>(null);
    // Evita que un doble toque aparque dos copias antes de que React pinte el
    // carrito vacío. En un mostrador, 200 ms bastan para que esto ocurra.
    const parkingLockRef = useRef(false);

    // ── Modo simple (Fase C-2 UX): esconde acciones avanzadas del POS ──
    // Desacoplado del menú (utils/navigation.ts), pero alineado con su intención:
    // todo comercio retail empieza con producto → venta → cobro. Las herramientas
    // avanzadas siguen disponibles al elegir explícitamente el modo completo.
    const [simpleMode] = useState<boolean>(() => {
        try {
            const user = JSON.parse(localStorage.getItem('nortex_user') || '{}');
            const tenant = JSON.parse(localStorage.getItem('nortex_tenant_data') || '{}');
            const type = tenant?.type || user?.tenant?.type || '';
            return firstSaleMode || resolvePosSimple(type, localStorage.getItem(UI_MODE_KEY));
        } catch { return firstSaleMode; }
    });
    const guidedSimpleMode = simpleMode || firstSaleMode;
    const [operatorRole] = useState<string>(() => currentOperatorRole());
    const canApproveScaleLabelTotal = canApproveExceptionalScaleLabel(operatorRole);
    // Solo Dueño/Admin ven el hint del PIN inicial en la apertura de caja.
    const [isOwnerAdmin] = useState<boolean>(() => {
        return ['OWNER', 'ADMIN', 'SUPER_ADMIN'].includes(operatorRole);
    });

    // 🔴 FIADO INTELIGENTE STATE
    const [showCreditPanel, setShowCreditPanel] = useState(false);
    const [creditOverridePin, setCreditOverridePin] = useState('');
    const [creditOverrideAuthorized, setCreditOverrideAuthorized] = useState(false);

    // 💸 DESCUENTOS STATE
    const [globalDiscount, setGlobalDiscount] = useState('');

    // 💱 NIO/USD STATE — tipo de cambio del tenant (B6); 36.56 solo es fallback
    // hasta que carga el vigente desde /exchange-rate/latest.
    const [exchangeRate, setExchangeRate] = useState(36.56);
    // Política de inventario del tenant. `null` = todavía no sabemos: el aviso
    // del carrito se muestra igual, pero sin prometer la consecuencia.
    const [permiteStockNegativo, setPermiteStockNegativo] = useState<boolean | null>(null);
    const [payingInUSD, setPayingInUSD] = useState(false);
    const [usdAmount, setUsdAmount] = useState('');
    const [searchTerm, setSearchTerm] = useState('');
    const [processing, setProcessing] = useState(false);

    // 🖨️ THERMAL PRINTER STATE
    const [thermalConnected, setThermalConnected] = useState(false);

    // CUSTOMER STATE (SMART SEARCH)
    const [customerList, setCustomerList] = useState<Customer[]>([]);
    const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
    const [customerSearch, setCustomerSearch] = useState('');
    const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);

    const [showAddModal, setShowAddModal] = useState(false);
    const [newProduct, setNewProduct] = useState({ name: '', sku: '', price: '', costPrice: '', stock: '', category: 'General' });

    // SHIFT STATE
    const [currentShift, setCurrentShift] = useState<Shift | null>(null);
    // Traspaso de caja: hay turno abierto, pero a nombre de otra persona. Se ve
    // el efectivo (la plata está físicamente ahí) y NO se puede cobrar hasta
    // tomarla, para que el arqueo tenga un responsable único.
    const turnoAjeno = !!currentShift && currentShift.esTurnoPropio === false;
    const [tomandoTurno, setTomandoTurno] = useState(false);
    const [showOpenShift, setShowOpenShift] = useState(false);
    const [showCloseShift, setShowCloseShift] = useState(false);
    // Fondo inicial: valor REAL '0', no un placeholder "0.00" que parece cargado
    // y en realidad deja el campo vacío contra un input `required`.
    const [initialCash, setInitialCash] = useState('0');
    const [employeePin, setEmployeePin] = useState('');
    // ¿Este negocio exige PIN para abrir la caja? Arranca en `false` —el default
    // del backend— para que el camino sin fricción sea también el que se pinta
    // primero. Si la lectura falla, se queda en false y la apertura va sin PIN:
    // el servidor decide igual, y en el peor caso responde PIN_REQUERIDO y el
    // modal lo muestra recién ahí. Al revés (asumir que se exige) le pondría un
    // campo de más a todos los negocios cuando la red falla.
    const [exigePin, setExigePin] = useState(false);
    // Errores propios de la apertura (en español, debajo del campo).
    const [errorApertura, setErrorApertura] = useState<{ pin?: string; fondo?: string; general?: string }>({});
    const [declaredCash, setDeclaredCash] = useState('');
    // Fase D: dólares contados al cierre (solo se manda si hay algo que declarar)
    const [declaredCashUsd, setDeclaredCashUsd] = useState('');
    const [shiftReport, setShiftReport] = useState<{ expected: number, diff: number } | null>(null);
    const [shiftLoading, setShiftLoading] = useState(true);

    // UI State
    const [showMobileCart, setShowMobileCart] = useState(false);
    const [showPaymentOptions, setShowPaymentOptions] = useState(false);
    const [resumePaymentAfterShift, setResumePaymentAfterShift] = useState(false);
    const [showCustomerPicker, setShowCustomerPicker] = useState(false);
    const [showSaleDetails, setShowSaleDetails] = useState(false);
    const [showQuickDetails, setShowQuickDetails] = useState(false);

    // 🔄 RETURNS STATE
    const [showReturnModal, setShowReturnModal] = useState(false);
    const [returnSaleSearch, setReturnSaleSearch] = useState('');
    const [returnSaleData, setReturnSaleData] = useState<ReturnSaleData | null>(null);
    const [returnItems, setReturnItems] = useState<ReturnItemSelection[]>([]);
    const [returnReason, setReturnReason] = useState('');
    const [returnProcessing, setReturnProcessing] = useState(false);
    const [returnSearching, setReturnSearching] = useState(false);
    const [returnErrors, setReturnErrors] = useState<Record<string, string>>({});
    const [returnGeneralError, setReturnGeneralError] = useState('');
    const [returnRefundMethod, setReturnRefundMethod] = useState<ReturnRefundMethod | ''>('');
    // Se conserva entre reintentos (incluido "respuesta perdida") y solo se
    // reemplaza cuando cambia la intención material o la devolución confirma.
    const returnRequestRef = useRef<{ signature: string; clientEventId: string } | null>(null);

    // POST-SALE MODAL STATE
    const [completedSale, setCompletedSale] = useState<CompletedSale | null>(null);
    const [cashReceived, setCashReceived] = useState('');

    // PRE-SALE CASH MODAL STATE
    const [showCashPreModal, setShowCashPreModal] = useState(false);

    // BARCODE SCANNER STATE
    const [scannerActive, setScannerActive] = useState(true);
    const [lastScanFeedback, setLastScanFeedback] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
    const scanBufferRef = useRef('');
    const scanTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const searchRef = useRef<HTMLInputElement>(null);
    const [scaleContext, setScaleContext] = useState<OfflineScaleContext | null>(null);
    const [scaleContextReady, setScaleContextReady] = useState(false);
    const lastScaleScanRef = useRef<{ rawCode: string; scannedAt: number } | null>(null);
    const [pendingDuplicateScaleLabel, setPendingDuplicateScaleLabel] = useState<PendingDuplicateScaleLabel | null>(null);
    const [pendingScaleLabelOverride, setPendingScaleLabelOverride] = useState<PendingScaleLabelOverride | null>(null);

    // Captura manual para productos medidos (incluye legacy D6). El form se
    // confirma con Enter y valida paso/4 decimales con la misma utilidad pura
    // que usa el servidor.
    const [manualMeasuredProduct, setManualMeasuredProduct] = useState<Product | null>(null);
    const [manualQuantityDraft, setManualQuantityDraft] = useState('');
    const [manualQuantityError, setManualQuantityError] = useState('');
    const [quantityErrors, setQuantityErrors] = useState<Record<string, string>>({});

    useEffect(() => {
        const activeKeys = new Set(cart.map(lineKey));
        setQuantityErrors(previous => {
            const next = Object.fromEntries(Object.entries(previous).filter(([key]) => activeKeys.has(key)));
            return Object.keys(next).length === Object.keys(previous).length ? previous : next;
        });
    }, [cart]);

    // QUICK CREATE MODAL STATE
    const [showQuickCreate, setShowQuickCreate] = useState(false);
    const [quickProduct, setQuickProduct] = useState({ name: '', sku: '', price: '', cost: '', stock: '1' });
    const [quickSaving, setQuickSaving] = useState(false);

    // EXCEL IMPORT MODAL STATE
    const [showImportModal, setShowImportModal] = useState(false);
    const [importData, setImportData] = useState<any[]>([]);
    const [importProgress, setImportProgress] = useState<{ step: string; pct: number } | null>(null);
    const [importResult, setImportResult] = useState<{ created: number; updated: number; errors: string[] } | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // 💰 CASH MOVEMENT STATE
    const [showCashModal, setShowCashModal] = useState<'IN' | 'OUT' | null>(null);
    const [cashAmount, setCashAmount] = useState('');
    const [cashCategory, setCashCategory] = useState('');
    const [cashDescription, setCashDescription] = useState('');
    const [cashMovementLoading, setCashMovementLoading] = useState(false);
    // Errores propios del movimiento de caja (antes: `return` mudo si faltaba algo).
    const [errorMovimiento, setErrorMovimiento] = useState<{ monto?: string; categoria?: string; descripcion?: string; general?: string }>({});
    // 🏦 Agente bancario (corresponsalía): el negocio es Agente Banpro/Rapibac/etc.
    const [showAgentModal, setShowAgentModal] = useState(false);
    const [agentAgreements, setAgentAgreements] = useState<any[]>([]);
    const [agentData, setAgentData] = useState({ agreementId: '', operation: 'DEPOSITO', amount: '', commission: '', externalRef: '', customerRef: '', currency: 'NIO', exchangeRate: localStorage.getItem('nortex_tc_usd') || '36.62' });
    const [agentLoading, setAgentLoading] = useState(false);
    const [newAgreementName, setNewAgreementName] = useState('');
    const [newAgreementKind, setNewAgreementKind] = useState('BANCO');
    const [cashBalance, setCashBalance] = useState<number | null>(null);

    // Pulso del día: progreso operativo sin exponer costos ni ganancia al cajero.
    interface PulsoDia {
        totalHoy: string;
        ventasHoy: number;
        racha: number;
        rachaIncluyeHoy: boolean;
        metaDiaria: string | null;
        record: string | null;
        esRecordHoy: boolean;
    }
    const [pulso, setPulso] = useState<PulsoDia | null>(null);
    const [cashMovements, setCashMovements] = useState<CashMovement[]>([]);
    const [showMovementsList, setShowMovementsList] = useState(false);
    // Menú único "Acciones de caja": el header tenía 8 botones de 7 colores
    // distintos compitiendo con el cobro. Lo operativo se agrupa acá y el rojo
    // queda reservado para lo irreversible (cerrar caja).
    const [showCashActions, setShowCashActions] = useState(false);

    // ── Por qué este menú se posiciona con JS y no con CSS ──────────────────
    // EL BUG: el menú era `absolute top-full` dentro del botón, y el botón vive
    // en un contenedor con `overflow-x-auto` (el header scrollea en horizontal
    // cuando no entran los botones). Por especificación CSS, si un eje del
    // overflow deja de ser `visible`, el OTRO eje se computa a `auto`: o sea
    // que `overflow-x-auto` también recorta en vertical. Como el header mide
    // 56px y el menú cae DEBAJO del botón, quedaba recortado entero. El estado
    // cambiaba y el chevron giraba, pero no aparecía nada — desde el mostrador
    // se ve como un botón muerto.
    //
    // LA SALIDA: `position: fixed`, que no lo recorta ningún ancestro con
    // overflow. Pero `fixed` se posiciona contra el viewport, así que hay que
    // medir dónde quedó el botón. No se ancla al borde derecho del header
    // porque el botón NO es el último: después viene "Cerrar caja".
    const botonAccionesCaja = useRef<HTMLButtonElement>(null);
    const [posicionMenuCaja, setPosicionMenuCaja] = useState<{ top: number; right: number } | null>(null);

    const medirMenuCaja = useCallback(() => {
        const r = botonAccionesCaja.current?.getBoundingClientRect();
        if (!r) return;
        setPosicionMenuCaja({
            top: r.bottom + 8,
            // Se alinea el borde DERECHO del menú con el del botón. El mínimo de
            // 8px evita que en una pantalla angosta se salga fuera de la vista.
            right: Math.max(8, window.innerWidth - r.right),
        });
    }, []);

    useLayoutEffect(() => {
        if (!showCashActions) { setPosicionMenuCaja(null); return; }
        medirMenuCaja();
        // El header scrollea en horizontal y la ventana puede cambiar de tamaño
        // (girar el teléfono). Sin re-medir, el menú queda flotando lejos del
        // botón que lo abrió. `true` = fase de captura, para enterarse también
        // del scroll del contenedor interno, que no burbujea.
        window.addEventListener('resize', medirMenuCaja);
        window.addEventListener('scroll', medirMenuCaja, true);
        return () => {
            window.removeEventListener('resize', medirMenuCaja);
            window.removeEventListener('scroll', medirMenuCaja, true);
        };
    }, [showCashActions, medirMenuCaja]);

    // ==========================================
    // OFFLINE / PWA STATE
    // ==========================================
    const [isOnline, setIsOnline] = useState(navigator.onLine);
    const [pendingOfflineCount, setPendingOfflineCount] = useState(0);
    const [reconciliationOfflineCount, setReconciliationOfflineCount] = useState(0);
    const [syncingOffline, setSyncingOffline] = useState(false);

    const token = localStorage.getItem('nortex_token');
    const headers = useMemo(() => ({
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
    }), [token]);

    // ==========================================
    // FETCH PRODUCTS FROM DB
    // ==========================================
    const fetchProducts = useCallback(async () => {
        try {
            const res = await fetch('/api/products', { headers });
            if (res.ok) {
                const data = await res.json();
                // Map backend fields to frontend Product type
                const mapped: Product[] = data.map((p: any) => ({
                    id: p.id,
                    name: p.name,
                    sku: p.sku,
                    price: p.price,
                    costPrice: p.cost,
                    stock: p.stock,
                    category: p.category || 'General',
                    unit: p.unit || 'unidad',
                    // Mayoreo y empaque: sin estos campos, effectiveUnitPrice
                    // nunca sale de DETALLE y la regla de precios por cantidad
                    // (testeada en tests/pricing.test.ts) queda muerta — la
                    // docena configurada a C$90 se cobraba 12 × detalle.
                    wholesalePrice: p.wholesalePrice ?? null,
                    wholesaleMinQty: p.wholesaleMinQty ?? null,
                    packUnit: p.packUnit ?? null,
                    packSize: p.packSize ?? null,
                    packPrice: p.packPrice ?? null,
                    saleMode: p.saleMode ?? null,
                    quantityStep: p.quantityStep == null ? null : Number(p.quantityStep),
                    productFamily: p.productFamily ?? null,
                }));
                setProducts(mapped);
                setProductsError(false);
            } else {
                // Falso empty-state (auditoría C8): un 500/402 mostraba "no tenés
                // productos" a quien SÍ tiene. Ahora se distingue error de vacío.
                setProductsError(true);
            }
        } catch (e) {
            console.error('Error fetching products:', e);
            setProductsError(true);
        }
    }, [headers]);

    // ==========================================
    // OFFLINE SYNC ENGINE
    // ==========================================
    const syncOfflineSales = useCallback(async () => {
        if (!identidad) return;
        const pending = await getPendingSales(identidad);
        if (pending.length === 0) return;
        setSyncingOffline(true);
        try {
            const token = localStorage.getItem('nortex_token');
            const res = await fetch('/api/sales/sync', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ sales: pending }),
            });
            if (res.ok) {
                const result = await res.json();
                await recordOfflineSyncResults(result.results ?? []);
                const syncedIds = result.results
                    .filter((r: any) => r.status === 'created' || r.status === 'skipped')
                    .map((r: any) => r.offlineId);
                const reconciliationCount = result.results
                    .filter((r: any) => r.status === 'reconciliation_required' || r.code === 'RECONCILIATION_REQUIRED')
                    .length;
                await markSalesSynced(syncedIds);
                const remaining = await getPendingSales(identidad);
                setPendingOfflineCount(remaining.length);
                setReconciliationOfflineCount(
                    remaining.filter((sale) => sale.syncState === 'RECONCILIATION_REQUIRED').length,
                );
                if (reconciliationCount > 0) {
                    setLastScanFeedback({
                        message: `${reconciliationCount} venta${reconciliationCount === 1 ? '' : 's'} offline requiere${reconciliationCount === 1 ? '' : 'n'} revisión; no se reinterpretó la etiqueta`,
                        type: 'error',
                    });
                    window.setTimeout(() => setLastScanFeedback(null), 8000);
                }
                await fetchProducts();
            }
        } catch (e) {
            // Se intentará de nuevo cuando vuelva internet
        } finally {
            setSyncingOffline(false);
        }
    }, [fetchProducts, identidad]);

    const refreshOfflineCount = useCallback(async () => {
        const pending = identidad ? await getPendingSales(identidad) : [];
        setPendingOfflineCount(pending.length);
        setReconciliationOfflineCount(
            pending.filter((sale) => sale.syncState === 'RECONCILIATION_REQUIRED').length,
        );
    }, [identidad]);

    const refreshScaleContext = useCallback(async () => {
        const tenantId = identidad?.tenantId;
        if (!tenantId) {
            setScaleContext(null);
            setScaleContextReady(true);
            return;
        }

        // La caché se pinta primero: al caer la red en el mostrador el router de
        // etiquetas sigue usando exactamente la versión publicada que descargó.
        const cached = await getScaleContext(tenantId).catch(() => null);
        if (cached) setScaleContext(cached);

        if (!navigator.onLine || !token) {
            setScaleContextReady(true);
            return;
        }

        try {
            const response = await fetch('/api/scale-labels/active-context', { headers });
            if (!response.ok) throw new Error('No se pudo actualizar el contexto de etiquetas');
            const normalized = normalizeActiveScaleContext(await response.json(), tenantId);
            await saveScaleContext(normalized);
            setScaleContext(normalized);
        } catch {
            // La caché anterior sigue siendo reproducible y tenant-scoped. Si no
            // hay ninguna, el scanner continúa funcionando para SKU comunes.
        } finally {
            setScaleContextReady(true);
        }
    }, [headers, identidad?.tenantId, token]);

    useEffect(() => {
        void refreshScaleContext();
    }, [refreshScaleContext]);

    // B6 — cargar el tipo de cambio vigente del tenant (BCN/manual).
    useEffect(() => {
        const t = localStorage.getItem('nortex_token');
        if (!t) return;
        fetch('/api/accounting/exchange-rate/latest', { headers: { Authorization: `Bearer ${t}` } })
            .then(r => r.ok ? r.json() : null)
            .then(d => { if (d && typeof d.rate === 'number' && d.rate > 0) setExchangeRate(d.rate); })
            .catch(() => { /* mantiene el fallback */ });
    }, []);

    // Política de stock negativo del tenant: define QUÉ le pasa a la venta
    // cuando una línea excede la existencia (rechazo vs inventario en negativo).
    // Si falla, queda en `null` y el aviso del carrito no promete consecuencia.
    useEffect(() => {
        const t = localStorage.getItem('nortex_token');
        if (!t) return;
        fetch('/api/tenant/inventory-settings', { headers: { Authorization: `Bearer ${t}` } })
            .then(r => r.ok ? r.json() : null)
            .then(d => { if (d && typeof d.allowNegativeStock === 'boolean') setPermiteStockNegativo(d.allowNegativeStock); })
            .catch(() => { /* sin dato: el aviso sale sin consecuencia */ });
    }, []);

    // ¿La caja pide PIN? Se consulta al montar, no al abrir el modal: cuando el
    // cajero aprieta "Cobrar" la respuesta ya tiene que estar, si no la pantalla
    // parpadearía entre las dos versiones del formulario.
    useEffect(() => {
        const t = localStorage.getItem('nortex_token');
        if (!t) return;
        fetch('/api/tenant/cashier-settings', { headers: { Authorization: `Bearer ${t}` } })
            .then(r => r.ok ? r.json() : null)
            .then(d => { if (d && typeof d.requireCashierPin === 'boolean') setExigePin(d.requireCashierPin); })
            .catch(() => { /* sin dato: se abre sin PIN y decide el servidor */ });
    }, []);

    // ── P0-1 · Validar el carrito rescatado contra el turno real ───────────
    // Corre una sola vez, cuando /shifts/current ya respondió. Regla dura: una
    // venta a medias NUNCA se restaura en el turno equivocado — la mercadería
    // de un turno cerrado no entra sola a la caja de hoy, porque descuadraría
    // el arqueo de otro. Se ofrece y decide el cajero.
    useEffect(() => {
        if (shiftLoading || persistenciaLista) return;
        const decision = decidirRestauracion({
            guardado: rescate,
            shiftIdActual: currentShift?.id ?? null,
            ahoraMs: Date.now(),
        });
        if (decision === 'OFRECER') {
            setCart([]);              // se retira de la vista hasta que decida
            setVentaPendiente(rescate);
            // En móvil el panel del ticket está oculto hasta tocar "Ver
            // Carrito": sin esto el aviso quedaría invisible justo para quien
            // más lo necesita. En escritorio el panel ya está a la vista y esto
            // no cambia nada.
            setShowMobileCart(true);
        } else if (decision === 'RESTAURAR' && rescate) {
            const quoted = rescate.lineas.some((line) => isQuotationCartLine(line as unknown as CartItem));
            setGlobalDiscount(quoted ? '' : rescate.descuentoGlobal);
            setClienteARestaurar(rescate.clienteId);
        }
        // DESCARTAR: el carrito ya arrancó vacío. Nada que hacer.
        setPersistenciaLista(true);
    }, [shiftLoading, currentShift?.id, rescate, persistenciaLista]);

    // El cliente se guarda por ID y se re-resuelve contra la lista viva: si lo
    // borraron, la venta sigue sin cliente en vez de arrastrar un fantasma.
    useEffect(() => {
        if (!clienteARestaurar || customerList.length === 0) return;
        const cliente = customerList.find(c => c.id === clienteARestaurar) || null;
        if (cliente) {
            setSelectedCustomer(cliente);
            setCustomerSearch(cliente.name);
        }
        setClienteARestaurar(null);
    }, [clienteARestaurar, customerList]);

    // ── P0-1 · Guardar (con debounce) ──────────────────────────────────────
    useEffect(() => {
        if (!persistenciaLista || !identidad) return;
        const clave = claveCarrito(identidad.tenantId, identidad.userId);
        const claveLegacy = claveCarritoLegacy(identidad.tenantId, identidad.userId);

        // Venta YA COBRADA: se borra sin esperar el debounce. Si no, navegar
        // entre el "¡Venta completada!" y "Nueva venta" dejaría guardado un
        // carrito de mercadería ya vendida — y al volver se cobraría dos veces.
        if (completedSale) {
            localStorage.removeItem(clave);
            localStorage.removeItem(claveLegacy);
            return;
        }

        const t = setTimeout(() => {
            const payload = serializarCarrito({
                shiftId: currentShift?.id ?? null,
                lineas: cart.map(aLineaGuardada),
                clienteId: selectedCustomer?.id ?? null,
                descuentoGlobal: globalDiscount,
                ahoraMs: Date.now(),
            });
            // Sin payload (carrito vacío o sin turno) se BORRA la clave: nunca
            // se deja un `[]` guardado que después haya que interpretar.
            if (payload) {
                localStorage.setItem(clave, payload);
                localStorage.removeItem(claveLegacy);
            } else {
                localStorage.removeItem(clave);
                localStorage.removeItem(claveLegacy);
            }
        }, 300);
        return () => clearTimeout(t);
    }, [cart, selectedCustomer?.id, globalDiscount, currentShift?.id, completedSale, persistenciaLista, identidad]);

    // Aparcados: cambian de a uno (F4 / restaurar / quitar), sin debounce.
    useEffect(() => {
        if (!persistenciaLista || !identidad) return;
        const clave = claveAparcados(identidad.tenantId, identidad.userId);
        const claveLegacy = claveAparcadosLegacy(identidad.tenantId, identidad.userId);
        const payload = serializarAparcados(heldCarts.map((h): AparcadoGuardado => ({
            id: h.id,
            label: h.label,
            shiftId: h.shiftId || currentShift?.id || '',
            heldAt: h.heldAt instanceof Date ? h.heldAt.getTime() : Date.now(),
            lineas: h.items.map(aLineaGuardada),
            clienteId: h.customer?.id ?? h.clienteId ?? null,
            descuentoGlobal: h.globalDiscount ?? '',
        })));
        if (payload) {
            localStorage.setItem(clave, payload);
            localStorage.removeItem(claveLegacy);
        } else {
            localStorage.removeItem(clave);
            localStorage.removeItem(claveLegacy);
        }
    }, [heldCarts, currentShift?.id, persistenciaLista, identidad]);

    // Cerrar la pestaña con una venta a medias: el navegador pregunta. El texto
    // lo decide el navegador (ya no se puede personalizar), pero el freno sí es
    // nuestro. Con el carrito ya persistido esto es la última red, no la única.
    useEffect(() => {
        if (cart.length === 0 || completedSale) return;
        const avisar = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
        window.addEventListener('beforeunload', avisar);
        return () => window.removeEventListener('beforeunload', avisar);
    }, [cart.length, completedSale]);

    // Dos pestañas del POS comparten la clave y la última que escribe gana: sin
    // esto se podría perder un carrito EN SILENCIO, que es exactamente el bug
    // que estamos arreglando, en otra forma. No se sobreescribe: se avisa.
    const [cajaEnOtraPestana, setCajaEnOtraPestana] = useState(false);
    useEffect(() => {
        if (!identidad) return;
        const clave = claveCarrito(identidad.tenantId, identidad.userId);
        const alCambiar = (e: StorageEvent) => { if (e.key === clave) setCajaEnOtraPestana(true); };
        window.addEventListener('storage', alCambiar);
        return () => window.removeEventListener('storage', alCambiar);
    }, [identidad]);

    // Tutorial guiado: si entran con ?tour=pos (desde Ayuda o el checklist).
    // SOLO cuando la caja está visible: antes el tour se dibujaba ENCIMA del
    // modal de apertura de turno (PIN), describiendo una pantalla tapada
    // (auditoría C6). Si el modal está abierto, el ?tour queda en la URL y el
    // tour arranca solo al abrir el turno (este efecto re-corre al cambiar).
    useEffect(() => {
        if (!firstSaleMode && !shiftLoading && !showOpenShift) maybeAutostartTour();
    }, [firstSaleMode, shiftLoading, showOpenShift]);

    useEffect(() => {
        refreshOfflineCount();
        const handleOnline = () => {
            setIsOnline(true);
            void refreshScaleContext();
            void syncOfflineSales();
        };
        const handleOffline = () => setIsOnline(false);
        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);
        return () => {
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
        };
    }, [syncOfflineSales, refreshOfflineCount, refreshScaleContext]);

    // ==========================================
    // INIT POS
    // ==========================================
    useEffect(() => {
        const initPOS = async () => {
            const token = localStorage.getItem('nortex_token');
            let hasOpenShift = false;

            // 1. Check Shift (Cache busting to avoid stale 'not found' after navigating)
            try {
                const res = await fetch(`/api/shifts/current?t=${Date.now()}`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                const data = await res.json();
                if (res.ok && data) {
                    setCurrentShift(data);
                    setShowOpenShift(false);
                    hasOpenShift = true;
                } else {
                    setCurrentShift(null);
                    // La caja se abre al cobrar, no al entrar. El usuario puede
                    // buscar, escanear y armar la venta antes de ese único gate.
                    setShowOpenShift(false);
                }
            } catch (e) {
                console.error("Failed to check shift", e);
                setCurrentShift(null);
                setShowOpenShift(false);
            } finally {
                setShiftLoading(false);
            }

            // 2. Fetch Customers for Dropdown
            try {
                const custRes = await fetch('/api/customers', {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (custRes.ok) {
                    setCustomerList(await custRes.json());
                }
            } catch (e) {
                console.error("Failed to fetch customers", e);
            }

            // 3. Check for Ghost Cart
            try {
                const pendingCart = localStorage.getItem('nortex_pending_cart');
                if (pendingCart && pendingCart !== 'undefined') {
                    const lineasTraspaso = JSON.parse(pendingCart);
                    // El traspaso (demo o cotización convertida) GANA: es una
                    // acción explícita del usuario. Pero desde que el carrito
                    // sobrevive a la navegación puede haber una venta restaurada
                    // debajo, y pisarla en silencio sería reintroducir el mismo
                    // bug que este cambio viene a matar. Se aparca primero: los
                    // aparcados ahora también son durables, así que no se pierde.
                    // `cart` acá es el del primer render, o sea lo restaurado.
                    if (cart.length > 0) {
                        setHeldCarts(prev => [...prev, {
                            id: `traspaso-${Date.now()}`,
                            label: 'Venta que estabas haciendo',
                            items: [...cart],
                            customer: null,
                            clienteId: null,
                            heldAt: new Date(),
                        }]);
                    }
                    setCart(lineasTraspaso);
                    if (Array.isArray(lineasTraspaso) && lineasTraspaso.some(isQuotationCartLine)) {
                        // Una cotización es un snapshot autoritativo: no hereda
                        // descuentos de la venta que acabamos de aparcar.
                        setGlobalDiscount('');
                    }
                    localStorage.removeItem('nortex_pending_cart');
                    if (!hasOpenShift) setResumePaymentAfterShift(false);
                }
            } catch (e) {
                console.error("Failed to parse ghost cart", e);
                localStorage.removeItem('nortex_pending_cart');
            }

            // 4. Autoconnect thermal printer
            thermalPrinter.autoConnect().then(setThermalConnected);
        };
        initPOS();
        fetchProducts();
        fetchPulso();
    }, []);

    /**
     * Traspaso de caja. El caso real: el dueño abre a las 7 y a las 2 entra el
     * cajero del segundo turno. Antes había dos salidas malas — cerrar y reabrir
     * la caja (partiendo el arqueo del día) o vender con el turno del dueño
     * (dejando el faltante a nombre de quien no estaba). El traspaso reasigna el
     * turno sin cerrarlo y queda registrado en AuditLog.
     */
    const tomarTurno = useCallback(async () => {
        if (!currentShift) return;
        setTomandoTurno(true);
        try {
            const res = await fetch(`/api/shifts/${currentShift.id}/tomar`, { method: 'POST', headers });
            const data = await res.json();
            if (!res.ok) {
                alert(data?.error || 'No pudimos tomar la caja.');
                return;
            }
            // Relee el turno: ahora vuelve con esTurnoPropio true y el cobro se habilita.
            const verif = await fetch(`/api/shifts/current?t=${Date.now()}`, { headers });
            if (verif.ok) {
                const turno = await verif.json();
                if (turno) setCurrentShift(turno);
            }
        } catch {
            alert('No pudimos tomar la caja. Revisá tu conexión.');
        } finally {
            setTomandoTurno(false);
        }
    }, [currentShift, headers]);

    // ==========================================
    // 💰 CASH MOVEMENT FUNCTIONS
    // ==========================================
    const fetchCashBalance = useCallback(async () => {
        try {
            const res = await fetch('/api/cash-movements/balance', { headers });
            if (res.ok) {
                const data = await res.json();
                // Defensivo (NX-03): el backend está unificando la fórmula del
                // saldo. Si `hasOpenShift` deja de venir pero el saldo sí, se usa
                // igual — lo que no se hace nunca es pisar el saldo con basura.
                const saldo = data?.balance;
                const hayTurno = data?.hasOpenShift ?? (saldo !== undefined && saldo !== null);
                if (hayTurno && saldo !== undefined && saldo !== null) {
                    setCashBalance(Number(toDecimal(saldo as string | number).toFixed(2)));
                }
            }
        } catch (e) { /* silently fail */ }
    }, [headers]);

    const fetchPulso = useCallback(async () => {
        try {
            const res = await fetch('/api/pos/pulso', { headers });
            if (res.ok) setPulso(await res.json());
        } catch { /* offline/red caída: se conserva el último pulso conocido */ }
    }, [headers]);

    const fetchCashMovements = useCallback(async () => {
        try {
            const res = await fetch('/api/cash-movements', { headers });
            if (res.ok) {
                const data = await res.json();
                // El endpoint puede devolver el arreglo pelado o envuelto
                // ({ data } / { movements }). Nos adaptamos sin cambiar el
                // contrato; cualquier otra forma se trata como lista vacía.
                const lista = Array.isArray(data) ? data
                    : Array.isArray(data?.data) ? data.data
                        : Array.isArray(data?.movements) ? data.movements
                            : [];
                setCashMovements(lista);
            }
        } catch (e) { /* silently fail */ }
    }, [headers]);

    // ── Movimientos del turno, normalizados a prueba de contrato ────────────
    // NX-03: el backend está sumando las VENTAS EN EFECTIVO a esta lista. Esos
    // registros son derivados y pueden venir sin `id`, sin `description` o con la
    // fecha en otro campo. Nada de eso puede romper el desplegable ni inventar un
    // monto: se normaliza acá y se renderiza solo lo que existe.
    const movimientosVisibles = useMemo(() => {
        const lista = (Array.isArray(cashMovements) ? cashMovements : []) as MovimientoCrudo[];
        return lista
            .filter(m => m && !m.isVoided)
            .map((m, i) => {
                const montoCrudo = toDecimal((m.amount ?? 0) as string | number);
                // `type` manda; si no viene (movimiento derivado), decide el signo.
                const esEntrada = m.type ? m.type === 'IN' : !montoCrudo.isNegative();
                const crudoFecha = m.createdAt ?? m.date ?? null;
                const fecha = crudoFecha ? new Date(crudoFecha) : null;
                const hora = fecha && !isNaN(fecha.getTime())
                    ? fecha.toLocaleTimeString('es-NI', { hour: '2-digit', minute: '2-digit' })
                    : '';
                const descripcion = (m.description ?? '').trim()
                    || (m.category ? DESCRIPCION_POR_CATEGORIA[m.category] : '')
                    || 'Movimiento de caja';
                return {
                    clave: String(m.id ?? `${m.category ?? 'MOV'}-${crudoFecha ?? ''}-${i}`),
                    descripcion,
                    monto: montoCrudo.abs(),
                    esEntrada,
                    hora,
                };
            });
    }, [cashMovements]);

    // Fetch balance when shift changes
    useEffect(() => {
        if (currentShift) {
            fetchCashBalance();
            fetchCashMovements();
        } else {
            setCashBalance(null);
            setCashMovements([]);
        }
    }, [currentShift]);

    const handleCashMovement = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!showCashModal) return;

        // Validación propia, en español y debajo del campo: antes el submit hacía
        // `return` en silencio (o el navegador gritaba "Please fill out this field").
        const montoD = toDecimal(cashAmount);
        const errores: typeof errorMovimiento = {};
        if (cashAmount.trim() === '' || montoD.lessThanOrEqualTo(0)) errores.monto = 'Ingresá un monto mayor a cero.';
        if (!cashCategory) errores.categoria = 'Elegí una categoría.';
        if (!cashDescription.trim()) errores.descripcion = 'Escribí para qué fue el movimiento.';
        setErrorMovimiento(errores);
        if (Object.keys(errores).length > 0) return;

        setCashMovementLoading(true);

        try {
            const res = await fetch('/api/cash-movements', {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    type: showCashModal,
                    // El monto viaja por Decimal (nunca parseFloat sobre dinero).
                    amount: Number(montoD.toFixed(2)),
                    currency: 'NIO',
                    category: cashCategory,
                    description: cashDescription.trim(),
                })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error);

            // Reset & refresh
            setShowCashModal(null);
            setCashAmount('');
            setCashCategory('');
            setCashDescription('');
            setErrorMovimiento({});
            fetchCashBalance();
            fetchCashMovements();
        } catch (error: any) {
            setErrorMovimiento({ general: error?.message || 'No pudimos registrar el movimiento. Reintentá.' });
        } finally {
            setCashMovementLoading(false);
        }
    };

    // Al abrir/cerrar el modal de movimiento, los errores viejos se van con él.
    useEffect(() => { setErrorMovimiento({}); }, [showCashModal]);

    const inCategories = [
        { value: 'INYECCION_CAPITAL', label: 'Inyección de Capital' },
        { value: 'CAMBIO', label: 'Cambio de Billete' },
        { value: 'AJUSTE', label: 'Ajuste' },
    ];
    const outCategories = [
        { value: 'GASTO_OPERATIVO', label: 'Gasto Operativo' },
        { value: 'PAGO_PROVEEDOR', label: 'Pago a Proveedor' },
        { value: 'RETIRO_PERSONAL', label: 'Retiro Personal' },
        { value: 'CAMBIO', label: 'Cambio' },
        { value: 'AJUSTE', label: 'Ajuste' },
    ];

    // ==========================================
    // 🏦 AGENTE BANCARIO (corresponsalía)
    // ==========================================
    // Operaciones y dirección del efectivo (espejo de AGENT_OPERATION_DIRECTION
    // del backend, que es la fuente autoritativa).
    const agentOps = [
        { value: 'DEPOSITO', label: 'Depósito a cuenta', dir: 'IN' },
        { value: 'RETIRO', label: 'Retiro de efectivo', dir: 'OUT' },
        { value: 'PAGO_TARJETA', label: 'Pago de tarjeta', dir: 'IN' },
        { value: 'PAGO_PRESTAMO', label: 'Pago de préstamo', dir: 'IN' },
        { value: 'PAGO_SERVICIO', label: 'Pago de servicio', dir: 'IN' },
        { value: 'RECARGA', label: 'Recarga', dir: 'IN' },
        { value: 'REMESA_ENVIO', label: 'Remesa: envío', dir: 'IN' },
        { value: 'REMESA_COBRO', label: 'Remesa: pago', dir: 'OUT' },
    ];

    const fetchAgentAgreements = useCallback(async () => {
        try {
            const res = await fetch('/api/agent-banking/agreements', { headers });
            if (res.ok) {
                const data = await res.json();
                if (data.success) setAgentAgreements(data.data.filter((a: any) => a.active));
            }
        } catch (e) { /* silently fail */ }
    }, [headers]);

    // Vista previa de la comisión pactada del convenio (el server recalcula
    // igual si no se manda — esto solo pre-llena el campo).
    const previewAgentCommission = (agreementId: string, operation: string, amount: string, currency: string, exchangeRate: string): string => {
        const agreement = agentAgreements.find(a => a.id === agreementId);
        const entry = agreement?.commissionConfig?.[operation];
        const tc = currency === 'USD' ? parseFloat(exchangeRate) : 1;
        // La comisión del contrato está en C$ → se calcula sobre el equivalente.
        const monto = parseFloat(amount) * (isFinite(tc) && tc > 0 ? tc : 1);
        if (!entry || !isFinite(monto) || monto <= 0) return '';
        const fija = isFinite(Number(entry.fija)) && Number(entry.fija) > 0 ? Number(entry.fija) : 0;
        const pct = isFinite(Number(entry.pct)) && Number(entry.pct) > 0 ? Number(entry.pct) : 0;
        const total = fija + (monto * pct) / 100;
        return total > 0 ? total.toFixed(2) : '';
    };

    const updateAgentData = (patch: Partial<typeof agentData>) => {
        setAgentData(prev => {
            const next = { ...prev, ...patch };
            // Recalcular la comisión sugerida cuando cambia convenio/operación/monto.
            if (patch.agreementId !== undefined || patch.operation !== undefined || patch.amount !== undefined || patch.currency !== undefined || patch.exchangeRate !== undefined) {
                next.commission = previewAgentCommission(next.agreementId, next.operation, next.amount, next.currency, next.exchangeRate);
            }
            return next;
        });
    };

    const handleCreateAgreement = async () => {
        if (!newAgreementName.trim()) return;
        setAgentLoading(true);
        try {
            const res = await fetch('/api/agent-banking/agreements', {
                method: 'POST',
                headers,
                body: JSON.stringify({ name: newAgreementName.trim(), kind: newAgreementKind })
            });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo crear el convenio');
            setAgentAgreements(prev => [...prev, data.data]);
            setAgentData(prev => ({ ...prev, agreementId: data.data.id }));
            setNewAgreementName('');
        } catch (error: any) {
            alert(error.message);
        } finally {
            setAgentLoading(false);
        }
    };

    const handleAgentTx = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!agentData.agreementId || !agentData.amount) return;
        setAgentLoading(true);
        try {
            const res = await fetch('/api/agent-banking/transactions', {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    agreementId: agentData.agreementId,
                    operation: agentData.operation,
                    amount: parseFloat(agentData.amount),
                    currency: agentData.currency,
                    ...(agentData.currency === 'USD' ? { exchangeRate: parseFloat(agentData.exchangeRate) } : {}),
                    ...(agentData.commission !== '' ? { commission: parseFloat(agentData.commission) } : {}),
                    ...(agentData.externalRef.trim() ? { externalRef: agentData.externalRef.trim() } : {}),
                    ...(agentData.customerRef.trim() ? { customerRef: agentData.customerRef.trim() } : {}),
                })
            });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.error || 'Error registrando la operación');

            setShowAgentModal(false);
            if (agentData.currency === 'USD') localStorage.setItem('nortex_tc_usd', agentData.exchangeRate);
            setAgentData({ agreementId: agentData.agreementId, operation: 'DEPOSITO', amount: '', commission: '', externalRef: '', customerRef: '', currency: 'NIO', exchangeRate: agentData.exchangeRate });
            fetchCashBalance();
            fetchCashMovements();
            fetchAgentAgreements();
            // Alertas de gaveta (Fase C): mínimo (sin efectivo para retiros) /
            // máximo (exceso → entregar al banco).
            if (Array.isArray(data.data?.alerts) && data.data.alerts.length > 0) {
                alert(data.data.alerts.join('\n\n'));
            }
        } catch (error: any) {
            alert(error.message);
        } finally {
            setAgentLoading(false);
        }
    };

    // --- SHIFT LOGIC (API) ---
    const handleOpenShift = async (e: React.FormEvent) => {
        e.preventDefault();

        // Validación propia en español (el form va `noValidate`: el globo nativo
        // del navegador está en inglés y no tiene arreglo por CSS).
        const errores: typeof errorApertura = {};
        // El PIN solo se valida si el negocio lo exige. Cuando no, ni siquiera
        // se muestra el campo: el servidor resuelve al cajero desde el JWT.
        if (exigePin && !/^\d{4}$/.test(employeePin)) errores.pin = 'El PIN son 4 dígitos.';
        if (initialCash.trim() === '') errores.fondo = 'Ingresá el fondo inicial. Si arrancás sin efectivo, poné 0.';
        else if (toDecimal(initialCash).isNegative()) errores.fondo = 'El fondo inicial no puede ser negativo.';
        setErrorApertura(errores);
        if (Object.keys(errores).length > 0) return;

        setShiftLoading(true);

        try {
            const token = localStorage.getItem('nortex_token');
            const res = await fetch('/api/shifts/open', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                // El fondo viaja por Decimal (nunca parseFloat sobre dinero).
                // El PIN solo se manda si el negocio lo exige: mandarlo igual
                // gastaría cupo del rate-limit y volvería a atar la apertura a
                // un dato que el servidor ya sabe resolver solo.
                body: JSON.stringify({
                    initialCash: Number(toDecimal(initialCash).toFixed(2)),
                    ...(exigePin ? { employeePin } : {}),
                })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error);
            setCurrentShift(data);
            setShowOpenShift(false);
            setEmployeePin('');
            setErrorApertura({});
            if (resumePaymentAfterShift) {
                setResumePaymentAfterShift(false);
                setShowPaymentOptions(true);
            }
        } catch (error: any) {
            setErrorApertura({ general: error?.message || 'No pudimos abrir la caja. Reintentá.' });
        }
        finally { setShiftLoading(false); }
    };

    const handleCloseShift = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!currentShift || !declaredCash) return;
        setShiftLoading(true);

        try {
            const token = localStorage.getItem('nortex_token');
            const res = await fetch('/api/shifts/close', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({
                    shiftId: currentShift.id,
                    declaredCash: parseFloat(declaredCash),
                    ...(declaredCashUsd.trim() !== '' ? { declaredCashUsd: parseFloat(declaredCashUsd) } : {}),
                })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error);

            setShiftReport({ expected: parseFloat(data.systemExpectedCash), diff: parseFloat(data.difference) });
            setCurrentShift(null);
        } catch (error: any) { alert(error.message); }
        finally { setShiftLoading(false); }
    };

    const finishClose = () => {
        setShowCloseShift(false);
        setShiftReport(null);
        setDeclaredCash('');
        setInitialCash('');
        setEmployeePin('');
        setShowOpenShift(true);
    };
    // -------------------

    const signalCartAddition = useCallback((productId: string) => {
        contadorResaltado.current += 1;
        setLineaResaltada({ id: productId, n: contadorResaltado.current });
        try { navigator.vibrate?.(30); } catch { /* el navegador no lo soporta */ }
    }, []);

    const appendMeasuredLine = useCallback((params: {
        product: Product;
        baseQuantity: string;
        presentationQuantity: string;
        presentationUnit: string;
        measurement: CartItem['measurement'];
        overrideUnitPrice?: string;
    }) => {
        const mode = effectiveSaleMode(params.product);
        const step = effectiveQuantityStep(params.product);
        const validated = validateQuantity(params.baseQuantity, { saleMode: mode, quantityStep: step });
        const quantity = validated.toNumber();
        const base = params.product.price;
        const price = params.overrideUnitPrice
            ? Number(params.overrideUnitPrice)
            : effectiveUnitPrice(
                {
                    basePrice: base,
                    wholesalePrice: params.product.wholesalePrice,
                    wholesaleMinQty: params.product.wholesaleMinQty,
                    packSize: params.product.packSize,
                    packPrice: params.product.packPrice,
                },
                quantity,
                Boolean(selectedCustomer?.isWholesale),
                'BASE',
            );
        const cartLineId = params.measurement?.clientEventId ?? generateOfflineId();
        setCart(prev => [...prev, {
            ...params.product,
            quantity,
            price,
            basePrice: params.overrideUnitPrice ? price : base,
            cartLineId,
            presentation: {
                quantity: params.presentationQuantity,
                unit: params.presentationUnit,
            },
            measurement: params.measurement,
        }]);
        signalCartAddition(params.product.id);
    }, [selectedCustomer?.isWholesale, signalCartAddition]);

    const addToCart = useCallback((product: Product) => {
        // Solo MEASURED explícito abre captura. Legacy null/undefined conserva
        // el flujo histórico de +1/fusión, pero su editor admite fracciones D6.
        if (product.saleMode === 'MEASURED') {
            setManualMeasuredProduct(product);
            setManualQuantityDraft('');
            setManualQuantityError('');
            return;
        }

        signalCartAddition(product.id);
        const wholesaleCustomer = Boolean(selectedCustomer?.isWholesale);
        setCart(prev => {
            const existing = prev.find(item => (
                item.id === product.id
                && item.saleMode !== 'MEASURED'
                && !item.measurement
                && !isQuotationCartLine(item)
                && !isPackCartLine(item)
            )) as CartLine | undefined;
            if (existing) {
                return prev.map(item => {
                    if (lineKey(item) !== lineKey(existing)) return item;
                    const line = item as CartLine;
                    const newQty = new Decimal(item.quantity).plus(1).toNumber();
                    const base = line.basePrice ?? item.price;
                    return {
                        ...item,
                        quantity: newQty,
                        basePrice: base,
                        price: effectiveUnitPrice({ basePrice: base, wholesalePrice: line.wholesalePrice, wholesaleMinQty: line.wholesaleMinQty, packSize: line.packSize, packPrice: line.packPrice }, newQty, wholesaleCustomer, 'BASE'),
                    };
                });
            }
            const price = effectiveUnitPrice({ basePrice: product.price, wholesalePrice: product.wholesalePrice, wholesaleMinQty: product.wholesaleMinQty, packSize: product.packSize, packPrice: product.packPrice }, 1, wholesaleCustomer, 'BASE');
            return [...prev, { ...product, quantity: 1, cartLineId: product.id, basePrice: product.price, price }];
        });
    }, [selectedCustomer?.isWholesale, signalCartAddition]);

    const addPackToCart = useCallback((product: Product) => {
        const packUnit = product.packUnit?.trim();
        const packSize = Number(product.packSize);
        const configuredBasePrice = (product as CartLine).basePrice ?? product.price;
        if (!packUnit || !Number.isFinite(packSize) || packSize <= 0) {
            setLastScanFeedback({ message: `${product.name} no tiene un empaque válido`, type: 'error' });
            playErrorBeep();
            return;
        }
        try {
            // El factor completo debe ser vendible bajo el step histórico del
            // producto (p. ej. COUNTED no admite cajas de 12.5 unidades).
            validateQuantity(packSize, {
                saleMode: effectiveSaleMode(product),
                quantityStep: effectiveQuantityStep(product),
            });
        } catch (error) {
            trackQuantityStepFailure(error, 'pack');
            setLastScanFeedback({
                message: error instanceof Error ? error.message : 'El empaque no coincide con el paso del producto',
                type: 'error',
            });
            playErrorBeep();
            return;
        }

        const wholesaleCustomer = Boolean(selectedCustomer?.isWholesale);
        const packUnitPrice = effectiveUnitPrice({
            basePrice: configuredBasePrice,
            wholesalePrice: product.wholesalePrice,
            wholesaleMinQty: product.wholesaleMinQty,
            packSize: product.packSize,
            packPrice: product.packPrice,
        }, packSize, wholesaleCustomer, 'PACK');

        setCart(previous => {
            const existing = previous.find(item => (
                item.id === product.id
                && isPackCartLine(item)
                && !item.measurement
                && !isQuotationCartLine(item)
            ));
            if (!existing) {
                return [...previous, {
                    ...product,
                    quantity: packSize,
                    price: packUnitPrice,
                    basePrice: configuredBasePrice,
                    cartLineId: `pack:${product.id}`,
                    presentation: { quantity: '1', unit: packUnit },
                }];
            }
            const existingKey = lineKey(existing);
            return previous.map(item => {
                if (lineKey(item) !== existingKey) return item;
                const nextBaseQuantity = new Decimal(item.quantity).plus(packSize);
                const nextPackCount = nextBaseQuantity.dividedBy(packSize);
                return {
                    ...item,
                    quantity: nextBaseQuantity.toNumber(),
                    price: packUnitPrice,
                    basePrice: configuredBasePrice,
                    presentation: {
                        quantity: formatQuantityValue(nextPackCount),
                        unit: packUnit,
                    },
                };
            });
        });
        signalCartAddition(product.id);
        playBeep();
    }, [selectedCustomer?.isWholesale, signalCartAddition]);

    const confirmManualMeasured = useCallback((event: React.FormEvent) => {
        event.preventDefault();
        if (!manualMeasuredProduct) return;
        try {
            const mode = effectiveSaleMode(manualMeasuredProduct);
            const step = effectiveQuantityStep(manualMeasuredProduct);
            const quantity = validateQuantity(manualQuantityDraft, { saleMode: mode, quantityStep: step });
            const clientEventId = generateOfflineId();
            appendMeasuredLine({
                product: manualMeasuredProduct,
                baseQuantity: quantity.toString(),
                presentationQuantity: formatQuantityValue(quantity),
                presentationUnit: manualMeasuredProduct.unit || 'unidad',
                measurement: {
                    source: 'MANUAL',
                    clientEventId,
                    capturedAt: new Date().toISOString(),
                },
            });
            setManualMeasuredProduct(null);
            setManualQuantityDraft('');
            setManualQuantityError('');
            playBeep();
        } catch (error) {
            trackQuantityStepFailure(error, 'manual');
            setManualQuantityError(error instanceof Error ? error.message : 'La cantidad no es válida');
            playErrorBeep();
        }
    }, [appendMeasuredLine, manualMeasuredProduct, manualQuantityDraft]);

    const previewProduct = useCallback((preview: ScalePreviewResponse): Product => {
        const catalog = products.find(product => product.id === preview.product.id);
        const price = Number(preview.product.price);
        if (!Number.isFinite(price) || price < 0) throw new Error('El producto de la etiqueta no tiene un precio válido');
        const step = preview.product.quantityStep == null ? null : Number(preview.product.quantityStep);
        return {
            ...(catalog ?? {
                id: preview.product.id,
                name: preview.product.name,
                sku: preview.plu,
                category: 'General',
                stock: Number.NaN,
                costPrice: 0,
            }),
            id: preview.product.id,
            name: preview.product.name,
            unit: preview.product.unit,
            price,
            saleMode: preview.product.saleMode ?? null,
            quantityStep: Number.isFinite(step) && Number(step) > 0 ? step : null,
        };
    }, [products]);

    const appendScalePreview = useCallback((rawCode: string, preview: ScalePreviewResponse, managerOverride = false) => {
        const product = previewProduct(preview);
        const baseQuantity = validateQuantity(preview.baseQuantity, {
            saleMode: effectiveSaleMode(product),
            quantityStep: effectiveQuantityStep(product),
        });
        const clientEventId = generateOfflineId();
        const overrideUnitPrice = managerOverride && preview.pricingPolicy === 'ACCEPT_LABEL_TOTAL'
            ? acceptedScaleLabelUnitPrice(
                preview.encodedPrice ?? (() => { throw new Error('La etiqueta no trae total codificado'); })(),
                baseQuantity.toString(),
            )
            : undefined;
        appendMeasuredLine({
            product,
            baseQuantity: baseQuantity.toString(),
            presentationQuantity: preview.sourceValue,
            presentationUnit: preview.sourceUnit,
            overrideUnitPrice,
            measurement: {
                source: 'SCALE_LABEL',
                rawCode,
                profileVersionId: preview.profileVersionId,
                clientEventId,
                capturedAt: new Date().toISOString(),
                previewBaseQuantity: formatQuantityValue(baseQuantity),
                sourceValue: preview.sourceValue,
                sourceUnit: preview.sourceUnit,
                encodedPrice: preview.encodedPrice,
                pricingPolicy: preview.pricingPolicy,
                managerOverride,
            },
        });
        lastScaleScanRef.current = { rawCode, scannedAt: Date.now() };
        setLastScanFeedback({
            message: `${product.name}: ${formatQuantityValue(baseQuantity)} ${product.unit || 'unidad'}`,
            type: 'success',
        });
        playBeep();
    }, [appendMeasuredLine, previewProduct]);

    const acceptScalePreview = useCallback((rawCode: string, preview: ScalePreviewResponse) => {
        const decision = decideScalePreviewAcceptance({
            rawCode,
            pricingPolicy: preview.pricingPolicy,
            lastScan: lastScaleScanRef.current,
            nowMs: Date.now(),
            duplicateWindowMs: DUPLICATE_SCALE_SCAN_WINDOW_MS,
            canApproveExceptionalPrice: canApproveScaleLabelTotal,
        });

        if (decision.kind === 'block_manager_session') {
            setLastScanFeedback({
                message: 'Esta etiqueta requiere iniciar sesión con un gerente o administrador para aceptar su total impreso',
                type: 'error',
            });
            playErrorBeep();
            return;
        }
        if (decision.kind === 'prompt_duplicate') {
            setPendingDuplicateScaleLabel({
                rawCode,
                preview,
                requiresManagerOverride: decision.requiresManagerOverride,
            });
            setLastScanFeedback({ message: 'Etiqueta repetida: confirmá si es otro paquete físico', type: 'error' });
            playErrorBeep();
            return;
        }
        if (decision.kind === 'prompt_manager_override') {
            setPendingScaleLabelOverride({ rawCode, preview });
            return;
        }
        appendScalePreview(rawCode, preview, decision.managerOverride);
    }, [appendScalePreview, canApproveScaleLabelTotal]);

    const previewFromOfflineContext = useCallback((rawCode: string, profileVersionId: string): ScalePreviewResponse => {
        const profile = scaleContext?.profiles.find(candidate => candidate.profileVersionId === profileVersionId);
        if (!profile) throw new Error('La versión de esta etiqueta no está disponible sin conexión');
        const route = routeScaleLabel(rawCode, [profile]);
        if (route.kind !== 'SCALE_LABEL') throw new Error('La etiqueta no coincide con la versión fijada');
        if (route.label.valueKind === 'TOTAL_PRICE') {
            throw new Error('Esta etiqueta solo trae precio total y requiere conexión para revalidarla');
        }
        const mapping = scaleContext?.mappings.find(candidate =>
            candidate.profileVersionId === profileVersionId && candidate.plu === route.label.plu
        );
        if (!mapping) throw new Error(`PLU ${route.label.plu} no está vinculado en la versión offline`);
        const product = products.find(candidate => candidate.id === mapping.productId) ?? mapping.product;
        if (!product) throw new Error('El producto de esta etiqueta no está disponible sin conexión');
        const baseQuantity = convertQuantity(route.label.value, mapping.sourceUnit, product.unit || mapping.sourceUnit);
        return {
            classification: 'SCALE_LABEL',
            profileVersionId,
            profileVersion: profile.profileVersion,
            product: {
                id: product.id,
                name: product.name,
                unit: product.unit || mapping.sourceUnit,
                price: product.price,
                saleMode: product.saleMode ?? null,
                quantityStep: product.quantityStep ?? null,
            },
            plu: route.label.plu,
            sourceValue: route.label.value,
            sourceUnit: mapping.sourceUnit,
            baseQuantity: formatQuantityValue(baseQuantity),
            pricingPolicy: profile.pricingPolicy,
        };
    }, [products, scaleContext]);

    const requestScalePreview = useCallback(async (rawCode: string, profileVersionId?: string): Promise<ScalePreviewResponse> => {
        const response = await fetch('/api/scale-labels/preview', {
            method: 'POST',
            headers,
            body: JSON.stringify({ rawCode, ...(profileVersionId ? { profileVersionId } : {}) }),
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
            const nested = body?.error && typeof body.error === 'object' ? body.error : null;
            const message = nested?.message || body?.message || (typeof body?.error === 'string' ? body.error : null) || 'No se pudo interpretar la etiqueta';
            throw new ScalePreviewRequestError(nested?.code || body?.code, message);
        }
        const preview = (body?.data ?? body) as ScalePreviewResponse;
        if ((preview as unknown as { classification?: string }).classification === 'SKU') {
            throw new ScalePreviewRequestError('SCALE_PROFILE_NOT_FOUND', 'El código no coincide con una etiqueta configurada');
        }
        if (preview.classification !== 'SCALE_LABEL' || !preview.profileVersionId) {
            throw new Error('El servidor no devolvió una vista previa de etiqueta válida');
        }
        return preview;
    }, [headers]);

    const handleBarcodeScan = useCallback(async (rawCode: string) => {
        const code = rawCode.trim();
        try {
            let routed: ReturnType<typeof routeScaleLabel> | null = null;
            if (scaleContext?.profiles.length) routed = routeScaleLabel(code, scaleContext.profiles);

            if (routed?.kind === 'SCALE_LABEL') {
                const preview = navigator.onLine
                    ? await requestScalePreview(code, routed.label.profileId)
                    : previewFromOfflineContext(code, routed.label.profileId);
                acceptScalePreview(code, preview);
                return;
            }

            // Si el contexto local quedó un instante atrás, el servidor tiene
            // la última palabra antes de permitir SKU. Solo NOT_FOUND habilita
            // el fallback; checksum/PLU/rango inválidos jamás se vuelven +1.
            if (navigator.onLine && /^\d{13}$/.test(code)) {
                try {
                    const preview = await requestScalePreview(code);
                    acceptScalePreview(code, preview);
                    void refreshScaleContext();
                    return;
                } catch (error) {
                    if (!(error instanceof ScalePreviewRequestError) || error.code !== 'SCALE_PROFILE_NOT_FOUND') throw error;
                }
            }

            // El router siempre intenta perfiles antes que SKU. Solo si ninguno
            // reconoce el código se permite el match exacto de catálogo.
            const found = products.find(product => product.sku.toUpperCase() === code.toUpperCase());
            if (found) {
                addToCart(found);
                if (found.saleMode === 'MEASURED') {
                    setLastScanFeedback({ message: `${found.name}: ingresá la cantidad`, type: 'success' });
                } else if (Number.isFinite(found.stock) && found.stock <= 0) {
                    playErrorBeep();
                    setLastScanFeedback({ message: `${found.name}: sin existencia en el sistema`, type: 'error' });
                } else {
                    playBeep();
                    setLastScanFeedback({ message: `Escaneado: ${found.name}`, type: 'success' });
                }
                return;
            }

            if (!scaleContextReady && /^\d{13}$/.test(code)) {
                throw new Error('Los formatos de etiqueta todavía se están cargando; intentá de nuevo');
            }
            throw new Error(`SKU "${code}" no encontrado`);
        } catch (error) {
            trackQuantityStepFailure(error, 'scale_label');
            const message = error instanceof ScaleLabelError
                ? error.message
                : error instanceof Error ? error.message : 'No se pudo leer el código';
            playErrorBeep();
            setLastScanFeedback({ message, type: 'error' });
        } finally {
            window.setTimeout(() => setLastScanFeedback(null), 3500);
        }
    }, [acceptScalePreview, addToCart, previewFromOfflineContext, products, refreshScaleContext, requestScalePreview, scaleContext, scaleContextReady]);

    const confirmDuplicateScaleLabel = useCallback(() => {
        if (!pendingDuplicateScaleLabel) return;
        try {
            const decision = decideScalePreviewAcceptance({
                rawCode: pendingDuplicateScaleLabel.rawCode,
                pricingPolicy: pendingDuplicateScaleLabel.preview.pricingPolicy,
                lastScan: lastScaleScanRef.current,
                nowMs: Date.now(),
                duplicateWindowMs: DUPLICATE_SCALE_SCAN_WINDOW_MS,
                canApproveExceptionalPrice: canApproveScaleLabelTotal,
                skipDuplicateCheck: true,
            });
            if (decision.kind === 'prompt_manager_override') {
                setPendingScaleLabelOverride({
                    rawCode: pendingDuplicateScaleLabel.rawCode,
                    preview: pendingDuplicateScaleLabel.preview,
                });
                setPendingDuplicateScaleLabel(null);
                return;
            }
            appendScalePreview(
                pendingDuplicateScaleLabel.rawCode,
                pendingDuplicateScaleLabel.preview,
                decision.kind === 'append' ? decision.managerOverride : pendingDuplicateScaleLabel.requiresManagerOverride,
            );
            setPendingDuplicateScaleLabel(null);
        } catch (error) {
            setLastScanFeedback({ message: error instanceof Error ? error.message : 'No se pudo agregar el paquete', type: 'error' });
        }
    }, [appendScalePreview, canApproveScaleLabelTotal, pendingDuplicateScaleLabel]);

    const confirmScaleLabelOverride = useCallback(() => {
        if (!pendingScaleLabelOverride) return;
        try {
            appendScalePreview(pendingScaleLabelOverride.rawCode, pendingScaleLabelOverride.preview, true);
            setPendingScaleLabelOverride(null);
        } catch (error) {
            setLastScanFeedback({ message: error instanceof Error ? error.message : 'No se pudo aprobar la etiqueta', type: 'error' });
            playErrorBeep();
        }
    }, [appendScalePreview, pendingScaleLabelOverride]);

    // ÚNICO listener global del lector wedge. Los inputs quedan fuera para que
    // Enter siga confirmando formularios y no venda accidentalmente lo escrito.
    useEffect(() => {
        if (!scannerActive) return;
        const handleScannerKey = (event: KeyboardEvent) => {
            const target = event.target as HTMLElement;
            const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable;
            if (isInput) return;

            if (event.key === 'Enter') {
                const code = scanBufferRef.current.trim();
                scanBufferRef.current = '';
                if (scanTimerRef.current) clearTimeout(scanTimerRef.current);
                if (code.length >= 2) {
                    event.preventDefault();
                    void handleBarcodeScan(code);
                }
                return;
            }
            if (event.key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey) return;
            scanBufferRef.current += event.key;
            if (scanTimerRef.current) clearTimeout(scanTimerRef.current);
            scanTimerRef.current = setTimeout(() => { scanBufferRef.current = ''; }, 120);
        };
        window.addEventListener('keydown', handleScannerKey, true);
        return () => {
            window.removeEventListener('keydown', handleScannerKey, true);
            if (scanTimerRef.current) clearTimeout(scanTimerRef.current);
        };
    }, [handleBarcodeScan, scannerActive]);

    // ── Quitar con deshacer (P0-4) ─────────────────────────────────────────
    // Borrar una línea no pedía confirmación ni ofrecía vuelta atrás, y el
    // botón medía 14px. Ahora el botón es de 44px —o sea que se acierta— y si
    // igual se toca de más, hay 5 segundos para recuperarla. Confirmar cada
    // borrado sería peor: en un mostrador, un diálogo por línea se convierte en
    // ruido que se acepta sin leer.
    const quitarLinea = useCallback((key: string) => {
        const posicion = cart.findIndex(i => lineKey(i) === key);
        if (posicion === -1) return;
        setQuitadoReciente({ item: cart[posicion], posicion });
        setCart(prev => prev.filter(i => lineKey(i) !== key));
        setQuantityErrors(prev => {
            const next = { ...prev };
            delete next[key];
            return next;
        });
    }, [cart]);

    const deshacerQuitado = useCallback(() => {
        if (!quitadoReciente) return;
        setCart(prev => {
            // Solo se compara la identidad de LÍNEA. Dos paquetes medidos del
            // mismo producto son mercadería distinta y deben coexistir.
            if (prev.some(i => lineKey(i) === lineKey(quitadoReciente.item))) return prev;
            const copia = [...prev];
            copia.splice(Math.min(quitadoReciente.posicion, copia.length), 0, quitadoReciente.item);
            return copia;
        });
        setQuitadoReciente(null);
    }, [quitadoReciente]);

    // El destello de la línea recién agregada se apaga solo (P1-4).
    useEffect(() => {
        if (!lineaResaltada) return;
        const timeout = setTimeout(() => setLineaResaltada(null), 400);
        return () => clearTimeout(timeout);
    }, [lineaResaltada]);

    // La ventana de deshacer se cierra sola.
    useEffect(() => {
        if (!quitadoReciente) return;
        const t = setTimeout(() => setQuitadoReciente(null), 5000);
        return () => clearTimeout(t);
    }, [quitadoReciente]);

    // Confirmación no bloqueante del parqueo/restauración. Se queda lo
    // suficiente para leerla y actuar, pero no tapa el siguiente cobro.
    useEffect(() => {
        if (!parkingNotice) return;
        const t = setTimeout(() => setParkingNotice(null), 6000);
        return () => clearTimeout(t);
    }, [parkingNotice]);

    // Reprecia una línea al cambiar su cantidad (mayoreo entra/sale según el umbral).
    const repricedLine = (item: CartItem, newQty: number): CartItem => {
        if (isQuotationCartLine(item)) return item;
        const line = item as CartLine;
        const base = line.basePrice ?? item.price;
        const presentationKind = isPackCartLine(item) ? 'PACK' : 'BASE';
        const price = effectiveUnitPrice(
            { basePrice: base, wholesalePrice: line.wholesalePrice, wholesaleMinQty: line.wholesaleMinQty, packSize: line.packSize, packPrice: line.packPrice },
            newQty,
            Boolean(selectedCustomer?.isWholesale),
            presentationKind,
        );
        const presentation = presentationKind === 'PACK' && item.packSize
            ? { quantity: formatQuantityValue(new Decimal(newQty).div(item.packSize)), unit: item.packUnit || 'empaque' }
            : effectiveSaleMode(item) === 'MEASURED' && item.measurement?.source !== 'SCALE_LABEL'
                ? { quantity: formatQuantityValue(newQty), unit: item.unit || 'unidad' }
                : item.presentation;
        return { ...item, quantity: newQty, basePrice: base, price, presentation } as CartItem;
    };

    const setQuantityError = (key: string, message: string | null) => {
        setQuantityErrors(prev => {
            if (!message && !prev[key]) return prev;
            const next = { ...prev };
            if (message) next[key] = message;
            else delete next[key];
            return next;
        });
    };

    const validateCartLineQuantity = (item: CartItem, value: Decimal.Value): Decimal => {
        const validated = validateQuantity(value, {
            saleMode: effectiveSaleMode(item),
            quantityStep: effectiveQuantityStep(item),
        });
        if (isPackCartLine(item)) {
            const packSize = new Decimal(item.packSize ?? 0);
            if (!packSize.isFinite() || !packSize.greaterThan(0) || !validated.modulo(packSize).isZero()) {
                throw new Error(`La línea de ${item.packUnit || 'empaque'} debe contener empaques completos de ${formatQuantityValue(packSize)} ${item.unit || 'unidad'}`);
            }
        }
        return validated;
    };

    const updateQuantity = (key: string, delta: number) => {
        const current = cart.find(item => lineKey(item) === key);
        if (!current) return;
        if (isQuotationCartLine(current)) {
            setQuantityError(key, 'La cantidad está fijada por la cotización original.');
            return;
        }
        if (current.measurement?.source === 'SCALE_LABEL') {
            setQuantityError(key, 'La cantidad viene de la etiqueta; escaneá otra si cambió.');
            return;
        }
        try {
            const candidate = new Decimal(current.quantity).plus(delta);
            const validated = validateCartLineQuantity(current, candidate);
            setQuantityError(key, null);
            setCart(prev => prev.map(item => lineKey(item) === key ? repricedLine(item, validated.toNumber()) : item));
        } catch (error) {
            trackQuantityStepFailure(error, 'cart');
            setQuantityError(key, error instanceof Error ? error.message : 'La cantidad no es válida');
        }
    };

    const setQuantity = (key: string, qty: number) => {
        const current = cart.find(item => lineKey(item) === key);
        if (!current) return;
        if (isQuotationCartLine(current)) {
            setQuantityError(key, 'La cantidad está fijada por la cotización original.');
            return;
        }
        if (current.measurement?.source === 'SCALE_LABEL') {
            setQuantityError(key, 'La cantidad viene de la etiqueta; no se puede sobrescribir.');
            return;
        }
        try {
            const validated = validateCartLineQuantity(current, qty);
            setQuantityError(key, null);
            setCart(prev => prev.map(item => lineKey(item) === key ? repricedLine(item, validated.toNumber()) : item));
        } catch (error) {
            trackQuantityStepFailure(error, 'cart');
            setQuantityError(key, error instanceof Error ? error.message : 'La cantidad no es válida');
        }
    };

    // Al cambiar el cliente (mayorista ↔ detalle), repreciar TODO el carrito.
    useEffect(() => {
        const wholesaleCustomer = Boolean(selectedCustomer?.isWholesale);
        setCart(prev => prev.map(item => {
            if (isQuotationCartLine(item)) return item;
            const line = item as CartLine;
            const base = line.basePrice ?? item.price;
            const presentationKind = isPackCartLine(item) ? 'PACK' : 'BASE';
            const price = effectiveUnitPrice(
                { basePrice: base, wholesalePrice: line.wholesalePrice, wholesaleMinQty: line.wholesaleMinQty, packSize: line.packSize, packPrice: line.packPrice },
                item.quantity,
                wholesaleCustomer,
                presentationKind,
            );
            return price === item.price ? item : ({ ...item, basePrice: base, price } as CartItem);
        }));
    }, [selectedCustomer?.id, selectedCustomer?.isWholesale]);

    // Per-item discount
    const setItemDiscount = (key: string, discount: number) => {
        setCart(prev => prev.map(item => {
            if (lineKey(item) === key) {
                if (isQuotationCartLine(item)) return item;
                return { ...item, discount: Math.min(100, Math.max(0, discount)) };
            }
            return item;
        }));
    };

    // ==========================================
    // 🅿️ PARQUEO DE VENTAS (Hold Cart)
    // ==========================================
    const handleHoldCart = useCallback(() => {
        if (cart.length === 0 || parkingLockRef.current) return;
        if (!currentShift) {
            setParkingNotice({ tone: 'warning', message: 'Abrí la caja para aparcar esta venta.' });
            setErrorApertura({});
            setResumePaymentAfterShift(false);
            setShowOpenShift(true);
            return;
        }
        if (heldCarts.length >= 5) {
            setParkingNotice({ tone: 'warning', message: 'Ya hay 5 ventas aparcadas. Continuá o descartá una para liberar espacio.' });
            setShowMobileCart(false);
            setShowHeldCarts(true);
            return;
        }
        parkingLockRef.current = true;
        const heldId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const held: HeldCart = {
            id: heldId,
            label: selectedCustomer?.name || `Venta ${heldCarts.length + 1}`,
            items: [...cart],
            customer: selectedCustomer,
            clienteId: selectedCustomer?.id ?? null,
            globalDiscount,
            shiftId: currentShift?.id,
            heldAt: new Date(),
        };
        setHeldCarts(prev => [...prev, held]);
        setCart([]);
        setSelectedCustomer(null);
        setCustomerSearch('');
        setGlobalDiscount('');
        setCreditOverrideAuthorized(false);
        setCreditOverridePin('');
        setShowMobileCart(false);
        setShowHeldCarts(false);
        setParkingNotice({
            tone: 'success',
            message: `Venta aparcada · ${cart.length} ${cart.length === 1 ? 'producto' : 'productos'}`,
            heldId,
        });
        trackEvent('sale_parked', {
            cart_items: cart.length,
            has_customer: Boolean(selectedCustomer),
            parked_count: heldCarts.length + 1,
        });
        window.setTimeout(() => { parkingLockRef.current = false; }, 0);
    }, [cart, heldCarts, selectedCustomer, currentShift?.id, globalDiscount]);

    const handleRestoreCart = useCallback((heldId: string) => {
        const toRestore = heldCarts.find(h => h.id === heldId);
        if (!toRestore) return;
        const swappedCurrentCart = cart.length > 0;
        // Si ya había una venta en curso, se intercambian atómicamente: sale
        // una aparcada y entra la actual. Incluso con 5 aparcadas el cupo no
        // crece, por lo que bloquear el cambio era una fricción artificial.
        if (cart.length > 0) {
            const currentHeld: HeldCart = {
                id: typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
                    ? crypto.randomUUID()
                    : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                label: selectedCustomer?.name || `Venta ${heldCarts.length}`,
                items: [...cart],
                customer: selectedCustomer,
                clienteId: selectedCustomer?.id ?? null,
                globalDiscount,
                shiftId: currentShift?.id,
                heldAt: new Date(),
            };
            setHeldCarts(prev => [...prev.filter(h => h.id !== heldId), currentHeld]);
        } else {
            setHeldCarts(prev => prev.filter(h => h.id !== heldId));
        }
        setCart(toRestore.items);
        // Un aparcado rescatado del storage trae `clienteId`, no el objeto: se
        // re-resuelve contra la lista viva (si lo borraron, queda sin cliente).
        const cliente = toRestore.customer
            ?? (toRestore.clienteId ? customerList.find(c => c.id === toRestore.clienteId) ?? null : null);
        setSelectedCustomer(cliente);
        setCustomerSearch(cliente?.name || '');
        setShowHeldCarts(false);
        setHeldCartToDiscard(null);
        setGlobalDiscount(toRestore.items.some(isQuotationCartLine) ? '' : (toRestore.globalDiscount ?? ''));
        setShowMobileCart(true);
        setParkingNotice({
            tone: 'success',
            message: swappedCurrentCart
                ? 'Venta recuperada · la venta actual quedó aparcada'
                : `Venta recuperada · ${toRestore.items.length} ${toRestore.items.length === 1 ? 'producto' : 'productos'}`,
        });
        trackEvent('parked_sale_restored', {
            cart_items: toRestore.items.length,
            swapped_current_cart: swappedCurrentCart,
            parked_count: swappedCurrentCart ? heldCarts.length : heldCarts.length - 1,
        });
    }, [cart, heldCarts, selectedCustomer, currentShift?.id, customerList, globalDiscount]);

    // ── P0-1 · Venta a medias de otro turno ────────────────────────────────
    const recuperarVentaPendiente = useCallback(() => {
        if (!ventaPendiente) return;
        const restoredLines = ventaPendiente.lineas as unknown as CartItem[];
        setCart(restoredLines);
        setGlobalDiscount(restoredLines.some(isQuotationCartLine) ? '' : ventaPendiente.descuentoGlobal);
        setClienteARestaurar(ventaPendiente.clienteId);
        setVentaPendiente(null);
    }, [ventaPendiente]);

    const descartarVentaPendiente = useCallback(() => {
        setVentaPendiente(null);
        if (identidad) {
            localStorage.removeItem(claveCarrito(identidad.tenantId, identidad.userId));
            localStorage.removeItem(claveCarritoLegacy(identidad.tenantId, identidad.userId));
        }
    }, [identidad]);

    // Reset del panel de anulación. Se llama al cerrar el modal Y al buscar otra
    // factura: sin esto, el cajero abre el panel para la factura A, escribe el
    // motivo, busca la B (el buscador queda activo arriba) y el botón de anular
    // sigue armado — con el motivo de A y apuntando a la B.
    const limpiarAnulacion = useCallback(() => {
        setMostrarAnular(false);
        setMotivoAnulacion('');
        setErrorAnulacion('');
    }, []);

    const anularFactura = useCallback(async () => {
        if (!returnSaleData?.id) return;
        setAnulando(true);
        setErrorAnulacion('');
        try {
            const token = localStorage.getItem('nortex_token');
            const res = await fetch(`/api/sales/${returnSaleData.id}/cancel`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({ motivo: motivoAnulacion }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'No se pudo anular la factura');

            // El stock volvió y la caja cambió: se refresca lo que el cajero
            // tiene a la vista, en vez de dejarlo con números viejos.
            await Promise.all([fetchProducts(), fetchCashBalance()]);
            limpiarAnulacion();
            setReturnSaleData(null);
            setShowReturnModal(false);
            setReturnItems([]);
            setReturnSaleSearch('');
            alert('Factura anulada. La mercadería volvió al inventario y la venta dejó de contar en los reportes.');
        } catch (err: any) {
            setErrorAnulacion(err?.message || 'No se pudo anular la factura');
        } finally {
            setAnulando(false);
        }
    }, [returnSaleData, motivoAnulacion, limpiarAnulacion, fetchProducts, fetchCashBalance]);

    const handleRemoveHeldCart = useCallback((heldId: string) => {
        setHeldCarts(prev => prev.filter(h => h.id !== heldId));
        setHeldCartToDiscard(null);
        if (heldCarts.length <= 1) setShowHeldCarts(false);
        setParkingNotice({ tone: 'success', message: 'Venta aparcada descartada.' });
        trackEvent('parked_sale_discarded', { parked_count: Math.max(0, heldCarts.length - 1) });
    }, [heldCarts.length]);

    const openHeldCarts = useCallback(() => {
        // El ticket móvil ocupa su propia capa. Cerrarlo antes de mostrar este
        // selector evita dos superficies interactivas superpuestas.
        setShowMobileCart(false);
        setHeldCartToDiscard(null);
        setShowHeldCarts(true);
    }, []);

    // ==========================================
    // ⌨️ HOTKEYS BÉLICOS
    // ==========================================
    useEffect(() => {
        const handleHotkey = (e: KeyboardEvent) => {
            // Alternativas sin Fn para laptops; Ctrl/Cmd+P queda libre para imprimir.
            if (e.ctrlKey || e.metaKey) {
                const key = e.key.toLowerCase();
                if (key === 'k') {
                    e.preventDefault();
                    searchRef.current?.focus();
                    return;
                }
                if (e.key === 'Enter') {
                    e.preventDefault();
                    if (e.repeat || processing || completedSale || showCashPreModal) return;
                    if (currentShift && cart.length > 0) handleCheckout('CASH');
                    return;
                }
            }

            // F-keys always work (don't type in inputs)
            switch (e.key) {
                case 'F2':
                    e.preventDefault();
                    searchRef.current?.focus();
                    return;
                case 'F4':
                    e.preventDefault();
                    handleHoldCart();
                    return;
                case 'F7':
                    e.preventDefault();
                    if (currentShift) { setShowCashModal('OUT'); setCashCategory(''); }
                    return;
                case 'F8':
                    e.preventDefault();
                    if (currentShift) { setShowCashModal('IN'); setCashCategory(''); }
                    return;
                case 'F9':
                    e.preventDefault();
                    // Guarda anti-doble-cobro: sin esto, el auto-repeat del
                    // teclado (dedo apoyado medio segundo) o un F9 por
                    // costumbre con el modal de venta completada abierto
                    // disparaba N POST /api/sales = N cobros y N descuentos
                    // de stock. El botón EFECTIVO ya estaba protegido con
                    // disabled={processing}; el atajo documentado, no.
                    if (e.repeat || processing || completedSale || showCashPreModal) return;
                    if (currentShift && cart.length > 0) handleCheckout('CASH');
                    return;
                case 'Escape':
                    e.preventDefault();
                    // Close any open modal
                    // El menú de acciones va PRIMERO: es lo más superficial de
                    // la pila y lo único que se abre sin tapar la pantalla, así
                    // que Escape tiene que cerrarlo a él y no a lo que haya
                    // debajo.
                    if (showCashActions) { setShowCashActions(false); return; }
                    if (completedSale) { handleNewSale(); return; }
                    if (showPaymentOptions) { setShowPaymentOptions(false); return; }
                    if (showCashModal) { setShowCashModal(null); return; }
                    if (showCreditPanel) { setShowCreditPanel(false); return; }
                    if (pendingScaleLabelOverride) { setPendingScaleLabelOverride(null); return; }
                    if (showHeldCarts) { setShowHeldCarts(false); return; }
                    if (showQuickCreate) { setShowQuickCreate(false); return; }
                    if (showAddModal) { setShowAddModal(false); return; }
                    if (showImportModal) { closeImportModal(); return; }
                    if (showCloseShift) { setShowCloseShift(false); return; }
                    if (showMovementsList) { setShowMovementsList(false); return; }
                    if (showCashPreModal) { setShowCashPreModal(false); return; }
                    // La apertura de caja se cierra de última: es el modal de más
                    // abajo en la pila. Antes NO se cerraba con nada — Escape no
                    // hacía nada y no tenía botón de cierre.
                    if (showOpenShift) { setShowOpenShift(false); return; }
                    return;
            }
        };
        window.addEventListener('keydown', handleHotkey);
        return () => window.removeEventListener('keydown', handleHotkey);
    }, [handleHoldCart, currentShift, cart, completedSale, processing, showPaymentOptions, showCashPreModal, showCashModal, showCreditPanel, pendingScaleLabelOverride, showHeldCarts, showQuickCreate, showAddModal, showImportModal, showCloseShift, showMovementsList, showOpenShift, showCashActions]);

    // ==========================================
    // 🔴 FIADO INTELIGENTE (Credit Override)
    // ==========================================
    const handleCreditOverride = useCallback(async () => {
        if (creditOverridePin.length !== 4) return;
        try {
            // La verificación es del SERVIDOR. Antes se hacía acá: se pedía
            // GET /api/employees y se comparaba `empleado.pin === tecleado` —
            // pero ese endpoint borra el PIN de la respuesta, así que la
            // comparación era `undefined === '1234'` y esta autorización NUNCA
            // funcionó: le decía "PIN incorrecto" al dueño con su propio PIN.
            const res = await fetch('/api/employees/verify-pin', {
                method: 'POST',
                headers: { ...headers, 'Content-Type': 'application/json' },
                body: JSON.stringify({ pin: creditOverridePin }),
            });
            const data = await res.json().catch(() => ({}));
            if (res.ok && data?.autorizado === true) {
                setCreditOverrideAuthorized(true);
                setShowCreditPanel(false);
                playBeep();
            } else {
                playErrorBeep();
                alert(data?.error || 'PIN incorrecto o no tiene permisos de Dueño/Gerente.');
                setCreditOverridePin('');
            }
        } catch {
            playErrorBeep();
            alert('No pudimos verificar el PIN. Revisá la conexión.');
        }
    }, [creditOverridePin, headers]);

    // ==========================================
    // QUICK CREATE PRODUCT (saves to DB + adds to cart)
    // ==========================================
    const handleQuickCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        setQuickSaving(true);

        try {
            // Alta rápida crea un producto legacy (saleMode null): conserva
            // fracciones de hasta 4dp. Solo COUNTED explícito impondría enteros.
            const stock = validateNonNegativeQuantity(quickProduct.stock, {
                saleMode: 'MEASURED',
                quantityStep: '0.0001',
            });
            const res = await fetch('/api/products', {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    name: quickProduct.name,
                    sku: quickProduct.sku.toUpperCase() || `SKU-${Date.now().toString(36).toUpperCase()}`,
                    price: parseFloat(quickProduct.price),
                    cost: parseFloat(quickProduct.cost) || parseFloat(quickProduct.price) * 0.7,
                    stock: stock.toString(),
                    minStock: 5,
                    category: 'General',
                    unit: 'unidad',
                    saleMode: null,
                    quantityStep: null,
                })
            });

            const data = await res.json();
            if (!res.ok) throw new Error(data.error);

            // Map to frontend Product and add to cart
            const newProd: Product = {
                id: data.id,
                name: data.name,
                sku: data.sku,
                price: data.price,
                costPrice: data.cost,
                stock: data.stock,
                category: data.category || 'General',
                wholesalePrice: data.wholesalePrice ?? null,
                wholesaleMinQty: data.wholesaleMinQty ?? null,
                packUnit: data.packUnit ?? null,
                packSize: data.packSize ?? null,
                packPrice: data.packPrice ?? null,
                unit: data.unit ?? 'unidad',
                saleMode: data.saleMode ?? null,
                quantityStep: data.quantityStep ?? null,
            };

            setProducts(prev => [newProd, ...prev]);
            addToCart(newProd);
            playBeep();

            setShowQuickCreate(false);
            setShowQuickDetails(false);
            setQuickProduct({ name: '', sku: '', price: '', cost: '', stock: '1' });
        } catch (error: any) {
            alert(`Error: ${error.message}`);
        } finally {
            setQuickSaving(false);
        }
    };

    // ==========================================
    // EXCEL IMPORT
    // ==========================================
    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setImportProgress({ step: 'Leyendo archivo...', pct: 10 });
        setImportResult(null);

        const reader = new FileReader();
        reader.onload = async (evt) => {
            try {
                const XLSX = await import('xlsx');
                const data = evt.target?.result;
                const workbook = XLSX.read(data, { type: 'binary' });
                const sheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[sheetName];
                const jsonData = XLSX.utils.sheet_to_json(worksheet);

                setImportProgress({ step: `${jsonData.length} filas leídas`, pct: 30 });

                // Parser compartido (utils/importProducts.ts): sinónimos de
                // encabezados nicas, dinero con "C$"/comas, códigos en notación
                // científica y duplicados — mismo criterio que Inventario.
                const parsed = parseWorkbookRows(jsonData as Record<string, unknown>[]);
                const valid = parsed.rows.filter(r => r.valid).map(r => ({
                    sku: r.data.sku,
                    name: r.data.nombre,
                    price: r.data.precio,
                    cost: r.data.costo,
                    stock: r.data.stock,
                    minStock: r.data.minStock,
                    category: r.data.categoria,
                    unit: r.data.unidad,
                    excelRow: r.excelRow,
                }));
                const skipped = parsed.rows.length - valid.length;
                setImportData(valid);
                setImportProgress({
                    step: skipped > 0
                        ? `${valid.length} productos listos (${skipped} filas con problemas — usá el importador de Inventario para ver el detalle)`
                        : `${valid.length} productos válidos listos`,
                    pct: 50,
                });
            } catch (err: any) {
                setImportProgress({ step: `Error: ${err.message}`, pct: 0 });
            }
        };
        reader.readAsBinaryString(file);
    };

    const executeImport = async () => {
        if (importData.length === 0) return;

        // En lotes de 200 (R2.7): un solo POST reventaba contra el tope de 500
        // del server al final, con 0 productos cargados.
        setImportProgress({ step: 'Enviando al servidor...', pct: 60 });

        const result = await importInChunks(
            importData,
            async (chunk) => {
                const res = await fetch('/api/products/bulk', {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({ products: chunk })
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
                return data;
            },
            (done, total) => setImportProgress({
                step: `Importando… ${done} de ${total}`,
                pct: 60 + Math.round((done / Math.max(1, total)) * 40),
            }),
        );

        setImportProgress({ step: 'Completado', pct: 100 });
        setImportResult({ created: result.created, updated: result.updated, errors: result.serverErrors });

        // Refresh products list
        fetchProducts();
    };

    const closeImportModal = () => {
        setShowImportModal(false);
        setImportData([]);
        setImportProgress(null);
        setImportResult(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    // ==========================================
    // LEGACY ADD (now creates in DB too)
    // ==========================================
    const handleCreateProduct = async (e: React.FormEvent) => {
        e.preventDefault();
        const price = parseFloat(newProduct.price);
        if (isNaN(price)) return;

        try {
            const stock = validateNonNegativeQuantity(newProduct.stock, {
                saleMode: 'MEASURED',
                quantityStep: '0.0001',
            });
            const res = await fetch('/api/products', {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    name: newProduct.name,
                    sku: newProduct.sku || `SKU-${Date.now().toString(36).toUpperCase()}`,
                    price: price,
                    cost: parseFloat(newProduct.costPrice) || price * 0.7,
                    stock: stock.toString(),
                    minStock: 5,
                    category: newProduct.category,
                    unit: 'unidad',
                    saleMode: null,
                    quantityStep: null,
                })
            });

            const data = await res.json();
            if (!res.ok) throw new Error(data.error);

            const productToAdd: Product = {
                id: data.id,
                name: data.name,
                sku: data.sku,
                category: data.category || newProduct.category,
                price: data.price,
                costPrice: data.cost,
                stock: data.stock,
                wholesalePrice: data.wholesalePrice ?? null,
                wholesaleMinQty: data.wholesaleMinQty ?? null,
                packUnit: data.packUnit ?? null,
                packSize: data.packSize ?? null,
                packPrice: data.packPrice ?? null,
                unit: data.unit ?? 'unidad',
                saleMode: data.saleMode ?? null,
                quantityStep: data.quantityStep ?? null,
            };
            setProducts(prev => [productToAdd, ...prev]);
            setShowAddModal(false);
            setNewProduct({ name: '', sku: '', price: '', costPrice: '', stock: '', category: 'General' });
        } catch (error: any) {
            alert(`Error: ${error.message}`);
        }
    };

    // 💰 Totales 100% en Decimal.js (sin float). El descuento global es string
    // controlado; se clampa 0–100 y se parsea aquí. El IVA también en Decimal.
    const quotationLineCount = cart.filter(isQuotationCartLine).length;
    const hasQuotationLines = quotationLineCount > 0;
    const globalDiscountD = hasQuotationLines
        ? new Decimal(0)
        : Decimal.min(100, Decimal.max(0, toDecimal(globalDiscount)));
    const totalD = cart.reduce((acc, item) => {
        const lineDiscount = isQuotationCartLine(item)
            ? new Decimal(0)
            : toDecimal((item as CartLine).discount ?? 0);
        const factor = new Decimal(1).minus(lineDiscount.div(100));
        const quantity = isQuotationCartLine(item) && item.quantityExact
            ? toDecimal(item.quantityExact)
            : toDecimal(item.quantity);
        return acc.plus(toDecimal(item.price).mul(quantity).mul(factor));
    }, new Decimal(0));
    const discountedTotalD = totalD.mul(new Decimal(1).minus(globalDiscountD.div(100)));
    // IVA 15% Nicaragua — DESGLOSE, no recargo. El precio de mostrador ya
    // incluye el IVA (convención nica) y el backend registra exactamente
    // discountedTotal como Sale.total (executeSale ignora el total del
    // cliente; nicaTax trata Sale.total como IVA incluido). Antes se sumaba
    // 15% encima: el cliente pagaba C$115 y la BD guardaba C$100 → sobrante
    // fantasma en todos los arqueos y fiado registrado 15% por debajo.
    const grandTotalD = discountedTotalD;
    const taxD = grandTotalD.minus(grandTotalD.div('1.15')); // informativo (incluido)

    // Proyecciones numéricas (2 decimales) para UI y payload; la verdad es Decimal.
    const total = totalD.toDecimalPlaces(2).toNumber();
    const discountAmount = totalD.minus(grandTotalD).toDecimalPlaces(2).toNumber();
    const discountedTotal = discountedTotalD.toDecimalPlaces(2).toNumber();
    const tax = taxD.toDecimalPlaces(2).toNumber();
    const grandTotal = grandTotalD.toDecimalPlaces(2).toNumber();
    const globalDiscountNum = globalDiscountD.toNumber();
    // ¿El chip de denominación es el que está cargado? Se compara por VALOR con
    // Decimal, no por string: '500' y '500.00' son el mismo billete, y comparar
    // texto dejaría el chip apagado según cómo se haya escrito el monto.
    const chipActivo = (monto: Decimal): boolean =>
        cashReceived !== '' && toDecimal(cashReceived).equals(monto);

    // Teclado táctil del modal de efectivo, con la misma sanitización del input.
    const teclaEfectivo = (tecla: string) => {
        setCashReceived(previous => {
            if (tecla === 'LIMPIAR') return '';
            if (tecla === 'BORRAR') return previous.slice(0, -1);
            return sanitizeDecimalInput(previous + tecla);
        });
    };

    // El menú que rodea al POS necesita saber si hay una venta abierta para
    // avisar antes de navegar. Una venta COBRADA (completedSale) ya no cuenta:
    // el carrito sigue en pantalla hasta "Nueva venta", pero salir ahí no
    // interrumpe nada.
    const reportarVenta = useReportarVenta();
    useEffect(() => {
        reportarVenta({ hayVenta: cart.length > 0 && !completedSale, lineas: cart.length, total: grandTotal });
    }, [cart.length, completedSale, grandTotal, reportarVenta]);
    // Al desmontar, el menú no puede quedar creyendo que hay una venta abierta.
    useEffect(() => () => reportarVenta({ hayVenta: false, lineas: 0, total: 0 }), [reportarVenta]);

    // SMART CREDIT CHECK
    const isCreditBlocked = useMemo(() => {
        if (creditOverrideAuthorized) return false; // Owner override
        if (!selectedCustomer) return true; // Cannot use credit without customer
        if (selectedCustomer.isBlocked) return true;
        if (selectedCustomer.currentDebt + grandTotal > selectedCustomer.creditLimit) return true;
        return false;
    }, [selectedCustomer, grandTotal, creditOverrideAuthorized]);

    // CREDIT THERMOMETER DATA
    const creditInfo = useMemo(() => {
        if (!selectedCustomer) return null;
        const limit = selectedCustomer.creditLimit;
        const currentDebt = selectedCustomer.currentDebt;
        const debtPct = limit > 0 ? (currentDebt / limit) * 100 : 100;
        const projectedDebt = currentDebt + grandTotal;
        const projectedPct = limit > 0 ? (projectedDebt / limit) * 100 : 100;
        const color = debtPct >= 80 || selectedCustomer.isBlocked ? 'red' : debtPct >= 50 ? 'yellow' : 'green';
        const projectedColor = projectedPct >= 100 ? 'red' : projectedPct >= 80 ? 'yellow' : 'green';
        return { limit, currentDebt, debtPct, projectedDebt, projectedPct, color, projectedColor, available: Math.max(0, limit - currentDebt) };
    }, [selectedCustomer, grandTotal]);

    const handleCheckout = async (method: 'CASH' | 'CARD' | 'QR' | 'TRANSFER' | 'CREDIT') => {
        if (!currentShift) {
            trackEvent('pos_shift_required', { source: firstSaleMode ? 'first_sale' : 'pos', cart_items: cart.length });
            setShowMobileCart(false);
            setResumePaymentAfterShift(true);
            setShowPaymentOptions(false);
            setShowOpenShift(true);
            return;
        }
        // La caja está abierta pero a nombre de otro: cobrar acá dejaría el
        // faltante del arqueo a nombre de quien no estaba en el mostrador.
        // Se toma la caja primero (queda en AuditLog) y recién ahí se cobra.
        if (turnoAjeno) { await tomarTurno(); return; }
        if (cart.length === 0) return;
        if (hasQuotationLines && quotationLineCount !== cart.length) {
            setLastScanFeedback({ message: 'La cotización debe cobrarse sola; aparcá o quitá las otras líneas.', type: 'error' });
            playErrorBeep();
            setShowMobileCart(true);
            return;
        }
        const checkoutQuantityErrors: Record<string, string> = {};
        for (const item of cart) {
            try {
                validateQuantity(item.quantity, {
                    saleMode: effectiveSaleMode(item),
                    quantityStep: effectiveQuantityStep(item),
                });
            } catch (error) {
                checkoutQuantityErrors[lineKey(item)] = error instanceof Error ? error.message : 'La cantidad no es válida';
            }
        }
        if (Object.keys(checkoutQuantityErrors).length > 0) {
            setQuantityErrors(previous => ({ ...previous, ...checkoutQuantityErrors }));
        }
        if (Object.keys(quantityErrors).length > 0) {
            setLastScanFeedback({ message: 'Corregí las cantidades marcadas antes de cobrar', type: 'error' });
            playErrorBeep();
            setShowMobileCart(true);
            return;
        }
        if (Object.keys(checkoutQuantityErrors).length > 0) {
            setLastScanFeedback({ message: 'Corregí las cantidades marcadas antes de cobrar', type: 'error' });
            playErrorBeep();
            setShowMobileCart(true);
            return;
        }
        setShowMobileCart(false);
        setShowPaymentOptions(false);
        trackEvent('sale_checkout_started', { payment_method: method, cart_items: cart.length });

        // Front-end Block (skip if override authorized)
        if (method === 'CREDIT' && isCreditBlocked && !creditOverrideAuthorized) {
            setShowCreditPanel(true);
            return;
        }

        setProcessing(true);
        const measuredLines = cart.filter(item => item.saleMode === 'MEASURED' || Boolean(item.measurement)).length;
        // Una sola clave de idempotencia por intento de cobro: viaja también
        // en el POST online (el backend ya deduplica por offlineId), así que
        // si la respuesta se pierde en lie-fi y la venta se re-encola, el
        // sync posterior la marca 'skipped' en vez de duplicarla.
        const offlineId = generateOfflineId();
        const saleItems = cart.map(c => ({
            id: c.id,
            name: c.name,
            ...(isQuotationCartLine(c) ? { quotationItemId: c.quotationItemId } : {}),
            quantity: isQuotationCartLine(c) && c.quantityExact
                ? c.quantityExact
                : formatQuantityValue(c.quantity),
            price: c.price,
            costPrice: c.costPrice,
            discount: isQuotationCartLine(c) ? 0 : ((c as CartLine).discount || 0),
            presentation: c.presentation ?? {
                quantity: formatQuantityValue(c.quantity),
                unit: c.unit || 'unidad',
            },
            ...(c.measurement ? { measurement: c.measurement } : {}),
        }));

        // Encolar la venta en IndexedDB (camino offline Y rescate de fallos
        // de red del camino online — antes un "Failed to fetch" tiraba la
        // venta a un alert y se perdía con el cliente ya servido).
        const queueSaleOffline = async () => {
            const tenantRaw = localStorage.getItem('nortex_tenant_data');
            const tenantId = tenantRaw ? JSON.parse(tenantRaw).id : '';
            const userRaw = localStorage.getItem('nortex_user');
            const userId = userRaw ? JSON.parse(userRaw).id : '';

            await saveSaleOffline({
                offlineId,
                tenantId,
                userId,
                shiftId: currentShift?.id ?? null,
                employeeId: currentShift?.employeeId ?? currentShift?.employee?.id ?? null,
                customerName: selectedCustomer ? selectedCustomer.name : 'Cliente General',
                customerId: selectedCustomer?.id ?? null,
                paymentMethod: method,
                total: grandTotal,
                globalDiscount: globalDiscountNum,
                items: saleItems,
                createdAt: new Date().toISOString(),
            });
            setPendingOfflineCount(p => p + 1);

            // Sin red, el pulso avanza localmente; el próximo fetch online
            // vuelve a establecer la cifra autoritativa.
            setPulso(previous => previous && {
                ...previous,
                totalHoy: toDecimal(previous.totalHoy).plus(grandTotal).toFixed(2),
                ventasHoy: previous.ventasHoy + 1,
                rachaIncluyeHoy: true,
                racha: previous.rachaIncluyeHoy ? previous.racha : previous.racha + 1,
                esRecordHoy: previous.record !== null
                    && toDecimal(previous.totalHoy).plus(grandTotal).greaterThan(toDecimal(previous.record)),
            });

            setCompletedSale({
                items: [...cart],
                subtotal: total,
                discount: discountAmount,
                tax,
                grandTotal,
                paymentMethod: method,
                customerName: selectedCustomer ? selectedCustomer.name : 'Cliente General',
                customerPhone: selectedCustomer?.phone,
                saleId: offlineId,
                date: new Date().toLocaleDateString('es-NI', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
                // Foto del efectivo recibido: el estado se limpia en la línea
                // siguiente, así que el vuelto tiene que quedar en la venta.
                cashReceived: method === 'CASH' ? cashReceived : undefined,
                usdReceived: method === 'CASH' && payingInUSD ? usdAmount : undefined,
            });
            setCashReceived('');
            trackEvent('sale_completed', { payment_method: method, offline: true, cart_items: cart.length });
            if (measuredLines > 0) {
                trackEvent('measured_sale_completed', { offline: true, measured_lines: measuredLines });
            }
        };

        try {
            const token = localStorage.getItem('nortex_token');

            // ── OFFLINE PATH ──────────────────────────────────────────
            if (!navigator.onLine) {
                await queueSaleOffline();
                return;
            }

            // ── ONLINE PATH ───────────────────────────────────────────
            // Timeout de 8 s: en lie-fi (wifi "conectado" que no pasa datos)
            // el fetch no resuelve nunca y el cobro quedaba congelado para
            // siempre; al vencer, la venta cae a la cola offline.
            const res = await fetch('/api/sales', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                signal: AbortSignal.timeout(8000),
                body: JSON.stringify({
                    offlineId,
                    items: saleItems.map(({ name: _name, ...item }) => item),
                    paymentMethod: method,
                    customerName: selectedCustomer ? selectedCustomer.name : 'Cliente General',
                    customerId: selectedCustomer?.id,
                    total: grandTotal,
                    globalDiscount: globalDiscountNum,
                    employeeId: currentShift?.employeeId || currentShift?.employee?.id || null
                })
            });

            const data = await res.json();
            if (!res.ok) throw new Error(data.error);

            fetchProducts();
            fetchPulso();
            // Aviso global (retención R2): el checklist de primeros pasos se
            // refresca en vivo y celebra la primera venta sin esperar un remount.
            window.dispatchEvent(new CustomEvent('nortex:data-changed'));

            setCompletedSale({
                items: [...cart],
                subtotal: total,
                discount: discountAmount,
                tax,
                grandTotal,
                paymentMethod: method,
                customerName: selectedCustomer ? selectedCustomer.name : 'Cliente General',
                customerPhone: selectedCustomer?.phone,
                saleId: data.id,
                date: new Date().toLocaleDateString('es-NI', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
                invoiceNumber: data.invoiceNumber,
                invoiceSeries: data.invoiceSeries,
                cashReceived: method === 'CASH' ? cashReceived : undefined,
                usdReceived: method === 'CASH' && payingInUSD ? usdAmount : undefined,
            });
            setCashReceived('');
            trackEvent('sale_completed', { payment_method: method, offline: false, cart_items: cart.length });
            if (measuredLines > 0) {
                trackEvent('measured_sale_completed', { offline: false, measured_lines: measuredLines });
            }

            // NX-03: la píldora de efectivo del header y el desplegable de
            // movimientos se quedaban en C$0.00 / "Sin movimientos" después de
            // cobrar. La venta en efectivo SÍ mueve la gaveta, así que se
            // refrescan ambos apenas el backend confirma.
            if (currentShift) { fetchCashBalance(); fetchCashMovements(); }

        } catch (error: any) {
            // Fallo de RED (timeout, servidor caído, DNS): la venta NO se
            // pierde — va a la cola offline y el sync la reintenta con la
            // misma clave de idempotencia. Un rechazo de NEGOCIO (stock
            // insuficiente, caja cerrada) sí se muestra: reintentarlo a
            // ciegas duplicaría el problema, no lo resolvería.
            const isNetworkFailure =
                error?.name === 'TimeoutError' ||
                error?.name === 'AbortError' ||
                error instanceof TypeError; // fetch: "Failed to fetch"
            if (isNetworkFailure) {
                try {
                    await queueSaleOffline();
                    return;
                } catch { /* IndexedDB también falló: cae al alert */ }
            }
            trackEvent('sale_failed', { payment_method: method, reason: error?.message || 'unknown' });
            alert(error.message);
        } finally {
            setProcessing(false);
        }
    };

    // ── Vuelto de la venta recién cobrada ───────────────────────────────────
    // Se deriva de la FOTO guardada en la venta (`completedSale.cashReceived`),
    // no del estado del modal: ese se limpia al cerrar el cobro y por eso la
    // pantalla de éxito nunca mostraba el vuelto. Todo en Decimal.
    const efectivoRecibidoDeLaVenta = useMemo(() => {
        if (!completedSale || completedSale.paymentMethod !== 'CASH') return null;
        if (!completedSale.cashReceived) return null;
        const recibido = toDecimal(completedSale.cashReceived);
        return recibido.greaterThan(0) ? recibido : null;
    }, [completedSale]);

    const vueltoDeLaVenta = useMemo(() => {
        if (!completedSale || !efectivoRecibidoDeLaVenta) return null;
        const vuelto = efectivoRecibidoDeLaVenta.minus(toDecimal(completedSale.grandTotal));
        // Pago justo (o insuficiente, p. ej. abono en efectivo): no hay vuelto
        // que mostrar y NO se inventa uno negativo.
        if (vuelto.lessThanOrEqualTo(0)) return null;
        const recibidoUsdD = completedSale.usdReceived ? toDecimal(completedSale.usdReceived) : null;
        const tasa = toDecimal(exchangeRate);
        const recibidoUsd = recibidoUsdD && recibidoUsdD.greaterThan(0) ? recibidoUsdD : null;
        return {
            recibido: efectivoRecibidoDeLaVenta,
            vuelto,
            recibidoUsd,
            // El vuelto se entrega en córdobas; el equivalente en dólares es
            // referencia para quien pagó en USD.
            vueltoUsd: recibidoUsd && tasa.greaterThan(0) ? vuelto.div(tasa) : null,
        };
    }, [completedSale, efectivoRecibidoDeLaVenta, exchangeRate]);

    // POST-SALE ACTIONS
    const getTenantPrintDetails = () => {
        try {
            const td = localStorage.getItem('nortex_tenant_data');
            if (td) {
                const tenant = JSON.parse(td);
                const taxId = String(tenant.taxId || '').trim();
                return {
                    tenantName: tenant.businessName || tenant.name || 'Nortex',
                    // El registro crea TAX-<uuid> (antes TAX-<timestamp>) como marcador interno;
                    // jamás debe salir impreso como si fuera un RUC fiscal.
                    ruc: taxId && !isPlaceholderTaxId(taxId) ? taxId : undefined,
                    address: tenant.address || undefined,
                    phone: tenant.phone || undefined,
                    dgiAuthCode: tenant.dgiAuthCode || undefined,
                };
            }
        } catch { }
        return { tenantName: 'Nortex' };
    };

    const buildInvoiceData = useCallback((): InvoiceData | null => {
        if (!completedSale) return null;
        const tenant = getTenantPrintDetails();
        return {
            ...tenant,
            customerName: completedSale.customerName,
            customerPhone: completedSale.customerPhone,
            items: completedSale.items.map(i => ({
                name: i.name,
                quantity: i.quantity,
                price: i.price,
                lineTotal: i.price * i.quantity,
                unit: i.unit,
                saleMode: effectiveSaleMode(i),
                presentation: i.presentation,
            })),
            subtotal: completedSale.subtotal,
            discount: completedSale.discount,
            tax: completedSale.tax,
            grandTotal: completedSale.grandTotal,
            paymentMethod: completedSale.paymentMethod,
            date: completedSale.date,
            saleId: completedSale.saleId,
            invoiceNumber: completedSale.invoiceNumber,
            invoiceSeries: completedSale.invoiceSeries,
            cashReceived: vueltoDeLaVenta ? Number(vueltoDeLaVenta.recibido.toFixed(2)) : undefined,
            change: vueltoDeLaVenta ? Number(vueltoDeLaVenta.vuelto.toFixed(2)) : undefined,
            user: currentShift?.employee
                ? `${currentShift.employee.firstName} ${currentShift.employee.lastName}`
                : 'Cajero',
        };
    }, [completedSale, currentShift?.employee, vueltoDeLaVenta]);

    const handleWhatsApp = () => {
        const inv = buildInvoiceData();
        if (!inv) return;
        sendToWhatsApp(inv, completedSale?.customerPhone);
    };

    const handlePrintTicket = () => {
        const inv = buildInvoiceData();
        if (!inv) return;
        // El ticket oculto ya está montado en el DOM; imprimir desde la misma
        // pestaña evita que el WebView/PWA bloquee el popup del ticket 80 mm.
        if (!printTicket(inv)) {
            alert('No se pudo abrir la impresión. Cerrá y volvé a abrir Nortex, luego intentá de nuevo.');
        }
    };

    const handleDirectThermalPrint = async () => {
        const inv = buildInvoiceData();
        if (!inv) return;
        const success = await thermalPrinter.printReceipt(inv);
        if (!success) {
            alert('La tiquetera no respondió. Usá “Ticket 80 mm” para imprimir desde el navegador.');
        }
    };

    const handlePrintA4 = () => {
        const inv = buildInvoiceData();
        if (!inv) return;
        printA4(inv);
    };

    const handleNewSale = () => {
        if (firstSaleMode) navigate('/app/pos', { replace: true });
        setCompletedSale(null);
        setCashReceived('');
        setCart([]);
        setSelectedCustomer(null);
        setCustomerSearch('');
        setGlobalDiscount('');
        setCreditOverrideAuthorized(false);
        setCreditOverridePin('');
        setShowCreditPanel(false);
        setShowPaymentOptions(false);
        setShowCustomerPicker(false);
        setShowSaleDetails(false);
        setShowMobileCart(false);
        setPayingInUSD(false);
        setUsdAmount('');
    };

    const postSalePrintOptions = buildPostSalePrintOptions(thermalConnected);
    const tenantPrintDetails = getTenantPrintDetails();

    // ── Aviso de existencias del carrito (utils/stockAlert.ts) ──────────────
    // La existencia se toma del catálogo VIVO (`products`), no de la foto que
    // quedó en la línea: un carrito aparcado media hora arrastra un stock que
    // ya no es cierto. Si el producto no está en el catálogo cargado, se cae a
    // la foto de la línea; si tampoco hay, el módulo lo marca DESCONOCIDO y no
    // se avisa nada (jamás un aviso inventado).
    const stockPorProducto = useMemo(() => {
        const m = new Map<string, number>();
        for (const p of products) m.set(p.id, p.stock);
        return m;
    }, [products]);

    const resumenStock = useMemo(() => {
        // Las etiquetas crean líneas independientes. Para existencias se suman
        // por producto: dos paquetes de 0.75 kg consumen 1.50 kg aunque tengan
        // clientEventId distintos.
        const aggregated = new Map<string, { id: string; name: string; quantity: Decimal; stock: number; unit?: string | null }>();
        for (const item of cart) {
            const current = aggregated.get(item.id);
            if (current) {
                current.quantity = current.quantity.plus(item.quantity);
            } else {
                aggregated.set(item.id, {
                    id: item.id,
                    name: item.name,
                    quantity: new Decimal(item.quantity),
                    stock: stockPorProducto.get(item.id) ?? item.stock,
                    unit: item.unit,
                });
            }
        }
        return evaluarCarrito([...aggregated.values()].map(item => ({
            ...item,
            quantity: item.quantity.toNumber(),
        })));
    }, [cart, stockPorProducto]);

    const avisoPorLinea = useMemo(() => {
        const m = new Map<string, AvisoStock>();
        for (const a of resumenStock.avisos) m.set(a.id, a);
        return m;
    }, [resumenStock]);

    const lineasPorProducto = useMemo(() => {
        const counts = new Map<string, number>();
        for (const item of cart) counts.set(item.id, (counts.get(item.id) ?? 0) + 1);
        return counts;
    }, [cart]);

    const resumenStockTexto = textoResumen(resumenStock, permiteStockNegativo);

    // ── P0-2 · La grilla deja de ser un catálogo ──────────────────────────
    // Medido en producción con 1,003 productos: 6,502 nodos DOM y 1,009 botones,
    // con un long task de 105 ms al limpiar el filtro — que pasa DESPUÉS DE CADA
    // VENTA, porque al cerrar la venta se limpia la búsqueda. Un cajero no
    // navega mil tarjetas: escanea o escribe. Así que se pinta un resultado de
    // búsqueda acotado, y el recorte SIEMPRE se declara (ver utils/posSearch.ts).
    const TOPE_SIN_BUSQUEDA = 24;
    const TOPE_BUSCANDO = 60;

    // El índice se arma UNA vez por catálogo. Antes se re-armaba el string
    // `name + sku + category` de cada producto en CADA tecla.
    const indiceProductos = useMemo(() => indexarProductos(products), [products]);

    // `useDeferredValue` (React 19) en lugar de un debounce: la grilla puede ir
    // un frame atrás sin bloquear el tipeo. NO toca el camino del escáner —
    // tanto el listener global como el Enter de la barra resuelven contra
    // `products` y `searchTerm` en directo, así que SKU + Enter sigue siendo
    // instantáneo. Esa es la ruta que más se usa y no se toca.
    const terminoDiferido = useDeferredValue(searchTerm);

    const resultadoBusqueda = useMemo(() => {
        const t = terminoDiferido.trim();
        return buscarProductos(indiceProductos, t, t === '' ? TOPE_SIN_BUSQUEDA : TOPE_BUSCANDO);
    }, [indiceProductos, terminoDiferido]);

    const filteredProducts = resultadoBusqueda.visibles;

    // Estable, para que `React.memo` de la tarjeta sirva de algo. Mismo criterio
    // que el escáner: si el negocio permite vender sin existencia la tarjeta
    // agrega igual, pero suena distinto — el oído del cajero es parte del aviso.
    const agregarDesdeGrilla = useCallback((product: Product) => {
        addToCart(product);
        if (product.stock <= 0) playErrorBeep(); else playBeep();
    }, [addToCart]);

    const filteredCustomers = customerList.filter(c => c.name.toLowerCase().includes(customerSearch.toLowerCase()));

    // Handle search input Enter to add exact SKU match to cart
    const handleSearchKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && searchTerm.trim()) {
            e.preventDefault();
            void handleBarcodeScan(searchTerm.trim());
            setSearchTerm('');
        }
    };

    const resetReturnFlow = () => {
        returnRequestRef.current = null;
        // El panel de anulación se limpia acá, con todo lo demás: si quedara
        // armado, el cajero podría reabrir el modal, buscar OTRA factura y
        // encontrarse el botón de anular listo con el motivo de la anterior.
        limpiarAnulacion();
        setShowReturnModal(false);
        setReturnSaleData(null);
        setReturnItems([]);
        setReturnSaleSearch('');
        setReturnReason('');
        setReturnRefundMethod('');
        setReturnErrors({});
        setReturnGeneralError('');
    };

    const normalizeReturnSale = (raw: any): ReturnSaleData => {
        if (!raw || typeof raw.id !== 'string' || !Array.isArray(raw.items)) {
            throw new Error('La venta no devolvió líneas válidas');
        }
        const items = raw.items.map((item: any): ReturnSaleLine => {
            const saleItemId = String(item.saleItemId ?? item.id ?? '').trim();
            if (!saleItemId) throw new Error('Una línea vendida no tiene identidad para devolverla con seguridad');
            const saleModeAtSale = item.saleModeAtSale === 'COUNTED' ? 'COUNTED' : 'MEASURED';
            const unitAtSale = String(item.unitAtSale || 'unidad');
            return {
                saleItemId,
                productId: String(item.productId ?? ''),
                productNameAtSale: String(item.productNameAtSale || item.name || item.productId || 'Producto'),
                unitAtSale,
                saleModeAtSale,
                presentationAtSale: item.presentationAtSale === 'PACK' ? 'PACK' : 'BASE',
                presentationQuantityAtSale: String(item.presentationQuantityAtSale ?? item.quantity ?? '0'),
                quantity: String(item.quantity ?? '0'),
                returnedQuantity: String(item.returnedQuantity ?? '0'),
                returnableQuantity: String(item.returnableQuantity ?? item.quantity ?? '0'),
                quantityStep: String(item.quantityStep ?? (saleModeAtSale === 'COUNTED' ? '1' : '0.0001')),
                priceAtSale: String(item.priceAtSale ?? '0'),
                refundUnitPrice: String(item.refundUnitPrice ?? item.priceAtSale ?? '0'),
                measurement: item.measurement ?? null,
            };
        });
        const supportedRefundMethods = new Set<ReturnRefundMethod>(['CASH', 'CARD', 'QR', 'TRANSFER']);
        const allowedRefundMethods = Array.isArray(raw.allowedRefundMethods)
            ? raw.allowedRefundMethods.filter((method: unknown): method is ReturnRefundMethod => (
                typeof method === 'string' && supportedRefundMethods.has(method as ReturnRefundMethod)
            ))
            : [];
        return {
            id: raw.id,
            total: raw.total,
            paymentMethod: String(raw.paymentMethod ?? ''),
            balance: String(raw.balance ?? '0'),
            allowedRefundMethods,
            items,
            // `?? null` y no `String(...)`: si la factura está vigente el campo
            // viene null/undefined, y convertirlo a texto daría "null", que es
            // truthy — la pantalla diría que TODA factura está anulada.
            cancelledAt: raw.cancelledAt ?? null,
        };
    };

    const searchReturnSale = async () => {
        if (!returnSaleSearch.trim() || returnSearching) return;
        setReturnSearching(true);
        setReturnGeneralError('');
        setReturnErrors({});
        // Se busca OTRA factura: el panel de anulación vuelve a cero. Si no, el
        // motivo escrito para la factura anterior quedaría apuntando a esta.
        limpiarAnulacion();
        try {
            const token = localStorage.getItem('nortex_token');
            const response = await fetch(`/api/sales/search?q=${encodeURIComponent(returnSaleSearch.trim())}`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            const body = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(body.error || 'No pudimos buscar la venta');
            const sale = normalizeReturnSale(body);
            setReturnSaleData(sale);
            setReturnItems(sale.items.map((item) => ({ ...item, quantityDraft: '0' })));
            setReturnRefundMethod(sale.allowedRefundMethods.length === 1 ? sale.allowedRefundMethods[0] : '');
        } catch (error) {
            setReturnSaleData(null);
            setReturnItems([]);
            setReturnRefundMethod('');
            setReturnGeneralError(error instanceof Error ? error.message : 'No pudimos buscar la venta');
        } finally {
            setReturnSearching(false);
        }
    };

    const validateReturnDraft = (item: ReturnItemSelection): { quantity: Decimal | null; error: string | null } => {
        let parsed: Decimal;
        try {
            parsed = new Decimal(item.quantityDraft.trim() || '0');
        } catch {
            return { quantity: null, error: 'Ingresá una cantidad decimal válida' };
        }
        if (!parsed.isFinite() || parsed.isNegative()) return { quantity: null, error: 'La cantidad no puede ser negativa' };
        if (parsed.isZero()) return { quantity: parsed, error: null };
        try {
            const validated = validateQuantity(parsed.toString(), {
                saleMode: item.saleModeAtSale,
                quantityStep: item.quantityStep,
            });
            const maximum = new Decimal(item.returnableQuantity);
            if (validated.greaterThan(maximum)) {
                return { quantity: null, error: `Máximo disponible: ${formatQuantityValue(maximum)} ${item.unitAtSale}` };
            }
            return { quantity: validated, error: null };
        } catch (error) {
            return { quantity: null, error: error instanceof Error ? error.message : 'Cantidad inválida' };
        }
    };

    const setReturnQuantity = (saleItemId: string, raw: string) => {
        const quantityDraft = sanitizeDecimalInput(raw);
        setReturnItems(previous => previous.map(item => item.saleItemId === saleItemId ? { ...item, quantityDraft } : item));
        setReturnGeneralError('');
        setReturnErrors(previous => {
            if (!previous[saleItemId]) return previous;
            const next = { ...previous };
            delete next[saleItemId];
            return next;
        });
    };

    const stepReturnQuantity = (item: ReturnItemSelection, direction: -1 | 1) => {
        const current = (() => {
            try { return new Decimal(item.quantityDraft || 0); }
            catch { return new Decimal(0); }
        })();
        const step = new Decimal(item.quantityStep);
        const maximum = new Decimal(item.returnableQuantity);
        const next = Decimal.max(0, Decimal.min(maximum, current.plus(step.mul(direction))));
        setReturnQuantity(item.saleItemId, formatQuantityValue(next));
    };

    const returnEstimate = returnItems.reduce((total, item) => {
        const validation = validateReturnDraft(item);
        return validation.quantity?.greaterThan(0)
            ? total.plus(validation.quantity.mul(item.refundUnitPrice))
            : total;
    }, new Decimal(0)).toDecimalPlaces(2);
    const returnCreditReduction = returnSaleData?.paymentMethod === 'CREDIT'
        ? Decimal.min(returnEstimate, Decimal.max(toDecimal(returnSaleData.balance), 0)).toDecimalPlaces(2)
        : new Decimal(0);
    const returnSettledRefund = returnEstimate.minus(returnCreditReduction).toDecimalPlaces(2);
    const returnRequiresRefundMethod = returnSaleData?.paymentMethod === 'CREDIT'
        && returnSettledRefund.greaterThan(0);

    const submitReturn = async () => {
        if (!returnSaleData || returnProcessing) return;
        const errors: Record<string, string> = {};
        const selected: Array<{ saleItemId: string; quantity: string }> = [];
        for (const item of returnItems) {
            const validation = validateReturnDraft(item);
            if (validation.error) errors[item.saleItemId] = validation.error;
            else if (validation.quantity?.greaterThan(0)) {
                selected.push({ saleItemId: item.saleItemId, quantity: validation.quantity.toString() });
            }
        }
        if (selected.length === 0) setReturnGeneralError('Seleccioná al menos una cantidad para devolver');
        else if (returnReason.trim().length < 3) setReturnGeneralError('Escribí un motivo de al menos 3 caracteres');
        else if (returnRequiresRefundMethod && !returnRefundMethod) setReturnGeneralError('Elegí cómo reembolsar el importe ya cobrado');
        else setReturnGeneralError('');
        setReturnErrors(errors);
        if (
            Object.keys(errors).length > 0
            || selected.length === 0
            || returnReason.trim().length < 3
            || (returnRequiresRefundMethod && !returnRefundMethod)
        ) return;

        setReturnProcessing(true);
        try {
            const token = localStorage.getItem('nortex_token');
            const materialPayload = {
                saleId: returnSaleData.id,
                items: [...selected].sort((left, right) => left.saleItemId.localeCompare(right.saleItemId)),
                reason: returnReason.trim(),
                ...(returnRequiresRefundMethod ? { refundMethod: returnRefundMethod } : {}),
            };
            const signature = JSON.stringify(materialPayload);
            if (!returnRequestRef.current || returnRequestRef.current.signature !== signature) {
                returnRequestRef.current = { signature, clientEventId: generateOfflineId() };
            }
            const response = await fetch('/api/returns', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({
                    ...materialPayload,
                    clientEventId: returnRequestRef.current.clientEventId,
                }),
            });
            const body = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(body.error || 'No pudimos procesar la devolución');
            alert(`Devolución procesada por ${formatMoney(Number(body.total ?? returnEstimate.toString()))}. Stock restaurado.`);
            resetReturnFlow();
            await fetchProducts();
        } catch (error) {
            setReturnGeneralError(error instanceof Error ? error.message : 'No pudimos procesar la devolución');
        } finally {
            setReturnProcessing(false);
        }
    };

    if (shiftLoading) return <div className="h-full flex items-center justify-center text-slate-500 gap-2"><Loader2 className="animate-spin" /> Cargando Sistema...</div>;

    return (
        <div className="flex h-full bg-surface-950 relative">

            {manualMeasuredProduct && (
                <div className="fixed inset-0 z-modal bg-black/70 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="manual-measure-title">
                    <form onSubmit={confirmManualMeasured} className="w-full max-w-sm rounded-card border border-white/[0.08] bg-surface-900 p-5 shadow-premium text-slate-100">
                        <div className="flex items-start justify-between gap-3">
                            <div>
                                <h2 id="manual-measure-title" className="font-bold text-lg">Cantidad de {manualMeasuredProduct.name}</h2>
                                <p className="mt-1 text-sm text-slate-400">
                                    Unidad base: {manualMeasuredProduct.unit || 'unidad'} · paso {formatQuantityValue(effectiveQuantityStep(manualMeasuredProduct))}
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => { setManualMeasuredProduct(null); setManualQuantityError(''); }}
                                className="w-11 h-11 rounded-control flex items-center justify-center text-slate-400 hover:bg-white/[0.06] hover:text-white"
                                aria-label="Cancelar captura de cantidad"
                            >
                                <X size={20} />
                            </button>
                        </div>
                        <label htmlFor="manual-measured-quantity" className="block mt-5 text-sm font-semibold">Peso o cantidad</label>
                        <div className="mt-2 flex items-center gap-2">
                            <input
                                id="manual-measured-quantity"
                                autoFocus
                                type="text"
                                inputMode="decimal"
                                value={manualQuantityDraft}
                                onChange={event => {
                                    setManualQuantityDraft(sanitizeDecimalInput(event.target.value));
                                    setManualQuantityError('');
                                }}
                                aria-invalid={Boolean(manualQuantityError)}
                                aria-describedby={manualQuantityError ? 'manual-measured-error' : undefined}
                                className="h-12 min-w-0 flex-1 rounded-control border border-white/[0.1] bg-surface-950 px-3 text-xl font-mono tabular-nums outline-none focus:border-brand"
                                placeholder={formatQuantityValue(effectiveQuantityStep(manualMeasuredProduct))}
                            />
                            <span className="font-semibold text-slate-300">{manualMeasuredProduct.unit || 'unidad'}</span>
                        </div>
                        {manualQuantityError && <p id="manual-measured-error" role="alert" className="mt-2 text-sm text-danger">{manualQuantityError}</p>}
                        <button type="submit" className="mt-5 h-12 w-full rounded-control bg-brand text-brand-on font-bold hover:bg-brand-hover">
                            Agregar al ticket
                        </button>
                        <p className="mt-2 text-center text-xs text-slate-500">Presioná Enter para confirmar.</p>
                    </form>
                </div>
            )}

            {pendingDuplicateScaleLabel && (
                <div className="fixed inset-0 z-modal bg-black/70 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="duplicate-label-title">
                    <div className="w-full max-w-sm rounded-card border border-amber-500/25 bg-surface-900 p-5 shadow-premium text-slate-100">
                        <AlertTriangle className="text-amber-400" size={26} />
                        <h2 id="duplicate-label-title" className="mt-3 text-lg font-bold">¿Es otro paquete igual?</h2>
                        <p className="mt-2 text-sm text-slate-300">
                            Esta misma etiqueta se leyó hace pocos segundos. Confirmá solo si tenés un segundo paquete físico con el mismo peso.
                        </p>
                        <div className="mt-5 grid grid-cols-2 gap-2">
                            <button
                                type="button"
                                onClick={() => setPendingDuplicateScaleLabel(null)}
                                className="h-11 rounded-control border border-white/[0.1] font-semibold text-slate-200 hover:bg-white/[0.06]"
                            >
                                No, cancelar
                            </button>
                            <button
                                type="button"
                                autoFocus
                                onClick={confirmDuplicateScaleLabel}
                                className="h-11 rounded-control bg-brand text-brand-on font-bold hover:bg-brand-hover"
                            >
                                Sí, agregar otro
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {pendingScaleLabelOverride && (
                <div className="fixed inset-0 z-modal bg-black/70 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="scale-override-title">
                    <div className="w-full max-w-sm rounded-card border border-red-500/25 bg-surface-900 p-5 shadow-premium text-slate-100">
                        <ShieldAlert className="text-red-400" size={26} />
                        <h2 id="scale-override-title" className="mt-3 text-lg font-bold">Confirmar total impreso</h2>
                        <p className="mt-2 text-sm text-slate-300">
                            Esta etiqueta fue emitida con política excepcional. Nortex cobrará el total impreso y dejará la aprobación auditada a tu usuario.
                        </p>
                        <div className="mt-4 rounded-xl border border-white/[0.08] bg-surface-950/70 p-3 text-sm">
                            <div className="flex items-center justify-between gap-3">
                                <span className="text-slate-400">Producto</span>
                                <span className="text-right font-semibold text-slate-100">{pendingScaleLabelOverride.preview.product.name}</span>
                            </div>
                            <div className="mt-2 flex items-center justify-between gap-3">
                                <span className="text-slate-400">Cantidad</span>
                                <span className="font-mono text-slate-100">{formatQuantity(pendingScaleLabelOverride.preview.baseQuantity, pendingScaleLabelOverride.preview.product.unit)}</span>
                            </div>
                            <div className="mt-2 flex items-center justify-between gap-3">
                                <span className="text-slate-400">Total etiqueta</span>
                                <span className="font-mono text-red-200">{formatMoney(pendingScaleLabelOverride.preview.encodedPrice ?? '0')}</span>
                            </div>
                        </div>
                        <div className="mt-5 grid grid-cols-2 gap-2">
                            <button
                                type="button"
                                onClick={() => setPendingScaleLabelOverride(null)}
                                className="h-11 rounded-control border border-white/[0.1] font-semibold text-slate-200 hover:bg-white/[0.06]"
                            >
                                Cancelar
                            </button>
                            <button
                                type="button"
                                autoFocus
                                onClick={confirmScaleLabelOverride}
                                className="h-11 rounded-control bg-red-600 text-white font-bold hover:bg-red-500"
                            >
                                Aceptar y auditar
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* HEADER BAR */}
            <div className="absolute top-0 right-0 left-0 h-14 bg-surface-900 border-b border-white/[0.06] px-6 flex justify-between items-center gap-4 z-10 text-slate-100">
                <div className="font-bold text-slate-100 flex items-center gap-2 shrink-0">
                    {firstSaleMode ? 'Tu primera venta' : 'Vender'}
                    {currentShift && (
                        <span className="text-xs bg-green-500/15 text-green-400 px-2 py-0.5 rounded-full border border-green-500/20 flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
                            {guidedSimpleMode ? 'Caja abierta' : currentShift.employee
                                ? `${currentShift.employee.firstName} ${currentShift.employee.lastName}`
                                : 'CAJA ABIERTA'}
                        </span>
                    )}
                </div>

                <div className="flex items-center gap-2 min-w-0 md:justify-end whitespace-nowrap pl-4 overflow-x-auto">
                    {/* Estado de conexión: informativo, no es una acción. Ámbar = requiere atención. */}
                    {!isOnline && (
                        <div className="flex items-center gap-1.5 text-xs font-semibold px-2.5 h-8 rounded-control bg-warning-soft text-amber-400 border border-amber-500/20">
                            <WifiOff size={14} />
                            <span className="hidden lg:inline">Sin internet</span>
                            {pendingOfflineCount > 0 && (
                                <span className="bg-surface-900 text-amber-400 text-[10px] font-black w-4 h-4 rounded-full flex items-center justify-center">{pendingOfflineCount}</span>
                            )}
                        </div>
                    )}
                    {isOnline && pendingOfflineCount > 0 && (
                        <button
                            onClick={syncOfflineSales}
                            disabled={syncingOffline}
                            className="flex items-center gap-1.5 text-xs font-semibold px-2.5 h-8 rounded-control bg-brand-soft text-brand border border-brand/20 hover:bg-brand/15 transition-colors disabled:opacity-60"
                            title="Sincronizar ventas offline"
                        >
                            <RefreshCw size={14} className={syncingOffline ? 'animate-spin' : ''} />
                            <span className="hidden lg:inline">{syncingOffline ? 'Sincronizando...' : `Sync (${pendingOfflineCount})`}</span>
                        </button>
                    )}
                    {reconciliationOfflineCount > 0 && (
                        <button
                            type="button"
                            onClick={() => alert(
                                `${reconciliationOfflineCount} venta${reconciliationOfflineCount === 1 ? '' : 's'} permanece${reconciliationOfflineCount === 1 ? '' : 'n'} protegida${reconciliationOfflineCount === 1 ? '' : 's'} en este dispositivo. Un administrador debe conciliarla manualmente con soporte; Nortex no reinterpretará la etiqueta ni borrará la evidencia automáticamente.`,
                            )}
                            className="flex items-center gap-1.5 text-xs font-semibold px-2.5 h-8 rounded-control bg-red-500/10 text-red-300 border border-red-500/20 hover:bg-red-500/15"
                            title="Ventas offline que requieren conciliación"
                        >
                            <AlertTriangle size={14} />
                            <span className="hidden lg:inline">Revisión ({reconciliationOfflineCount})</span>
                        </button>
                    )}

                    {pulso && pulso.ventasHoy > 0 && (
                        <div
                            className="flex items-center gap-2 text-xs px-3 h-8 rounded-control bg-emerald-500/10 text-emerald-300 border border-emerald-500/20"
                            title={pulso.metaDiaria ? `Vendido hoy · Meta del día: ${formatMoney(pulso.metaDiaria)}` : 'Vendido hoy'}
                        >
                            {pulso.racha >= 2 && (
                                <span className="font-black text-[11px]" title={`${pulso.racha} días seguidos vendiendo`}>🔥{pulso.racha}</span>
                            )}
                            <span className="font-bold nx-num">{formatMoney(pulso.totalHoy)}</span>
                            {pulso.metaDiaria && (
                                <span className="hidden md:block w-12 h-1.5 rounded-full bg-white/10 overflow-hidden">
                                    <span
                                        className="block h-full bg-emerald-400"
                                        style={{ width: `${Math.min(100, toDecimal(pulso.totalHoy).div(toDecimal(pulso.metaDiaria)).mul(100).toNumber())}%` }}
                                    />
                                </span>
                            )}
                        </div>
                    )}

                    {/* Saldo en caja: dato, en neutro. Abre el detalle de movimientos. */}
                    {currentShift && !guidedSimpleMode && cashBalance !== null && (
                        <button
                            onClick={() => setShowMovementsList(!showMovementsList)}
                            className="flex items-center gap-1.5 text-xs px-3 h-8 rounded-control bg-white/[0.04] text-slate-200 border border-white/[0.06] hover:bg-white/[0.06] transition-colors"
                            title="Efectivo en caja"
                        >
                            <Wallet size={14} />
                            <span className="font-bold nx-num">{formatMoney(cashBalance)}</span>
                        </button>
                    )}

                    {/* Carritos aparcados: badge de estado, solo si hay alguno esperando. */}
                    {heldCarts.length > 0 && (
                        <button
                            onClick={() => showHeldCarts ? setShowHeldCarts(false) : openHeldCarts()}
                            aria-label={`${heldCarts.length} ${heldCarts.length === 1 ? 'venta aparcada' : 'ventas aparcadas'}`}
                            aria-expanded={showHeldCarts}
                            className={`relative flex items-center gap-1.5 text-xs font-semibold px-2.5 h-8 rounded-control border transition-colors ${
                                guidedSimpleMode
                                    ? 'bg-sky-500/10 text-sky-300 border-sky-500/20 hover:bg-sky-500/15'
                                    : 'bg-white/[0.04] text-slate-200 border-white/[0.06] hover:bg-white/[0.06]'
                            }`}
                            title="Ventas aparcadas listas para retomar"
                        >
                            <ParkingCircle size={14} />
                            <span className="text-[10px] font-black">{heldCarts.length}</span>
                            <span className="hidden lg:inline">{guidedSimpleMode ? 'Aparcadas' : 'Aparcados'}</span>
                        </button>
                    )}

                    {/* ── MENÚ ÚNICO DE ACCIONES DE CAJA ──────────────────────────
                        Antes: 8 botones sólidos (verde/ámbar/cian/naranja/índigo…)
                        peleando por atención con el cobro. Ahora: un solo botón
                        neutro que despliega lo operativo. El color vuelve a
                        significar algo porque casi no se usa. */}
                    {currentShift && !firstSaleMode && (
                        <div className="relative">
                            <button
                                ref={botonAccionesCaja}
                                onClick={() => setShowCashActions(v => !v)}
                                aria-haspopup="menu"
                                aria-expanded={showCashActions}
                                className="flex items-center gap-1.5 text-xs font-semibold px-3 h-8 rounded-control bg-white/[0.04] text-slate-200 border border-white/[0.06] hover:bg-white/[0.06] transition-colors"
                                title="Acciones de caja"
                            >
                                {guidedSimpleMode ? <MoreHorizontal size={15} /> : <SlidersHorizontal size={14} />}
                                <span className="hidden sm:inline">{guidedSimpleMode ? 'Más' : 'Acciones de caja'}</span>
                                <ChevronDown size={14} className={`transition-transform ${showCashActions ? 'rotate-180' : ''}`} />
                            </button>

                            {showCashActions && posicionMenuCaja && (
                                <>
                                    {/* Capa de cierre: click afuera cierra el menú. Por debajo
                                        del menú pero por encima del contenido. */}
                                    <div className="fixed inset-0 z-sticky" onClick={() => setShowCashActions(false)} />
                                    <div
                                        role="menu"
                                        aria-label="Acciones de caja"
                                        style={{ top: posicionMenuCaja.top, right: posicionMenuCaja.right }}
                                        // `fixed` y no `absolute`: el contenedor del header tiene
                                        // overflow y recortaba el menú entero (ver el comentario
                                        // largo junto a `medirMenuCaja`). El alto máximo es para
                                        // que en un teléfono acostado el menú no se salga por
                                        // abajo sin poder alcanzarse.
                                        className="fixed w-64 max-h-[calc(100vh-5rem)] overflow-y-auto bg-surface-800 border border-white/[0.08] rounded-card shadow-premium z-checkout animate-fade-in-up"
                                    >
                                        <button
                                            onClick={() => { setShowCashModal('IN'); setCashCategory(''); setShowCashActions(false); }}
                                            className="w-full flex items-center gap-3 px-4 h-touch text-sm text-slate-200 hover:bg-white/[0.05] transition-colors text-left"
                                        >
                                            <ArrowDownCircle size={16} className="text-brand shrink-0" />
                                            <span>Entrada de efectivo</span>
                                            <span className="ml-auto text-[10px] text-slate-500 font-mono">F8</span>
                                        </button>
                                        <button
                                            onClick={() => { setShowCashModal('OUT'); setCashCategory(''); setShowCashActions(false); }}
                                            className="w-full flex items-center gap-3 px-4 h-touch text-sm text-slate-200 hover:bg-white/[0.05] transition-colors text-left"
                                        >
                                            <ArrowUpCircle size={16} className="text-slate-400 shrink-0" />
                                            <span>Salida de efectivo</span>
                                            <span className="ml-auto text-[10px] text-slate-500 font-mono">F7</span>
                                        </button>
                                        <button
                                            onClick={() => { setShowAgentModal(true); fetchAgentAgreements(); setShowCashActions(false); }}
                                            className="w-full flex items-center gap-3 px-4 h-touch text-sm text-slate-200 hover:bg-white/[0.05] transition-colors text-left"
                                        >
                                            <Landmark size={16} className="text-slate-400 shrink-0" />
                                            <span>Agente bancario</span>
                                        </button>
                                        {guidedSimpleMode && cart.length > 0 && (
                                            <button
                                                onClick={() => { handleHoldCart(); setShowCashActions(false); }}
                                                className="w-full flex items-center gap-3 px-4 h-touch text-sm text-slate-200 hover:bg-white/[0.05] transition-colors text-left"
                                            >
                                                <ParkingCircle size={16} className="text-sky-300 shrink-0" />
                                                <span>Aparcar venta</span>
                                                <span className="ml-auto text-[10px] text-slate-500 font-mono">F4</span>
                                            </button>
                                        )}
                                        {!guidedSimpleMode && (
                                            <button
                                                onClick={() => { setShowReturnModal(true); setShowCashActions(false); }}
                                                className="w-full flex items-center gap-3 px-4 h-touch text-sm text-slate-200 hover:bg-white/[0.05] transition-colors text-left"
                                            >
                                                <RefreshCw size={16} className="text-slate-400 shrink-0" />
                                                <span>Devolución de producto</span>
                                            </button>
                                        )}
                                        <button
                                            onClick={() => { openHeldCarts(); setShowCashActions(false); }}
                                            className="w-full flex items-center gap-3 px-4 h-touch text-sm text-slate-200 hover:bg-white/[0.05] transition-colors text-left"
                                        >
                                            <ParkingCircle size={16} className="text-slate-400 shrink-0" />
                                            <span>Ventas aparcadas</span>
                                            <span className="ml-auto text-[10px] text-slate-500 font-mono">
                                                {heldCarts.length > 0 ? heldCarts.length : 'F4'}
                                            </span>
                                        </button>

                                        {!guidedSimpleMode && (
                                            <div className="border-t border-white/[0.06]">
                                                <button
                                                    onClick={() => setScannerActive(!scannerActive)}
                                                    className="w-full flex items-center gap-3 px-4 h-touch text-sm text-slate-300 hover:bg-white/[0.05] transition-colors text-left"
                                                >
                                                    <ScanBarcode size={16} className="text-slate-400 shrink-0" />
                                                    <span>Escáner</span>
                                                    <span className={`ml-auto text-[11px] font-semibold ${scannerActive ? 'text-brand' : 'text-slate-500'}`}>
                                                        {scannerActive ? 'Activo' : 'Apagado'}
                                                    </span>
                                                </button>
                                                <button
                                                    onClick={async () => {
                                                        if (!thermalConnected) {
                                                            const success = await thermalPrinter.connect();
                                                            setThermalConnected(success);
                                                        }
                                                        setShowCashActions(false);
                                                    }}
                                                    className="w-full flex items-center gap-3 px-4 h-touch text-sm text-slate-300 hover:bg-white/[0.05] transition-colors text-left"
                                                >
                                                    <Printer size={16} className="text-slate-400 shrink-0" />
                                                    {/* Antes se cortaba como "ar Tiquetera": el texto largo
                                                        vivía en una fila horizontal con overflow oculto. */}
                                                    <span className="truncate">Tiquetera</span>
                                                    <span className={`ml-auto text-[11px] font-semibold shrink-0 ${thermalConnected ? 'text-brand' : 'text-slate-500'}`}>
                                                        {thermalConnected ? 'Lista' : 'Vincular'}
                                                    </span>
                                                </button>
                                            </div>
                                        )}
                                        {guidedSimpleMode && (
                                            <div className="border-t border-white/[0.06]">
                                                <button
                                                    onClick={() => {
                                                        setShowCashActions(false);
                                                        if (cart.length > 0) setBloqueoCierre(true);
                                                        else setShowCloseShift(true);
                                                    }}
                                                    className="w-full flex items-center gap-3 px-4 h-touch text-sm text-danger hover:bg-danger-soft transition-colors text-left"
                                                >
                                                    <Lock size={16} className="shrink-0" />
                                                    <span>Cerrar caja</span>
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                </>
                            )}
                        </div>
                    )}

                    {/* Cerrar caja: lo único irreversible del header → único uso del rojo. */}
                    {currentShift && !guidedSimpleMode ? (
                        <button onClick={() => { if (cart.length > 0) { setBloqueoCierre(true); return; } setShowCloseShift(true); }} className="text-xs font-semibold text-danger hover:bg-danger-soft px-3 h-8 rounded-control transition-colors flex items-center gap-1.5">
                            <Lock size={14} /> Cerrar caja
                        </button>
                    ) : !currentShift ? (
                        // Vuelta a la apertura: como el modal ahora se puede cerrar
                        // ("solo quiero mirar"), este indicador tiene que ser la
                        // puerta de regreso, no un cartel muerto.
                        <button
                            onClick={() => { setErrorApertura({}); setShowOpenShift(true); }}
                            className="flex items-center gap-1.5 text-xs font-semibold px-3 h-8 rounded-control bg-white/[0.04] text-slate-300 border border-white/[0.07] hover:bg-white/[0.07] transition-colors"
                            title="Abrir la caja para poder cobrar"
                        >
                            <Lock size={14} /> Caja cerrada
                        </button>
                    ) : null}
                </div>
            </div>

            {/* SCANNER FEEDBACK TOAST */}
            {lastScanFeedback && (
                <div className={`absolute top-16 left-1/2 -translate-x-1/2 z-50 px-6 py-3 rounded-xl shadow-2xl font-bold text-sm animate-in fade-in slide-in-from-top duration-200 flex items-center gap-2 ${lastScanFeedback.type === 'success'
                    ? 'bg-emerald-500 text-white'
                    : 'bg-red-500 text-white'
                    }`}>
                    <ScanBarcode size={18} />
                    {lastScanFeedback.message}
                </div>
            )}
            {/* --- CASH MOVEMENT MODAL --- */}
            {showCashModal && (
                <div className="absolute inset-0 z-50 bg-slate-900/80 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="bg-surface-900 rounded-xl shadow-2xl w-full max-w-md p-6 animate-in zoom-in duration-200">
                        <div className="flex items-center justify-between mb-5">
                            <div className="flex items-center gap-3">
                                <div className={`w-10 h-10 rounded-full flex items-center justify-center ${showCashModal === 'IN' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-amber-500/15 text-amber-400'}`}>
                                    {showCashModal === 'IN' ? <ArrowDownCircle size={24} /> : <ArrowUpCircle size={24} />}
                                </div>
                                <div>
                                    <h2 className="text-lg font-bold text-slate-100">
                                        {showCashModal === 'IN' ? 'Entrada de Efectivo' : 'Salida de Efectivo'}
                                    </h2>
                                    {showCashModal === 'OUT' && cashBalance !== null && (
                                        <p className="text-xs text-slate-500">Disponible: <span className="font-bold text-slate-200">{formatMoney(cashBalance)}</span></p>
                                    )}
                                </div>
                            </div>
                            <button onClick={() => setShowCashModal(null)} className="text-slate-400 hover:text-slate-300 p-1">
                                <X size={20} />
                            </button>
                        </div>

                        <form onSubmit={handleCashMovement} noValidate className="space-y-4">
                            {/* Category - Quick Select Buttons */}
                            <div>
                                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 block">Categoría</label>
                                <div className="grid grid-cols-2 gap-2">
                                    {(showCashModal === 'IN' ? inCategories : outCategories).map(cat => (
                                        <button
                                            key={cat.value}
                                            type="button"
                                            onClick={() => setCashCategory(cat.value)}
                                            className={`text-left text-sm px-3 py-2.5 rounded-lg border-2 transition-all ${cashCategory === cat.value
                                                ? showCashModal === 'IN'
                                                    ? 'border-emerald-500 bg-emerald-500/10 text-emerald-400 font-bold'
                                                    : 'border-amber-500 bg-amber-500/10 text-amber-400 font-bold'
                                                : 'border-white/[0.06] text-slate-300 hover:border-white/10'
                                                }`}
                                        >
                                            {cat.label}
                                        </button>
                                    ))}
                                </div>
                                {errorMovimiento.categoria && <p className="text-xs text-danger mt-2">{errorMovimiento.categoria}</p>}
                            </div>

                            {/* Amount */}
                            <div>
                                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1 block">Monto (C$)</label>
                                <input
                                    type="text"
                                    inputMode="decimal"
                                    value={cashAmount}
                                    onChange={e => { setCashAmount(sanitizeDecimalInput(e.target.value)); setErrorMovimiento(prev => ({ ...prev, monto: undefined })); }}
                                    placeholder="0.00"
                                    aria-label="Monto del movimiento en córdobas"
                                    className="w-full text-2xl font-bold text-center border-2 border-white/10 rounded-xl p-4 focus:border-nortex-500 outline-none text-slate-100 bg-surface-800/40 font-mono tabular-nums"
                                    autoFocus
                                />
                                {errorMovimiento.monto && <p className="text-xs text-danger mt-2">{errorMovimiento.monto}</p>}
                            </div>

                            {/* Description */}
                            <div>
                                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1 block">Descripción</label>
                                <input
                                    type="text"
                                    value={cashDescription}
                                    onChange={e => { setCashDescription(e.target.value); setErrorMovimiento(prev => ({ ...prev, descripcion: undefined })); }}
                                    placeholder={showCashModal === 'OUT' ? 'Ej: Compra de hielo para el local' : 'Ej: Cambio de billete de C$500'}
                                    aria-label="Descripción del movimiento"
                                    maxLength={300}
                                    className="w-full border-2 border-white/[0.06] rounded-lg px-4 py-3 text-sm focus:border-nortex-500 outline-none text-slate-200"
                                />
                                {errorMovimiento.descripcion && <p className="text-xs text-danger mt-2">{errorMovimiento.descripcion}</p>}
                            </div>

                            {errorMovimiento.general && (
                                <p className="text-xs text-danger bg-danger-soft border border-danger/20 rounded-control px-3 py-2">{errorMovimiento.general}</p>
                            )}

                            <button
                                type="submit"
                                // Habilitado siempre: si falta algo, el submit muestra
                                // el error en español debajo del campo. Un botón muerto
                                // no explica qué falta.
                                disabled={cashMovementLoading}
                                className={`w-full py-3.5 rounded-xl font-bold text-white transition-all flex items-center justify-center gap-2 ${showCashModal === 'IN'
                                    ? 'bg-emerald-500 hover:bg-emerald-600 disabled:bg-emerald-300'
                                    : 'bg-amber-500 hover:bg-amber-600 disabled:bg-amber-300'
                                    }`}
                            >
                                {cashMovementLoading ? (
                                    <><Loader2 className="animate-spin" size={18} /> Registrando...</>
                                ) : (
                                    <>{showCashModal === 'IN' ? <ArrowDownCircle size={18} /> : <ArrowUpCircle size={18} />} Registrar {showCashModal === 'IN' ? 'Entrada' : 'Salida'}</>
                                )}
                            </button>
                        </form>
                    </div>
                </div>
            )}

            {/* --- 🏦 AGENTE BANCARIO MODAL --- */}
            {showAgentModal && (
                <div className="absolute inset-0 z-50 bg-slate-900/80 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="bg-surface-900 rounded-xl shadow-2xl w-full max-w-md p-6 animate-in zoom-in duration-200 max-h-[90vh] overflow-y-auto">
                        <div className="flex items-center justify-between mb-5">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-full flex items-center justify-center bg-sky-500/15 text-sky-400">
                                    <Landmark size={24} />
                                </div>
                                <div>
                                    <h2 className="text-lg font-bold text-slate-100">Agente Bancario</h2>
                                    <p className="text-xs text-slate-500">La transacción se hace en el equipo del banco; acá queda registrada para cuadrar tu caja.</p>
                                </div>
                            </div>
                            <button onClick={() => setShowAgentModal(false)} className="text-slate-400 hover:text-slate-300 p-1">
                                <X size={20} />
                            </button>
                        </div>

                        {agentAgreements.length === 0 ? (
                            <div className="space-y-3">
                                <p className="text-sm text-slate-300">Todavía no tenés convenios registrados. Agregá el primero (ej: <span className="font-bold">Agente Banpro</span>, <span className="font-bold">Rapibac</span>, <span className="font-bold">Puntoxpress</span>).</p>
                                <input
                                    type="text"
                                    value={newAgreementName}
                                    onChange={e => setNewAgreementName(e.target.value)}
                                    placeholder="Nombre del convenio (ej: Agente Banpro)"
                                    className="w-full border-2 border-white/[0.06] rounded-lg px-4 py-3 text-sm focus:border-sky-500 outline-none text-slate-200"
                                />
                                <select
                                    value={newAgreementKind}
                                    onChange={e => setNewAgreementKind(e.target.value)}
                                    className="w-full border-2 border-white/[0.06] rounded-lg px-4 py-3 text-sm focus:border-sky-500 outline-none text-slate-200 bg-surface-900"
                                >
                                    <option value="BANCO">Banco (Banpro, BAC, Lafise...)</option>
                                    <option value="RED_RECAUDADORA">Red de pagos (Puntoxpress, Punto Fácil)</option>
                                    <option value="REMESERA">Remesera (AirPak/Western Union...)</option>
                                </select>
                                <button
                                    onClick={handleCreateAgreement}
                                    disabled={agentLoading || !newAgreementName.trim()}
                                    className="w-full py-3 rounded-xl font-bold text-white bg-sky-600 hover:bg-sky-700 disabled:bg-sky-300 transition-all"
                                >
                                    {agentLoading ? 'Creando...' : 'Crear convenio'}
                                </button>
                                <p className="text-[11px] text-slate-400">Solo el dueño o un admin puede crear convenios.</p>
                            </div>
                        ) : (
                            <form onSubmit={handleAgentTx} className="space-y-4">
                                {/* Convenio */}
                                <div>
                                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1 block">Convenio</label>
                                    <select
                                        value={agentData.agreementId}
                                        onChange={e => updateAgentData({ agreementId: e.target.value })}
                                        className="w-full border-2 border-white/[0.06] rounded-lg px-4 py-3 text-sm focus:border-sky-500 outline-none text-slate-200 bg-surface-900"
                                        required
                                        {...validacionEs('Elegí el convenio del banco.')}
                                    >
                                        <option value="">— Elegí el convenio —</option>
                                        {agentAgreements.map(a => (
                                            <option key={a.id} value={a.id}>{a.name}</option>
                                        ))}
                                    </select>
                                </div>

                                {/* Operación */}
                                <div>
                                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 block">Operación</label>
                                    <div className="grid grid-cols-2 gap-2">
                                        {agentOps.map(op => (
                                            <button
                                                key={op.value}
                                                type="button"
                                                onClick={() => updateAgentData({ operation: op.value })}
                                                className={`text-left text-sm px-3 py-2.5 rounded-lg border-2 transition-all ${agentData.operation === op.value
                                                    ? op.dir === 'IN'
                                                        ? 'border-emerald-500 bg-emerald-500/10 text-emerald-400 font-bold'
                                                        : 'border-amber-500 bg-amber-500/10 text-amber-400 font-bold'
                                                    : 'border-white/[0.06] text-slate-300 hover:border-white/10'
                                                    }`}
                                            >
                                                {op.label}
                                                <span className={`block text-[10px] font-normal ${op.dir === 'IN' ? 'text-emerald-400' : 'text-amber-400'}`}>
                                                    {op.dir === 'IN' ? 'entra efectivo' : 'sale efectivo'}
                                                </span>
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {/* Moneda (Fase D: gaveta multi-moneda) */}
                                <div>
                                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 block">Moneda</label>
                                    <div className="grid grid-cols-2 gap-2">
                                        <button
                                            type="button"
                                            onClick={() => updateAgentData({ currency: 'NIO' })}
                                            className={`text-sm px-3 py-2 rounded-lg border-2 font-bold transition-all ${agentData.currency === 'NIO' ? 'border-sky-500 bg-sky-500/10 text-sky-400' : 'border-white/[0.06] text-slate-300 hover:border-white/10'}`}
                                        >
                                            C$ Córdobas
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => updateAgentData({ currency: 'USD' })}
                                            className={`text-sm px-3 py-2 rounded-lg border-2 font-bold transition-all ${agentData.currency === 'USD' ? 'border-emerald-500 bg-emerald-500/10 text-emerald-400' : 'border-white/[0.06] text-slate-300 hover:border-white/10'}`}
                                        >
                                            US$ Dólares
                                        </button>
                                    </div>
                                </div>

                                {/* Monto */}
                                <div>
                                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1 block">Monto ({agentData.currency === 'USD' ? 'US$' : 'C$'})</label>
                                    <input
                                        type="text"
                                        inputMode="decimal"
                                        value={agentData.amount}
                                        onChange={e => updateAgentData({ amount: sanitizeDecimalInput(e.target.value) })}
                                        placeholder="0.00"
                                        aria-label="Monto de la operación"
                                        className="w-full text-2xl font-bold text-center border-2 border-white/10 rounded-xl p-4 focus:border-sky-500 outline-none text-slate-100 bg-surface-800/40 font-mono tabular-nums"
                                        required
                                        {...validacionEs('Ingresá el monto de la operación.')}
                                    />
                                    {agentOps.find(o => o.value === agentData.operation)?.dir === 'OUT' && cashBalance !== null && agentData.currency === 'NIO' && (
                                        <p className="text-xs text-slate-500 mt-1">Efectivo disponible en gaveta: <span className="font-bold text-slate-200">{formatMoney(cashBalance)}</span></p>
                                    )}
                                </div>

                                {/* Tipo de cambio (solo USD) */}
                                {agentData.currency === 'USD' && (
                                    <div>
                                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1 block">Tipo de cambio (C$ por US$)</label>
                                        <input
                                            type="text"
                                            inputMode="decimal"
                                            value={agentData.exchangeRate}
                                            onChange={e => updateAgentData({ exchangeRate: sanitizeDecimalInput(e.target.value) })}
                                            placeholder="36.62"
                                            aria-label="Tipo de cambio, córdobas por dólar"
                                            className="w-full border-2 border-white/[0.06] rounded-lg px-4 py-3 text-sm focus:border-emerald-500 outline-none text-slate-200 font-mono"
                                            required
                                            {...validacionEs('Ingresá el tipo de cambio del día.')}
                                        />
                                        {parseFloat(agentData.amount) > 0 && parseFloat(agentData.exchangeRate) > 0 && (
                                            <p className="text-xs text-slate-500 mt-1">Equivale a <span className="font-bold text-slate-200">{formatMoney((parseFloat(agentData.amount) * parseFloat(agentData.exchangeRate)))}</span> — así se asienta en tu contabilidad.</p>
                                        )}
                                    </div>
                                )}

                                {/* Comisión + Referencia */}
                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1 block">Comisión (C$)</label>
                                        <input
                                            type="text"
                                            inputMode="decimal"
                                            value={agentData.commission}
                                            onChange={e => setAgentData(prev => ({ ...prev, commission: sanitizeDecimalInput(e.target.value) }))}
                                            placeholder="0.00"
                                            className="w-full border-2 border-white/[0.06] rounded-lg px-3 py-3 text-sm focus:border-sky-500 outline-none text-slate-200 font-mono"
                                        />
                                        <p className="text-[10px] text-slate-400 mt-0.5">Lo que te paga el banco (no es efectivo de hoy).</p>
                                    </div>
                                    <div>
                                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1 block">Ref. del voucher</label>
                                        <input
                                            type="text"
                                            value={agentData.externalRef}
                                            onChange={e => setAgentData(prev => ({ ...prev, externalRef: e.target.value }))}
                                            placeholder="Folio del equipo del banco"
                                            className="w-full border-2 border-white/[0.06] rounded-lg px-3 py-3 text-sm focus:border-sky-500 outline-none text-slate-200"
                                        />
                                    </div>
                                </div>

                                <button
                                    type="submit"
                                    disabled={agentLoading || !agentData.agreementId || !agentData.amount}
                                    className="w-full py-3.5 rounded-xl font-bold text-white bg-sky-600 hover:bg-sky-700 disabled:bg-sky-300 transition-all flex items-center justify-center gap-2"
                                >
                                    {agentLoading ? (
                                        <><Loader2 className="animate-spin" size={18} /> Registrando...</>
                                    ) : (
                                        <><Landmark size={18} /> Registrar operación</>
                                    )}
                                </button>
                            </form>
                        )}
                    </div>
                </div>
            )}

            {/* --- MOVEMENTS LIST DROPDOWN --- */}
            {showMovementsList && currentShift && (
                <div className="absolute top-14 right-4 z-40 w-80 bg-surface-900 rounded-xl shadow-2xl border border-white/[0.06] max-h-80 overflow-y-auto animate-in slide-in-from-top duration-200">
                    <div className="p-3 border-b border-white/[0.04] flex justify-between items-center sticky top-0 bg-surface-900">
                        <h3 className="text-sm font-bold text-slate-200">Movimientos del Turno</h3>
                        <button onClick={() => setShowMovementsList(false)} className="text-slate-400 hover:text-slate-300"><X size={16} /></button>
                    </div>
                    {movimientosVisibles.length === 0 ? (
                        <p className="text-sm text-slate-400 text-center py-6">Sin movimientos todavía</p>
                    ) : (
                        <div className="divide-y divide-white/[0.04]">
                            {movimientosVisibles.map(m => (
                                <div key={m.clave} className="px-3 py-2.5 flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs ${m.esEntrada ? 'bg-emerald-500/15 text-emerald-400' : 'bg-amber-500/15 text-amber-400'}`}>
                                            {m.esEntrada ? '↓' : '↑'}
                                        </div>
                                        <div>
                                            <p className="text-xs font-medium text-slate-200 truncate max-w-[160px]">{m.descripcion}</p>
                                            {m.hora && <p className="text-[10px] text-slate-400">{m.hora}</p>}
                                        </div>
                                    </div>
                                    <span className={`text-sm font-bold font-mono tabular-nums ${m.esEntrada ? 'text-emerald-400' : 'text-amber-400'}`}>
                                        {formatMoney(m.esEntrada ? m.monto : m.monto.negated(), 'NIO', { signed: true })}
                                    </span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {parkingNotice && (
                <div
                    role="status"
                    aria-live="polite"
                    className={`fixed left-3 right-3 sm:left-1/2 sm:right-auto sm:-translate-x-1/2 ${showMobileCart ? 'top-20 bottom-auto' : 'bottom-20'} sm:top-auto sm:bottom-4 z-toast sm:min-w-[360px] max-w-md px-3 py-3 rounded-card border shadow-premium flex items-center gap-3 ${
                        parkingNotice.tone === 'warning'
                            ? 'bg-surface-800 border-amber-500/30 text-amber-300'
                            : 'bg-surface-800 border-white/[0.10] text-slate-100'
                    }`}
                >
                    <div className={`w-8 h-8 rounded-pill flex items-center justify-center shrink-0 ${parkingNotice.tone === 'warning' ? 'bg-warning-soft' : 'bg-brand-soft text-brand'}`}>
                        {parkingNotice.tone === 'warning' ? <AlertTriangle size={16} /> : <Check size={16} />}
                    </div>
                    <span className="text-sm font-semibold flex-1 min-w-0">{parkingNotice.message}</span>
                    {parkingNotice.heldId && (
                        <button
                            type="button"
                            onClick={() => handleRestoreCart(parkingNotice.heldId as string)}
                            className="h-9 px-3 rounded-control text-sm font-bold text-brand hover:bg-brand-soft transition-colors shrink-0"
                        >
                            Recuperar
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={() => setParkingNotice(null)}
                        aria-label="Cerrar aviso"
                        className="w-9 h-9 rounded-control text-slate-400 hover:text-slate-100 hover:bg-white/[0.06] flex items-center justify-center shrink-0"
                    >
                        <X size={16} />
                    </button>
                </div>
            )}

            {/* --- 🅿️ VENTAS APARCADAS --- */}
            {showHeldCarts && (
                <div
                    className="fixed inset-0 z-modal bg-black/65 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
                    onClick={() => { setShowHeldCarts(false); setHeldCartToDiscard(null); }}
                >
                    <section
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="held-carts-title"
                        className="w-full sm:max-w-md max-h-[calc(100dvh-3rem)] sm:max-h-[min(680px,calc(100dvh-2rem))] bg-surface-900 rounded-t-card sm:rounded-card shadow-premium border border-white/[0.08] overflow-hidden flex flex-col animate-in slide-in-from-bottom sm:fade-in duration-200"
                        onClick={e => e.stopPropagation()}
                    >
                    <div className="px-5 py-4 border-b border-white/[0.06] flex justify-between items-start gap-3 bg-surface-900">
                        <div className="min-w-0">
                            <h2 id="held-carts-title" className="text-base font-bold text-slate-100 flex items-center gap-2">
                                <ParkingCircle size={18} className="text-sky-300" /> Ventas aparcadas
                                <span className="text-xs text-slate-400 font-semibold">{heldCarts.length}/5</span>
                            </h2>
                            <p className="text-xs text-slate-400 mt-1">Retomá una venta exactamente donde la dejaste.</p>
                        </div>
                        <IconButton
                            icon={<X size={17} />}
                            label="Cerrar ventas aparcadas"
                            onClick={() => { setShowHeldCarts(false); setHeldCartToDiscard(null); }}
                        />
                    </div>
                    {heldCarts.length === 0 ? (
                        <div className="p-10 text-center">
                            <div className="w-12 h-12 rounded-pill bg-sky-500/10 text-sky-300 mx-auto mb-3 flex items-center justify-center">
                                <ParkingCircle size={23} />
                            </div>
                            <p className="text-sm font-semibold text-slate-200">No hay ventas esperando</p>
                            <p className="text-xs text-slate-400 mt-1.5 max-w-[260px] mx-auto">Aparcá una venta para atender a otra persona sin perder el carrito.</p>
                        </div>
                    ) : (
                        <div className="divide-y divide-white/[0.06] overflow-y-auto custom-scrollbar">
                            {heldCarts.map(held => {
                                const heldSubtotal = held.items.reduce((sum, item) => {
                                    const descuentoLinea = toDecimal((item as CartLine).discount ?? 0);
                                    return sum.plus(toDecimal(item.price).mul(item.quantity).mul(new Decimal(1).minus(descuentoLinea.div(100))));
                                }, new Decimal(0));
                                const descuentoGlobal = Decimal.min(100, Decimal.max(0, toDecimal(held.globalDiscount ?? '')));
                                const heldTotal = heldSubtotal.mul(new Decimal(1).minus(descuentoGlobal.div(100)));
                                const minutesAgo = Math.round((Date.now() - new Date(held.heldAt).getTime()) / 60000);
                                return (
                                    <div key={held.id} className="p-4 hover:bg-surface-800/30 transition-colors">
                                        <div className="flex items-start justify-between gap-3">
                                            <div className="flex-1 min-w-0">
                                                <p className="text-sm font-bold text-slate-100 truncate">{held.label}</p>
                                                <p className="text-xs text-slate-400 mt-0.5">
                                                    {held.items.length} {held.items.length === 1 ? 'producto' : 'productos'} · <span className="nx-num text-slate-200 font-semibold">{formatMoney(heldTotal)}</span> · {minutesAgo < 1 ? 'Recién' : `Hace ${minutesAgo} min`}
                                                </p>
                                            </div>
                                            <div className="flex items-center gap-1 shrink-0">
                                                <button
                                                    onClick={() => handleRestoreCart(held.id)}
                                                    className="h-touch px-3 text-sm font-bold bg-brand text-brand-on rounded-control hover:bg-brand-hover transition-colors flex items-center gap-2"
                                                >
                                                    <RotateCcw size={15} /> Continuar
                                                </button>
                                                <button
                                                    onClick={() => setHeldCartToDiscard(heldCartToDiscard === held.id ? null : held.id)}
                                                    aria-label={`Descartar ${held.label}`}
                                                    aria-expanded={heldCartToDiscard === held.id}
                                                    className="w-touch h-touch flex items-center justify-center text-slate-400 hover:text-danger hover:bg-danger-soft rounded-control transition-colors"
                                                >
                                                    <Trash2 size={17} />
                                                </button>
                                            </div>
                                        </div>
                                        {/* Mini preview of items */}
                                        <div className="flex flex-wrap gap-1 mt-2.5">
                                            {held.items.slice(0, 3).map((item, i) => (
                                                <span key={i} className="text-[11px] bg-white/[0.04] text-slate-300 px-2 py-1 rounded-control">
                                                    {item.quantity}x {item.name.length > 15 ? item.name.slice(0, 15) + '…' : item.name}
                                                </span>
                                            ))}
                                            {held.items.length > 3 && (
                                                <span className="text-[11px] text-slate-400 px-1 py-1">+{held.items.length - 3} más</span>
                                            )}
                                        </div>
                                        {heldCartToDiscard === held.id && (
                                            <div role="alert" className="mt-3 p-3 rounded-control bg-danger-soft border border-danger/20 flex flex-col sm:flex-row sm:items-center gap-2">
                                                <p className="text-xs text-slate-200 flex-1">Esta venta se eliminará del dispositivo.</p>
                                                <div className="flex gap-2">
                                                    <button onClick={() => setHeldCartToDiscard(null)} className="h-9 px-3 rounded-control text-xs font-semibold text-slate-200 hover:bg-white/[0.06]">Cancelar</button>
                                                    <button onClick={() => handleRemoveHeldCart(held.id)} className="h-9 px-3 rounded-control bg-danger text-white text-xs font-bold hover:opacity-90">Descartar</button>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                    {heldCarts.length > 0 && cart.length > 0 && (
                        <div className="px-4 py-3 border-t border-white/[0.06] bg-surface-800/40">
                            <p className="text-xs text-slate-400 text-center">Al continuar, la venta actual quedará aparcada automáticamente.</p>
                        </div>
                    )}
                    </section>
                </div>
            )}

            {/* --- OPEN SHIFT MODAL --- */}
            {showOpenShift && (
                <div className="fixed inset-0 z-modal bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => { setShowOpenShift(false); setResumePaymentAfterShift(false); }}>
                    <div role="dialog" aria-modal="true" aria-labelledby="open-shift-title" className="bg-surface-900 border border-white/[0.08] rounded-card shadow-premium w-full max-w-sm overflow-hidden" onClick={e => e.stopPropagation()}>
                        <div className="px-5 pt-5 pb-4 flex items-start gap-3 border-b border-white/[0.06]">
                            <div className="w-10 h-10 rounded-pill bg-brand-soft text-brand flex items-center justify-center shrink-0">
                                <Lock size={19} />
                            </div>
                            <div className="min-w-0 flex-1">
                                <h2 id="open-shift-title" className="text-lg font-bold text-slate-100">Abrí caja para continuar</h2>
                                <p className="text-sm text-slate-400 mt-1">
                                    {resumePaymentAfterShift ? `Tu venta de ${formatMoney(grandTotal)} ya está lista.` : 'Esto mantiene el efectivo del día ordenado.'}
                                </p>
                            </div>
                            <IconButton
                                icon={<X size={16} />}
                                label="Cerrar"
                                onClick={() => { setShowOpenShift(false); setResumePaymentAfterShift(false); }}
                            />
                        </div>

                        <form onSubmit={handleOpenShift} noValidate className="p-5 space-y-4">
                            {/* El PIN solo aparece si el negocio lo exige (varios
                                cajeros sobre una misma cuenta). Apagado —el
                                default—, el servidor resuelve al cajero desde el
                                JWT y esta pantalla queda en un número y un botón.

                                Acá vivía además un cartel "Tu PIN inicial ya está
                                listo", que se cayó con el PIN precargado: la
                                pantalla imprimía y rellenaba el 1234 sembrado. Un
                                secreto que la propia pantalla revela no es un
                                control de acceso. */}
                            {exigePin && (
                            <div>
                                <label className="block text-xs font-semibold text-slate-400 mb-1.5">PIN de caja</label>
                                <input
                                    type="password"
                                    inputMode="numeric"
                                    maxLength={4}
                                    autoFocus
                                    aria-label="PIN de caja"
                                    className="w-full h-touch px-4 tracking-[0.45em] text-center text-xl font-bold border border-white/10 rounded-control focus:border-brand focus:ring-2 focus:ring-brand/30 outline-none text-slate-100 bg-surface-800/40"
                                    value={employeePin}
                                    onFocus={e => e.currentTarget.select()}
                                    onChange={e => {
                                        setEmployeePin(e.target.value.replace(/\D/g, '').slice(0, 4));
                                        setErrorApertura(prev => ({ ...prev, pin: undefined }));
                                    }}
                                />
                                {errorApertura.pin && <p className="text-xs text-danger mt-1.5">{errorApertura.pin}</p>}
                            </div>
                            )}

                            <div>
                                <label className="block text-xs font-semibold text-slate-400 mb-1.5">Efectivo con el que empezás</label>
                                <div className="relative">
                                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-bold">C$</span>
                                    <input
                                        type="text"
                                        inputMode="decimal"
                                        aria-label="Fondo inicial en efectivo"
                                        className="w-full h-touch pl-10 pr-4 text-lg font-bold border border-white/10 rounded-control focus:border-brand focus:ring-2 focus:ring-brand/30 outline-none text-slate-100 bg-surface-800/40 tabular-nums"
                                        // Sin PIN este es el primer (y único)
                                        // campo: el foco tiene que caer acá.
                                        autoFocus={!exigePin}
                                        onFocus={e => e.currentTarget.select()}
                                        value={initialCash}
                                        onChange={e => { setInitialCash(sanitizeDecimalInput(e.target.value)); setErrorApertura(prev => ({ ...prev, fondo: undefined })); }}
                                    />
                                </div>
                                {errorApertura.fondo
                                    ? <p className="text-xs text-danger mt-1.5">{errorApertura.fondo}</p>
                                    : <p className="text-xs text-slate-500 mt-1.5">Si todavía no tenés cambio, dejalo en 0.</p>}
                            </div>

                            {errorApertura.general && (
                                <p className="text-xs text-danger bg-danger-soft border border-danger/20 rounded-control px-3 py-2">{errorApertura.general}</p>
                            )}

                            <button type="submit" disabled={shiftLoading || (exigePin && employeePin.length !== 4)} className="w-full h-pay rounded-control bg-brand text-brand-on font-bold hover:bg-brand-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2">
                                {shiftLoading && <Loader2 size={18} className="animate-spin" />}
                                {shiftLoading ? 'Abriendo caja…' : resumePaymentAfterShift ? 'Abrir caja y cobrar' : 'Abrir caja'}
                                {!shiftLoading && <ArrowRight size={18} />}
                            </button>
                            <button
                                type="button"
                                onClick={() => { setShowOpenShift(false); setResumePaymentAfterShift(false); }}
                                className="w-full h-touch rounded-control text-sm font-semibold text-slate-400 hover:text-slate-200 hover:bg-white/[0.04]"
                            >
                                Cancelar
                            </button>
                        </form>
                    </div>
                </div>
            )}

            {/* --- CLOSE SHIFT MODAL --- */}
            {/* Guarda de cierre con venta en curso (P0-1). Tres salidas, todas
                explícitas: ninguna pierde la venta sin que el cajero lo sepa. */}
            {bloqueoCierre && (
                <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-modal p-4" onClick={() => setBloqueoCierre(false)}>
                    <div
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="titulo-bloqueo-cierre"
                        className="bg-surface-900 border border-white/10 rounded-card p-6 w-full max-w-sm text-slate-100"
                        onClick={e => e.stopPropagation()}
                    >
                        <h3 id="titulo-bloqueo-cierre" className="text-lg font-extrabold flex items-center gap-2">
                            <AlertTriangle size={20} className="text-amber-400" /> Tenés una venta sin cobrar
                        </h3>
                        <p className="text-sm text-slate-300 mt-2">
                            Hay {cart.length} producto{cart.length === 1 ? '' : 's'} en el carrito por {formatMoney(grandTotal)}. Decidí qué hacer antes de cerrar la caja.
                        </p>
                        <div className="mt-5 space-y-2">
                            <button
                                onClick={() => { handleHoldCart(); setBloqueoCierre(false); setShowCloseShift(true); }}
                                className="w-full h-11 rounded-control bg-brand text-brand-on font-bold hover:bg-brand-hover transition-colors"
                            >
                                Aparcar la venta y cerrar
                            </button>
                            <button
                                onClick={() => setBloqueoCierre(false)}
                                className="w-full h-11 rounded-control bg-white/[0.06] text-slate-100 font-bold hover:bg-white/[0.12] transition-colors"
                            >
                                Seguir vendiendo
                            </button>
                            <button
                                onClick={() => {
                                    setCart([]); setSelectedCustomer(null); setCustomerSearch(''); setGlobalDiscount('');
                                    setBloqueoCierre(false); setShowCloseShift(true);
                                }}
                                className="w-full h-11 rounded-control text-danger font-bold hover:bg-danger-soft transition-colors"
                            >
                                Descartar la venta y cerrar
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {showCloseShift && (
                <div className="absolute inset-0 z-50 bg-slate-900/80 backdrop-blur flex items-center justify-center p-4">
                    <div className="bg-surface-900 rounded-xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in duration-200">
                        {!shiftReport ? (
                            <div className="p-8">
                                <h2 className="text-xl font-bold text-slate-100 mb-1">Cierre de Caja (Ciego)</h2>
                                <p className="text-slate-500 text-sm mb-6">Contá el dinero físico e ingresalo abajo.</p>
                                <form onSubmit={handleCloseShift}>
                                    <label className="text-xs font-mono font-bold text-slate-500">EFECTIVO CONTADO</label>
                                    <div className="relative mb-6">
                                        <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                                        <input
                                            type="text"
                                            inputMode="decimal"
                                            autoFocus
                                            className="w-full pl-10 py-3 text-2xl font-bold border border-white/10 rounded-lg focus:ring-2 focus:ring-nortex-500 outline-none text-slate-100 font-mono tabular-nums"
                                            placeholder="0.00"
                                            value={declaredCash}
                                            aria-label="Efectivo contado en la gaveta"
                                            onChange={e => setDeclaredCash(sanitizeDecimalInput(e.target.value))}
                                            required
                                            {...validacionEs('Ingresá el efectivo que contaste.')}
                                        />
                                    </div>
                                    {/* Fase D: dólares contados (solo si manejaste US$ en el turno) */}
                                    <div className="mb-4">
                                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1 block">Dólares contados (US$) — opcional</label>
                                        <input
                                            type="text"
                                            inputMode="decimal"
                                            value={declaredCashUsd}
                                            onChange={e => setDeclaredCashUsd(sanitizeDecimalInput(e.target.value))}
                                            placeholder="Solo si manejaste dólares (agente bancario)"
                                            className="w-full border-2 border-white/[0.06] rounded-lg px-4 py-3 text-sm focus:border-emerald-500 outline-none text-slate-200 font-mono"
                                        />
                                    </div>
                                    <div className="flex gap-3">
                                        <button type="button" onClick={() => setShowCloseShift(false)} className="flex-1 py-3 text-slate-300 font-medium hover:bg-surface-800/40 rounded-lg">Cancelar</button>
                                        <button type="submit" disabled={shiftLoading} className="flex-1 py-3 bg-red-600 text-white font-bold rounded-lg hover:bg-red-700">
                                            {shiftLoading ? 'CERRANDO...' : 'REALIZAR CORTE Z'}
                                        </button>
                                    </div>
                                </form>
                            </div>
                        ) : (
                            <div className="bg-surface-800/40">
                                <div className="p-8 text-center border-b border-white/[0.06] bg-surface-900 text-slate-100">
                                    <div className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 ${shiftReport.diff >= 0 ? 'bg-green-500/15 text-green-400' : 'bg-red-500/15 text-red-400'}`}>
                                        {shiftReport.diff >= 0 ? <Check size={32} /> : <AlertTriangle size={32} />}
                                    </div>
                                    <h2 className="text-2xl font-bold text-slate-100">Resumen de Cierre</h2>
                                    <p className={`text-lg font-bold mt-2 ${shiftReport.diff >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                        {shiftReport.diff >= 0 ? 'Cuadre exitoso' : 'Discrepancia de efectivo'}
                                    </p>
                                </div>
                                <div className="p-8 space-y-4">
                                    <div className="flex justify-between text-sm">
                                        <span className="text-slate-500">Esperado (Sistema)</span>
                                        <span className="font-bold nx-num">{formatMoney(shiftReport.expected)}</span>
                                    </div>
                                    <div className="flex justify-between text-sm">
                                        <span className="text-slate-500">Declarado (Cajero)</span>
                                        <span className="font-bold nx-num">{formatMoney(parseFloat(declaredCash))}</span>
                                    </div>
                                    <div className="border-t border-white/[0.06] pt-3 flex justify-between text-base text-slate-100">
                                        <span className="font-bold text-slate-200">Diferencia</span>
                                        <span className={`font-mono font-bold ${shiftReport.diff < 0 ? 'text-red-500' : 'text-green-500'}`}>
                                            {shiftReport.diff > 0 ? '+' : ''}{shiftReport.diff.toFixed(2)}
                                        </span>
                                    </div>
                                    <button onClick={finishClose} className="w-full mt-6 py-3 bg-slate-900 text-white font-bold rounded-lg hover:bg-slate-800">
                                        FINALIZAR TURNO
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* ADD PRODUCT MODAL (Full) */}
            {showAddModal && (
                <div className="absolute inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="bg-surface-900 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden border border-white/[0.06] text-slate-100">
                        <div className="p-5 border-b border-white/[0.04] flex justify-between items-center bg-surface-800/40 text-slate-100">
                            <h3 className="font-bold text-slate-100 flex items-center gap-2">
                                <PackagePlus size={20} className="text-nortex-500" /> Nuevo Producto
                            </h3>
                            <button onClick={() => setShowAddModal(false)} className="text-slate-400 hover:text-red-500 transition-colors">
                                <X size={24} />
                            </button>
                        </div>

                        <form onSubmit={handleCreateProduct} className="p-6 space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div className="col-span-2">
                                    <label className="block text-xs font-mono text-slate-500 mb-1">NOMBRE DEL PRODUCTO *</label>
                                    <input type="text" required {...validacionEs('Escribí el nombre del producto.')} className="w-full px-3 py-2 border border-white/10 rounded-lg focus:outline-none focus:ring-2 focus:ring-nortex-500 text-slate-100"
                                        placeholder="Ej. Taladro Percutor 500W" value={newProduct.name} onChange={e => setNewProduct({ ...newProduct, name: e.target.value })} />
                                </div>
                                <div>
                                    <label className="block text-xs font-mono text-slate-500 mb-1">SKU / CÓDIGO DE BARRAS</label>
                                    <input type="text" className="w-full px-3 py-2 border border-white/10 rounded-lg focus:outline-none focus:ring-2 focus:ring-nortex-500 text-slate-100"
                                        placeholder="Escaneá o escribí" value={newProduct.sku} onChange={e => setNewProduct({ ...newProduct, sku: e.target.value.toUpperCase() })} />
                                </div>
                                <div>
                                    <label className="block text-xs font-mono text-slate-500 mb-1">CATEGORÍA</label>
                                    <select className="w-full px-3 py-2 border border-white/10 rounded-lg focus:outline-none focus:ring-2 focus:ring-nortex-500 bg-surface-900"
                                        value={newProduct.category} onChange={e => setNewProduct({ ...newProduct, category: e.target.value })} >
                                        <option>General</option><option>Construcción</option><option>Ferretería</option><option>Herramientas</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs font-mono text-slate-500 mb-1">PRECIO VENTA *</label>
                                    <input type="text" inputMode="decimal" required {...validacionEs('Ingresá el precio de venta.')} className="w-full px-3 py-2 border border-white/10 rounded-lg focus:outline-none focus:ring-2 focus:ring-nortex-500 text-slate-100 font-mono tabular-nums"
                                        placeholder="0.00" value={newProduct.price} onChange={e => setNewProduct({ ...newProduct, price: sanitizeDecimalInput(e.target.value) })} />
                                </div>
                                <div>
                                    <label className="block text-xs font-mono text-slate-500 mb-1">COSTO (COMPRA) *</label>
                                    <input type="text" inputMode="decimal" required {...validacionEs('Ingresá el costo del producto.')} className="w-full px-3 py-2 border border-white/10 rounded-lg focus:outline-none focus:ring-2 focus:ring-nortex-500 bg-surface-800/40 text-slate-100 font-mono tabular-nums"
                                        placeholder="0.00" value={newProduct.costPrice} onChange={e => setNewProduct({ ...newProduct, costPrice: sanitizeDecimalInput(e.target.value) })} />
                                </div>
                                <div className="col-span-2">
                                    <label className="block text-xs font-mono text-slate-500 mb-1">STOCK INICIAL *</label>
                                    <input type="text" inputMode="decimal" required {...validacionEs('Ingresá el stock inicial (puede ser 0).')} className="w-full px-3 py-2 border border-white/10 rounded-lg focus:outline-none focus:ring-2 focus:ring-nortex-500 text-slate-100 font-mono tabular-nums"
                                        placeholder="0" value={newProduct.stock} onChange={e => setNewProduct({ ...newProduct, stock: sanitizeDecimalInput(e.target.value) })} />
                                </div>
                            </div>
                            <button type="submit" className="btn-primary w-full py-3 flex items-center justify-center gap-2">
                                <Save size={18} /> Guardar en Inventario
                            </button>
                        </form>
                    </div>
                </div>
            )}

            {/* ==========================================
          QUICK CREATE MODAL (Minimal - Speed focused)
         ========================================== */}
            {showQuickCreate && (
                <div className="absolute inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setShowQuickCreate(false)}>
                    <div className="bg-surface-900 rounded-card shadow-premium w-full max-w-sm overflow-hidden border border-white/[0.08]" onClick={e => e.stopPropagation()}>
                        <div className="px-5 py-4 flex items-center justify-between border-b border-white/[0.06]">
                            <div>
                                <h3 className="font-bold text-slate-100 flex items-center gap-2">
                                    <PackagePlus size={19} className="text-brand" /> Agregar producto
                                </h3>
                                {simpleMode && <p className="text-xs text-slate-500 mt-1">Nombre y precio. Eso es suficiente para vender.</p>}
                            </div>
                            <button onClick={() => setShowQuickCreate(false)} className="w-10 h-10 rounded-control text-slate-400 hover:text-white hover:bg-white/[0.05] flex items-center justify-center" aria-label="Cerrar">
                                <X size={20} />
                            </button>
                        </div>

                        <form onSubmit={handleQuickCreate} className="p-5 space-y-4">
                            <div>
                                <label className="block text-xs font-semibold text-slate-400 mb-1.5">Nombre</label>
                                <input
                                    required autoFocus
                                    {...validacionEs('Escribí el nombre del producto.')}
                                    type="text"
                                    placeholder="Ej. Martillo"
                                    value={quickProduct.name}
                                    onChange={e => setQuickProduct({ ...quickProduct, name: e.target.value })}
                                    className="w-full h-touch px-3 border border-white/10 rounded-control bg-surface-800/40 text-slate-100 font-semibold focus:ring-2 focus:ring-brand/40 focus:border-brand outline-none"
                                />
                            </div>

                            <div>
                                <label className="block text-xs font-semibold text-slate-400 mb-1.5">Precio de venta</label>
                                <div className="relative">
                                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-bold">C$</span>
                                    <input
                                        required type="text" inputMode="decimal"
                                        {...validacionEs('Ingresá el precio de venta.')}
                                        aria-label="Precio de venta"
                                        placeholder="0.00"
                                        value={quickProduct.price}
                                        onChange={e => setQuickProduct({ ...quickProduct, price: sanitizeDecimalInput(e.target.value) })}
                                        className="w-full h-pay pl-10 pr-3 border border-white/10 rounded-control bg-surface-800/40 text-slate-100 font-bold text-xl focus:ring-2 focus:ring-brand/40 focus:border-brand outline-none tabular-nums"
                                    />
                                </div>
                            </div>

                            {simpleMode && (
                                <button
                                    type="button"
                                    onClick={() => setShowQuickDetails(v => !v)}
                                    className="w-full h-touch px-1 flex items-center justify-between text-sm font-semibold text-slate-400 hover:text-slate-200"
                                    aria-expanded={showQuickDetails}
                                >
                                    Más datos (opcionales)
                                    {showQuickDetails ? <ChevronUp size={17} /> : <ChevronDown size={17} />}
                                </button>
                            )}

                            {(!simpleMode || showQuickDetails) && (
                                <div className="space-y-3 pt-1">
                                    <div>
                                        <label className="block text-xs font-semibold text-slate-400 mb-1.5">Código o SKU</label>
                                        <input
                                            type="text"
                                            placeholder="Podés escanearlo"
                                            value={quickProduct.sku}
                                            onChange={e => setQuickProduct({ ...quickProduct, sku: e.target.value.toUpperCase() })}
                                            className="w-full h-touch px-3 border border-white/10 rounded-control bg-surface-800/40 text-slate-100 focus:ring-2 focus:ring-brand/40 focus:border-brand outline-none"
                                        />
                                    </div>
                                    <div className="grid grid-cols-2 gap-3">
                                        <div>
                                            <label className="block text-xs font-semibold text-slate-400 mb-1.5">Costo</label>
                                            <input
                                                type="text" inputMode="decimal" placeholder="Opcional"
                                                value={quickProduct.cost}
                                                onChange={e => setQuickProduct({ ...quickProduct, cost: sanitizeDecimalInput(e.target.value) })}
                                                className="w-full h-touch px-3 border border-white/10 rounded-control bg-surface-800/40 text-slate-100 focus:ring-2 focus:ring-brand/40 outline-none tabular-nums"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-semibold text-slate-400 mb-1.5">Existencia</label>
                                            <input
                                                type="text" inputMode="decimal"
                                                value={quickProduct.stock}
                                                onChange={e => setQuickProduct({ ...quickProduct, stock: sanitizeDecimalInput(e.target.value) })}
                                                className="w-full h-touch px-3 border border-white/10 rounded-control bg-surface-800/40 text-slate-100 focus:ring-2 focus:ring-brand/40 outline-none tabular-nums"
                                            />
                                        </div>
                                    </div>
                                </div>
                            )}

                            <button
                                type="submit"
                                disabled={quickSaving}
                                className="w-full h-pay rounded-control bg-brand text-brand-on font-bold hover:bg-brand-hover transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                            >
                                {quickSaving ? <Loader2 size={18} className="animate-spin" /> : <Plus size={18} />}
                                {quickSaving ? 'Guardando…' : 'Guardar y agregar'}
                            </button>
                        </form>
                    </div>
                </div>
            )}

            {/* ==========================================
          EXCEL IMPORT MODAL
         ========================================== */}
            {showImportModal && (
                <div className="absolute inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="bg-surface-900 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden border border-white/[0.06]">
                        <div className="bg-gradient-to-r from-blue-600 to-indigo-600 px-5 py-4 flex items-center justify-between">
                            <h3 className="font-bold text-white flex items-center gap-2">
                                <Upload size={18} /> Importar Productos (Excel/CSV)
                            </h3>
                            <button onClick={closeImportModal} className="text-white/80 hover:text-white">
                                <X size={20} />
                            </button>
                        </div>

                        <div className="p-6 space-y-4">
                            {/* Instructions */}
                            <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3">
                                <p className="text-xs text-blue-300 font-medium mb-1">Columnas esperadas en el archivo:</p>
                                <p className="text-[11px] text-blue-400 font-mono">Nombre | SKU | Precio | Costo | Stock | Categoria | Unidad</p>
                                <p className="text-[10px] text-blue-400 mt-1">Acepta .xlsx y .csv. Los nombres de columna son flexibles (Nombre/name/producto, etc.)</p>
                            </div>

                            {/* File Input */}
                            <div>
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    accept=".xlsx,.xls,.csv"
                                    onChange={handleFileUpload}
                                    className="w-full text-sm text-slate-300 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:font-bold file:bg-blue-500/15 file:text-blue-400 hover:file:bg-blue-200 file:cursor-pointer"
                                />
                            </div>

                            {/* Progress Bar */}
                            {importProgress && (
                                <div>
                                    <div className="flex justify-between text-xs mb-1">
                                        <span className="text-slate-300 font-medium">{importProgress.step}</span>
                                        <span className="text-slate-500">{importProgress.pct}%</span>
                                    </div>
                                    <div className="w-full bg-white/[0.06] rounded-full h-2.5 overflow-hidden">
                                        <div
                                            className="bg-gradient-to-r from-blue-500 to-indigo-500 h-full rounded-full transition-all duration-500"
                                            style={{ width: `${importProgress.pct}%` }}
                                        />
                                    </div>
                                </div>
                            )}

                            {/* Preview */}
                            {importData.length > 0 && !importResult && (
                                <div>
                                    <p className="text-sm font-bold text-slate-200 mb-2">Vista previa ({importData.length} productos):</p>
                                    <div className="max-h-40 overflow-y-auto border border-white/[0.06] rounded-lg">
                                        <table className="w-full text-xs">
                                            <thead className="bg-white/[0.04] sticky top-0">
                                                <tr>
                                                    <th className="text-left px-2 py-1.5 text-slate-300">SKU</th>
                                                    <th className="text-left px-2 py-1.5 text-slate-300">Nombre</th>
                                                    <th className="text-right px-2 py-1.5 text-slate-300">Precio</th>
                                                    <th className="text-right px-2 py-1.5 text-slate-300">Stock</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-white/[0.04]">
                                                {importData.slice(0, 10).map((row, i) => (
                                                    <tr key={i} className="hover:bg-surface-800/40">
                                                        <td className="px-2 py-1 font-mono text-slate-500">{row.sku}</td>
                                                        <td className="px-2 py-1 text-slate-200">{row.name}</td>
                                                        <td className="px-2 py-1 text-right text-slate-200">{row.price}</td>
                                                        <td className="px-2 py-1 text-right text-slate-200">{row.stock}</td>
                                                    </tr>
                                                ))}
                                                {importData.length > 10 && (
                                                    <tr>
                                                        <td colSpan={4} className="text-center py-1 text-slate-400 text-[10px]">
                                                            ... y {importData.length - 10} mas
                                                        </td>
                                                    </tr>
                                                )}
                                            </tbody>
                                        </table>
                                    </div>

                                    <button
                                        onClick={executeImport}
                                        className="w-full mt-3 py-3 rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-bold hover:from-blue-700 hover:to-indigo-700 shadow-lg flex items-center justify-center gap-2"
                                    >
                                        <Upload size={18} /> Importar {importData.length} Productos
                                    </button>
                                </div>
                            )}

                            {/* Results */}
                            {importResult && (
                                <div className="space-y-3">
                                    <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-4 text-center">
                                        <Check size={32} className="text-emerald-500 mx-auto mb-2" />
                                        <p className="font-bold text-emerald-300">Importación Completada</p>
                                        <div className="flex justify-center gap-6 mt-2">
                                            <div>
                                                <p className="text-2xl font-bold text-emerald-400">{importResult.created}</p>
                                                <p className="text-[10px] text-emerald-400">Creados</p>
                                            </div>
                                            <div>
                                                <p className="text-2xl font-bold text-blue-400">{importResult.updated}</p>
                                                <p className="text-[10px] text-blue-400">Actualizados</p>
                                            </div>
                                        </div>
                                    </div>

                                    {importResult.errors.length > 0 && (
                                        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3">
                                            <p className="text-xs font-bold text-red-400 mb-1">Errores ({importResult.errors.length}):</p>
                                            <ul className="text-[10px] text-red-400 space-y-0.5 max-h-20 overflow-y-auto">
                                                {importResult.errors.map((err, i) => (
                                                    <li key={i}>{err}</li>
                                                ))}
                                            </ul>
                                        </div>
                                    )}

                                    <button
                                        onClick={closeImportModal}
                                        className="w-full py-3 rounded-lg bg-slate-800 text-white font-bold hover:bg-slate-900"
                                    >
                                        Cerrar
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* LEFT: PRODUCTS */}
            <div className="w-full flex-1 flex flex-col p-4 lg:p-6 mt-14 overflow-hidden mb-16 lg:mb-0">
                {firstSaleMode && (
                    <div className="mb-4 px-4 py-3 rounded-card border border-brand/25 bg-brand-soft flex flex-col sm:flex-row sm:items-center gap-3">
                        <div className="w-9 h-9 rounded-pill bg-brand/15 text-brand flex items-center justify-center shrink-0">
                            <ShoppingCart size={19} />
                        </div>
                        <div className="min-w-0 flex-1">
                            <p className="text-sm font-bold text-slate-100">Esta venta es real</p>
                            <p className="text-xs text-slate-400 mt-0.5">Al cobrar se actualizan tu caja y tu inventario.</p>
                        </div>
                        <button
                            type="button"
                            onClick={() => navigate('/demo?source=first_sale')}
                            className="h-touch px-4 rounded-control border border-white/[0.08] text-sm font-semibold text-slate-200 hover:bg-white/[0.05] inline-flex items-center justify-center gap-2 shrink-0"
                        >
                            <PlayCircle size={17} /> Practicar sin guardar
                        </button>
                    </div>
                )}
                <div className="mb-4 flex gap-2">
                    <div className="relative flex-1">
                        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
                        {/* 56px + foco automático al montar: es el primer control de la
                            pantalla donde el cajero pasa el 80% del turno. Antes había
                            que hacer clic (o saber F2) antes de poder escanear. */}
                        <input
                            ref={searchRef}
                            type="text"
                            autoFocus
                            placeholder="Buscar o escanear"
                            className="w-full h-pay pl-11 pr-4 rounded-control bg-surface-900 border border-white/[0.06] focus:outline-none focus:ring-2 focus:ring-brand/40 focus:border-brand/50 text-slate-100 font-medium transition-colors"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            onKeyDown={handleSearchKeyDown}
                        />
                    </div>
                    {/* Quick Create */}
                    <button
                        onClick={() => setShowQuickCreate(true)}
                        className={guidedSimpleMode
                            ? 'h-pay px-3 sm:px-4 rounded-control border border-white/[0.08] text-slate-200 flex items-center gap-2 font-semibold text-sm hover:bg-white/[0.05] transition-colors'
                            : 'bg-gradient-to-r from-amber-500 to-orange-500 text-white px-3 rounded-xl flex items-center gap-1.5 font-bold text-sm hover:from-amber-600 hover:to-orange-600 shadow-md transition-all'}
                        title="Producto Rápido"
                    >
                        {guidedSimpleMode ? <Plus size={18} /> : <Zap size={18} />}
                        <span className={guidedSimpleMode ? 'hidden sm:inline' : ''}>{guidedSimpleMode ? 'Producto' : 'Rápido'}</span>
                    </button>
                    {/* Full Create */}
                    {!guidedSimpleMode && <button
                        onClick={() => setShowAddModal(true)}
                        className="bg-nortex-500 text-white px-3 rounded-xl flex items-center gap-1.5 font-medium text-sm hover:bg-nortex-600 transition-all"
                        title="Crear producto completo"
                    >
                        <Plus size={18} /> Nuevo
                    </button>}
                    {/* Import */}
                    {!guidedSimpleMode && <button
                        onClick={() => setShowImportModal(true)}
                        className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white px-3 rounded-xl flex items-center gap-1.5 font-bold text-sm hover:from-blue-700 hover:to-indigo-700 shadow-md transition-all"
                        title="Importar desde Excel"
                    >
                        <Upload size={18} /> Excel
                    </button>}
                </div>

                {/* ACCESO RÁPIDO A PRODUCTOS
                    Esta lista es `filteredProducts.slice(0, 5)`: el catálogo en su
                    orden natural, NO un ranking de ventas — no existe endpoint de
                    más-vendidos y no se inventa uno. Por eso el rótulo se calcula
                    con `rotuloProductosRapidos`, que solo dice "Más vendidos"
                    cuando hay un ranking real con suficientes ventas detrás. */}
                {!guidedSimpleMode && searchTerm === '' && (
                    <div className="mb-4">
                        <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                            <Zap size={14} className="text-amber-500" /> {firstSaleMode ? 'Empezá por uno de estos' : rotuloProductosRapidos(rankingDisponible, ventasRegistradas)}
                        </h3>
                        <div className="grid grid-cols-3 lg:grid-cols-5 gap-2">
                            {filteredProducts.slice(0, 5).map(product => (
                                <button
                                    key={`top-${product.id}`}
                                    onClick={() => { addToCart(product); playBeep(); }}
                                    className="bg-slate-800 hover:bg-slate-700 border border-slate-700 hover:border-nortex-500 p-3 rounded-xl text-center active:scale-95 transition-all flex flex-col items-center justify-center gap-1 h-24 shadow-[0_0_15px_rgba(0,0,0,0.1)] group"
                                >
                                    <Package size={24} className="text-blue-400 group-hover:text-blue-300 transition-colors mb-1" />
                                    <span className="text-[10px] font-bold text-slate-300 leading-tight line-clamp-2">{product.name}</span>
                                    <span className="text-xs font-black text-emerald-400 mt-auto">{formatMoney(product.price)}</span>
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {filteredProducts.length === 0 ? (
                    <div className="flex-1 min-h-0 flex items-center justify-center pb-4">
                        {searchTerm ? (
                            <EmptyState
                                mode="no-results"
                                title="Sin resultados"
                                description={`Ningún producto coincide con "${searchTerm}".`}
                                action={{ label: 'Limpiar búsqueda', onClick: () => setSearchTerm('') }}
                            />
                        ) : productsError ? (
                            <EmptyState
                                mode="error"
                                title="No pudimos cargar tus productos"
                                description="Puede ser tu conexión. Tus productos siguen ahí — reintentá."
                                action={{ label: 'Reintentar', onClick: () => fetchProducts() }}
                            />
                        ) : (
                            <EmptyState
                                icon={<Package size={32} />}
                                title="Agregá el primer producto"
                                description="Solo necesitamos un nombre y un precio. Después podés completar el resto."
                                action={{ label: 'Agregar producto', icon: <PackagePlus size={18} />, onClick: () => setShowQuickCreate(true) }}
                                linkAction={{ label: 'Prefiero practicar sin guardar datos', onClick: () => navigate('/demo?source=empty_catalog') }}
                            />
                        )}
                    </div>
                ) : (
                /* Grilla compacta: la tarjeta era `aspect-square` (≈230px en desktop)
                   y esperaba una imagen que este componente nunca renderiza — 60%
                   de vacío y solo ~6 productos visibles. A 96px de alto y hasta 5
                   columnas entran ~20 sin scrollear, que es lo que hace rápido al
                   mostrador. */
                <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-2 overflow-y-auto pb-4 custom-scrollbar flex-1 min-h-0 content-start">
                    {filteredProducts.map(product => (
                        <TarjetaProducto
                            key={product.id}
                            product={product}
                            bloqueada={permiteStockNegativo !== true && product.stock <= 0}
                            onAgregar={agregarDesdeGrilla}
                        />
                    ))}
                    {/* El recorte se DECLARA. Una lista cortada en silencio se lee
                        como "esto es todo lo que tengo", y en un inventario eso
                        hace que el dueño vuelva a comprar algo que ya tiene. */}
                    {resultadoBusqueda.ocultos > 0 && (
                        <p className="col-span-full text-center text-xs text-slate-400 py-3">
                            {searchTerm.trim() === ''
                                ? `Mostrando ${resultadoBusqueda.visibles.length} de ${resultadoBusqueda.total} productos — escaneá o escribí para buscar el resto.`
                                : `Mostrando ${resultadoBusqueda.visibles.length} de ${resultadoBusqueda.total} coincidencias — afiná la búsqueda.`}
                        </p>
                    )}
                </div>
                )}

                {/* ⌨️ HOTKEY CHEAT SHEET */}
                {!guidedSimpleMode && !firstSaleMode && (
                    <div className="hidden md:flex items-center gap-3 mt-2 px-2 py-1.5 text-[11px] text-slate-500 select-none flex-shrink-0">
                        <Keyboard size={13} className="text-slate-500" />
                        <span className="bg-white/[0.04] px-1.5 py-0.5 rounded text-slate-500">F2</span>
                        <span className="bg-white/[0.04] px-1.5 py-0.5 rounded text-slate-500">Ctrl+K</span> Buscar
                        <span className="text-slate-300">·</span>
                        <span className="bg-white/[0.04] px-1.5 py-0.5 rounded text-slate-500">F4</span> Aparcar
                        <span className="text-slate-300">·</span>
                        <span className="bg-white/[0.04] px-1.5 py-0.5 rounded text-slate-500">F7</span> Salida
                        <span className="text-slate-300">·</span>
                        <span className="bg-white/[0.04] px-1.5 py-0.5 rounded text-slate-500">F8</span> Entrada
                        <span className="text-slate-300">·</span>
                        <span className="bg-white/[0.04] px-1.5 py-0.5 rounded text-slate-500">F9</span>
                        <span className="bg-white/[0.04] px-1.5 py-0.5 rounded text-slate-500">Ctrl+Enter</span> Cobrar
                        <span className="text-slate-300">·</span>
                        <span className="bg-white/[0.04] px-1.5 py-0.5 rounded text-slate-500">Esc</span> Cerrar
                    </div>
                )}
            </div>

            {/* RIGHT: CART DRAWER (Responsive) */}
            {/* Mobile Toggle Button */}
            {cart.length > 0 && <div className="lg:hidden fixed bottom-20 left-4 right-4 z-40">
                <button
                    onClick={() => setShowMobileCart(true)}
                    className="w-full h-pay bg-brand text-brand-on rounded-card shadow-premium flex items-center justify-between px-5 font-bold text-base animate-in slide-in-from-bottom duration-300"
                >
                    <div className="flex items-center gap-2">
                        <ShoppingCart size={21} />
                        <span>Revisar venta · {cart.reduce((a, b) => a + b.quantity, 0)}</span>
                    </div>
                    <span>{formatMoney(grandTotal)}</span>
                </button>
            </div>}

            {/* Cart Container - Drawer on Mobile, Sidebar on Desktop */}
            <div className={`
          fixed inset-0 z-50 bg-surface-900 lg:static lg:z-auto lg:w-96 lg:border-l lg:border-white/[0.06] flex flex-col lg:shadow-xl lg:mt-14 transition-all duration-300
          ${showMobileCart ? 'translate-y-0 opacity-100' : 'translate-y-full lg:translate-y-0 opacity-0 pointer-events-none lg:opacity-100 lg:pointer-events-auto'}
      `}>
                <div className="p-5 border-b border-white/[0.04] bg-surface-800/40 text-slate-100 flex items-center justify-between">
                    <h2 className="font-bold text-slate-100 flex items-center gap-2"><ShoppingCart size={20} /> {guidedSimpleMode ? 'Venta actual' : 'Ticket'}</h2>
                    {/* Mobile Close Button */}
                    <button onClick={() => setShowMobileCart(false)} className="lg:hidden p-2 bg-white/[0.06] rounded-full text-slate-300" aria-label="Cerrar resumen de venta">
                        <ArrowDownCircle size={24} />
                    </button>
                </div>

                {currentShift && !guidedSimpleMode && (cart.length > 0 || heldCarts.length > 0) && (
                    <div className="px-4 pt-3 flex flex-wrap gap-2">
                        {cart.length > 0 && (
                            <button
                                type="button"
                                onClick={handleHoldCart}
                                className={`h-9 px-3 rounded-control border text-sm font-semibold transition-colors ${
                                    guidedSimpleMode
                                        ? 'bg-amber-500/10 text-amber-300 border-amber-500/20 hover:bg-amber-500/15'
                                        : 'bg-white/[0.04] text-slate-200 border-white/[0.06] hover:bg-white/[0.06]'
                                }`}
                            >
                                <span className="inline-flex items-center gap-2">
                                    <ParkingCircle size={15} />
                                    Aparcar
                                    {!guidedSimpleMode && <span className="text-[10px] font-mono text-slate-500">F4</span>}
                                </span>
                            </button>
                        )}
                        {heldCarts.length > 0 && (
                            <button
                                type="button"
                                onClick={openHeldCarts}
                                className={`h-9 px-3 rounded-control border text-sm font-semibold transition-colors ${
                                    guidedSimpleMode
                                        ? 'bg-sky-500/10 text-sky-300 border-sky-500/20 hover:bg-sky-500/15'
                                        : 'bg-white/[0.04] text-slate-200 border-white/[0.06] hover:bg-white/[0.06]'
                                }`}
                            >
                                <span className="inline-flex items-center gap-2">
                                    <RotateCcw size={15} />
                                    Aparcadas ({heldCarts.length})
                                </span>
                            </button>
                        )}
                    </div>
                )}

                {/* EMPLOYEE AUTO-ASSIGNED (from PIN on shift open) */}
                {currentShift?.employee && !guidedSimpleMode && (
                    <div className="px-4 pt-3">
                        <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2 flex items-center gap-2">
                            <div className="w-7 h-7 bg-emerald-200 rounded-full flex items-center justify-center text-emerald-400 font-bold text-xs">
                                {currentShift.employee.firstName[0]}{currentShift.employee.lastName[0]}
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="text-sm font-bold text-emerald-300 truncate">{currentShift.employee.firstName} {currentShift.employee.lastName}</p>
                                <p className="text-[10px] text-emerald-400 uppercase">{currentShift.employee.role} - Vendedor asignado</p>
                            </div>
                        </div>
                    </div>
                )}

                {/* 👑 SMART CUSTOMER SEARCH - GOD-TIER SELECTOR */}
                {guidedSimpleMode && !showCustomerPicker && !selectedCustomer ? (
                    <div className="px-4 pt-3">
                        <button
                            type="button"
                            onClick={() => setShowCustomerPicker(true)}
                            className="w-full h-touch px-3 rounded-control text-sm font-semibold text-slate-400 hover:text-slate-200 hover:bg-white/[0.04] border border-transparent hover:border-white/[0.06] flex items-center gap-2 transition-colors"
                        >
                            <User size={17} /> Agregar cliente <span className="font-normal text-slate-500">(opcional)</span>
                        </button>
                    </div>
                ) : (
                <div className="px-4 pt-4 relative">
                    <label className="text-[10px] font-black text-indigo-400 uppercase tracking-widest mb-1.5 flex items-center gap-1.5">
                        <User size={12} /> {guidedSimpleMode ? 'CLIENTE' : 'CLIENTE PARA SCORING'}
                    </label>
                    <div className="relative">
                        <div className="absolute left-4 top-1/2 -translate-y-1/2 w-9 h-9 bg-indigo-500/15 rounded-full flex items-center justify-center">
                            <User className="text-indigo-400" size={20} />
                        </div>
                        <input
                            type="text"
                            placeholder="Buscar cliente"
                            className={guidedSimpleMode
                                ? 'w-full h-touch pl-16 pr-10 text-sm font-semibold border border-white/[0.08] rounded-control outline-none focus:border-brand focus:ring-2 focus:ring-brand/30 bg-surface-800/40 text-slate-100 placeholder:text-slate-500 transition-colors'
                                : 'w-full pl-16 pr-10 py-4 text-base font-bold border-2 border-brand rounded-xl outline-none focus:border-brand-hover focus:ring-4 focus:ring-brand/20 bg-brand/5 text-slate-100 placeholder:text-slate-500 placeholder:font-medium transition-all shadow-sm'}
                            value={selectedCustomer ? selectedCustomer.name : customerSearch}
                            onChange={(e) => {
                                setCustomerSearch(e.target.value);
                                setSelectedCustomer(null);
                                setShowCustomerDropdown(true);
                            }}
                            onFocus={() => setShowCustomerDropdown(true)}
                        />
                        {selectedCustomer && (
                            <button onClick={() => { setSelectedCustomer(null); setCustomerSearch(''); setShowCustomerPicker(false); }} className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 bg-red-500/15 rounded-full text-red-500 hover:bg-red-200 hover:text-red-400 transition-colors">
                                <X size={16} />
                            </button>
                        )}
                    </div>

                    {/* Dropdown Results */}
                    {showCustomerDropdown && !selectedCustomer && (
                        <div className="absolute left-4 right-4 top-[72px] bg-surface-900 border-2 border-indigo-500/20 rounded-xl shadow-2xl z-20 max-h-56 overflow-y-auto text-slate-100">
                            {filteredCustomers.length === 0 ? (
                                <div className="p-4 text-sm text-slate-400 text-center">No encontrado. Ir a Clientes para crear.</div>
                            ) : (
                                filteredCustomers.map(c => (
                                    <button
                                        key={c.id}
                                        onClick={() => {
                                            setSelectedCustomer(c);
                                            setShowCustomerDropdown(false);
                                        }}
                                        className="w-full text-left px-4 py-3 hover:bg-indigo-500/10 border-b border-white/[0.04] last:border-0 text-slate-100 transition-colors"
                                    >
                                        <div className="font-bold text-slate-100 text-sm">{c.name}</div>
                                        <div className="text-[11px] text-slate-500 mt-0.5">Límite: {formatMoney(c.creditLimit)} | Deuda: {formatMoney(c.currentDebt)}</div>
                                    </button>
                                ))
                            )}
                        </div>
                    )}

                    {/* Credit Status Indicator */}
                    {selectedCustomer && (
                        <div className={`mt-2.5 p-3 rounded-xl text-xs border-2 ${selectedCustomer.isBlocked ? 'bg-red-500/10 border-red-300 text-red-400' : 'bg-blue-500/10 border-blue-500/20 text-blue-400'}`}>
                            <div className="flex justify-between font-bold mb-1.5">
                                <span className="flex items-center gap-1">{selectedCustomer.isBlocked ? 'BLOQUEADO' : 'Linea Disponible:'}</span>
                                {!selectedCustomer.isBlocked && <span className="text-sm">{formatMoney((selectedCustomer.creditLimit - selectedCustomer.currentDebt))}</span>}
                            </div>
                            {!selectedCustomer.isBlocked && (
                                <div className="w-full bg-blue-200 h-2 rounded-full overflow-hidden">
                                    <div className="bg-blue-500 h-full transition-all" style={{ width: `${Math.min((selectedCustomer.currentDebt / selectedCustomer.creditLimit) * 100, 100)}%` }}></div>
                                </div>
                            )}
                        </div>
                    )}
                </div>
                )}

                {/* ⚠️ Venta a medias que NO pertenece a este turno (o quedó vieja).
                    No se restaura sola: meter mercadería de otro turno en la caja
                    de hoy sin avisar descuadraría el arqueo de otro. Se muestra
                    con su tamaño real para que la decisión sea informada. */}
                {ventaPendiente && (() => {
                    const r = resumenGuardado(ventaPendiente);
                    return (
                        <div role="status" className="mx-4 mt-4 p-3 rounded-control bg-warning-soft border border-amber-500/20">
                            <div className="flex items-start gap-2">
                                <AlertTriangle size={16} className="text-amber-400 shrink-0 mt-0.5" />
                                <div className="flex-1 min-w-0">
                                    <p className="text-[13px] font-bold text-amber-400 leading-snug">Tenés una venta sin terminar</p>
                                    <p className="text-[12px] text-slate-300 mt-0.5">
                                        {r.lineas} producto{r.lineas === 1 ? '' : 's'} · {formatMoney(r.total)} — quedó de otro turno.
                                    </p>
                                    <div className="flex gap-2 mt-2">
                                        <button
                                            onClick={recuperarVentaPendiente}
                                            className="px-2.5 py-1 rounded bg-amber-500 text-white text-[12px] font-bold hover:bg-amber-600 transition-colors"
                                        >
                                            Recuperar
                                        </button>
                                        <button
                                            onClick={descartarVentaPendiente}
                                            className="px-2.5 py-1 rounded bg-white/[0.06] text-slate-200 text-[12px] font-bold hover:bg-white/[0.12] transition-colors"
                                        >
                                            Descartar
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    );
                })()}

                {/* Otra pestaña escribió el mismo carrito: se avisa en vez de
                    pisarlo en silencio — perder un carrito sin enterarse es el
                    mismo bug que estamos arreglando, disfrazado. */}
                {cajaEnOtraPestana && (
                    <div role="status" className="mx-4 mt-4 p-2.5 rounded-control bg-white/[0.04] border border-white/[0.08] flex items-start gap-2">
                        <AlertTriangle size={14} className="text-slate-400 shrink-0 mt-0.5" />
                        <p className="text-[12px] text-slate-300 flex-1">
                            La caja está abierta en otra pestaña. Usá una sola para que no se pisen las ventas.
                        </p>
                        <button onClick={() => setCajaEnOtraPestana(false)} className="text-slate-400 hover:text-slate-200 shrink-0" aria-label="Cerrar aviso">
                            <X size={14} />
                        </button>
                    </div>
                )}

                <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar">
                    {cart.length === 0 ? (
                        <div className="h-full flex flex-col items-center justify-center text-slate-400 space-y-4">
                            <div className="w-14 h-14 rounded-pill bg-white/[0.04] flex items-center justify-center"><ShoppingCart size={26} /></div>
                            <p className="text-sm font-semibold text-slate-300">Tu venta está vacía</p>
                            <p className="text-xs text-slate-500 text-center max-w-[220px]">Seleccioná un producto o escaneá su código para empezar.</p>
                            {currentShift && heldCarts.length > 0 && (
                                <button
                                    type="button"
                                    onClick={openHeldCarts}
                                    className="h-touch px-4 rounded-control border border-sky-500/20 bg-sky-500/10 text-sky-200 font-semibold text-sm hover:bg-sky-500/15 transition-colors"
                                >
                                    <span className="inline-flex items-center gap-2">
                                        <RotateCcw size={16} />
                                        Continuar venta aparcada ({heldCarts.length})
                                    </span>
                                </button>
                            )}
                        </div>
                    ) : (
                        cart.map(item => {
                            const key = lineKey(item);
                            const isScaleLabel = item.measurement?.source === 'SCALE_LABEL';
                            const isQuotationLine = isQuotationCartLine(item);
                            const unit = item.unit || 'unidad';
                            const lineDiscount = isQuotationLine ? 0 : ((item as CartLine).discount ?? 0);
                            const lineDiscountD = toDecimal(lineDiscount);
                            const displayedQuantity = isQuotationLine && item.quantityExact
                                ? item.quantityExact
                                : item.quantity;
                            const lineTotalD = toDecimal(item.price).mul(displayedQuantity).mul(new Decimal(1).minus(lineDiscountD.div(100)));
                            const tierBadge = lineTierBadge(item as CartLine, Boolean(selectedCustomer?.isWholesale));
                            const packSize = (item as CartLine).packSize;
                            const packLabel = ((item as CartLine).packUnit || 'caja').toLowerCase();
                            const packLine = isPackCartLine(item);
                            const quantityStep = packLine && packSize != null && packSize > 0
                                ? packSize
                                : effectiveQuantityStep(item);
                            return (
                                <div
                                    key={key}
                                    className={`bg-surface-800/40 p-3 rounded-lg border text-slate-100 transition-colors duration-300 ${lineaResaltada?.id === item.id ? 'border-emerald-500/60 bg-emerald-500/10' : 'border-white/[0.04]'}`}
                                >
                                    {/* FILA 1 · El nombre, a ancho completo (P0-3).
                                        Antes era `line-clamp-1` dentro de una columna de
                                        110px y sin `title`: "1 bolson de ranchita chile"
                                        se leía "1 bolson de..." y no había ni tooltip.
                                        Confirmar el artículo en voz alta con el cliente es
                                        el control de calidad de una venta; acá era
                                        imposible. El alto sobra: el panel estaba vacío de
                                        la tercera fila para abajo. */}
                                    <h4
                                        title={item.name}
                                        className="text-[15px] font-semibold text-slate-100 leading-snug line-clamp-2"
                                    >
                                        {item.name}
                                    </h4>

                                    {/* FILA 2 · precio · cantidad · total · quitar */}
                                    <div className="flex items-center gap-2 mt-2">
                                        <div className="flex-1 min-w-0">
                                            <div className="text-xs text-slate-400 font-mono tabular-nums flex items-center gap-1.5 flex-wrap">
                                                <span>
                                                    {packLine
                                                        ? `${formatQuantityValue(item.presentation?.quantity ?? 0)} ${packLabel} (${formatQuantityValue(displayedQuantity)} ${unit}) × ${formatMoney(item.price)} / ${unit}`
                                                        : `${formatQuantityValue(displayedQuantity)} ${unit} × ${formatMoney(item.price)} / ${unit}`}
                                                </span>
                                                {isScaleLabel && (
                                                    <span className="px-1.5 py-0.5 bg-cyan-500/15 text-cyan-300 rounded text-[9px] font-bold tracking-wide">ETIQUETA</span>
                                                )}
                                                {isQuotationLine && (
                                                    <span className="px-1.5 py-0.5 bg-violet-500/15 text-violet-300 rounded text-[9px] font-bold tracking-wide">COTIZACIÓN</span>
                                                )}
                                                {tierBadge && (
                                                    <span className="px-1.5 py-0.5 bg-indigo-500/15 text-indigo-400 rounded text-[9px] font-bold tracking-wide">{tierBadge}</span>
                                                )}
                                                {!isScaleLabel && !isQuotationLine && packSize != null && packSize > 0 && item.packUnit && (
                                                    <button
                                                        onClick={() => addPackToCart(item)}
                                                        className="px-1.5 py-0.5 bg-emerald-500/15 text-emerald-400 hover:bg-emerald-200 rounded text-[9px] font-bold tracking-wide transition-colors"
                                                        title={`Agregar 1 ${packLabel} (${packSize} ${(item as CartLine).unit || 'und'})`}
                                                        aria-label={`Agregar un ${packLabel} de ${item.name}, ${packSize} unidades`}
                                                    >
                                                        +1 {packLabel.toUpperCase()} ({packSize})
                                                    </button>
                                                )}
                                            </div>
                                            <div className="text-[15px] font-bold text-white font-mono tabular-nums mt-0.5">{formatMoney(lineTotalD)}</div>
                                        </div>

                                        {/* Objetivos táctiles de 44px (P0-4). Antes: −/+ de
                                            22px y basurero de 14px, los tres SIN nombre
                                            accesible — anónimos para un lector de pantalla
                                            y para cualquier prueba automatizada. */}
                                        {isScaleLabel || isQuotationLine ? (
                                            <div
                                                className={`min-h-11 px-3 flex flex-col justify-center rounded-control shrink-0 ${isQuotationLine ? 'border border-violet-500/20 bg-violet-500/10 text-violet-100' : 'border border-cyan-500/20 bg-cyan-500/10 text-cyan-100'}`}
                                                title={isQuotationLine
                                                    ? 'Cantidad y precio fijados por la cotización original'
                                                    : 'El servidor vuelve a derivar esta cantidad desde la etiqueta'}
                                            >
                                                <span className="font-mono text-sm font-bold tabular-nums">{formatQuantityValue(displayedQuantity)} {unit}</span>
                                                <span className="text-[9px] uppercase tracking-wide">{isQuotationLine ? 'fijado por cotización' : 'fijado por etiqueta'}</span>
                                            </div>
                                        ) : (
                                            <div className="flex items-center gap-0.5 bg-surface-900 rounded-control border border-white/[0.06] p-0.5 text-slate-100 shrink-0">
                                                <button
                                                    onClick={() => updateQuantity(key, -quantityStep)}
                                                    aria-label={`Restar ${formatQuantityValue(quantityStep)} ${unit} de ${item.name}`}
                                                    className="w-11 h-11 flex items-center justify-center hover:bg-white/[0.06] rounded-control text-slate-300 transition-colors"
                                                >
                                                    <Minus size={18} />
                                                </button>
                                                <NumberDraftInput
                                                    value={item.quantity}
                                                    onCommit={(n) => setQuantity(key, n)}
                                                    ariaLabel={`Cantidad de ${item.name} en ${unit}`}
                                                    ariaInvalid={Boolean(quantityErrors[key])}
                                                    describedBy={quantityErrors[key] ? `quantity-error-${key}` : undefined}
                                                    className="w-16 h-11 text-center text-base font-mono tabular-nums font-bold border-0 outline-none bg-transparent text-slate-100"
                                                />
                                                <button
                                                    onClick={() => updateQuantity(key, quantityStep)}
                                                    aria-label={`Agregar ${formatQuantityValue(quantityStep)} ${unit} de ${item.name}`}
                                                    className="w-11 h-11 flex items-center justify-center hover:bg-white/[0.06] rounded-control text-slate-300 transition-colors"
                                                >
                                                    <Plus size={18} />
                                                </button>
                                            </div>
                                        )}

                                        <button
                                            onClick={() => quitarLinea(key)}
                                            aria-label={`Quitar ${item.name} del ticket`}
                                            className="w-11 h-11 flex items-center justify-center rounded-control text-slate-400 hover:text-danger hover:bg-danger-soft transition-colors shrink-0"
                                        >
                                            <Trash2 size={18} />
                                        </button>
                                    </div>
                                    {quantityErrors[key] && <p id={`quantity-error-${key}`} role="alert" className="mt-1.5 text-[11px] text-danger">{quantityErrors[key]}</p>}
                                    {!guidedSimpleMode && !isQuotationLine && (
                                        <>
                                            {lineDiscountD.greaterThan(0) ? (
                                                <div className="flex items-center gap-2 mt-1.5 pt-1.5 border-t border-white/[0.04]">
                                                    <span className="px-1.5 py-0.5 rounded bg-danger-soft text-danger text-[10px] font-bold">−{lineDiscount}%</span>
                                                    <span className="text-[11px] text-slate-400">
                                                        rebaja {formatMoney(toDecimal(item.price).mul(item.quantity).mul(lineDiscountD).div(100))}
                                                    </span>
                                                    <button
                                                        onClick={() => setLineaConDescuento(previous => previous === key ? null : key)}
                                                        className="ml-auto text-[11px] text-slate-400 hover:text-slate-200 underline underline-offset-2"
                                                    >
                                                        {lineaConDescuento === key ? 'Listo' : 'Cambiar'}
                                                    </button>
                                                </div>
                                            ) : lineaConDescuento !== key ? (
                                                <button
                                                    onClick={() => setLineaConDescuento(key)}
                                                    className="mt-1.5 pt-1.5 border-t border-white/[0.04] w-full text-left text-[11px] text-slate-500 hover:text-slate-300 transition-colors flex items-center gap-1.5"
                                                >
                                                    <Percent size={11} /> Aplicar descuento
                                                </button>
                                            ) : null}

                                            {lineaConDescuento === key && (
                                                <div className="flex items-center gap-2 mt-1.5">
                                                    <NumberDraftInput
                                                        value={lineDiscount}
                                                        onCommit={(value) => setItemDiscount(key, value)}
                                                        allowZero
                                                        placeholder="0"
                                                        ariaLabel={`Descuento de ${item.name} en porcentaje`}
                                                        className="w-16 h-11 text-center text-base border border-white/[0.10] rounded-control outline-none focus:border-brand text-slate-100 font-mono tabular-nums bg-surface-900"
                                                    />
                                                    <span className="text-xs text-slate-400">% de descuento</span>
                                                    <button
                                                        onClick={() => setLineaConDescuento(null)}
                                                        className="ml-auto h-11 px-3 rounded-control bg-white/[0.06] hover:bg-white/[0.12] text-slate-100 text-xs font-bold transition-colors"
                                                    >
                                                        Listo
                                                    </button>
                                                </div>
                                            )}
                                        </>
                                    )}
                                    {/* ⚠️ Aviso de existencias — la línea vende más de lo que
                                        hay en el sistema (o el producto ya está en negativo).
                                        AVISA, no bloquea: el conteo puede estar desactualizado
                                        y el producto estar físicamente en la góndola. Lo que sí
                                        hace es dar la salida en un toque: ajustar a lo que hay,
                                        o quitar la línea si no hay nada. */}
                                    {(() => {
                                        const aviso = avisoPorLinea.get(item.id);
                                        const texto = aviso ? textoAviso(aviso) : null;
                                        if (!aviso || !texto) return null;
                                        const grave = aviso.estado === 'SIN_EXISTENCIA';
                                        return (
                                            <div
                                                role="status"
                                                className={`mt-1.5 pt-1.5 border-t border-white/[0.04] flex items-start gap-2 text-[11px] leading-snug ${grave ? 'text-danger' : 'text-amber-400'}`}
                                            >
                                                <AlertTriangle size={13} className="shrink-0 mt-px" />
                                                <span className="flex-1 min-w-0">{texto}</span>
                                                {aviso.ajustarA !== null && !isScaleLabel && !isQuotationLine && (lineasPorProducto.get(item.id) ?? 0) === 1 ? (
                                                    <button
                                                        onClick={() => setQuantity(key, aviso.ajustarA as number)}
                                                        className="shrink-0 px-1.5 py-0.5 rounded bg-white/[0.06] hover:bg-white/[0.12] font-bold text-slate-200 transition-colors"
                                                    >
                                                        Ajustar a {aviso.ajustarA}
                                                    </button>
                                                ) : (
                                                    <button
                                                        onClick={() => quitarLinea(key)}
                                                        aria-label={`Quitar ${item.name} del ticket`}
                                                        className="shrink-0 px-1.5 py-0.5 rounded bg-white/[0.06] hover:bg-white/[0.12] font-bold text-slate-200 transition-colors"
                                                    >
                                                        Quitar
                                                    </button>
                                                )}
                                            </div>
                                        );
                                    })()}
                                </div>
                            );
                        })
                    )}
                </div>
                {/* Deshacer un quitado (P0-4). Va dentro del panel y pegado al
                    bloque de cobro para que se vea también en móvil, donde el
                    panel del ticket ES la pantalla. */}
                {quitadoReciente && (
                    <div role="status" className="mx-4 mb-2 px-3 py-2 rounded-control bg-surface-800 border border-white/[0.08] flex items-center gap-2">
                        <span className="text-[12px] text-slate-300 flex-1 min-w-0 truncate">
                            Quitaste "{quitadoReciente.item.name}"
                        </span>
                        <button
                            onClick={deshacerQuitado}
                            className="shrink-0 px-2.5 py-1 rounded bg-white/[0.08] text-slate-100 text-[12px] font-bold hover:bg-white/[0.16] transition-colors"
                        >
                            Deshacer
                        </button>
                    </div>
                )}

                {/* Bloque de cobro: sticky al fondo del panel, superficie elevada y
                    z-checkout. Ningún flotante puede vivir por encima de esto. */}
                <div className="sticky bottom-0 z-checkout p-5 border-t border-white/[0.06] bg-surface-800 text-slate-100">
                    {/* 💸 Global Discount (oculto en modo simple para no invitar al error) */}
                    {!guidedSimpleMode && <div className="flex items-center gap-2 mb-2">
                        <Percent size={14} className="text-slate-400" />
                        <span className="text-xs text-slate-500 font-bold">Descuento Global</span>
                        <input
                            type="text"
                            inputMode="decimal"
                            placeholder="0"
                            aria-label="Descuento global en porcentaje"
                            className="w-14 text-xs text-center border border-white/[0.06] rounded px-1 py-1 outline-none focus:border-brand text-slate-200 font-mono tabular-nums"
                            value={hasQuotationLines ? '' : globalDiscount}
                            onChange={e => setGlobalDiscount(sanitizeDecimalInput(e.target.value))}
                            disabled={hasQuotationLines}
                            title={hasQuotationLines ? 'La cotización conserva su descuento y precio originales' : undefined}
                        />
                        <span className="text-xs text-slate-400">%</span>
                        {hasQuotationLines && (
                            <span className="text-[10px] text-violet-300 ml-auto">Fijado por cotización</span>
                        )}
                        {globalDiscountD.greaterThan(0) && (
                            <span className="text-xs text-red-500 font-bold ml-auto">-{formatMoney(totalD.mul(globalDiscountD).div(100))}</span>
                        )}
                    </div>}
                    {/* P1-5 — Antes: "Subtotal C$19.00 · IVA incluido C$2.48 ·
                        TOTAL C$19.00". Tres líneas donde dos eran idénticas y la
                        del medio no sumaba, porque "Subtotal" estaba puesto sobre
                        el BRUTO (que ya trae el IVA adentro). Ahora se imprime el
                        desglose fiscal real —base imponible + IVA = TOTAL—, que
                        además es el MISMO que sale en el ticket de papel: el
                        número de la pantalla y el del papel tienen que cuadrar
                        entre sí y con la declaración.
                        Subtotal y Descuento solo aparecen cuando hubo descuento;
                        sin él eran una cifra repetida. */}
                    {(!guidedSimpleMode || showSaleDetails) ? (
                        <div className="mb-2">
                            {globalDiscountD.greaterThan(0) && (
                                <>
                                    <div className="flex justify-between text-sm text-slate-400 mb-1"><span>Subtotal</span><span className="nx-num">{formatMoney(total)}</span></div>
                                    <div className="flex justify-between text-sm text-danger mb-1"><span>Descuento ({globalDiscountNum}%)</span><span className="nx-num">-{formatMoney(totalD.mul(globalDiscountD).div(100))}</span></div>
                                </>
                            )}
                            <div className="flex justify-between text-sm text-slate-400 mb-1"><span>Base imponible</span><span className="nx-num">{formatMoney(grandTotalD.minus(taxD))}</span></div>
                            <div className="flex justify-between text-sm text-slate-400"><span>IVA incluido (15%)</span><span className="nx-num">{formatMoney(tax)}</span></div>
                        </div>
                    ) : (
                        <button
                            type="button"
                            onClick={() => setShowSaleDetails(true)}
                            className="w-full flex items-center justify-between text-xs text-slate-500 hover:text-slate-300 mb-2 py-1"
                        >
                            <span>Impuestos incluidos</span><ChevronDown size={15} />
                        </button>
                    )}
                    {/* El TOTAL es la cifra que decide la operación: tamaño display,
                        en color de texto principal (no coloreado). */}
                    <div className="flex justify-between items-baseline mb-4 pt-3 border-t border-white/[0.06]">
                        <span className="nx-label">Total</span>
                        <span className="nx-total">{formatMoney(grandTotal)}</span>
                    </div>

                    {/* Resumen de existencias: va PEGADO a los botones de cobro
                        porque es el último momento en que el aviso sirve. El texto
                        dice la consecuencia REAL según la política del tenant
                        (rechazo vs inventario en negativo); si todavía no sabemos
                        cuál es, avisa el hecho y no promete nada. */}
                    {resumenStockTexto && (
                        <div
                            role="status"
                            className={`flex items-start gap-2 mb-3 px-3 py-2 rounded-control text-[12px] leading-snug ${permiteStockNegativo === false ? 'bg-danger-soft text-danger' : 'bg-warning-soft text-amber-400'}`}
                        >
                            <AlertTriangle size={14} className="shrink-0 mt-px" />
                            <span>{resumenStockTexto}</span>
                        </div>
                    )}

                    {/* Una sola decisión dominante en modo guiado. Los métodos se
                        eligen después, como en Square/Shopify/Lightspeed. */}
                    {guidedSimpleMode ? (
                        <div className="space-y-2">
                            <button
                                type="button"
                                onClick={() => {
                                    if (!currentShift) {
                                        trackEvent('pos_shift_required', { source: firstSaleMode ? 'first_sale' : 'pos', cart_items: cart.length });
                                        setErrorApertura({});
                                        setShowMobileCart(false);
                                        setResumePaymentAfterShift(true);
                                        setShowOpenShift(true);
                                        return;
                                    }
                                    setShowMobileCart(false);
                                    setShowPaymentOptions(true);
                                }}
                                disabled={processing || cart.length === 0 || turnoAjeno}
                                className="w-full h-pay px-5 bg-brand text-brand-on font-bold rounded-control hover:bg-brand-hover text-[17px] flex items-center justify-between active:scale-[0.99] transition-colors disabled:opacity-45 disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand/40"
                            >
                                <span>Cobrar</span>
                                <span className="flex items-center gap-2 nx-num">{formatMoney(grandTotal)} <ArrowRight size={20} /></span>
                            </button>
                            {currentShift && !turnoAjeno && (cart.length > 0 || heldCarts.length > 0) && (
                                <div className={`grid gap-2 ${cart.length > 0 && heldCarts.length > 0 ? 'grid-cols-2' : 'grid-cols-1'}`}>
                                    {cart.length > 0 && (
                                    <button
                                        type="button"
                                        onClick={handleHoldCart}
                                        disabled={processing}
                                        className="h-touch px-4 rounded-control border border-white/[0.08] text-slate-200 font-semibold text-sm hover:bg-white/[0.05] transition-colors disabled:opacity-45 disabled:cursor-not-allowed"
                                    >
                                        <span className="inline-flex items-center gap-2">
                                            <ParkingCircle size={16} className="text-sky-300" />
                                            Aparcar venta
                                        </span>
                                    </button>
                                    )}
                                    {heldCarts.length > 0 && (
                                    <button
                                        type="button"
                                        onClick={openHeldCarts}
                                        className="h-touch px-4 rounded-control border border-sky-500/20 bg-sky-500/10 text-sky-200 font-semibold text-sm hover:bg-sky-500/15 transition-colors"
                                    >
                                        <span className="inline-flex items-center gap-2">
                                            <RotateCcw size={16} />
                                            Aparcadas ({heldCarts.length})
                                        </span>
                                    </button>
                                    )}
                                </div>
                            )}
                        </div>
                    ) : <div className="grid grid-cols-2 gap-3 mb-3">
                        <button
                            // Sin turno abierto el botón NO queda muerto: manda a la
                            // apertura de caja (que ahora se puede cerrar). Bloquear
                            // el cobro es correcto; dejar al usuario sin camino, no.
                            onClick={() => {
                                if (!currentShift) { setErrorApertura({}); setShowOpenShift(true); return; }
                                setCashReceived(''); setPayingInUSD(false); setUsdAmount(''); setShowCashPreModal(true);
                            }}
                            title={!currentShift ? 'Abrí la caja para poder cobrar' : undefined}
                            disabled={processing || cart.length === 0}
                            className="h-pay bg-brand text-brand-on font-bold rounded-control hover:bg-brand-hover text-[17px] flex items-center justify-center gap-2.5 active:scale-[0.98] transition-colors disabled:opacity-45 disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand/40"
                        >
                            <Banknote size={22} strokeWidth={2.5} className="shrink-0" />
                            <span className="flex flex-col items-start leading-tight min-w-0">
                                <span className="flex items-center gap-1.5">
                                    EFECTIVO
                                    <kbd className="hidden md:inline text-[10px] font-mono font-normal opacity-70 border border-current/30 rounded px-1">F9</kbd>
                                </span>
                                {cart.length > 0 && (
                                    <span className="text-[13px] font-mono tabular-nums opacity-90">{formatMoney(grandTotal)}</span>
                                )}
                            </span>
                        </button>
                        <button
                            onClick={() => handleCheckout('CREDIT')}
                            title={!currentShift ? 'Abrí la caja para poder cobrar' : undefined}
                            disabled={processing || isCreditBlocked}
                            className={`h-pay font-bold rounded-control text-[17px] flex items-center justify-center gap-2.5 active:scale-[0.98] transition-colors border ${
                                isCreditBlocked
                                    ? 'bg-transparent text-slate-500 cursor-not-allowed border-white/[0.06]'
                                    : 'bg-transparent text-slate-100 border-slate-700 hover:bg-white/[0.04]'
                            }`}
                        >
                            {isCreditBlocked ? <Ban size={22} strokeWidth={2.5} className="shrink-0" /> : <CreditCard size={22} strokeWidth={2.5} className="shrink-0" />}
                            <span className="flex flex-col items-start leading-tight min-w-0">
                                <span>CRÉDITO</span>
                                {cart.length > 0 && !isCreditBlocked && (
                                    <span className="text-[13px] font-mono tabular-nums opacity-90">{formatMoney(grandTotal)}</span>
                                )}
                                {isCreditBlocked && !selectedCustomer && (
                                    <span className="text-[11px] font-normal opacity-80">Elegí un cliente</span>
                                )}
                            </span>
                        </button>
                    </div>}
                    {!guidedSimpleMode && isCreditBlocked && selectedCustomer && (
                        <p className="text-xs text-center text-red-500 font-bold mb-1">Crédito no disponible: límite excedido o cliente bloqueado.</p>
                    )}
                    {!guidedSimpleMode && !currentShift && (
                        <p className="text-xs text-center text-slate-400 mt-2">Podés mirar y armar el carrito; para cobrar hay que abrir la caja.</p>
                    )}
                    {turnoAjeno && (
                        <div className="mt-2 text-center">
                            <p className="text-xs text-slate-400">
                                Esta caja la abrió <span className="text-slate-200 font-semibold">{currentShift?.turnoDe ?? 'otra persona'}</span>.
                                Tomá la caja para cobrar con tu nombre.
                            </p>
                            <button
                                onClick={tomarTurno}
                                disabled={tomandoTurno}
                                className="mt-2 h-touch px-5 rounded-control border border-slate-700 text-slate-100 font-semibold hover:bg-white/[0.04] transition-colors disabled:opacity-45"
                            >
                                {tomandoTurno ? 'Tomando la caja…' : 'Tomar la caja'}
                            </button>
                        </div>
                    )}
                </div>
            </div>

            {/* =============================== */}
            {/* 🔄 RETURNS MODAL                */}
            {/* =============================== */}
            {showReturnModal && (
                <div
                    className="absolute inset-0 z-50 bg-slate-900/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200"
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="return-modal-title"
                >
                    <div className="bg-surface-900 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden border border-white/[0.06] max-h-[90vh] flex flex-col">
                        <div className="bg-gradient-to-r from-amber-500 to-orange-600 px-6 py-4 flex items-center justify-between">
                            <h3 id="return-modal-title" className="text-lg font-bold text-white flex items-center gap-2"><RefreshCw size={20} /> Devolución de Producto</h3>
                            <button onClick={resetReturnFlow} className="text-white/80 hover:text-white" aria-label="Cerrar devolución"><X size={20} /></button>
                        </div>
                        <div className="p-5 flex-1 overflow-y-auto space-y-4">
                            {/* Sale Search */}
                            <div>
                                <label className="text-xs font-bold text-slate-300 mb-1 block">Buscar Venta por ID</label>
                                <form
                                    className="flex gap-2"
                                    onSubmit={(event) => { event.preventDefault(); void searchReturnSale(); }}
                                >
                                    <input
                                        type="text"
                                        placeholder="Ej: clp8..."
                                        className="flex-1 px-3 py-2 border border-white/10 rounded-lg text-sm outline-none focus:border-amber-500 text-slate-100"
                                        value={returnSaleSearch}
                                        onChange={e => setReturnSaleSearch(e.target.value)}
                                    />
                                    <button
                                        type="submit"
                                        disabled={returnSearching || !returnSaleSearch.trim()}
                                        className="px-4 py-2 bg-amber-500 text-white font-bold rounded-lg hover:bg-amber-600 text-sm disabled:opacity-50"
                                        aria-label="Buscar venta"
                                    >
                                        {returnSearching ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
                                    </button>
                                </form>
                                {returnGeneralError && !returnSaleData && <p role="alert" className="mt-2 text-xs text-danger">{returnGeneralError}</p>}
                            </div>

                            {/* Sale Found */}
                            {returnSaleData && (
                                <>
                                    <div className="bg-surface-800/40 rounded-lg p-3 border border-white/[0.06]">
                                        <div className="flex justify-between text-xs mb-1">
                                            <span className="text-slate-500">ID:</span>
                                            <span className="font-mono font-bold text-slate-200">{returnSaleData.id.slice(0, 12)}...</span>
                                        </div>
                                        <div className="flex justify-between text-xs mb-1">
                                            <span className="text-slate-500">Total:</span>
                                            <span className="font-bold text-slate-100">{formatMoney(Number(returnSaleData.total))}</span>
                                        </div>
                                        <div className="flex justify-between text-xs">
                                            <span className="text-slate-500">Método:</span>
                                            <span className="text-slate-200">{returnSaleData.paymentMethod}</span>
                                        </div>
                                    </div>

                                    {/* Una factura YA anulada no ofrece ninguno de los dos
                                        caminos. Devolver sobre ella sumaría el stock por
                                        segunda vez (la anulación ya lo devolvió) — el
                                        backend lo rechaza, pero mostrar el formulario y
                                        recién ahí decir que no es una pérdida de tiempo
                                        con un cliente esperando. */}
                                    {returnSaleData.cancelledAt ? (
                                        <div className="rounded-control border border-danger/30 bg-danger-soft p-3 flex gap-2.5">
                                            <Ban size={16} className="text-danger shrink-0 mt-0.5" />
                                            <div>
                                                <p className="text-[12px] font-bold text-danger">Esta factura está anulada</p>
                                                <p className="text-[11px] text-slate-300 leading-snug mt-1">
                                                    La mercadería ya volvió al inventario y la venta ya no cuenta en los
                                                    reportes. No hay nada que devolver.
                                                </p>
                                            </div>
                                        </div>
                                    ) : (
                                    <>

                                    {/* ── ANULAR LA FACTURA (DGI-5) ─────────────────────
                                        Distinto de devolver: devolver es mercadería que
                                        vuelve de una venta que SÍ ocurrió; anular es
                                        decir que la factura no debió emitirse. Se ofrece
                                        acá porque el cajero ya buscó la factura, pero
                                        separado y en rojo — no es la acción de todos los
                                        días y no debe confundirse con la devolución. */}
                                    {!mostrarAnular ? (
                                        <button
                                            onClick={() => { setMostrarAnular(true); setErrorAnulacion(''); }}
                                            className="w-full text-[12px] text-danger hover:bg-danger-soft rounded-control py-2 transition-colors flex items-center justify-center gap-1.5"
                                        >
                                            <Ban size={14} /> Esta factura no debió emitirse — anularla
                                        </button>
                                    ) : (
                                        <div className="rounded-control border border-danger/30 bg-danger-soft p-3 space-y-2">
                                            <p className="text-[12px] font-bold text-danger flex items-center gap-1.5">
                                                <AlertTriangle size={14} /> Anular la factura completa
                                            </p>
                                            <p className="text-[11px] text-slate-300 leading-snug">
                                                La mercadería vuelve al inventario y la venta deja de contar en los
                                                reportes y en la declaración. El comprobante NO se borra: queda
                                                marcado como anulado y su número no se reutiliza.
                                            </p>
                                            <textarea
                                                value={motivoAnulacion}
                                                onChange={e => setMotivoAnulacion(e.target.value)}
                                                rows={2}
                                                maxLength={500}
                                                placeholder="¿Por qué se anula? (ej: cobro duplicado al mismo cliente)"
                                                aria-label="Motivo de la anulación"
                                                className="w-full text-[12px] bg-surface-900 border border-white/10 rounded-control px-2 py-1.5 text-slate-100 outline-none focus:border-danger placeholder:text-slate-500"
                                            />
                                            {errorAnulacion && (
                                                <p role="alert" className="text-[11px] text-danger font-medium">{errorAnulacion}</p>
                                            )}
                                            <div className="flex gap-2">
                                                <button
                                                    onClick={() => { setMostrarAnular(false); setMotivoAnulacion(''); setErrorAnulacion(''); }}
                                                    className="flex-1 h-touch rounded-control bg-white/[0.06] text-slate-200 text-[12px] font-bold hover:bg-white/[0.12] transition-colors"
                                                >
                                                    Mejor no
                                                </button>
                                                <button
                                                    onClick={anularFactura}
                                                    disabled={anulando || motivoAnulacion.trim().length < 10}
                                                    className="flex-1 h-touch rounded-control bg-danger text-white text-[12px] font-bold hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
                                                >
                                                    {anulando ? <Loader2 size={14} className="animate-spin" /> : <Ban size={14} />}
                                                    Anular factura
                                                </button>
                                            </div>
                                        </div>
                                    )}

                                    {/* Items Selection */}
                                    <div>
                                        <label className="text-xs font-bold text-slate-300 mb-2 block">Seleccionar Items a Devolver</label>
                                        <div className="space-y-2">
                                            {returnItems.map((item) => {
                                                const errorId = `return-error-${item.saleItemId}`;
                                                const exhausted = new Decimal(item.returnableQuantity).lessThanOrEqualTo(0);
                                                const currentQuantity = toDecimal(item.quantityDraft);
                                                return (
                                                    <div key={item.saleItemId} className="bg-surface-800/40 p-3 rounded-lg border border-white/[0.04]">
                                                        <div className="flex items-start justify-between gap-3">
                                                            <div className="flex-1 min-w-0">
                                                                <p className="text-sm font-semibold text-slate-100 truncate">{item.productNameAtSale}</p>
                                                                <p className="mt-0.5 text-[11px] text-slate-400">
                                                                    {item.presentationAtSale === 'PACK'
                                                                        ? `${formatQuantityValue(item.presentationQuantityAtSale)} empaque(s) · ${formatQuantityValue(item.quantity)} ${item.unitAtSale}`
                                                                        : `${formatQuantityValue(item.quantity)} ${item.unitAtSale}`}
                                                                </p>
                                                                {item.measurement && (
                                                                    <p className="mt-0.5 text-[11px] text-sky-300">
                                                                        Medición: {formatQuantityValue(item.measurement.sourceValue)} {item.measurement.sourceUnit}
                                                                    </p>
                                                                )}
                                                                <p className="mt-1 text-[11px] text-slate-400">
                                                                    {formatMoney(Number(item.refundUnitPrice))} / {item.unitAtSale} · Devuelto {formatQuantityValue(item.returnedQuantity)} · Disponible {formatQuantityValue(item.returnableQuantity)}
                                                                </p>
                                                            </div>
                                                            <span className={`shrink-0 rounded px-2 py-0.5 text-[10px] font-bold ${item.presentationAtSale === 'PACK' ? 'bg-violet-500/15 text-violet-300' : 'bg-slate-500/15 text-slate-300'}`}>
                                                                {item.presentationAtSale === 'PACK' ? 'EMPAQUE' : 'BASE'}
                                                            </span>
                                                        </div>

                                                        {exhausted ? (
                                                            <p className="mt-2 text-xs font-medium text-slate-500">Ya fue devuelto por completo.</p>
                                                        ) : (
                                                            <div className="mt-3">
                                                                <div className="flex items-center gap-2">
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => stepReturnQuantity(item, -1)}
                                                                        disabled={currentQuantity.lessThanOrEqualTo(0)}
                                                                        className="w-9 h-9 flex items-center justify-center hover:bg-white/[0.06] rounded-lg text-slate-300 disabled:opacity-30"
                                                                        aria-label={`Restar ${formatQuantityValue(item.quantityStep)} ${item.unitAtSale} de ${item.productNameAtSale}`}
                                                                    ><Minus size={14} /></button>
                                                                    <div className="flex-1">
                                                                        <input
                                                                            type="text"
                                                                            inputMode="decimal"
                                                                            value={item.quantityDraft}
                                                                            onChange={(event) => setReturnQuantity(item.saleItemId, event.target.value)}
                                                                            onBlur={() => {
                                                                                const validation = validateReturnDraft(item);
                                                                                setReturnErrors(previous => {
                                                                                    const next = { ...previous };
                                                                                    if (validation.error) next[item.saleItemId] = validation.error;
                                                                                    else delete next[item.saleItemId];
                                                                                    return next;
                                                                                });
                                                                            }}
                                                                            className="w-full h-9 px-2 rounded-lg border border-white/10 bg-surface-950 text-center text-sm font-bold text-slate-100 outline-none focus:border-amber-500"
                                                                            aria-label={`Cantidad a devolver de ${item.productNameAtSale} en ${item.unitAtSale}`}
                                                                            aria-invalid={!!returnErrors[item.saleItemId] || undefined}
                                                                            aria-describedby={returnErrors[item.saleItemId] ? errorId : undefined}
                                                                        />
                                                                        <p className="mt-1 text-center text-[10px] text-slate-500">Paso {formatQuantityValue(item.quantityStep)} {item.unitAtSale}</p>
                                                                    </div>
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => stepReturnQuantity(item, 1)}
                                                                        disabled={currentQuantity.greaterThanOrEqualTo(new Decimal(item.returnableQuantity))}
                                                                        className="w-9 h-9 flex items-center justify-center hover:bg-white/[0.06] rounded-lg text-slate-300 disabled:opacity-30"
                                                                        aria-label={`Sumar ${formatQuantityValue(item.quantityStep)} ${item.unitAtSale} a ${item.productNameAtSale}`}
                                                                    ><Plus size={14} /></button>
                                                                </div>
                                                                {returnErrors[item.saleItemId] && (
                                                                    <p id={errorId} role="alert" className="mt-1 text-xs text-danger">{returnErrors[item.saleItemId]}</p>
                                                                )}
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>

                                    {/* Reason */}
                                    <div>
                                        <label className="text-xs font-bold text-slate-300 mb-1 block">Motivo</label>
                                        <input
                                            type="text"
                                            placeholder="Ej: Producto defectuoso"
                                            className="w-full px-3 py-2 border border-white/10 rounded-lg text-sm outline-none focus:border-amber-500 text-slate-100"
                                            value={returnReason}
                                            onChange={e => { setReturnReason(e.target.value); setReturnGeneralError(''); }}
                                            onKeyDown={event => {
                                                if (event.key === 'Enter') {
                                                    event.preventDefault();
                                                    void submitReturn();
                                                }
                                            }}
                                            aria-label="Motivo de la devolución"
                                        />
                                    </div>

                                    {returnRequiresRefundMethod && (
                                        <div className="rounded-lg border border-sky-500/20 bg-sky-500/10 p-3">
                                            <label htmlFor="return-refund-method" className="text-xs font-bold text-sky-200 mb-1 block">
                                                Canal del reembolso cobrado
                                            </label>
                                            <p className="mb-2 text-[11px] text-slate-400">
                                                Esta devolución reduce {formatMoney(returnCreditReduction.toNumber())} de la cuenta por cobrar y devuelve {formatMoney(returnSettledRefund.toNumber())} por el canal seleccionado.
                                            </p>
                                            <select
                                                id="return-refund-method"
                                                value={returnRefundMethod}
                                                onChange={(event) => {
                                                    setReturnRefundMethod(event.target.value as ReturnRefundMethod | '');
                                                    setReturnGeneralError('');
                                                }}
                                                className="w-full rounded-lg border border-white/10 bg-surface-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-500"
                                                aria-required="true"
                                            >
                                                <option value="">Seleccioná cómo devolver</option>
                                                {returnSaleData.allowedRefundMethods.map((method) => (
                                                    <option key={method} value={method}>{RETURN_REFUND_METHOD_LABELS[method]}</option>
                                                ))}
                                            </select>
                                        </div>
                                    )}

                                    {/* Confirm */}
                                    <div>
                                        <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3 mb-3">
                                            <div className="flex justify-between font-bold">
                                                <span className="text-amber-300">Total estimado:</span>
                                                <span className="text-amber-400">{formatMoney(returnEstimate.toNumber())}</span>
                                            </div>
                                        </div>
                                        {returnGeneralError && <p role="alert" className="mb-2 text-xs text-danger">{returnGeneralError}</p>}
                                        <button
                                            type="button"
                                            onClick={() => void submitReturn()}
                                            disabled={returnProcessing}
                                            className="w-full py-3 bg-amber-500 text-white font-bold rounded-lg hover:bg-amber-600 disabled:opacity-50 flex items-center justify-center gap-2"
                                        >
                                            {returnProcessing ? <Loader2 size={18} className="animate-spin" /> : <RefreshCw size={18} />}
                                            Confirmar Devolución
                                        </button>
                                    </div>
                                    </>
                                    )}
                                </>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* =============================== */}
            {/* 🔴 CREDIT THERMOMETER PANEL       */}
            {/* =============================== */}
            {showCreditPanel && selectedCustomer && creditInfo && (
                <div className="absolute inset-0 z-50 bg-slate-900/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
                    <div className="bg-surface-900 rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden border border-white/[0.06]">
                        <div className={`px-6 py-4 text-center ${creditInfo.color === 'red' ? 'bg-gradient-to-r from-red-500 to-rose-600' :
                            creditInfo.color === 'yellow' ? 'bg-gradient-to-r from-amber-400 to-orange-500' :
                                'bg-gradient-to-r from-emerald-500 to-green-600'
                            }`}>
                            <h3 className="text-lg font-bold text-white flex items-center justify-center gap-2">
                                {creditInfo.color === 'red' ? '' : creditInfo.color === 'yellow' ? '' : ''} SEMÁFORO DE CRÉDITO
                            </h3>
                        </div>
                        <div className="p-5 space-y-4">
                            <div className="text-center">
                                <p className="text-lg font-bold text-slate-100">{selectedCustomer.name}</p>
                            </div>

                            {/* Current Debt Bar */}
                            <div>
                                <div className="flex justify-between text-xs mb-1">
                                    <span className="text-slate-500">Deuda Actual</span>
                                    <span className="font-bold text-slate-100">{formatMoney(creditInfo.currentDebt)}</span>
                                </div>
                                <div className="w-full bg-white/[0.06] h-3 rounded-full overflow-hidden">
                                    <div className={`h-full rounded-full transition-all duration-500 ${creditInfo.color === 'red' ? 'bg-red-500' : creditInfo.color === 'yellow' ? 'bg-amber-400' : 'bg-emerald-500'
                                        }`} style={{ width: `${Math.min(creditInfo.debtPct, 100)}%` }} />
                                </div>
                                <div className="flex justify-between text-[10px] mt-1">
                                    <span className="text-slate-400">Límite: {formatMoney(creditInfo.limit)}</span>
                                    <span className="font-bold text-slate-300">{Math.round(creditInfo.debtPct)}%</span>
                                </div>
                            </div>

                            {/* Projected */}
                            <div className="bg-surface-800/40 rounded-lg p-3 border border-white/[0.04]">
                                <p className="text-xs text-slate-500 mb-1">Con esta venta (+{formatMoney(grandTotal)}):</p>
                                <div className="flex justify-between">
                                    <span className="text-sm font-bold text-slate-200">Nuevo total:</span>
                                    <span className={`text-sm font-bold ${creditInfo.projectedColor === 'red' ? 'text-red-400' : creditInfo.projectedColor === 'yellow' ? 'text-amber-400' : 'text-emerald-400'}`}>
                                        {formatMoney(creditInfo.projectedDebt)} ({Math.round(creditInfo.projectedPct)}%)
                                    </span>
                                </div>
                            </div>

                            {/* Override PIN */}
                            {isCreditBlocked && !creditOverrideAuthorized && (
                                <div className="bg-red-500/10 border-2 border-red-500/20 rounded-xl p-4 space-y-3">
                                    <p className="text-sm font-bold text-red-400 text-center">CRÉDITO DENEGADO</p>
                                    <p className="text-xs text-red-400 text-center">PIN del Dueño/Gerente requerido para autorizar</p>
                                    <div className="flex justify-center gap-2">
                                        {[0, 1, 2, 3].map(i => (
                                            <input
                                                key={i}
                                                type="password"
                                                inputMode="numeric"
                                                maxLength={1}
                                                className="w-12 h-12 text-center text-xl font-bold border-2 border-red-300 rounded-lg focus:border-red-500 outline-none text-slate-100 bg-surface-900"
                                                value={creditOverridePin[i] || ''}
                                                autoFocus={i === 0}
                                                onChange={(e) => {
                                                    const val = e.target.value.replace(/\D/g, '');
                                                    if (val.length <= 1) {
                                                        const newPin = creditOverridePin.split('');
                                                        newPin[i] = val;
                                                        setCreditOverridePin(newPin.join(''));
                                                        if (val && i < 3) {
                                                            const next = e.target.parentElement?.children[i + 1] as HTMLInputElement;
                                                            next?.focus();
                                                        }
                                                    }
                                                }}
                                            />
                                        ))}
                                    </div>
                                    <button
                                        onClick={handleCreditOverride}
                                        disabled={creditOverridePin.length !== 4}
                                        className="w-full py-2.5 bg-red-600 text-white font-bold rounded-lg hover:bg-red-700 disabled:opacity-50 transition-all flex items-center justify-center gap-2 text-sm"
                                    >
                                        <ShieldAlert size={16} /> Autorizar Override
                                    </button>
                                </div>
                            )}

                            {/* Actions */}
                            <div className="flex gap-2">
                                <button
                                    onClick={() => { setShowCreditPanel(false); setCreditOverridePin(''); }}
                                    className="flex-1 py-2.5 text-slate-300 font-medium hover:bg-surface-800/40 rounded-lg border border-white/[0.06] text-sm"
                                >
                                    Cancelar
                                </button>
                                {(!isCreditBlocked || creditOverrideAuthorized) && (
                                    <button
                                        onClick={() => { setShowCreditPanel(false); handleCheckout('CREDIT'); }}
                                        className="flex-1 py-2.5 bg-nortex-900 text-white font-bold rounded-lg hover:bg-nortex-800 text-sm flex items-center justify-center gap-1"
                                    >
                                        <Check size={16} /> Confirmar Crédito
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* =============================== */}
            {/* POST-SALE SUCCESS MODAL         */}
            {/* =============================== */}
            {showPaymentOptions && (
                <div className="fixed inset-0 z-modal bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={() => setShowPaymentOptions(false)}>
                    <div role="dialog" aria-modal="true" aria-labelledby="payment-title" className="bg-surface-900 border border-white/[0.08] rounded-t-card sm:rounded-card shadow-premium w-full max-w-sm overflow-hidden" onClick={e => e.stopPropagation()}>
                        <div className="px-5 py-4 border-b border-white/[0.06] flex items-start justify-between gap-3">
                            <div>
                                <p className="text-xs font-semibold text-slate-500">Total a cobrar</p>
                                <h2 id="payment-title" className="text-3xl font-extrabold text-slate-100 mt-1 nx-num">{formatMoney(grandTotal)}</h2>
                            </div>
                            <IconButton icon={<X size={16} />} label="Cerrar" onClick={() => setShowPaymentOptions(false)} />
                        </div>
                        <div className="p-4 space-y-2">
                            <p className="text-sm font-semibold text-slate-300 px-1 pb-1">¿Cómo pagó?</p>
                            <button
                                type="button"
                                onClick={() => {
                                    setShowPaymentOptions(false);
                                    setCashReceived('');
                                    setPayingInUSD(false);
                                    setUsdAmount('');
                                    setShowCashPreModal(true);
                                }}
                                className="w-full h-pay px-4 rounded-control bg-brand text-brand-on font-bold flex items-center gap-3 hover:bg-brand-hover transition-colors"
                            >
                                <Banknote size={22} /> Efectivo <ArrowRight size={19} className="ml-auto" />
                            </button>
                            <button
                                type="button"
                                onClick={() => handleCheckout('TRANSFER')}
                                disabled={processing}
                                className="w-full h-pay px-4 rounded-control border border-white/[0.08] text-slate-100 font-bold flex items-center gap-3 hover:bg-white/[0.05] transition-colors disabled:opacity-50"
                            >
                                <QrCode size={21} /> Transferencia <ArrowRight size={19} className="ml-auto text-slate-500" />
                            </button>
                            <button
                                type="button"
                                onClick={() => handleCheckout('CARD')}
                                disabled={processing}
                                className="w-full h-pay px-4 rounded-control border border-white/[0.08] text-slate-100 font-bold flex items-center gap-3 hover:bg-white/[0.05] transition-colors disabled:opacity-50"
                            >
                                <CreditCard size={21} /> Tarjeta <ArrowRight size={19} className="ml-auto text-slate-500" />
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    if (!selectedCustomer) {
                                        setShowPaymentOptions(false);
                                        setShowCustomerPicker(true);
                                        setShowMobileCart(true);
                                        return;
                                    }
                                    handleCheckout('CREDIT');
                                }}
                                disabled={processing || Boolean(selectedCustomer && isCreditBlocked)}
                                className="w-full h-touch px-4 rounded-control text-slate-300 font-semibold flex items-center gap-3 hover:bg-white/[0.04] transition-colors disabled:opacity-45"
                            >
                                <Wallet size={19} /> {selectedCustomer ? 'Fiado' : 'Fiado · elegir cliente'}
                            </button>
                            <p className="text-xs text-slate-500 text-center pt-2">Al elegir un método se registra la venta.</p>
                        </div>
                    </div>
                </div>
            )}
            {/* =============================== */}
            {/* 💵 PRE-SALE CASH MODAL          */}
            {/* =============================== */}
            {showCashPreModal && (
                <div className="fixed inset-0 z-modal bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-200" onClick={() => setShowCashPreModal(false)}>
                    <div className="bg-surface-900 rounded-t-card sm:rounded-card shadow-premium w-full max-w-sm overflow-hidden border border-white/[0.08]" onClick={e => e.stopPropagation()}>
                        <div className="p-5 border-b border-white/[0.06] flex items-center gap-3">
                            <div className="w-10 h-10 rounded-pill bg-brand-soft text-brand flex items-center justify-center"><Banknote size={20} /></div>
                            <div>
                                <h2 className="text-base font-bold text-slate-100">Efectivo</h2>
                                <p className="text-2xl font-extrabold text-slate-100 mt-0.5 nx-num">{formatMoney(grandTotal)}</p>
                            </div>
                            <IconButton icon={<X size={16} />} label="Cerrar" onClick={() => setShowCashPreModal(false)} className="ml-auto" />
                        </div>
                        <div className="p-5 space-y-4">
                            {/* USD toggle */}
                            <div className="flex items-center justify-between">
                                <label className="text-xs text-slate-500 font-semibold">Efectivo recibido</label>
                                <button
                                    onClick={() => { setPayingInUSD(!payingInUSD); setUsdAmount(''); setCashReceived(''); }}
                                    className={`text-[10px] font-bold px-2 py-1 rounded-full border transition-all ${payingInUSD ? 'bg-blue-500 text-white border-blue-500' : 'bg-white/[0.04] text-slate-500 border-white/[0.06] hover:border-blue-300'}`}
                                >
                                    {payingInUSD ? 'USD' : '¿Paga en USD?'}
                                </button>
                            </div>

                            {payingInUSD ? (
                                <div className="space-y-2">
                                    <div className="relative">
                                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-blue-500 font-bold text-sm">$</span>
                                        <input
                                            type="text"
                                            inputMode="decimal"
                                            autoFocus
                                            aria-label="Monto recibido en dólares"
                                            className="w-full pl-8 pr-4 py-3 border border-blue-300 rounded-lg text-xl font-bold text-slate-100 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 bg-blue-500/10 font-mono tabular-nums"
                                            placeholder="0.00"
                                            value={usdAmount}
                                            onChange={e => {
                                                const s = sanitizeDecimalInput(e.target.value);
                                                setUsdAmount(s);
                                                setCashReceived(s === '' ? '' : toDecimal(s).mul(exchangeRate).toFixed(2));
                                            }}
                                        />
                                    </div>
                                    <div className="text-xs text-blue-400 text-center font-medium">Tasa: 1 USD = {formatMoney(exchangeRate)} NIO</div>
                                    {toDecimal(usdAmount).greaterThan(0) && (
                                        <div className="bg-blue-500/10 px-3 py-2 rounded-lg border border-blue-500/20 text-sm">
                                            <div className="flex justify-between"><span className="text-blue-400">Equivalente NIO:</span><span className="font-bold text-blue-300 font-mono tabular-nums">{formatMoney(toDecimal(usdAmount).mul(exchangeRate))}</span></div>
                                            {toDecimal(usdAmount).mul(exchangeRate).greaterThanOrEqualTo(grandTotal) && (
                                                <>
                                                    <div className="flex justify-between mt-1 pt-1 border-t border-blue-500/20"><span className="font-bold text-emerald-400">Cambio NIO:</span><span className="font-bold text-emerald-400 font-mono tabular-nums">{formatMoney(toDecimal(usdAmount).mul(exchangeRate).minus(grandTotal))}</span></div>
                                                    <div className="flex justify-between mt-0.5"><span className="text-emerald-500 text-xs">Cambio USD:</span><span className="font-bold text-brand text-xs nx-num">{formatUSD(toDecimal(usdAmount).minus(toDecimal(grandTotal).div(exchangeRate)))}</span></div>
                                                </>
                                            )}
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <>
                                    {/* Denominaciones derivadas del total (nunca fijas):
                                        ver `denominacionesSugeridas` — ninguna puede
                                        resultar en un pago menor al total. */}
                                    <div className="flex gap-2 flex-wrap">
                                        {/* P1-5/P1-2 — El estilo del chip se DERIVA de lo
                                            que hay escrito. Antes el verde de "Monto exacto"
                                            estaba hardcodeado: al tocar C$500 el input pasaba
                                            a 500 y el cambio salía bien, pero "Monto exacto"
                                            seguía resaltado y C$500 apagado — la pantalla
                                            mentía sobre lo que estaba seleccionado.
                                            El activo se distingue por BORDE además de color:
                                            no se depende solo del color para decir cuál es. */}
                                        <button
                                            type="button"
                                            onClick={() => setCashReceived(grandTotalD.toFixed(2))}
                                            aria-pressed={chipActivo(grandTotalD)}
                                            className={`flex-shrink-0 px-3 py-1.5 font-bold rounded-control text-xs border transition-colors ${chipActivo(grandTotalD)
                                                ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500 hover:bg-emerald-500/25'
                                                : 'bg-white/[0.04] text-slate-200 border-white/[0.06] hover:bg-white/[0.06]'}`}
                                        >
                                            Monto exacto
                                        </button>
                                        {denominacionesSugeridas(grandTotalD).map(monto => (
                                            <button
                                                key={monto.toFixed(2)}
                                                type="button"
                                                onClick={() => setCashReceived(monto.toFixed(2))}
                                                aria-pressed={chipActivo(monto)}
                                                className={`flex-shrink-0 px-3 py-1.5 font-bold rounded-control text-xs border transition-colors ${chipActivo(monto)
                                                    ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500 hover:bg-emerald-500/25'
                                                    : 'bg-white/[0.04] text-slate-200 border-white/[0.06] hover:bg-white/[0.06]'}`}
                                            >
                                                {formatMoney(monto, 'NIO', { decimals: 0 })}
                                            </button>
                                        ))}
                                    </div>
                                    <div className="relative">
                                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-sm">C$</span>
                                        <input
                                            type="text"
                                            inputMode="decimal"
                                            autoFocus
                                            aria-label="Efectivo recibido en córdobas"
                                            className="w-full pl-10 pr-4 py-3 border border-white/10 rounded-lg text-xl font-bold text-slate-100 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/30 font-mono tabular-nums"
                                            placeholder={grandTotal.toFixed(2)}
                                            value={cashReceived}
                                            onChange={e => setCashReceived(sanitizeDecimalInput(e.target.value))}
                                        />
                                    </div>
                                    <div className="grid grid-cols-3 gap-1.5">
                                        {['7', '8', '9', '4', '5', '6', '1', '2', '3', '.', '0', '00'].map(key => (
                                            <button
                                                key={key}
                                                type="button"
                                                onClick={() => teclaEfectivo(key)}
                                                className="h-14 rounded-control bg-white/[0.04] hover:bg-white/[0.10] text-slate-100 text-xl font-bold font-mono tabular-nums transition-colors active:scale-[0.97]"
                                            >
                                                {key}
                                            </button>
                                        ))}
                                        <button
                                            type="button"
                                            onClick={() => teclaEfectivo('BORRAR')}
                                            aria-label="Borrar el último dígito"
                                            className="h-14 rounded-control bg-white/[0.04] hover:bg-white/[0.10] text-slate-300 font-bold transition-colors active:scale-[0.97] flex items-center justify-center"
                                        >
                                            <ArrowRight size={20} className="rotate-180" />
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => teclaEfectivo('LIMPIAR')}
                                            className="h-14 col-span-2 rounded-control bg-white/[0.04] hover:bg-white/[0.10] text-slate-300 font-bold transition-colors active:scale-[0.97]"
                                        >
                                            Limpiar
                                        </button>
                                    </div>
                                    {cashReceived !== '' && toDecimal(cashReceived).greaterThanOrEqualTo(grandTotal) && (
                                        <div className="bg-emerald-500/10 px-4 py-3 rounded-control border border-emerald-500/20 text-center">
                                            <p className="text-xs font-bold text-emerald-400 uppercase tracking-widest">Vuelto</p>
                                            <p className="text-5xl font-black text-emerald-400 font-mono tabular-nums leading-none mt-1">
                                                {formatMoney(toDecimal(cashReceived).minus(grandTotal))}
                                            </p>
                                        </div>
                                    )}
                                    {cashReceived !== '' && toDecimal(cashReceived).lessThan(grandTotal) && (
                                        <div className="bg-red-500/10 px-4 py-3 rounded-control border border-red-500/20 text-center">
                                            <p className="text-xs font-bold text-red-400 uppercase tracking-widest">Falta</p>
                                            <p className="text-3xl font-black text-red-400 font-mono tabular-nums leading-none mt-1">
                                                {formatMoney(toDecimal(grandTotal).minus(toDecimal(cashReceived)))}
                                            </p>
                                        </div>
                                    )}
                                </>
                            )}

                            <div className="flex gap-3 pt-1">
                                <button
                                    onClick={() => setShowCashPreModal(false)}
                                    className="flex-1 py-3 rounded-xl border border-white/[0.06] text-slate-300 font-bold hover:bg-surface-800/40 transition-colors"
                                >
                                    Cancelar
                                </button>
                                <button
                                    onClick={() => { setShowCashPreModal(false); handleCheckout('CASH'); }}
                                    disabled={processing}
                                    className="flex-1 h-touch rounded-control bg-brand text-brand-on font-bold hover:bg-brand-hover transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                                >
                                    {processing ? <Loader2 size={18} className="animate-spin" /> : <Check size={18} />}
                                    Cobrar {formatMoney(grandTotal)}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {completedSale && (
                <div className="fixed inset-0 z-modal bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
                    <div className="bg-surface-900 rounded-card shadow-premium w-full max-w-md overflow-hidden border border-white/[0.08]">

                        {/* Header - Success */}
                        <div className="p-6 text-center border-b border-white/[0.06]">
                            <div className="w-14 h-14 bg-brand-soft border border-brand/20 rounded-pill flex items-center justify-center mx-auto mb-3">
                                <Check size={30} className="text-brand" />
                            </div>
                            <h2 className="text-xl font-bold text-slate-100">Venta lista</h2>
                            <p className="text-slate-500 text-sm mt-1">{completedSale.date}</p>
                        </div>

                        {/* Sale Summary */}
                        <div className="p-6">
                            {/* EL VUELTO PRIMERO Y MÁS GRANDE: es el único número que
                                el cajero necesita en este instante, con el cliente
                                enfrente esperando. Antes ni aparecía (el efectivo
                                recibido se limpiaba al cerrar la venta). */}
                            {vueltoDeLaVenta && (
                                <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-card p-4 mb-4 text-center">
                                    <p className="text-xs font-bold text-emerald-400 uppercase tracking-widest">Vuelto para el cliente</p>
                                    <p className="text-5xl font-black text-emerald-400 font-mono tabular-nums mt-1 leading-none">
                                        {formatMoney(vueltoDeLaVenta.vuelto)}
                                    </p>
                                    {vueltoDeLaVenta.vueltoUsd && (
                                        <p className="text-xs text-emerald-300 mt-1">Equivale a {formatUSD(vueltoDeLaVenta.vueltoUsd)}</p>
                                    )}
                                    <p className="text-[11px] text-slate-400 mt-2">
                                        Recibiste {vueltoDeLaVenta.recibidoUsd
                                            ? `${formatUSD(vueltoDeLaVenta.recibidoUsd)} (${formatMoney(vueltoDeLaVenta.recibido)})`
                                            : formatMoney(vueltoDeLaVenta.recibido)} · Total {formatMoney(completedSale.grandTotal)}
                                    </p>
                                </div>
                            )}

                            <div className="bg-surface-800/40 rounded-xl p-4 mb-4 border border-white/[0.04]">
                                <div className="flex justify-between items-center mb-2">
                                    <span className="text-sm text-slate-500">Cliente</span>
                                    <span className="font-bold text-slate-100">{completedSale.customerName}</span>
                                </div>
                                <div className="flex justify-between items-center mb-2">
                                    <span className="text-sm text-slate-500">Método</span>
                                    <span className="font-medium text-slate-200">
                                        {completedSale.paymentMethod === 'CASH' ? 'Efectivo' :
                                            completedSale.paymentMethod === 'CREDIT' ? 'Crédito' :
                                                completedSale.paymentMethod === 'CARD' ? 'Tarjeta' :
                                                    completedSale.paymentMethod === 'TRANSFER' ? 'Transferencia' : completedSale.paymentMethod}
                                    </span>
                                </div>
                                <div className="border-t border-white/[0.06] pt-2 mt-2">
                                    <div className="flex justify-between items-center">
                                        <span className="text-lg font-bold text-slate-100">Total Cobrado</span>
                                        <span className="text-2xl font-bold text-slate-100 nx-num">{formatMoney(completedSale.grandTotal)}</span>
                                    </div>
                                </div>

                                {/* Efectivo recibido sin vuelto (pago justo): el detalle
                                    igual queda a la vista para cuadrar la gaveta. */}
                                {completedSale.paymentMethod === 'CASH' && !vueltoDeLaVenta && efectivoRecibidoDeLaVenta && (
                                    <div className="mt-3 pt-3 border-t border-white/[0.06] flex justify-between items-center">
                                        <span className="text-sm text-slate-500">Efectivo recibido</span>
                                        <span className="font-bold text-slate-200 font-mono tabular-nums">{formatMoney(efectivoRecibidoDeLaVenta)}</span>
                                    </div>
                                )}
                            </div>

                            {pulso && (
                                <div className={`rounded-xl p-4 mb-4 border ${pulso.esRecordHoy ? 'bg-amber-500/10 border-amber-500/25' : 'bg-surface-800/40 border-white/[0.04]'}`}>
                                    <div className="flex items-baseline justify-between">
                                        <span className="text-xs font-bold text-slate-500 uppercase tracking-widest">Hoy llevás</span>
                                        <span className="text-xs text-slate-500">{pulso.ventasHoy} {pulso.ventasHoy === 1 ? 'venta' : 'ventas'}</span>
                                    </div>
                                    <p className="text-3xl font-black text-slate-100 nx-num mt-1">{formatMoney(pulso.totalHoy)}</p>
                                    {pulso.metaDiaria && (() => {
                                        const progress = Math.min(100, toDecimal(pulso.totalHoy).div(toDecimal(pulso.metaDiaria)).mul(100).toNumber());
                                        const complete = progress >= 100;
                                        return (
                                            <div className="mt-2">
                                                <div className="h-2 rounded-full bg-white/10 overflow-hidden">
                                                    <div
                                                        className={`h-full transition-all duration-700 ${complete ? 'bg-amber-400' : 'bg-emerald-500'}`}
                                                        style={{ width: `${progress}%` }}
                                                    />
                                                </div>
                                                <p className="text-[11px] text-slate-400 mt-1">
                                                    {complete
                                                        ? <>🎯 ¡Meta del día cumplida! ({formatMoney(pulso.metaDiaria)})</>
                                                        : <>Meta del día: {formatMoney(pulso.metaDiaria)} · vas al {Math.round(progress)}%</>}
                                                </p>
                                            </div>
                                        );
                                    })()}
                                    {pulso.esRecordHoy && (
                                        <p className="text-sm font-bold text-amber-400 mt-2">🏆 ¡Hoy es tu mejor día del último mes!</p>
                                    )}
                                    {pulso.racha >= 2 && (
                                        <p className="text-[11px] text-slate-400 mt-1.5">🔥 {pulso.racha} días seguidos vendiendo — no cortés la racha</p>
                                    )}
                                </div>
                            )}

                            <button
                                onClick={handleNewSale}
                                className="w-full h-pay bg-brand text-brand-on font-bold rounded-control hover:bg-brand-hover transition-colors flex items-center justify-center gap-2"
                            >
                                <RotateCcw size={18} /> Hacer otra venta
                            </button>

                            <div className={`grid gap-2 mt-3 ${postSalePrintOptions.length > 2 ? 'grid-cols-1' : 'grid-cols-2'}`}>
                                <button
                                    onClick={handleWhatsApp}
                                    className="h-touch flex items-center justify-center gap-2 border border-white/[0.08] text-slate-200 font-semibold rounded-control hover:bg-white/[0.05] transition-colors text-sm"
                                >
                                    <MessageCircle size={18} /> WhatsApp
                                </button>
                                <button
                                    onClick={handlePrintTicket}
                                    className="h-touch flex items-center justify-center gap-2 border border-white/[0.08] text-slate-200 font-semibold rounded-control hover:bg-white/[0.05] transition-colors text-sm"
                                >
                                    <Printer size={18} /> {postSalePrintOptions[0]?.label ?? 'Ticket 80 mm'}
                                </button>
                                {postSalePrintOptions.some(option => option.id === 'thermal') && (
                                    <button
                                        onClick={handleDirectThermalPrint}
                                        className="h-touch flex items-center justify-center gap-2 border border-brand/20 bg-brand/10 text-brand font-semibold rounded-control hover:bg-brand/15 transition-colors text-sm col-span-full"
                                    >
                                        <Printer size={18} /> Enviar a tiquetera
                                    </button>
                                )}
                            </div>
                            <button
                                onClick={handlePrintA4}
                                className="w-full h-touch mt-1 text-sm text-slate-400 font-semibold hover:text-slate-200 flex items-center justify-center gap-2"
                            >
                                <FileText size={17} /> Ver factura A4
                            </button>
                        </div>
                    </div>
                </div>
            )}
            {/* HIDDEN RECEIPT COMPONENT FOR PRINTING */}
            <ReceiptTicket data={completedSale ? {
                tenantName: tenantPrintDetails.tenantName,
                ruc: tenantPrintDetails.ruc,
                address: tenantPrintDetails.address,
                phone: tenantPrintDetails.phone,
                dgiAuthCode: tenantPrintDetails.dgiAuthCode,
                date: completedSale.date,
                saleId: completedSale.saleId,
                invoiceNumber: completedSale.invoiceNumber,
                invoiceSeries: completedSale.invoiceSeries,
                customerName: completedSale.customerName,
                items: completedSale.items,
                subtotal: completedSale.subtotal,
                discount: completedSale.discount,
                tax: completedSale.tax,
                total: completedSale.grandTotal,
                paymentMethod: completedSale.paymentMethod,
                // Solo si hubo vuelto real (efectivo > total): el ticket no
                // imprime un vuelto inventado en pagos justos ni a crédito.
                cashReceived: vueltoDeLaVenta ? Number(vueltoDeLaVenta.recibido.toFixed(2)) : undefined,
                change: vueltoDeLaVenta ? Number(vueltoDeLaVenta.vuelto.toFixed(2)) : undefined,
                user: currentShift?.employee ? `${currentShift.employee.firstName} ${currentShift.employee.lastName}` : 'Cajero',
            } : null} />

            {/* SCAN FEEDBACK TOAST */}
            {lastScanFeedback && (
                <div className={`fixed bottom-24 left-1/2 -translate-x-1/2 px-6 py-3 rounded-full font-bold shadow-2xl z-50 animate-in slide-in-from-bottom-5 ${lastScanFeedback.type === 'success' ? 'bg-emerald-500 text-white' : 'bg-red-500 text-white'}`}>
                    {lastScanFeedback.message}
                </div>
            )}
        </div>
    );
};

export default POS;
