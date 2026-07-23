import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { MOCK_PRODUCTS } from '../constants';
import { Product, CartItem, Shift, CashMovement } from '../types';
import { effectiveTier, effectiveUnitPrice } from '../utils/pricing';
import { ArrowDownCircle, ArrowUpCircle, ShoppingCart, Plus, Minus, Trash2, Search, CreditCard, Banknote, QrCode, Tag, PackagePlus, Package, X, Save, User, Clock, Lock, ArrowRight, AlertTriangle, DollarSign, Check, Loader2, Ban, ShieldAlert, MessageCircle, Printer, FileText, RotateCcw, Zap, Upload, ScanBarcode, Volume2, VolumeX, Wallet, ParkingCircle, Keyboard, Percent, RefreshCw, WifiOff, Landmark } from 'lucide-react';
import { printTicket, printA4, sendToWhatsApp, InvoiceData } from './InvoiceTemplate';
import { maybeAutostartTour } from '../utils/tours';
import { resolveUiMode, UI_MODE_KEY } from '../utils/navigation';
import { ReceiptTicket } from './ReceiptTicket';
import { thermalPrinter } from '../utils/thermalPrinter';
import * as XLSX from 'xlsx';
import { db, generateOfflineId, saveSaleOffline, getPendingSales, markSalesSynced } from '../lib/db';
import Decimal from 'decimal.js';

// ── Utilidades financieras del POS (string controlado + Decimal.js) ──────────
// CartItem no modela discount/unit; se anotan en runtime → tipo local (sin `any`).
// basePrice preserva el precio de DETALLE original de la línea: item.price es el
// precio cobrado (puede pasar a mayoreo y volver al bajar la cantidad).
type CartLine = CartItem & { discount?: number; unit?: string; basePrice?: number };

// ── Venta por mayor: la regla de precios vive en utils/pricing.ts (pura,
// testeada en tests/pricing.test.ts e importable por cualquier canal). ─────────
// Etiqueta del nivel activo de una línea (para el badge del carrito).
const lineTierBadge = (item: CartLine, wholesaleCustomer: boolean): string | null => {
    const base = item.basePrice ?? item.price;
    const { kind } = effectiveTier(
        { basePrice: base, wholesalePrice: item.wholesalePrice, wholesaleMinQty: item.wholesaleMinQty, packSize: item.packSize, packPrice: item.packPrice },
        item.quantity,
        wholesaleCustomer
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
}> = ({ value, onCommit, className, placeholder, ariaLabel, allowZero }) => {
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
}

// Post-sale state
interface CompletedSale {
    items: CartItem[];
    subtotal: number;
    tax: number;
    grandTotal: number;
    paymentMethod: string;
    customerName: string;
    customerPhone?: string;
    saleId?: string;
    date: string;
    invoiceNumber?: number;
    invoiceSeries?: string;
}

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
    const [products, setProducts] = useState<Product[]>(MOCK_PRODUCTS);
    const [cart, setCart] = useState<CartItem[]>([]);

    // 🅿️ PARQUEO DE VENTAS STATE
    const [heldCarts, setHeldCarts] = useState<HeldCart[]>([]);
    const [showHeldCarts, setShowHeldCarts] = useState(false);

    // ── Modo simple (Fase C-2 UX): esconde acciones avanzadas del POS ──
    // Mismo criterio que el menú (utils/navigation.ts); se lee una vez al montar.
    const [simpleMode] = useState<boolean>(() => {
        try {
            const type = JSON.parse(localStorage.getItem('nortex_user') || '{}')?.tenant?.type || '';
            return resolveUiMode(type, localStorage.getItem(UI_MODE_KEY)) === 'simple';
        } catch { return false; }
    });
    // Solo Dueño/Admin ven el hint del PIN inicial en la apertura de caja.
    const [isOwnerAdmin] = useState<boolean>(() => {
        try {
            const role = JSON.parse(atob((localStorage.getItem('nortex_token') || '').split('.')[1])).role || '';
            return ['OWNER', 'ADMIN', 'SUPER_ADMIN'].includes(role);
        } catch { return false; }
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
    const [showOpenShift, setShowOpenShift] = useState(false);
    const [showCloseShift, setShowCloseShift] = useState(false);
    const [initialCash, setInitialCash] = useState('');
    const [employeePin, setEmployeePin] = useState('');
    const [declaredCash, setDeclaredCash] = useState('');
    // Fase D: dólares contados al cierre (solo se manda si hay algo que declarar)
    const [declaredCashUsd, setDeclaredCashUsd] = useState('');
    const [shiftReport, setShiftReport] = useState<{ expected: number, diff: number } | null>(null);
    const [shiftLoading, setShiftLoading] = useState(true);

    // UI State
    const [showMobileCart, setShowMobileCart] = useState(false);

    // 🔄 RETURNS STATE
    const [showReturnModal, setShowReturnModal] = useState(false);
    const [returnSaleSearch, setReturnSaleSearch] = useState('');
    const [returnSaleData, setReturnSaleData] = useState<any>(null);
    const [returnItems, setReturnItems] = useState<{ productId: string, name: string, quantity: number, price: number, maxQty: number }[]>([]);
    const [returnReason, setReturnReason] = useState('');
    const [returnProcessing, setReturnProcessing] = useState(false);

    // POST-SALE MODAL STATE
    const [completedSale, setCompletedSale] = useState<CompletedSale | null>(null);
    const [cashReceived, setCashReceived] = useState('');

    // PRE-SALE CASH MODAL STATE
    const [showCashPreModal, setShowCashPreModal] = useState(false);

    // BARCODE SCANNER STATE
    const [scannerActive, setScannerActive] = useState(true);
    const [lastScanFeedback, setLastScanFeedback] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
    const scanBufferRef = useRef('');
    const scanTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const scanTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const searchRef = useRef<HTMLInputElement>(null);

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
    // 🏦 Agente bancario (corresponsalía): el negocio es Agente Banpro/Rapibac/etc.
    const [showAgentModal, setShowAgentModal] = useState(false);
    const [agentAgreements, setAgentAgreements] = useState<any[]>([]);
    const [agentData, setAgentData] = useState({ agreementId: '', operation: 'DEPOSITO', amount: '', commission: '', externalRef: '', customerRef: '', currency: 'NIO', exchangeRate: localStorage.getItem('nortex_tc_usd') || '36.62' });
    const [agentLoading, setAgentLoading] = useState(false);
    const [newAgreementName, setNewAgreementName] = useState('');
    const [newAgreementKind, setNewAgreementKind] = useState('BANCO');
    const [cashBalance, setCashBalance] = useState<number | null>(null);
    const [cashMovements, setCashMovements] = useState<CashMovement[]>([]);
    const [showMovementsList, setShowMovementsList] = useState(false);

    // ==========================================
    // OFFLINE / PWA STATE
    // ==========================================
    const [isOnline, setIsOnline] = useState(navigator.onLine);
    const [pendingOfflineCount, setPendingOfflineCount] = useState(0);
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
                }));
                setProducts(mapped);
            }
        } catch (e) {
            console.error('Error fetching products:', e);
        }
    }, [headers]);

    // ==========================================
    // OFFLINE SYNC ENGINE
    // ==========================================
    const syncOfflineSales = useCallback(async () => {
        const pending = await getPendingSales();
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
                const syncedIds = result.results
                    .filter((r: any) => r.status === 'created' || r.status === 'skipped')
                    .map((r: any) => r.offlineId);
                await markSalesSynced(syncedIds);
                setPendingOfflineCount(0);
                fetchProducts();
            }
        } catch (e) {
            // Se intentará de nuevo cuando vuelva internet
        } finally {
            setSyncingOffline(false);
        }
    }, []);

    const refreshOfflineCount = useCallback(async () => {
        const pending = await getPendingSales();
        setPendingOfflineCount(pending.length);
    }, []);

    // B6 — cargar el tipo de cambio vigente del tenant (BCN/manual).
    useEffect(() => {
        const t = localStorage.getItem('nortex_token');
        if (!t) return;
        fetch('/api/accounting/exchange-rate/latest', { headers: { Authorization: `Bearer ${t}` } })
            .then(r => r.ok ? r.json() : null)
            .then(d => { if (d && typeof d.rate === 'number' && d.rate > 0) setExchangeRate(d.rate); })
            .catch(() => { /* mantiene el fallback */ });
    }, []);

    // Tutorial guiado: si entran con ?tour=pos (desde Ayuda o el checklist).
    useEffect(() => { maybeAutostartTour(); }, []);

    useEffect(() => {
        refreshOfflineCount();
        const handleOnline = () => {
            setIsOnline(true);
            syncOfflineSales();
        };
        const handleOffline = () => setIsOnline(false);
        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);
        return () => {
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
        };
    }, [syncOfflineSales, refreshOfflineCount]);

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
                    setShowOpenShift(true);
                }
            } catch (e) {
                console.error("Failed to check shift", e);
                setCurrentShift(null);
                setShowOpenShift(true);
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
                    setCart(JSON.parse(pendingCart));
                    localStorage.removeItem('nortex_pending_cart');
                    if (!hasOpenShift) alert("¡Bienvenido! Abre tu caja para completar la venta de la demo o cotización.");
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
    }, []);

    // ==========================================
    // 💰 CASH MOVEMENT FUNCTIONS
    // ==========================================
    const fetchCashBalance = useCallback(async () => {
        try {
            const res = await fetch('/api/cash-movements/balance', { headers });
            if (res.ok) {
                const data = await res.json();
                if (data.hasOpenShift) setCashBalance(data.balance);
            }
        } catch (e) { /* silently fail */ }
    }, [headers]);

    const fetchCashMovements = useCallback(async () => {
        try {
            const res = await fetch('/api/cash-movements', { headers });
            if (res.ok) {
                setCashMovements(await res.json());
            }
        } catch (e) { /* silently fail */ }
    }, [headers]);

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
        if (!showCashModal || !cashAmount || !cashCategory || !cashDescription) return;
        setCashMovementLoading(true);

        try {
            const res = await fetch('/api/cash-movements', {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    type: showCashModal,
                    amount: parseFloat(cashAmount),
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
            fetchCashBalance();
            fetchCashMovements();
        } catch (error: any) {
            alert(error.message);
        } finally {
            setCashMovementLoading(false);
        }
    };

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

    // ==========================================
    // BARCODE SCANNER (Global keydown listener)
    // ==========================================
    useEffect(() => {
        if (!scannerActive) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            // Ignore if typing in an input/textarea (except for Enter to submit scan)
            const target = e.target as HTMLElement;
            const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT';

            // Scanners send characters rapidly then Enter
            if (e.key === 'Enter') {
                const code = scanBufferRef.current.trim();
                if (code.length >= 3) {
                    e.preventDefault();
                    e.stopPropagation();
                    handleBarcodeScan(code);
                }
                scanBufferRef.current = '';
                if (scanTimerRef.current) clearTimeout(scanTimerRef.current);
                return;
            }

            // Don't capture if user is focused on a form input
            if (isInput) return;

            // Accumulate characters - scanners type very fast
            if (e.key.length === 1) {
                scanBufferRef.current += e.key;

                // Reset buffer after 100ms of no input (human typing is slower)
                if (scanTimerRef.current) clearTimeout(scanTimerRef.current);
                scanTimerRef.current = setTimeout(() => {
                    scanBufferRef.current = '';
                }, 100);
            }
        };

        window.addEventListener('keydown', handleKeyDown, true);
        return () => {
            window.removeEventListener('keydown', handleKeyDown, true);
            if (scanTimerRef.current) clearTimeout(scanTimerRef.current);
        };
    }, [scannerActive, products, cart]);

    const handleBarcodeScan = useCallback((code: string) => {
        const upperCode = code.toUpperCase();
        const found = products.find(p => p.sku.toUpperCase() === upperCode);

        if (found) {
            addToCart(found);
            playBeep();
            setLastScanFeedback({ message: `+ ${found.name}`, type: 'success' });
        } else {
            playErrorBeep();
            setLastScanFeedback({ message: `SKU "${code}" no encontrado`, type: 'error' });
        }

        // Clear feedback after 2 seconds
        setTimeout(() => setLastScanFeedback(null), 2000);
    }, [products]);

    // --- SHIFT LOGIC (API) ---
    const handleOpenShift = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!initialCash || !employeePin) return;
        if (!/^\d{4}$/.test(employeePin)) {
            alert('El PIN debe ser exactamente 4 digitos.');
            return;
        }
        setShiftLoading(true);

        try {
            const token = localStorage.getItem('nortex_token');
            const res = await fetch('/api/shifts/open', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ initialCash: parseFloat(initialCash), employeePin })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error);
            setCurrentShift(data);
            setShowOpenShift(false);
            setEmployeePin('');
        } catch (error: any) { alert(error.message); }
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

    const addToCart = useCallback((product: Product) => {
        if (!currentShift) { setShowOpenShift(true); return; }
        const wholesaleCustomer = Boolean(selectedCustomer?.isWholesale);
        setCart(prev => {
            const existing = prev.find(item => item.id === product.id) as CartLine | undefined;
            if (existing) {
                return prev.map(item => {
                    if (item.id !== product.id) return item;
                    const line = item as CartLine;
                    const newQty = item.quantity + 1;
                    const base = line.basePrice ?? item.price;
                    return { ...item, quantity: newQty, basePrice: base, price: effectiveUnitPrice({ basePrice: base, wholesalePrice: line.wholesalePrice, wholesaleMinQty: line.wholesaleMinQty, packSize: line.packSize, packPrice: line.packPrice }, newQty, wholesaleCustomer) };
                });
            }
            const price = effectiveUnitPrice({ basePrice: product.price, wholesalePrice: product.wholesalePrice, wholesaleMinQty: product.wholesaleMinQty, packSize: product.packSize, packPrice: product.packPrice }, 1, wholesaleCustomer);
            return [...prev, { ...product, quantity: 1, basePrice: product.price, price }];
        });
    }, [currentShift, selectedCustomer]);

    // GLOBAL SCANNER LISTENER (Independent of focus)
    // Moved here to strictly follow React ordering (addToCart must be defined)
    useEffect(() => {
        if (!scannerActive) return;

        const handleKv = (e: KeyboardEvent) => {
            // Ignore if user is typing in a real input field except the search bar itself
            const target = e.target as HTMLElement;
            if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') {
                return;
            }

            // Global auto-focus on the search bar for friction-less typing/scanning
            if (searchRef.current && document.activeElement !== searchRef.current) {
                // Don't focus on Control keys, Shift, etc.
                if (e.key.length === 1) {
                    searchRef.current.focus();
                }
            }

            const char = e.key;
            // Scanner sends 'Enter' at the end
            if (char === 'Enter') {
                const code = scanBufferRef.current.trim(); // Trim whitespace
                if (code.length >= 2) { // Allow shorter codes if needed, but usually >2
                    // Try to find product (case insensitive)
                    const found = products.find(p => p.sku.toUpperCase() === code.toUpperCase());

                    if (found) {
                        addToCart(found);
                        playBeep();
                        setLastScanFeedback({ message: `Escaneado: ${found.name}`, type: 'success' });
                    } else {
                        playErrorBeep();
                        setLastScanFeedback({ message: `NO ENCONTRADO: ${code}`, type: 'error' });
                    }
                    setTimeout(() => setLastScanFeedback(null), 3000);
                }
                scanBufferRef.current = '';
            } else if (char.length === 1) {
                // Buffer char
                scanBufferRef.current += char;
                // Clear buffer if typing too slow (human typing vs scanner machinegun)
                if (scanTimeoutRef.current) clearTimeout(scanTimeoutRef.current);
                scanTimeoutRef.current = setTimeout(() => {
                    scanBufferRef.current = '';
                }, 100); // 100ms tolerance
            }
        };

        window.addEventListener('keydown', handleKv);
        return () => window.removeEventListener('keydown', handleKv);
    }, [products, addToCart, scannerActive]);

    const removeFromCart = (id: string) => setCart(prev => prev.filter(item => item.id !== id));

    // Reprecia una línea al cambiar su cantidad (mayoreo entra/sale según el umbral).
    const repricedLine = (item: CartItem, newQty: number): CartItem => {
        const line = item as CartLine;
        const base = line.basePrice ?? item.price;
        const price = effectiveUnitPrice(
            { basePrice: base, wholesalePrice: line.wholesalePrice, wholesaleMinQty: line.wholesaleMinQty, packSize: line.packSize, packPrice: line.packPrice },
            newQty,
            Boolean(selectedCustomer?.isWholesale)
        );
        return { ...item, quantity: newQty, basePrice: base, price } as CartItem;
    };

    const updateQuantity = (id: string, delta: number) => {
        setCart(prev => prev.map(item => {
            if (item.id === id) {
                const newQty = Math.max(0.01, Math.round((item.quantity + delta) * 100) / 100);
                return repricedLine(item, newQty);
            }
            return item;
        }));
    };

    const setQuantity = (id: string, qty: number) => {
        setCart(prev => prev.map(item => {
            if (item.id === id) {
                return repricedLine(item, Math.max(0.01, qty));
            }
            return item;
        }));
    };

    // Al cambiar el cliente (mayorista ↔ detalle), repreciar TODO el carrito.
    useEffect(() => {
        const wholesaleCustomer = Boolean(selectedCustomer?.isWholesale);
        setCart(prev => prev.map(item => {
            const line = item as CartLine;
            const base = line.basePrice ?? item.price;
            const price = effectiveUnitPrice(
                { basePrice: base, wholesalePrice: line.wholesalePrice, wholesaleMinQty: line.wholesaleMinQty, packSize: line.packSize, packPrice: line.packPrice },
                item.quantity,
                wholesaleCustomer
            );
            return price === item.price ? item : ({ ...item, basePrice: base, price } as CartItem);
        }));
    }, [selectedCustomer?.id, selectedCustomer?.isWholesale]);

    // Per-item discount
    const setItemDiscount = (id: string, discount: number) => {
        setCart(prev => prev.map(item => {
            if (item.id === id) {
                return { ...item, discount: Math.min(100, Math.max(0, discount)) };
            }
            return item;
        }));
    };

    // ==========================================
    // 🅿️ PARQUEO DE VENTAS (Hold Cart)
    // ==========================================
    const handleHoldCart = useCallback(() => {
        if (cart.length === 0) return;
        if (heldCarts.length >= 5) {
            alert('Máximo 5 carritos aparcados. Restaura uno primero.');
            return;
        }
        const held: HeldCart = {
            id: Date.now().toString(),
            label: selectedCustomer?.name || `Carrito ${heldCarts.length + 1}`,
            items: [...cart],
            customer: selectedCustomer,
            heldAt: new Date(),
        };
        setHeldCarts(prev => [...prev, held]);
        setCart([]);
        setSelectedCustomer(null);
        setCustomerSearch('');
        setGlobalDiscount('');
        setCreditOverrideAuthorized(false);
        setCreditOverridePin('');
    }, [cart, heldCarts, selectedCustomer]);

    const handleRestoreCart = useCallback((heldId: string) => {
        const toRestore = heldCarts.find(h => h.id === heldId);
        if (!toRestore) return;
        // If current cart has items, park it first
        if (cart.length > 0) {
            if (heldCarts.length >= 5) {
                alert('Máximo 5 carritos. Limpia el carrito actual primero.');
                return;
            }
            const currentHeld: HeldCart = {
                id: Date.now().toString(),
                label: selectedCustomer?.name || `Carrito ${heldCarts.length + 1}`,
                items: [...cart],
                customer: selectedCustomer,
                heldAt: new Date(),
            };
            setHeldCarts(prev => [...prev.filter(h => h.id !== heldId), currentHeld]);
        } else {
            setHeldCarts(prev => prev.filter(h => h.id !== heldId));
        }
        setCart(toRestore.items);
        setSelectedCustomer(toRestore.customer);
        setCustomerSearch(toRestore.customer?.name || '');
        setShowHeldCarts(false);
        setGlobalDiscount('');
    }, [cart, heldCarts, selectedCustomer]);

    const handleRemoveHeldCart = useCallback((heldId: string) => {
        setHeldCarts(prev => prev.filter(h => h.id !== heldId));
    }, []);

    // ==========================================
    // ⌨️ HOTKEYS BÉLICOS
    // ==========================================
    useEffect(() => {
        const handleHotkey = (e: KeyboardEvent) => {
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
                    if (currentShift && cart.length > 0) handleCheckout('CASH');
                    return;
                case 'Escape':
                    e.preventDefault();
                    // Close any open modal
                    if (completedSale) { handleNewSale(); return; }
                    if (showCashModal) { setShowCashModal(null); return; }
                    if (showCreditPanel) { setShowCreditPanel(false); return; }
                    if (showHeldCarts) { setShowHeldCarts(false); return; }
                    if (showQuickCreate) { setShowQuickCreate(false); return; }
                    if (showAddModal) { setShowAddModal(false); return; }
                    if (showImportModal) { closeImportModal(); return; }
                    if (showCloseShift) { setShowCloseShift(false); return; }
                    if (showMovementsList) { setShowMovementsList(false); return; }
                    return;
            }
        };
        window.addEventListener('keydown', handleHotkey);
        return () => window.removeEventListener('keydown', handleHotkey);
    }, [handleHoldCart, currentShift, cart, completedSale, showCashModal, showCreditPanel, showHeldCarts, showQuickCreate, showAddModal, showImportModal, showCloseShift, showMovementsList]);

    // ==========================================
    // 🔴 FIADO INTELIGENTE (Credit Override)
    // ==========================================
    const handleCreditOverride = useCallback(async () => {
        if (creditOverridePin.length !== 4) return;
        try {
            // Fetch employees to find OWNER with matching PIN
            const res = await fetch('/api/employees', { headers });
            if (!res.ok) return;
            const employees = await res.json();
            const owner = employees.find((e: any) =>
                (e.role === 'MANAGER' || e.role === 'OWNER') && e.pin === creditOverridePin
            );
            if (owner) {
                setCreditOverrideAuthorized(true);
                setShowCreditPanel(false);
                playBeep();
            } else {
                playErrorBeep();
                alert('PIN incorrecto o no tiene permisos de Dueño/Gerente.');
                setCreditOverridePin('');
            }
        } catch {
            alert('Error verificando PIN');
        }
    }, [creditOverridePin, headers]);

    // ==========================================
    // QUICK CREATE PRODUCT (saves to DB + adds to cart)
    // ==========================================
    const handleQuickCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        setQuickSaving(true);

        try {
            const res = await fetch('/api/products', {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    name: quickProduct.name,
                    sku: quickProduct.sku.toUpperCase() || `SKU-${Date.now().toString(36).toUpperCase()}`,
                    price: parseFloat(quickProduct.price),
                    cost: parseFloat(quickProduct.cost) || parseFloat(quickProduct.price) * 0.7,
                    stock: parseInt(quickProduct.stock) || 1,
                    minStock: 5,
                    category: 'General',
                    unit: 'unidad'
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
            };

            setProducts(prev => [newProd, ...prev]);
            addToCart(newProd);
            playBeep();

            setShowQuickCreate(false);
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
        reader.onload = (evt) => {
            try {
                const data = evt.target?.result;
                const workbook = XLSX.read(data, { type: 'binary' });
                const sheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[sheetName];
                const jsonData = XLSX.utils.sheet_to_json(worksheet);

                setImportProgress({ step: `${jsonData.length} filas leídas`, pct: 30 });

                // Map columns (flexible naming)
                const mapped = jsonData.map((row: any) => ({
                    name: row['Nombre'] || row['nombre'] || row['Name'] || row['name'] || row['Producto'] || row['producto'] || '',
                    sku: row['SKU'] || row['sku'] || row['Codigo'] || row['codigo'] || row['Código'] || row['código'] || row['Barcode'] || row['barcode'] || '',
                    price: row['Precio'] || row['precio'] || row['Price'] || row['price'] || row['PrecioVenta'] || row['precio_venta'] || 0,
                    cost: row['Costo'] || row['costo'] || row['Cost'] || row['cost'] || row['CostoCompra'] || row['costo_compra'] || 0,
                    stock: row['Stock'] || row['stock'] || row['Cantidad'] || row['cantidad'] || row['Qty'] || 0,
                    category: row['Categoria'] || row['categoria'] || row['Category'] || row['category'] || row['Categoría'] || 'General',
                    unit: row['Unidad'] || row['unidad'] || row['Unit'] || row['unit'] || 'unidad',
                    minStock: row['StockMinimo'] || row['stock_minimo'] || row['MinStock'] || 5,
                }));

                const valid = mapped.filter((p: any) => p.name && p.sku);
                setImportData(valid);
                setImportProgress({ step: `${valid.length} productos válidos listos`, pct: 50 });
            } catch (err: any) {
                setImportProgress({ step: `Error: ${err.message}`, pct: 0 });
            }
        };
        reader.readAsBinaryString(file);
    };

    const executeImport = async () => {
        if (importData.length === 0) return;

        setImportProgress({ step: 'Enviando al servidor...', pct: 60 });

        try {
            const res = await fetch('/api/products/bulk', {
                method: 'POST',
                headers,
                body: JSON.stringify({ products: importData })
            });

            setImportProgress({ step: 'Procesando...', pct: 85 });

            const data = await res.json();
            if (!res.ok) throw new Error(data.error);

            setImportProgress({ step: 'Completado', pct: 100 });
            setImportResult({ created: data.created, updated: data.updated, errors: data.errors });

            // Refresh products list
            fetchProducts();
        } catch (error: any) {
            setImportProgress({ step: `Error: ${error.message}`, pct: 0 });
        }
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
        const stock = parseInt(newProduct.stock);
        if (isNaN(price) || isNaN(stock)) return;

        try {
            const res = await fetch('/api/products', {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    name: newProduct.name,
                    sku: newProduct.sku || `SKU-${Date.now().toString(36).toUpperCase()}`,
                    price: price,
                    cost: parseFloat(newProduct.costPrice) || price * 0.7,
                    stock: stock,
                    minStock: 5,
                    category: newProduct.category,
                    unit: 'unidad'
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
    const globalDiscountD = Decimal.min(100, Decimal.max(0, toDecimal(globalDiscount)));
    const totalD = cart.reduce((acc, item) => {
        const lineDiscount = toDecimal((item as CartLine).discount ?? 0);
        const factor = new Decimal(1).minus(lineDiscount.div(100));
        return acc.plus(toDecimal(item.price).mul(item.quantity).mul(factor));
    }, new Decimal(0));
    const discountedTotalD = totalD.mul(new Decimal(1).minus(globalDiscountD.div(100)));
    const taxD = discountedTotalD.mul('0.15'); // IVA 15% Nicaragua
    const grandTotalD = discountedTotalD.plus(taxD);

    // Proyecciones numéricas (2 decimales) para UI y payload; la verdad es Decimal.
    const total = totalD.toDecimalPlaces(2).toNumber();
    const discountedTotal = discountedTotalD.toDecimalPlaces(2).toNumber();
    const tax = taxD.toDecimalPlaces(2).toNumber();
    const grandTotal = grandTotalD.toDecimalPlaces(2).toNumber();
    const globalDiscountNum = globalDiscountD.toNumber();

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

    const handleCheckout = async (method: 'CASH' | 'CARD' | 'QR' | 'CREDIT') => {
        if (!currentShift) { setShowOpenShift(true); return; }
        if (cart.length === 0) return;

        // Front-end Block (skip if override authorized)
        if (method === 'CREDIT' && isCreditBlocked && !creditOverrideAuthorized) {
            setShowCreditPanel(true);
            return;
        }

        setProcessing(true);
        try {
            const token = localStorage.getItem('nortex_token');

            // ── OFFLINE PATH ──────────────────────────────────────────
            if (!navigator.onLine) {
                const tenantRaw = localStorage.getItem('nortex_tenant_data');
                const tenantId = tenantRaw ? JSON.parse(tenantRaw).id : '';
                const userRaw = localStorage.getItem('nortex_user');
                const userId = userRaw ? JSON.parse(userRaw).id : '';

                const offlineId = generateOfflineId();
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
                    items: cart.map(c => ({
                        id: c.id,
                        name: c.name,
                        quantity: c.quantity,
                        price: c.price,
                        costPrice: c.costPrice,
                        discount: (c as any).discount || 0,
                    })),
                    createdAt: new Date().toISOString(),
                });
                setPendingOfflineCount(p => p + 1);

                setCompletedSale({
                    items: [...cart],
                    subtotal: total,
                    tax,
                    grandTotal,
                    paymentMethod: method,
                    customerName: selectedCustomer ? selectedCustomer.name : 'Cliente General',
                    customerPhone: selectedCustomer?.phone,
                    saleId: offlineId,
                    date: new Date().toLocaleDateString('es-NI', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
                });
                setCashReceived('');
                return;
            }

            // ── ONLINE PATH ───────────────────────────────────────────
            const res = await fetch('/api/sales', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({
                    items: cart.map(c => ({ id: c.id, quantity: c.quantity, price: c.price, costPrice: c.costPrice, discount: (c as any).discount || 0 })),
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

            setCompletedSale({
                items: [...cart],
                subtotal: total,
                tax,
                grandTotal,
                paymentMethod: method,
                customerName: selectedCustomer ? selectedCustomer.name : 'Cliente General',
                customerPhone: selectedCustomer?.phone,
                saleId: data.id,
                date: new Date().toLocaleDateString('es-NI', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
                invoiceNumber: data.invoiceNumber,
                invoiceSeries: data.invoiceSeries,
            });
            setCashReceived('');

        } catch (error: any) {
            alert(error.message);
        } finally {
            setProcessing(false);
        }
    };

    // POST-SALE ACTIONS
    const getTenantName = () => {
        try {
            const td = localStorage.getItem('nortex_tenant_data');
            if (td) return JSON.parse(td).businessName || 'Nortex';
        } catch { }
        return 'Nortex';
    };

    const buildInvoiceData = useCallback((): InvoiceData | null => {
        if (!completedSale) return null;
        return {
            tenantName: getTenantName(),
            customerName: completedSale.customerName,
            customerPhone: completedSale.customerPhone,
            items: completedSale.items.map(i => ({
                name: i.name,
                quantity: i.quantity,
                price: i.price,
                lineTotal: i.price * i.quantity,
            })),
            subtotal: completedSale.subtotal,
            tax: completedSale.tax,
            grandTotal: completedSale.grandTotal,
            paymentMethod: completedSale.paymentMethod,
            date: completedSale.date,
            saleId: completedSale.saleId,
        };
    }, [completedSale]);

    const handleWhatsApp = () => {
        const inv = buildInvoiceData();
        if (!inv) return;
        sendToWhatsApp(inv, completedSale?.customerPhone);
    };

    const handlePrintTicket = async () => {
        if (thermalPrinter.isConnected()) {
            const inv = buildInvoiceData();
            if (inv) {
                const success = await thermalPrinter.printReceipt(inv);
                if (!success) {
                    alert('Error comunicándose con la tiquetera. Verifica conexión de web serial.');
                }
            }
        } else {
            // Use the in-DOM ReceiptTicket + @media print CSS
            // Wait 150ms to ensure React has rendered the receipt data
            setTimeout(() => window.print(), 150);
        }
    };

    const handlePrintA4 = () => {
        const inv = buildInvoiceData();
        if (!inv) return;
        printA4(inv);
    };

    const handleNewSale = () => {
        setCompletedSale(null);
        setCashReceived('');
        setCart([]);
        setSelectedCustomer(null);
        setCustomerSearch('');
        setGlobalDiscount('');
        setCreditOverrideAuthorized(false);
        setCreditOverridePin('');
        setShowCreditPanel(false);
        setPayingInUSD(false);
        setUsdAmount('');
    };

    const filteredProducts = useMemo(() => {
        if (!searchTerm) return products;
        const term = searchTerm.trim();

        // Exact SKU match first (for manual barcode/SKU entry)
        const exactMatch = products.find(p => p.sku.toUpperCase() === term.toUpperCase());
        if (exactMatch) return [exactMatch];

        // Fuzzy search
        const terms = term.toLowerCase().split(' ').filter(t => t.length > 0);
        return products.filter(p => terms.every(t => `${p.name} ${p.sku} ${p.category}`.toLowerCase().includes(t)));
    }, [searchTerm, products]);

    const filteredCustomers = customerList.filter(c => c.name.toLowerCase().includes(customerSearch.toLowerCase()));

    // Handle search input Enter to add exact SKU match to cart
    const handleSearchKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && searchTerm.trim()) {
            const term = searchTerm.trim().toUpperCase();
            const match = products.find(p => p.sku.toUpperCase() === term);
            if (match) {
                addToCart(match);
                playBeep();
                setSearchTerm('');
            }
        }
    };

    if (shiftLoading) return <div className="h-full flex items-center justify-center text-slate-500 gap-2"><Loader2 className="animate-spin" /> Cargando Sistema...</div>;

    return (
        <div className="flex h-full bg-surface-950 relative">

            {/* HEADER BAR */}
            <div className="absolute top-0 right-0 left-0 h-14 bg-surface-900 border-b border-white/[0.06] px-6 flex justify-between items-center gap-4 z-10 text-slate-100">
                <div className="font-bold text-slate-100 flex items-center gap-2 shrink-0">
                    PUNTO DE VENTA
                    {currentShift && (
                        <span className="text-xs bg-green-500/15 text-green-400 px-2 py-0.5 rounded-full border border-green-500/20 flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
                            {currentShift.employee
                                ? `${currentShift.employee.firstName} ${currentShift.employee.lastName}`
                                : 'CAJA ABIERTA'}
                        </span>
                    )}
                </div>

                <div className="flex items-center gap-2 flex-1 min-w-0 justify-end overflow-x-auto custom-scrollbar whitespace-nowrap pl-4">
                    {/* 🖨️ TIQUETERA BT/USB */}
                    {!simpleMode && <button
                        onClick={async () => {
                            if (!thermalConnected) {
                                const success = await thermalPrinter.connect();
                                setThermalConnected(success);
                            }
                        }}
                        className={`flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg transition-all shadow-sm ${thermalConnected ? 'bg-indigo-500 text-white hover:bg-indigo-600' : 'bg-white/[0.04] text-slate-500 hover:bg-white/[0.06] border border-white/[0.06]'}`}
                        title={thermalConnected ? 'Tiquetera Conectada' : 'Vincular Tiquetera'}
                    >
                        <Printer size={14} />
                        <span className="hidden lg:inline">{thermalConnected ? 'Tiquetera lista' : 'Vincular Tiquetera'}</span>
                    </button>}

                    {/* 📶 OFFLINE INDICATOR */}
                    {!isOnline && (
                        <div className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg bg-amber-500 text-white shadow-sm">
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
                            className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg bg-green-500 text-white hover:bg-green-600 shadow-sm disabled:opacity-60"
                            title="Sincronizar ventas offline"
                        >
                            <RefreshCw size={14} className={syncingOffline ? 'animate-spin' : ''} />
                            <span className="hidden lg:inline">{syncingOffline ? 'Sincronizando...' : `Sync (${pendingOfflineCount})`}</span>
                        </button>
                    )}

                    {/* 🅿️ PARQUEO BADGE */}
                    {currentShift && !simpleMode && (
                        <button
                            onClick={() => setShowHeldCarts(!showHeldCarts)}
                            className={`relative flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg transition-all shadow-sm ${heldCarts.length > 0 ? 'bg-blue-500 text-white hover:bg-blue-600' : 'bg-white/[0.04] text-slate-500 hover:bg-white/[0.06] border border-white/[0.06]'}`}
                            title={`Carritos aparcados (F4 para aparcar)`}
                        >
                            <ParkingCircle size={14} />
                            {heldCarts.length > 0 && (
                                <span className="bg-surface-900 text-blue-400 text-[10px] font-black w-4 h-4 rounded-full flex items-center justify-center">{heldCarts.length}</span>
                            )}
                            <span className="hidden lg:inline">{heldCarts.length > 0 ? 'Aparcados' : 'Aparcar'}</span>
                        </button>
                    )}
                    {/* 💰 CASH BALANCE INDICATOR */}
                    {currentShift && cashBalance !== null && (
                        <button
                            onClick={() => setShowMovementsList(!showMovementsList)}
                            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full bg-white/[0.04] text-slate-200 border border-white/[0.06] hover:bg-white/[0.06] transition-all cursor-pointer"
                            title="Efectivo en caja"
                        >
                            <Wallet size={14} />
                            <span className="font-bold">C${cashBalance.toFixed(2)}</span>
                        </button>
                    )}

                    {/* 💰 QUICK ACTION: ENTRADA DE EFECTIVO */}
                    {currentShift && (
                        <button
                            onClick={() => { setShowCashModal('IN'); setCashCategory(''); }}
                            className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 transition-all shadow-sm"
                            title="Entrada de Efectivo"
                        >
                            <ArrowDownCircle size={14} />
                            Entrada
                        </button>
                    )}

                    {/* 💸 QUICK ACTION: SALIDA DE EFECTIVO */}
                    {currentShift && (
                        <button
                            onClick={() => { setShowCashModal('OUT'); setCashCategory(''); }}
                            className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg bg-amber-500 text-white hover:bg-amber-600 transition-all shadow-sm"
                            title="Salida de Efectivo"
                        >
                            <ArrowUpCircle size={14} />
                            Salida
                        </button>
                    )}

                    {/* 🏦 QUICK ACTION: AGENTE BANCARIO (corresponsalía) */}
                    {currentShift && (
                        <button
                            onClick={() => { setShowAgentModal(true); fetchAgentAgreements(); }}
                            className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg bg-sky-600 text-white hover:bg-sky-700 transition-all shadow-sm"
                            title="Operación de agente bancario (Banpro, BAC, Lafise, Puntoxpress...)"
                        >
                            <Landmark size={14} />
                            Agente
                        </button>
                    )}

                    {/* 🔄 QUICK ACTION: DEVOLUCIÓN */}
                    {currentShift && !simpleMode && (
                        <button
                            onClick={() => setShowReturnModal(true)}
                            className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg bg-orange-500 text-white hover:bg-orange-600 transition-all shadow-sm"
                            title="Devolución de Producto"
                        >
                            <RefreshCw size={14} />
                            Dev.
                        </button>
                    )}

                    {/* Scanner indicator */}
                    {!simpleMode && <button
                        onClick={() => setScannerActive(!scannerActive)}
                        className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full transition-all ${scannerActive
                            ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20'
                            : 'bg-white/[0.04] text-slate-500 border border-white/[0.06]'
                            }`}
                        title={scannerActive ? 'Escáner activo' : 'Escáner desactivado'}
                    >
                        <ScanBarcode size={14} />
                        {scannerActive ? <Volume2 size={12} /> : <VolumeX size={12} />}
                        <span className="hidden xl:inline">{scannerActive ? 'Escáner ON' : 'Escáner OFF'}</span>
                    </button>}

                    {currentShift ? (
                        <button onClick={() => setShowCloseShift(true)} className="text-xs font-bold text-red-500 hover:bg-red-500/10 px-3 py-1.5 rounded transition-colors flex items-center gap-1">
                            <Lock size={14} /> CERRAR CAJA
                        </button>
                    ) : (
                        <span className="text-xs font-bold text-red-500 flex items-center gap-1"><AlertTriangle size={14} /> CAJA CERRADA</span>
                    )}
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
                                        <p className="text-xs text-slate-500">Disponible: <span className="font-bold text-slate-200">C${cashBalance.toFixed(2)}</span></p>
                                    )}
                                </div>
                            </div>
                            <button onClick={() => setShowCashModal(null)} className="text-slate-400 hover:text-slate-300 p-1">
                                <X size={20} />
                            </button>
                        </div>

                        <form onSubmit={handleCashMovement} className="space-y-4">
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
                            </div>

                            {/* Amount */}
                            <div>
                                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1 block">Monto (C$)</label>
                                <input
                                    type="text"
                                    inputMode="decimal"
                                    value={cashAmount}
                                    onChange={e => setCashAmount(sanitizeDecimalInput(e.target.value))}
                                    placeholder="0.00"
                                    className="w-full text-2xl font-bold text-center border-2 border-white/10 rounded-xl p-4 focus:border-nortex-500 outline-none text-slate-100 bg-surface-800/40 font-mono tabular-nums"
                                    autoFocus
                                    required
                                />
                            </div>

                            {/* Description */}
                            <div>
                                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1 block">Descripción</label>
                                <input
                                    type="text"
                                    value={cashDescription}
                                    onChange={e => setCashDescription(e.target.value)}
                                    placeholder={showCashModal === 'OUT' ? 'Ej: Compra de hielo para el local' : 'Ej: Cambio de billete de C$500'}
                                    className="w-full border-2 border-white/[0.06] rounded-lg px-4 py-3 text-sm focus:border-nortex-500 outline-none text-slate-200"
                                    required
                                    minLength={3}
                                />
                            </div>

                            <button
                                type="submit"
                                disabled={cashMovementLoading || !cashCategory || !cashAmount || !cashDescription}
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
                                        className="w-full text-2xl font-bold text-center border-2 border-white/10 rounded-xl p-4 focus:border-sky-500 outline-none text-slate-100 bg-surface-800/40 font-mono tabular-nums"
                                        required
                                    />
                                    {agentOps.find(o => o.value === agentData.operation)?.dir === 'OUT' && cashBalance !== null && agentData.currency === 'NIO' && (
                                        <p className="text-xs text-slate-500 mt-1">Efectivo disponible en gaveta: <span className="font-bold text-slate-200">C${cashBalance.toFixed(2)}</span></p>
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
                                            className="w-full border-2 border-white/[0.06] rounded-lg px-4 py-3 text-sm focus:border-emerald-500 outline-none text-slate-200 font-mono"
                                            required
                                        />
                                        {parseFloat(agentData.amount) > 0 && parseFloat(agentData.exchangeRate) > 0 && (
                                            <p className="text-xs text-slate-500 mt-1">Equivale a <span className="font-bold text-slate-200">C${(parseFloat(agentData.amount) * parseFloat(agentData.exchangeRate)).toFixed(2)}</span> — así se asienta en tu contabilidad.</p>
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
                    {cashMovements.length === 0 ? (
                        <p className="text-sm text-slate-400 text-center py-6">Sin movimientos</p>
                    ) : (
                        <div className="divide-y divide-white/[0.04]">
                            {cashMovements.filter(m => !m.isVoided).map(m => (
                                <div key={m.id} className="px-3 py-2.5 flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs ${m.type === 'IN' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-amber-500/15 text-amber-400'}`}>
                                            {m.type === 'IN' ? '↓' : '↑'}
                                        </div>
                                        <div>
                                            <p className="text-xs font-medium text-slate-200 truncate max-w-[160px]">{m.description}</p>
                                            <p className="text-[10px] text-slate-400">{new Date(m.createdAt).toLocaleTimeString('es-NI', { hour: '2-digit', minute: '2-digit' })}</p>
                                        </div>
                                    </div>
                                    <span className={`text-sm font-bold ${m.type === 'IN' ? 'text-emerald-400' : 'text-amber-400'}`}>
                                        {m.type === 'IN' ? '+' : '-'}C${Number(m.amount).toFixed(2)}
                                    </span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* --- 🅿️ HELD CARTS DROPDOWN --- */}
            {showHeldCarts && currentShift && (
                <div className="absolute top-14 right-4 z-40 w-96 bg-surface-900 rounded-xl shadow-2xl border border-white/[0.06] max-h-[420px] overflow-y-auto animate-in slide-in-from-top duration-200">
                    <div className="p-3 border-b border-white/[0.04] flex justify-between items-center sticky top-0 bg-surface-900 z-10">
                        <h3 className="text-sm font-bold text-slate-200 flex items-center gap-2">
                            <ParkingCircle size={16} className="text-blue-500" /> Carritos Aparcados ({heldCarts.length}/5)
                        </h3>
                        <button onClick={() => setShowHeldCarts(false)} className="text-slate-400 hover:text-slate-300"><X size={16} /></button>
                    </div>
                    {heldCarts.length === 0 ? (
                        <div className="p-8 text-center">
                            <ParkingCircle size={32} className="text-slate-300 mx-auto mb-2" />
                            <p className="text-sm text-slate-400">Sin carritos aparcados</p>
                            <p className="text-[10px] text-slate-300 mt-1">Usa F4 o el botón 🅿para aparcar el carrito actual</p>
                        </div>
                    ) : (
                        <div className="divide-y divide-white/[0.04]">
                            {heldCarts.map(held => {
                                const heldTotal = held.items.reduce((sum, item) => sum + item.price * item.quantity, 0);
                                const minutesAgo = Math.round((Date.now() - new Date(held.heldAt).getTime()) / 60000);
                                return (
                                    <div key={held.id} className="p-3 hover:bg-surface-800/40 transition-colors">
                                        <div className="flex items-start justify-between mb-2">
                                            <div className="flex-1 min-w-0">
                                                <p className="text-sm font-bold text-slate-100 truncate">{held.label}</p>
                                                <p className="text-[11px] text-slate-500">
                                                    {held.items.length} {held.items.length === 1 ? 'item' : 'items'} · C${heldTotal.toFixed(2)} · Hace {minutesAgo < 1 ? '<1' : minutesAgo} min
                                                </p>
                                            </div>
                                            <div className="flex items-center gap-1.5 ml-2">
                                                <button
                                                    onClick={() => handleRestoreCart(held.id)}
                                                    className="text-xs font-bold px-3 py-1.5 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors flex items-center gap-1"
                                                >
                                                    <RotateCcw size={12} /> Restaurar
                                                </button>
                                                <button
                                                    onClick={() => handleRemoveHeldCart(held.id)}
                                                    className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-500/10 rounded transition-colors"
                                                    title="Descartar carrito"
                                                >
                                                    <Trash2 size={14} />
                                                </button>
                                            </div>
                                        </div>
                                        {/* Mini preview of items */}
                                        <div className="flex flex-wrap gap-1">
                                            {held.items.slice(0, 3).map((item, i) => (
                                                <span key={i} className="text-[10px] bg-white/[0.04] text-slate-300 px-1.5 py-0.5 rounded">
                                                    {item.quantity}x {item.name.length > 15 ? item.name.slice(0, 15) + '…' : item.name}
                                                </span>
                                            ))}
                                            {held.items.length > 3 && (
                                                <span className="text-[10px] text-slate-400">+{held.items.length - 3} más</span>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                    {heldCarts.length > 0 && cart.length > 0 && (
                        <div className="p-2 border-t border-white/[0.04] bg-surface-800/40">
                            <p className="text-[10px] text-slate-400 text-center">Al restaurar, el carrito actual se aparcará automáticamente</p>
                        </div>
                    )}
                </div>
            )}

            {/* --- OPEN SHIFT MODAL --- */}
            {showOpenShift && (
                <div className="absolute inset-0 z-50 bg-slate-900/90 backdrop-blur flex items-center justify-center p-4">
                    <div className="bg-surface-900 rounded-xl shadow-2xl w-full max-w-sm p-8 text-center animate-in zoom-in duration-200">
                        <div className="w-16 h-16 bg-blue-500/15 text-blue-400 rounded-full flex items-center justify-center mx-auto mb-4">
                            <Lock size={32} />
                        </div>
                        <h2 className="text-2xl font-bold text-slate-100 mb-2">Apertura de Caja</h2>
                        <p className="text-slate-500 text-sm mb-6">Ingresa tu PIN de empleado y el fondo inicial.</p>
                        {isOwnerAdmin && (
                            <p className="text-xs bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-lg px-3 py-2 mb-4">
                                ¿Primera vez? Tu PIN inicial de dueño es <strong>1234</strong> — cambialo después en <strong>Mi Personal</strong>.
                            </p>
                        )}
                        <form onSubmit={handleOpenShift} className="space-y-5">
                            {/* PIN Input */}
                            <div>
                                <label className="text-xs font-mono font-bold text-slate-400 uppercase tracking-wider">PIN de Empleado</label>
                                <div className="flex justify-center gap-2 mt-2">
                                    {[0, 1, 2, 3].map(i => (
                                        <input
                                            key={i}
                                            type="password"
                                            inputMode="numeric"
                                            maxLength={1}
                                            className="w-14 h-14 text-center text-2xl font-bold border-2 border-white/10 rounded-xl focus:border-nortex-500 outline-none text-slate-100 bg-surface-800/40"
                                            value={employeePin[i] || ''}
                                            autoFocus={i === 0}
                                            onChange={(e) => {
                                                const val = e.target.value.replace(/\D/g, '');
                                                if (val.length <= 1) {
                                                    const newPin = employeePin.split('');
                                                    newPin[i] = val;
                                                    setEmployeePin(newPin.join(''));
                                                    // Auto-focus next input
                                                    if (val && i < 3) {
                                                        const next = e.target.parentElement?.children[i + 1] as HTMLInputElement;
                                                        next?.focus();
                                                    }
                                                }
                                            }}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Backspace' && !employeePin[i] && i > 0) {
                                                    const prev = (e.target as HTMLElement).parentElement?.children[i - 1] as HTMLInputElement;
                                                    prev?.focus();
                                                }
                                            }}
                                        />
                                    ))}
                                </div>
                            </div>

                            {/* Cash Input */}
                            <div>
                                <label className="text-xs font-mono font-bold text-slate-400 uppercase tracking-wider">Fondo Inicial (Efectivo)</label>
                                <input
                                    type="text"
                                    inputMode="decimal"
                                    className="w-full text-center text-3xl font-bold border-b-2 border-white/10 focus:border-nortex-500 outline-none pb-2 mt-2 text-slate-100 font-mono tabular-nums"
                                    placeholder="0.00"
                                    value={initialCash}
                                    onChange={e => setInitialCash(sanitizeDecimalInput(e.target.value))}
                                    required
                                />
                            </div>

                            <button type="submit" disabled={shiftLoading || employeePin.length !== 4} className="btn-primary w-full py-3 disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100">
                                {shiftLoading ? 'VERIFICANDO PIN...' : 'ABRIR TURNO'}
                            </button>
                        </form>
                    </div>
                </div>
            )}

            {/* --- CLOSE SHIFT MODAL --- */}
            {showCloseShift && (
                <div className="absolute inset-0 z-50 bg-slate-900/80 backdrop-blur flex items-center justify-center p-4">
                    <div className="bg-surface-900 rounded-xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in duration-200">
                        {!shiftReport ? (
                            <div className="p-8">
                                <h2 className="text-xl font-bold text-slate-100 mb-1">Cierre de Caja (Ciego)</h2>
                                <p className="text-slate-500 text-sm mb-6">Cuenta el dinero fisico e ingresalo abajo.</p>
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
                                            onChange={e => setDeclaredCash(sanitizeDecimalInput(e.target.value))}
                                            required
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
                                        {shiftReport.diff >= 0 ? 'Cuadre Exitoso' : 'Discrepancia de Efectivo'}
                                    </p>
                                </div>
                                <div className="p-8 space-y-4">
                                    <div className="flex justify-between text-sm">
                                        <span className="text-slate-500">Esperado (Sistema)</span>
                                        <span className="font-mono font-bold">${shiftReport.expected.toFixed(2)}</span>
                                    </div>
                                    <div className="flex justify-between text-sm">
                                        <span className="text-slate-500">Declarado (Cajero)</span>
                                        <span className="font-mono font-bold">${parseFloat(declaredCash).toFixed(2)}</span>
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
                                    <input type="text" required className="w-full px-3 py-2 border border-white/10 rounded-lg focus:outline-none focus:ring-2 focus:ring-nortex-500 text-slate-100"
                                        placeholder="Ej. Taladro Percutor 500W" value={newProduct.name} onChange={e => setNewProduct({ ...newProduct, name: e.target.value })} />
                                </div>
                                <div>
                                    <label className="block text-xs font-mono text-slate-500 mb-1">SKU / CODIGO BARRAS</label>
                                    <input type="text" className="w-full px-3 py-2 border border-white/10 rounded-lg focus:outline-none focus:ring-2 focus:ring-nortex-500 text-slate-100"
                                        placeholder="Escanea o escribe" value={newProduct.sku} onChange={e => setNewProduct({ ...newProduct, sku: e.target.value.toUpperCase() })} />
                                </div>
                                <div>
                                    <label className="block text-xs font-mono text-slate-500 mb-1">CATEGORIA</label>
                                    <select className="w-full px-3 py-2 border border-white/10 rounded-lg focus:outline-none focus:ring-2 focus:ring-nortex-500 bg-surface-900"
                                        value={newProduct.category} onChange={e => setNewProduct({ ...newProduct, category: e.target.value })} >
                                        <option>General</option><option>Construccion</option><option>Ferreteria</option><option>Herramientas</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs font-mono text-slate-500 mb-1">PRECIO VENTA *</label>
                                    <input type="text" inputMode="decimal" required className="w-full px-3 py-2 border border-white/10 rounded-lg focus:outline-none focus:ring-2 focus:ring-nortex-500 text-slate-100 font-mono tabular-nums"
                                        placeholder="0.00" value={newProduct.price} onChange={e => setNewProduct({ ...newProduct, price: sanitizeDecimalInput(e.target.value) })} />
                                </div>
                                <div>
                                    <label className="block text-xs font-mono text-slate-500 mb-1">COSTO (Wholesale) *</label>
                                    <input type="text" inputMode="decimal" required className="w-full px-3 py-2 border border-white/10 rounded-lg focus:outline-none focus:ring-2 focus:ring-nortex-500 bg-surface-800/40 text-slate-100 font-mono tabular-nums"
                                        placeholder="0.00" value={newProduct.costPrice} onChange={e => setNewProduct({ ...newProduct, costPrice: sanitizeDecimalInput(e.target.value) })} />
                                </div>
                                <div className="col-span-2">
                                    <label className="block text-xs font-mono text-slate-500 mb-1">STOCK INICIAL *</label>
                                    <input type="text" inputMode="decimal" required className="w-full px-3 py-2 border border-white/10 rounded-lg focus:outline-none focus:ring-2 focus:ring-nortex-500 text-slate-100 font-mono tabular-nums"
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
                <div className="absolute inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="bg-surface-900 rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden border border-white/[0.06]">
                        <div className="bg-gradient-to-r from-amber-500 to-orange-500 px-5 py-3 flex items-center justify-between">
                            <h3 className="font-bold text-white flex items-center gap-2">
                                <Zap size={18} /> Producto Rapido
                            </h3>
                            <button onClick={() => setShowQuickCreate(false)} className="text-white/80 hover:text-white">
                                <X size={20} />
                            </button>
                        </div>

                        <form onSubmit={handleQuickCreate} className="p-5 space-y-3">
                            <div>
                                <input
                                    required autoFocus
                                    type="text"
                                    placeholder="Nombre del producto *"
                                    value={quickProduct.name}
                                    onChange={e => setQuickProduct({ ...quickProduct, name: e.target.value })}
                                    className="w-full px-3 py-2.5 border border-white/10 rounded-lg text-slate-100 font-semibold focus:ring-2 focus:ring-amber-500 outline-none"
                                />
                            </div>
                            <div>
                                <input
                                    type="text"
                                    placeholder="SKU / Codigo de barras (escanea aqui)"
                                    value={quickProduct.sku}
                                    onChange={e => setQuickProduct({ ...quickProduct, sku: e.target.value.toUpperCase() })}
                                    className="w-full px-3 py-2.5 border border-white/10 rounded-lg text-slate-100 font-mono focus:ring-2 focus:ring-amber-500 outline-none bg-amber-500/10"
                                />
                            </div>
                            <div className="grid grid-cols-3 gap-2">
                                <div>
                                    <label className="text-[10px] text-slate-500 font-bold">PRECIO *</label>
                                    <input
                                        required type="text" inputMode="decimal"
                                        placeholder="0.00"
                                        value={quickProduct.price}
                                        onChange={e => setQuickProduct({ ...quickProduct, price: sanitizeDecimalInput(e.target.value) })}
                                        className="w-full px-2 py-2 border border-white/10 rounded-lg text-slate-100 font-bold text-lg focus:ring-2 focus:ring-amber-500 outline-none font-mono tabular-nums"
                                    />
                                </div>
                                <div>
                                    <label className="text-[10px] text-slate-500 font-bold">COSTO</label>
                                    <input
                                        type="text" inputMode="decimal"
                                        placeholder="0.00"
                                        value={quickProduct.cost}
                                        onChange={e => setQuickProduct({ ...quickProduct, cost: sanitizeDecimalInput(e.target.value) })}
                                        className="w-full px-2 py-2 border border-white/10 rounded-lg text-slate-100 focus:ring-2 focus:ring-amber-500 outline-none font-mono tabular-nums"
                                    />
                                </div>
                                <div>
                                    <label className="text-[10px] text-slate-500 font-bold">STOCK</label>
                                    <input
                                        type="text" inputMode="decimal"
                                        value={quickProduct.stock}
                                        onChange={e => setQuickProduct({ ...quickProduct, stock: sanitizeDecimalInput(e.target.value) })}
                                        className="w-full px-2 py-2 border border-white/10 rounded-lg text-slate-100 focus:ring-2 focus:ring-amber-500 outline-none font-mono tabular-nums"
                                    />
                                </div>
                            </div>
                            <button
                                type="submit"
                                disabled={quickSaving}
                                className="w-full py-3 rounded-lg bg-gradient-to-r from-amber-500 to-orange-500 text-white font-bold hover:from-amber-600 hover:to-orange-600 shadow-lg transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                            >
                                {quickSaving ? <Loader2 size={18} className="animate-spin" /> : <Zap size={18} />}
                                {quickSaving ? 'Guardando...' : 'Crear y Agregar al Carrito'}
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
                                        <p className="font-bold text-emerald-300">Importacion Completada</p>
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
                <div className="mb-4 flex gap-2">
                    <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
                        <input
                            ref={searchRef}
                            type="text"
                            placeholder="Buscar producto o escanear codigo..."
                            className="w-full pl-10 pr-4 py-3 rounded-xl border border-white/[0.06] focus:outline-none focus:ring-2 focus:ring-nortex-500 shadow-sm text-slate-100 font-medium"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            onKeyDown={handleSearchKeyDown}
                        />
                    </div>
                    {/* Quick Create */}
                    <button
                        onClick={() => setShowQuickCreate(true)}
                        className="bg-gradient-to-r from-amber-500 to-orange-500 text-white px-3 rounded-xl flex items-center gap-1.5 font-bold text-sm hover:from-amber-600 hover:to-orange-600 shadow-md transition-all"
                        title="Producto Rápido"
                    >
                        <Zap size={18} /> {simpleMode ? 'Agregar' : 'Rápido'}
                    </button>
                    {/* Full Create */}
                    {!simpleMode && <button
                        onClick={() => setShowAddModal(true)}
                        className="bg-nortex-500 text-white px-3 rounded-xl flex items-center gap-1.5 font-medium text-sm hover:bg-nortex-600 transition-all"
                        title="Crear producto completo"
                    >
                        <Plus size={18} /> Nuevo
                    </button>}
                    {/* Import */}
                    {!simpleMode && <button
                        onClick={() => setShowImportModal(true)}
                        className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white px-3 rounded-xl flex items-center gap-1.5 font-bold text-sm hover:from-blue-700 hover:to-indigo-700 shadow-md transition-all"
                        title="Importar desde Excel"
                    >
                        <Upload size={18} /> Excel
                    </button>}
                </div>

                {/* TOP SELLERS QUICK ACCESS */}
                {searchTerm === '' && (
                    <div className="mb-4">
                        <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                            <Zap size={14} className="text-amber-500" /> Mas Vendidos
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
                                    <span className="text-xs font-black text-emerald-400 mt-auto">C${product.price}</span>
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 overflow-y-auto pb-4 custom-scrollbar flex-1 min-h-0">
                    {filteredProducts.map(product => (
                        <button
                            key={product.id}
                            onClick={() => { addToCart(product); playBeep(); }}
                            disabled={product.stock === 0}
                            className="panel-premium-light aspect-square p-4 hover:border-brand/40 hover:shadow-glow shadow-brand/10 transition-all text-left flex flex-col justify-between text-slate-100 active:scale-95 disabled:opacity-50 disabled:active:scale-100 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-brand/40"
                        >
                            <div className="min-w-0">
                                <div className="flex justify-between items-start mb-1 gap-1">
                                    <span className="text-xs font-mono tabular-nums text-slate-400 truncate">{product.sku}</span>
                                    <span className="text-[10px] px-1.5 py-0.5 bg-white/[0.04] text-slate-500 rounded font-medium flex-shrink-0">{product.category}</span>
                                </div>
                                <h3 className="font-semibold text-slate-100 leading-tight mt-1 line-clamp-3">{product.name}</h3>
                            </div>
                            <div className="mt-3 flex justify-between items-end gap-1">
                                <span className="text-lg font-bold text-white font-mono tabular-nums">C$ {product.price.toFixed(2)}</span>
                                <span className={`text-xs px-2 py-1 rounded flex-shrink-0 ${product.stock === 0 ? 'bg-red-500/15 text-red-400 font-bold' : product.stock <= 5 ? 'bg-amber-500/15 text-amber-400' : 'bg-white/[0.04] text-slate-500'}`}>
                                    {product.stock === 0 ? 'AGOTADO' : `Stock: ${product.stock}`}
                                </span>
                            </div>
                        </button>
                    ))}
                </div>

                {/* ⌨️ HOTKEY CHEAT SHEET */}
                <div className="hidden lg:flex items-center gap-3 mt-2 px-2 py-1.5 text-[10px] text-slate-400 font-mono select-none flex-shrink-0">
                    <Keyboard size={12} className="text-slate-300" />
                    <span className="bg-white/[0.04] px-1.5 py-0.5 rounded text-slate-500">F2</span> Buscar
                    <span className="text-slate-300">·</span>
                    <span className="bg-white/[0.04] px-1.5 py-0.5 rounded text-slate-500">F4</span> Aparcar
                    <span className="text-slate-300">·</span>
                    <span className="bg-white/[0.04] px-1.5 py-0.5 rounded text-slate-500">F7</span> Salida
                    <span className="text-slate-300">·</span>
                    <span className="bg-white/[0.04] px-1.5 py-0.5 rounded text-slate-500">F8</span> Entrada
                    <span className="text-slate-300">·</span>
                    <span className="bg-white/[0.04] px-1.5 py-0.5 rounded text-slate-500">F9</span> Cobrar
                    <span className="text-slate-300">·</span>
                    <span className="bg-white/[0.04] px-1.5 py-0.5 rounded text-slate-500">Esc</span> Cerrar
                </div>
            </div>

            {/* RIGHT: CART DRAWER (Responsive) */}
            {/* Mobile Toggle Button */}
            <div className="lg:hidden fixed bottom-20 left-4 right-4 z-40">
                <button
                    onClick={() => setShowMobileCart(true)}
                    className="w-full bg-nortex-900 text-white py-4 rounded-xl shadow-2xl flex items-center justify-between px-6 font-bold text-lg animate-in slide-in-from-bottom duration-300"
                >
                    <div className="flex items-center gap-2">
                        <div className="bg-white/20 p-2 rounded-lg">
                            <ShoppingCart size={24} />
                        </div>
                        <span>Ver Carrito ({cart.reduce((a, b) => a + b.quantity, 0)})</span>
                    </div>
                    <span>C$ {grandTotal.toFixed(2)}</span>
                </button>
            </div>

            {/* Cart Container - Drawer on Mobile, Sidebar on Desktop */}
            <div className={`
          fixed inset-0 z-50 bg-surface-900 lg:static lg:z-auto lg:w-96 lg:border-l lg:border-white/[0.06] flex flex-col lg:shadow-xl lg:mt-14 transition-all duration-300
          ${showMobileCart ? 'translate-y-0 opacity-100' : 'translate-y-full lg:translate-y-0 opacity-0 pointer-events-none lg:opacity-100 lg:pointer-events-auto'}
      `}>
                <div className="p-5 border-b border-white/[0.04] bg-surface-800/40 text-slate-100 flex items-center justify-between">
                    <h2 className="font-bold text-slate-100 flex items-center gap-2"><ShoppingCart size={20} /> Ticket</h2>
                    {/* Mobile Close Button */}
                    <button onClick={() => setShowMobileCart(false)} className="lg:hidden p-2 bg-white/[0.06] rounded-full text-slate-300">
                        <ArrowDownCircle size={24} />
                    </button>
                </div>

                {/* EMPLOYEE AUTO-ASSIGNED (from PIN on shift open) */}
                {currentShift?.employee && (
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
                <div className="px-4 pt-4 relative">
                    <label className="text-[10px] font-black text-indigo-400 uppercase tracking-widest mb-1.5 flex items-center gap-1.5">
                        <User size={12} /> {simpleMode ? 'CLIENTE (OPCIONAL)' : 'CLIENTE PARA SCORING'}
                    </label>
                    <div className="relative">
                        <div className="absolute left-4 top-1/2 -translate-y-1/2 w-9 h-9 bg-indigo-500/15 rounded-full flex items-center justify-center">
                            <User className="text-indigo-400" size={20} />
                        </div>
                        <input
                            type="text"
                            placeholder="Buscar o seleccionar cliente..."
                            className="w-full pl-16 pr-10 py-4 text-base font-bold border-2 border-brand rounded-xl outline-none focus:border-brand-hover focus:ring-4 focus:ring-brand/20 bg-brand/5 text-slate-100 placeholder:text-slate-500 placeholder:font-medium transition-all shadow-sm"
                            value={selectedCustomer ? selectedCustomer.name : customerSearch}
                            onChange={(e) => {
                                setCustomerSearch(e.target.value);
                                setSelectedCustomer(null);
                                setShowCustomerDropdown(true);
                            }}
                            onFocus={() => setShowCustomerDropdown(true)}
                        />
                        {selectedCustomer && (
                            <button onClick={() => { setSelectedCustomer(null); setCustomerSearch(''); }} className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 bg-red-500/15 rounded-full text-red-500 hover:bg-red-200 hover:text-red-400 transition-colors">
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
                                        <div className="text-[11px] text-slate-500 mt-0.5">Limite: C${c.creditLimit} | Deuda: C${c.currentDebt}</div>
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
                                {!selectedCustomer.isBlocked && <span className="text-sm">C${(selectedCustomer.creditLimit - selectedCustomer.currentDebt).toFixed(2)}</span>}
                            </div>
                            {!selectedCustomer.isBlocked && (
                                <div className="w-full bg-blue-200 h-2 rounded-full overflow-hidden">
                                    <div className="bg-blue-500 h-full transition-all" style={{ width: `${Math.min((selectedCustomer.currentDebt / selectedCustomer.creditLimit) * 100, 100)}%` }}></div>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar">
                    {cart.length === 0 ? (
                        <div className="h-full flex flex-col items-center justify-center text-slate-400 space-y-4">
                            <ShoppingCart size={32} /> <p className="text-sm">Carrito vacio</p>
                            <p className="text-[10px] text-slate-300">Escanea un codigo de barras o selecciona un producto</p>
                        </div>
                    ) : (
                        cart.map(item => {
                            const lineDiscount = (item as CartLine).discount ?? 0;
                            const lineDiscountD = toDecimal(lineDiscount);
                            const lineTotalD = toDecimal(item.price).mul(item.quantity).mul(new Decimal(1).minus(lineDiscountD.div(100)));
                            const tierBadge = lineTierBadge(item as CartLine, Boolean(selectedCustomer?.isWholesale));
                            const packSize = (item as CartLine).packSize;
                            const packLabel = ((item as CartLine).packUnit || 'caja').toLowerCase();
                            return (
                                <div key={item.id} className="bg-surface-800/40 p-3 rounded-lg border border-white/[0.04] text-slate-100">
                                    <div className="flex items-center gap-3">
                                        <div className="flex-1 min-w-0">
                                            <h4 className="text-sm font-medium text-slate-100 line-clamp-1">{item.name}</h4>
                                            <div className="text-xs text-slate-500 mt-0.5 font-mono tabular-nums flex items-center gap-1.5 flex-wrap">
                                                <span>C$ {item.price.toFixed(2)} / {(item as CartLine).unit || 'und'}</span>
                                                {tierBadge && (
                                                    <span className="px-1.5 py-0.5 bg-indigo-500/15 text-indigo-400 rounded text-[9px] font-bold tracking-wide">{tierBadge}</span>
                                                )}
                                                {packSize != null && packSize > 0 && (
                                                    <button
                                                        onClick={() => updateQuantity(item.id, packSize)}
                                                        className="px-1.5 py-0.5 bg-emerald-500/15 text-emerald-400 hover:bg-emerald-200 rounded text-[9px] font-bold tracking-wide transition-colors"
                                                        title={`Agregar 1 ${packLabel} (${packSize} ${(item as CartLine).unit || 'und'})`}
                                                    >
                                                        +1 {packLabel.toUpperCase()} ({packSize})
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-1 bg-surface-900 rounded border border-white/[0.06] p-1 text-slate-100">
                                            <button onClick={() => updateQuantity(item.id, -0.5)} className="p-1 hover:bg-white/[0.06] rounded text-slate-300"><Minus size={14} /></button>
                                            <NumberDraftInput
                                                value={item.quantity}
                                                onCommit={(n) => { if (n > 0) setQuantity(item.id, n); }}
                                                ariaLabel={`Cantidad de ${item.name}`}
                                                className="w-14 text-center text-sm font-mono tabular-nums font-bold border-0 outline-none bg-transparent text-slate-100"
                                            />
                                            <button onClick={() => updateQuantity(item.id, 0.5)} className="p-1 hover:bg-white/[0.06] rounded text-slate-300"><Plus size={14} /></button>
                                        </div>
                                        <div className="text-right min-w-[60px]">
                                            <div className="text-sm font-bold text-white font-mono tabular-nums">C$ {lineTotalD.toFixed(2)}</div>
                                            <button onClick={() => removeFromCart(item.id)} className="text-red-400 hover:text-red-400 mt-1"><Trash2 size={14} className="ml-auto" /></button>
                                        </div>
                                    </div>
                                    {/* Per-item discount row */}
                                    <div className="flex items-center gap-2 mt-1.5 pt-1.5 border-t border-white/[0.04]">
                                        <Percent size={11} className="text-slate-400" />
                                        <NumberDraftInput
                                            value={lineDiscount}
                                            onCommit={(n) => setItemDiscount(item.id, n)}
                                            allowZero
                                            placeholder="0"
                                            ariaLabel={`Descuento de ${item.name} en porcentaje`}
                                            className="w-12 text-[11px] text-center border border-white/[0.06] rounded px-1 py-0.5 outline-none focus:border-brand text-slate-200 font-mono tabular-nums"
                                        />
                                        <span className="text-[10px] text-slate-400">% desc</span>
                                        {lineDiscountD.greaterThan(0) && (
                                            <span className="text-[10px] text-red-500 font-bold ml-auto">-C${toDecimal(item.price).mul(item.quantity).mul(lineDiscountD).div(100).toFixed(2)}</span>
                                        )}
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>
                <div className="p-5 border-t border-white/[0.04] bg-surface-800/40 text-slate-100">
                    {/* 💸 Global Discount (oculto en modo simple para no invitar al error) */}
                    {!simpleMode && <div className="flex items-center gap-2 mb-2">
                        <Percent size={14} className="text-slate-400" />
                        <span className="text-xs text-slate-500 font-bold">Descuento Global</span>
                        <input
                            type="text"
                            inputMode="decimal"
                            placeholder="0"
                            aria-label="Descuento global en porcentaje"
                            className="w-14 text-xs text-center border border-white/[0.06] rounded px-1 py-1 outline-none focus:border-brand text-slate-200 font-mono tabular-nums"
                            value={globalDiscount}
                            onChange={e => setGlobalDiscount(sanitizeDecimalInput(e.target.value))}
                        />
                        <span className="text-xs text-slate-400">%</span>
                        {globalDiscountD.greaterThan(0) && (
                            <span className="text-xs text-red-500 font-bold ml-auto">-C${totalD.mul(globalDiscountD).div(100).toFixed(2)}</span>
                        )}
                    </div>}
                    <div className="flex justify-between text-sm text-slate-500 mb-1"><span>Subtotal</span><span className="font-mono tabular-nums">C$ {total.toFixed(2)}</span></div>
                    {globalDiscountD.greaterThan(0) && <div className="flex justify-between text-sm text-red-500 mb-1"><span>Descuento ({globalDiscountNum}%)</span><span className="font-mono tabular-nums">-C$ {totalD.mul(globalDiscountD).div(100).toFixed(2)}</span></div>}
                    <div className="flex justify-between text-sm text-slate-500 mb-1"><span>IVA (15%)</span><span className="font-mono tabular-nums">C$ {tax.toFixed(2)}</span></div>
                    <div className="flex justify-between text-xl font-bold text-white mb-4 pt-2 border-t border-white/[0.06]"><span>Total</span><span className="font-mono tabular-nums">C$ {grandTotal.toFixed(2)}</span></div>

                    {/* 💥 MASSIVE PAYMENT BUTTONS - FAT FINGER FRIENDLY */}
                    <div className="grid grid-cols-2 gap-3 mb-3">
                        <button
                            onClick={() => { setCashReceived(''); setPayingInUSD(false); setUsdAmount(''); setShowCashPreModal(true); }}
                            disabled={!currentShift || processing || cart.length === 0}
                            className="h-16 bg-gradient-to-b from-green-500 to-green-700 text-white font-black rounded-xl hover:from-green-600 hover:to-green-800 text-xl flex items-center justify-center gap-2.5 shadow-lg hover:shadow-xl active:scale-[0.97] transition-all disabled:opacity-50 disabled:cursor-not-allowed border-2 border-green-400/30"
                        >
                            <Banknote size={28} strokeWidth={2.5} /> EFECTIVO
                        </button>
                        <button
                            onClick={() => handleCheckout('CREDIT')}
                            disabled={!currentShift || processing || isCreditBlocked}
                            className={`h-16 font-black rounded-xl text-xl flex items-center justify-center gap-2.5 shadow-lg active:scale-[0.97] transition-all border-2 ${
                                isCreditBlocked
                                    ? 'bg-white/10 text-slate-500 cursor-not-allowed border-white/[0.06]'
                                    : 'bg-gradient-to-b from-indigo-500 to-indigo-700 text-white hover:from-indigo-600 hover:to-indigo-800 hover:shadow-xl border-indigo-400/30'
                            }`}
                        >
                            {isCreditBlocked ? <Ban size={28} strokeWidth={2.5} /> : <CreditCard size={28} strokeWidth={2.5} />} CRÉDITO
                        </button>
                    </div>
                    {isCreditBlocked && selectedCustomer && (
                        <p className="text-xs text-center text-red-500 font-bold mb-1">Credito no disponible: Limite excedido o cliente bloqueado.</p>
                    )}
                </div>
            </div>

            {/* =============================== */}
            {/* 🔄 RETURNS MODAL                */}
            {/* =============================== */}
            {showReturnModal && (
                <div className="absolute inset-0 z-50 bg-slate-900/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
                    <div className="bg-surface-900 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden border border-white/[0.06] max-h-[90vh] flex flex-col">
                        <div className="bg-gradient-to-r from-amber-500 to-orange-600 px-6 py-4 flex items-center justify-between">
                            <h3 className="text-lg font-bold text-white flex items-center gap-2"><RefreshCw size={20} /> Devolución de Producto</h3>
                            <button onClick={() => { setShowReturnModal(false); setReturnSaleData(null); setReturnItems([]); setReturnSaleSearch(''); setReturnReason(''); }} className="text-white/80 hover:text-white"><X size={20} /></button>
                        </div>
                        <div className="p-5 flex-1 overflow-y-auto space-y-4">
                            {/* Sale Search */}
                            <div>
                                <label className="text-xs font-bold text-slate-300 mb-1 block">Buscar Venta por ID</label>
                                <div className="flex gap-2">
                                    <input
                                        type="text"
                                        placeholder="Ej: clp8..."
                                        className="flex-1 px-3 py-2 border border-white/10 rounded-lg text-sm outline-none focus:border-amber-500 text-slate-100"
                                        value={returnSaleSearch}
                                        onChange={e => setReturnSaleSearch(e.target.value)}
                                    />
                                    <button
                                        onClick={async () => {
                                            if (!returnSaleSearch.trim()) return;
                                            try {
                                                const token = localStorage.getItem('nortex_token');
                                                const res = await fetch(`/api/sales/search?q=${returnSaleSearch}`, { headers: { 'Authorization': `Bearer ${token}` } });
                                                const data = await res.json();
                                                if (!res.ok) throw new Error(data.error);
                                                setReturnSaleData(data);
                                                setReturnItems(data.items.map((item: any) => ({
                                                    productId: item.productId,
                                                    name: item.productId, // Will be populated
                                                    quantity: 0,
                                                    price: Number(item.priceAtSale),
                                                    maxQty: Number(item.quantity)
                                                })));
                                            } catch (err: any) { alert(err.message); }
                                        }}
                                        className="px-4 py-2 bg-amber-500 text-white font-bold rounded-lg hover:bg-amber-600 text-sm"
                                    >
                                        <Search size={16} />
                                    </button>
                                </div>
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
                                            <span className="font-bold text-slate-100">C$ {Number(returnSaleData.total).toFixed(2)}</span>
                                        </div>
                                        <div className="flex justify-between text-xs">
                                            <span className="text-slate-500">Método:</span>
                                            <span className="text-slate-200">{returnSaleData.paymentMethod}</span>
                                        </div>
                                    </div>

                                    {/* Items Selection */}
                                    <div>
                                        <label className="text-xs font-bold text-slate-300 mb-2 block">Seleccionar Items a Devolver</label>
                                        <div className="space-y-2">
                                            {returnItems.map((item, idx) => (
                                                <div key={idx} className="flex items-center gap-3 bg-surface-800/40 p-2 rounded-lg border border-white/[0.04]">
                                                    <div className="flex-1 min-w-0">
                                                        <p className="text-xs font-medium text-slate-200 truncate">{returnSaleData.items[idx]?.productId?.slice(0, 8) || item.productId.slice(0, 8)}...</p>
                                                        <p className="text-[10px] text-slate-400">C$ {item.price.toFixed(2)} · Max: {item.maxQty}</p>
                                                    </div>
                                                    <div className="flex items-center gap-1">
                                                        <button
                                                            onClick={() => { const n = [...returnItems]; n[idx].quantity = Math.max(0, n[idx].quantity - 1); setReturnItems(n); }}
                                                            className="p-1 hover:bg-white/[0.06] rounded text-slate-500"
                                                        ><Minus size={12} /></button>
                                                        <span className="w-8 text-center text-sm font-bold text-slate-100">{item.quantity}</span>
                                                        <button
                                                            onClick={() => { const n = [...returnItems]; n[idx].quantity = Math.min(n[idx].maxQty, n[idx].quantity + 1); setReturnItems(n); }}
                                                            className="p-1 hover:bg-white/[0.06] rounded text-slate-500"
                                                        ><Plus size={12} /></button>
                                                    </div>
                                                </div>
                                            ))}
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
                                            onChange={e => setReturnReason(e.target.value)}
                                        />
                                    </div>

                                    {/* Confirm */}
                                    {returnItems.some(i => i.quantity > 0) && (
                                        <div>
                                            <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3 mb-3">
                                                <div className="flex justify-between font-bold">
                                                    <span className="text-amber-300">Total Devolución:</span>
                                                    <span className="text-amber-400">C$ {returnItems.reduce((sum, i) => sum + i.price * i.quantity, 0).toFixed(2)}</span>
                                                </div>
                                            </div>
                                            <button
                                                onClick={async () => {
                                                    setReturnProcessing(true);
                                                    try {
                                                        const token = localStorage.getItem('nortex_token');
                                                        const itemsToReturn = returnItems.filter(i => i.quantity > 0);
                                                        const res = await fetch('/api/returns', {
                                                            method: 'POST',
                                                            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                                                            body: JSON.stringify({
                                                                saleId: returnSaleData.id,
                                                                items: itemsToReturn,
                                                                reason: returnReason
                                                            })
                                                        });
                                                        const data = await res.json();
                                                        if (!res.ok) throw new Error(data.error);
                                                        alert('Devolución procesada. Stock restaurado.');
                                                        setShowReturnModal(false);
                                                        setReturnSaleData(null);
                                                        setReturnItems([]);
                                                        setReturnSaleSearch('');
                                                        setReturnReason('');
                                                        fetchProducts();
                                                    } catch (err: any) { alert(err.message); } finally { setReturnProcessing(false); }
                                                }}
                                                disabled={returnProcessing}
                                                className="w-full py-3 bg-amber-500 text-white font-bold rounded-lg hover:bg-amber-600 disabled:opacity-50 flex items-center justify-center gap-2"
                                            >
                                                {returnProcessing ? <Loader2 size={18} className="animate-spin" /> : <RefreshCw size={18} />}
                                                Confirmar Devolución
                                            </button>
                                        </div>
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
                                    <span className="font-bold text-slate-100">C$ {creditInfo.currentDebt.toFixed(2)}</span>
                                </div>
                                <div className="w-full bg-white/[0.06] h-3 rounded-full overflow-hidden">
                                    <div className={`h-full rounded-full transition-all duration-500 ${creditInfo.color === 'red' ? 'bg-red-500' : creditInfo.color === 'yellow' ? 'bg-amber-400' : 'bg-emerald-500'
                                        }`} style={{ width: `${Math.min(creditInfo.debtPct, 100)}%` }} />
                                </div>
                                <div className="flex justify-between text-[10px] mt-1">
                                    <span className="text-slate-400">Límite: C$ {creditInfo.limit.toFixed(2)}</span>
                                    <span className="font-bold text-slate-300">{Math.round(creditInfo.debtPct)}%</span>
                                </div>
                            </div>

                            {/* Projected */}
                            <div className="bg-surface-800/40 rounded-lg p-3 border border-white/[0.04]">
                                <p className="text-xs text-slate-500 mb-1">Con esta venta (+C$ {grandTotal.toFixed(2)}):</p>
                                <div className="flex justify-between">
                                    <span className="text-sm font-bold text-slate-200">Nuevo total:</span>
                                    <span className={`text-sm font-bold ${creditInfo.projectedColor === 'red' ? 'text-red-400' : creditInfo.projectedColor === 'yellow' ? 'text-amber-400' : 'text-emerald-400'}`}>
                                        C$ {creditInfo.projectedDebt.toFixed(2)} ({Math.round(creditInfo.projectedPct)}%)
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
            {/* =============================== */}
            {/* 💵 PRE-SALE CASH MODAL          */}
            {/* =============================== */}
            {showCashPreModal && (
                <div className="absolute inset-0 z-50 bg-slate-900/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
                    <div className="bg-surface-900 rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden border border-white/[0.06]">
                        <div className="bg-gradient-to-r from-green-500 to-emerald-600 p-5 text-center">
                            <Banknote size={32} className="text-white mx-auto mb-2" />
                            <h2 className="text-lg font-bold text-white">Cobro en Efectivo</h2>
                            <p className="text-emerald-100 text-2xl font-black mt-1">C$ {grandTotal.toFixed(2)}</p>
                        </div>
                        <div className="p-5 space-y-4">
                            {/* USD toggle */}
                            <div className="flex items-center justify-between">
                                <label className="text-xs font-mono text-slate-500 font-bold">EFECTIVO RECIBIDO</label>
                                <button
                                    onClick={() => { setPayingInUSD(!payingInUSD); setUsdAmount(''); setCashReceived(''); }}
                                    className={`text-[10px] font-bold px-2 py-1 rounded-full border transition-all ${payingInUSD ? 'bg-blue-500 text-white border-blue-500' : 'bg-white/[0.04] text-slate-500 border-white/[0.06] hover:border-blue-300'}`}
                                >
                                    {payingInUSD ? 'USD ' : 'Paga en USD?'}
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
                                    <div className="text-xs text-blue-400 text-center font-medium">Tasa: 1 USD = C${exchangeRate.toFixed(2)} NIO</div>
                                    {toDecimal(usdAmount).greaterThan(0) && (
                                        <div className="bg-blue-500/10 px-3 py-2 rounded-lg border border-blue-500/20 text-sm">
                                            <div className="flex justify-between"><span className="text-blue-400">Equivalente NIO:</span><span className="font-bold text-blue-300 font-mono tabular-nums">C$ {toDecimal(usdAmount).mul(exchangeRate).toFixed(2)}</span></div>
                                            {toDecimal(usdAmount).mul(exchangeRate).greaterThanOrEqualTo(grandTotal) && (
                                                <>
                                                    <div className="flex justify-between mt-1 pt-1 border-t border-blue-500/20"><span className="font-bold text-emerald-400">Cambio NIO:</span><span className="font-bold text-emerald-400 font-mono tabular-nums">C$ {toDecimal(usdAmount).mul(exchangeRate).minus(grandTotal).toFixed(2)}</span></div>
                                                    <div className="flex justify-between mt-0.5"><span className="text-emerald-500 text-xs">Cambio USD:</span><span className="font-bold text-emerald-500 text-xs font-mono tabular-nums">$ {toDecimal(usdAmount).minus(toDecimal(grandTotal).div(exchangeRate)).toFixed(2)}</span></div>
                                                </>
                                            )}
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <>
                                    <div className="flex gap-2 flex-wrap">
                                        <button onClick={() => setCashReceived(grandTotal.toFixed(2))} className="flex-shrink-0 px-3 py-1.5 bg-emerald-500/15 text-emerald-400 hover:bg-emerald-200 font-bold rounded-lg text-xs border border-emerald-500/20 transition-colors">Monto Exacto</button>
                                        {[100, 200, 500, 1000].map(amt => (
                                            <button key={amt} onClick={() => setCashReceived(amt.toString())} className="flex-shrink-0 px-3 py-1.5 bg-white/[0.04] text-slate-200 hover:bg-white/[0.06] font-bold rounded-lg text-xs border border-white/[0.06] transition-colors">C$ {amt}</button>
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
                                    {cashReceived !== '' && toDecimal(cashReceived).greaterThanOrEqualTo(grandTotal) && (
                                        <div className="flex justify-between items-center bg-emerald-500/10 px-3 py-2 rounded-lg border border-emerald-500/20">
                                            <span className="font-bold text-emerald-400 text-sm">CAMBIO</span>
                                            <span className="text-2xl font-black text-emerald-400 font-mono tabular-nums">C$ {toDecimal(cashReceived).minus(grandTotal).toFixed(2)}</span>
                                        </div>
                                    )}
                                    {cashReceived !== '' && toDecimal(cashReceived).lessThan(grandTotal) && (
                                        <div className="flex justify-between items-center bg-red-500/10 px-3 py-2 rounded-lg border border-red-500/20">
                                            <span className="font-bold text-red-400 text-sm">FALTANTE</span>
                                            <span className="text-xl font-bold text-red-400 font-mono tabular-nums">C$ {toDecimal(grandTotal).minus(toDecimal(cashReceived)).toFixed(2)}</span>
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
                                    className="flex-1 py-3 rounded-xl bg-gradient-to-b from-green-500 to-green-700 text-white font-black hover:from-green-600 hover:to-green-800 transition-all shadow-lg disabled:opacity-50 flex items-center justify-center gap-2"
                                >
                                    {processing ? <Loader2 size={18} className="animate-spin" /> : <Check size={18} />}
                                    Confirmar
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {completedSale && (
                <div className="absolute inset-0 z-50 bg-slate-900/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
                    <div className="bg-surface-900 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden border border-white/[0.06]">

                        {/* Header - Success */}
                        <div className="bg-gradient-to-r from-emerald-500 to-green-600 p-6 text-center relative overflow-hidden">
                            <div className="absolute -right-6 -top-6 w-24 h-24 bg-white/10 rounded-full blur-xl" />
                            <div className="w-16 h-16 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-3 relative z-10">
                                <Check size={36} className="text-white" />
                            </div>
                            <h2 className="text-xl font-bold text-white relative z-10">Venta Registrada con Exito</h2>
                            <p className="text-emerald-100 text-sm mt-1 relative z-10">{completedSale.date}</p>
                        </div>

                        {/* Sale Summary */}
                        <div className="p-6">
                            <div className="bg-surface-800/40 rounded-xl p-4 mb-4 border border-white/[0.04]">
                                <div className="flex justify-between items-center mb-2">
                                    <span className="text-sm text-slate-500">Cliente</span>
                                    <span className="font-bold text-slate-100">{completedSale.customerName}</span>
                                </div>
                                <div className="flex justify-between items-center mb-2">
                                    <span className="text-sm text-slate-500">Metodo</span>
                                    <span className="font-medium text-slate-200">
                                        {completedSale.paymentMethod === 'CASH' ? 'Efectivo' :
                                            completedSale.paymentMethod === 'CREDIT' ? 'Credito' :
                                                completedSale.paymentMethod === 'CARD' ? 'Tarjeta' : completedSale.paymentMethod}
                                    </span>
                                </div>
                                <div className="border-t border-white/[0.06] pt-2 mt-2">
                                    <div className="flex justify-between items-center">
                                        <span className="text-lg font-bold text-slate-100">Total Cobrado</span>
                                        <span className="text-2xl font-bold text-emerald-400">C$ {completedSale.grandTotal.toFixed(2)}</span>
                                    </div>
                                </div>

                                {/* Cash change summary - read-only, set before sale */}
                                {completedSale.paymentMethod === 'CASH' && cashReceived !== '' && toDecimal(cashReceived).greaterThan(0) && (
                                    <div className="mt-3 pt-3 border-t border-white/[0.06] space-y-2">
                                        <div className="flex justify-between items-center">
                                            <span className="text-sm text-slate-500">Efectivo recibido</span>
                                            <span className="font-bold text-slate-200 font-mono tabular-nums">
                                                {payingInUSD && usdAmount ? `$ ${usdAmount} (C$ ${cashReceived})` : `C$ ${toDecimal(cashReceived).toFixed(2)}`}
                                            </span>
                                        </div>
                                        {toDecimal(cashReceived).greaterThanOrEqualTo(completedSale.grandTotal) && (
                                            <div className="flex justify-between items-center bg-emerald-500/10 px-3 py-2 rounded-lg border border-emerald-500/20">
                                                <span className="font-bold text-emerald-400 text-sm">CAMBIO</span>
                                                <span className="text-xl font-black text-emerald-400 font-mono tabular-nums">C$ {toDecimal(cashReceived).minus(completedSale.grandTotal).toFixed(2)}</span>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>

                            {/* Action Buttons */}
                            <div className="grid grid-cols-2 gap-3 mb-3">
                                {/* WhatsApp */}
                                <button
                                    onClick={handleWhatsApp}
                                    className="flex items-center justify-center gap-2 py-3 bg-green-500 hover:bg-green-600 text-white font-bold rounded-xl transition-colors shadow-lg shadow-green-500/20 text-sm"
                                >
                                    <MessageCircle size={18} /> WhatsApp
                                </button>

                                {/* Ticket 80mm */}
                                <button
                                    onClick={handlePrintTicket}
                                    className="flex items-center justify-center gap-2 py-3 bg-slate-700 hover:bg-slate-800 text-white font-bold rounded-xl transition-colors shadow-lg shadow-slate-700/20 text-sm"
                                >
                                    <Printer size={18} /> Ticket 80mm
                                </button>

                                {/* Factura A4 */}
                                <button
                                    onClick={handlePrintA4}
                                    className="flex items-center justify-center gap-2 py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl transition-colors shadow-lg shadow-blue-600/20 text-sm col-span-2"
                                >
                                    <FileText size={18} /> Factura A4
                                </button>
                            </div>

                            {/* New Sale */}
                            <button
                                onClick={handleNewSale}
                                className="w-full py-3.5 bg-nortex-900 hover:bg-nortex-800 text-white font-bold rounded-xl transition-colors flex items-center justify-center gap-2 shadow-lg"
                            >
                                <RotateCcw size={18} /> Nueva Venta
                            </button>
                        </div>
                    </div>
                </div>
            )}
            {/* HIDDEN RECEIPT COMPONENT FOR PRINTING */}
            <ReceiptTicket data={completedSale ? {
                tenantName: getTenantName(),
                ruc: (() => { try { const t = localStorage.getItem('nortex_tenant'); return t ? JSON.parse(t).taxId : undefined; } catch { return undefined; } })(),
                address: (() => { try { const t = localStorage.getItem('nortex_tenant'); return t ? JSON.parse(t).address : undefined; } catch { return undefined; } })(),
                phone: (() => { try { const t = localStorage.getItem('nortex_tenant'); return t ? JSON.parse(t).phone : undefined; } catch { return undefined; } })(),
                dgiAuthCode: (() => { try { const t = localStorage.getItem('nortex_tenant'); return t ? JSON.parse(t).dgiAuthCode : undefined; } catch { return undefined; } })(),
                date: completedSale.date,
                saleId: completedSale.saleId,
                invoiceNumber: completedSale.invoiceNumber,
                invoiceSeries: completedSale.invoiceSeries,
                customerName: completedSale.customerName,
                items: completedSale.items,
                subtotal: completedSale.subtotal,
                tax: completedSale.tax,
                total: completedSale.grandTotal,
                paymentMethod: completedSale.paymentMethod,
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
