import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { MOCK_PRODUCTS } from '../constants';
import { Product, CartItem, Shift } from '../types';
import { ShoppingCart, Plus, Minus, Trash2, Search, CreditCard, Banknote, QrCode, Tag, PackagePlus, X, Save, User, Clock, Lock, ArrowRight, AlertTriangle, DollarSign, Check, Loader2, Ban, ShieldAlert, MessageCircle, Printer, FileText, RotateCcw, Zap, Upload, ScanBarcode, Volume2, VolumeX } from 'lucide-react';
import { printTicket, printA4, sendToWhatsApp, InvoiceData } from './InvoiceTemplate';
import * as XLSX from 'xlsx';

interface Customer {
    id: string;
    name: string;
    phone?: string;
    creditLimit: number;
    currentDebt: number;
    isBlocked: boolean;
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
    const [searchTerm, setSearchTerm] = useState('');
    const [processing, setProcessing] = useState(false);

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
    const [shiftReport, setShiftReport] = useState<{ expected: number, diff: number } | null>(null);
    const [shiftLoading, setShiftLoading] = useState(true);

    // UI State
    const [showMobileCart, setShowMobileCart] = useState(false); // NEW: Mobile Cart Drawer Toggle

    // POST-SALE MODAL STATE
    const [completedSale, setCompletedSale] = useState<CompletedSale | null>(null);
    const [cashReceived, setCashReceived] = useState('');

    // BARCODE SCANNER STATE
    const [scannerActive, setScannerActive] = useState(true);
    const [lastScanFeedback, setLastScanFeedback] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
    const scanBufferRef = useRef('');
    const scanTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
                }));
                setProducts(mapped);
            }
        } catch (e) {
            console.error('Error fetching products:', e);
        }
    }, [headers]);

    // ==========================================
    // INIT POS
    // ==========================================
    useEffect(() => {
        const initPOS = async () => {
            try {
                const token = localStorage.getItem('nortex_token');

                // 1. Check Shift
                const res = await fetch('/api/shifts/current', {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                const data = await res.json();
                if (res.ok && data) {
                    setCurrentShift(data);
                    setShowOpenShift(false);
                } else {
                    setCurrentShift(null);
                    setShowOpenShift(true);
                }

                // 2. Fetch Customers for Dropdown
                const custRes = await fetch('/api/customers', {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (custRes.ok) {
                    setCustomerList(await custRes.json());
                }

                // 3. Check for Ghost Cart
                const pendingCart = localStorage.getItem('nortex_pending_cart');
                if (pendingCart) {
                    setCart(JSON.parse(pendingCart));
                    localStorage.removeItem('nortex_pending_cart');
                    if (!data) alert("¡Bienvenido! Abre tu caja para completar la venta de la demo.");
                }

            } catch (e) {
                console.error("Failed to check shift", e);
                setShowOpenShift(true);
            } finally {
                setShiftLoading(false);
            }
        };
        initPOS();
        fetchProducts();
    }, []);

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
                body: JSON.stringify({ shiftId: currentShift.id, declaredCash: parseFloat(declaredCash) })
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
        setCart(prev => {
            const existing = prev.find(item => item.id === product.id);
            if (existing) return prev.map(item => item.id === product.id ? { ...item, quantity: item.quantity + 1 } : item);
            return [...prev, { ...product, quantity: 1 }];
        });
    }, [currentShift]);

    const removeFromCart = (id: string) => setCart(prev => prev.filter(item => item.id !== id));

    const updateQuantity = (id: string, delta: number) => {
        setCart(prev => prev.map(item => {
            if (item.id === id) {
                const newQty = Math.max(1, item.quantity + delta);
                return { ...item, quantity: newQty };
            }
            return item;
        }));
    };

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

    const total = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const tax = total * 0.15; // IVA 15% Nicaragua
    const grandTotal = total + tax;

    // SMART CREDIT CHECK
    const isCreditBlocked = useMemo(() => {
        if (!selectedCustomer) return true; // Cannot use credit without customer
        if (selectedCustomer.isBlocked) return true;
        if (selectedCustomer.currentDebt + grandTotal > selectedCustomer.creditLimit) return true;
        return false;
    }, [selectedCustomer, grandTotal]);

    const handleCheckout = async (method: 'CASH' | 'CARD' | 'QR' | 'CREDIT') => {
        if (!currentShift) { setShowOpenShift(true); return; }
        if (cart.length === 0) return;

        // Front-end Block
        if (method === 'CREDIT' && isCreditBlocked) {
            alert("Credito Denegado: Cliente bloqueado o sin cupo disponible.");
            return;
        }

        setProcessing(true);
        try {
            const token = localStorage.getItem('nortex_token');
            const res = await fetch('/api/sales', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({
                    items: cart.map(c => ({ id: c.id, quantity: c.quantity, price: c.price, costPrice: c.costPrice })),
                    paymentMethod: method,
                    customerName: selectedCustomer ? selectedCustomer.name : 'Cliente General',
                    customerId: selectedCustomer?.id,
                    total: grandTotal,
                    employeeId: currentShift?.employeeId || currentShift?.employee?.id || null
                })
            });

            const data = await res.json();
            if (!res.ok) throw new Error(data.error);

            // Refresh products to update stock in the grid
            fetchProducts();

            // Show post-sale success modal instead of clearing immediately
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

    const handlePrintTicket = () => {
        const inv = buildInvoiceData();
        if (!inv) return;
        printTicket(inv);
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
        <div className="flex h-full bg-slate-100 relative">

            {/* HEADER BAR */}
            <div className="absolute top-0 right-0 left-0 h-14 bg-white border-b border-slate-200 px-6 flex justify-between items-center z-10 text-slate-800">
                <div className="font-bold text-nortex-900 flex items-center gap-2">
                    PUNTO DE VENTA
                    {currentShift && (
                        <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full border border-green-200 flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
                            {currentShift.employee
                                ? `${currentShift.employee.firstName} ${currentShift.employee.lastName}`
                                : 'CAJA ABIERTA'}
                        </span>
                    )}
                </div>

                <div className="flex items-center gap-3">
                    {/* Scanner indicator */}
                    <button
                        onClick={() => setScannerActive(!scannerActive)}
                        className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full transition-all ${scannerActive
                                ? 'bg-emerald-100 text-emerald-700 border border-emerald-200'
                                : 'bg-slate-100 text-slate-500 border border-slate-200'
                            }`}
                        title={scannerActive ? 'Escáner activo' : 'Escáner desactivado'}
                    >
                        <ScanBarcode size={14} />
                        {scannerActive ? <Volume2 size={12} /> : <VolumeX size={12} />}
                        <span className="hidden xl:inline">{scannerActive ? 'Escáner ON' : 'Escáner OFF'}</span>
                    </button>

                    {currentShift ? (
                        <button onClick={() => setShowCloseShift(true)} className="text-xs font-bold text-red-500 hover:bg-red-50 px-3 py-1.5 rounded transition-colors flex items-center gap-1">
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

            {/* --- OPEN SHIFT MODAL --- */}
            {showOpenShift && (
                <div className="absolute inset-0 z-50 bg-slate-900/90 backdrop-blur flex items-center justify-center p-4">
                    <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-8 text-center animate-in zoom-in duration-200">
                        <div className="w-16 h-16 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-4">
                            <Lock size={32} />
                        </div>
                        <h2 className="text-2xl font-bold text-slate-800 mb-2">Apertura de Caja</h2>
                        <p className="text-slate-500 text-sm mb-6">Ingresa tu PIN de empleado y el fondo inicial.</p>
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
                                            className="w-14 h-14 text-center text-2xl font-bold border-2 border-slate-300 rounded-xl focus:border-nortex-500 outline-none text-slate-800 bg-slate-50"
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
                                    type="number"
                                    className="w-full text-center text-3xl font-bold border-b-2 border-slate-300 focus:border-nortex-500 outline-none pb-2 mt-2 text-slate-800"
                                    placeholder="0.00"
                                    value={initialCash}
                                    onChange={e => setInitialCash(e.target.value)}
                                    required
                                />
                            </div>

                            <button type="submit" disabled={shiftLoading || employeePin.length !== 4} className="w-full py-3 bg-nortex-900 text-white font-bold rounded-lg hover:bg-nortex-800 disabled:opacity-50 disabled:cursor-not-allowed transition-all">
                                {shiftLoading ? 'VERIFICANDO PIN...' : 'ABRIR TURNO'}
                            </button>
                        </form>
                    </div>
                </div>
            )}

            {/* --- CLOSE SHIFT MODAL --- */}
            {showCloseShift && (
                <div className="absolute inset-0 z-50 bg-slate-900/80 backdrop-blur flex items-center justify-center p-4">
                    <div className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in duration-200">
                        {!shiftReport ? (
                            <div className="p-8">
                                <h2 className="text-xl font-bold text-slate-800 mb-1">Cierre de Caja (Ciego)</h2>
                                <p className="text-slate-500 text-sm mb-6">Cuenta el dinero fisico e ingresalo abajo.</p>
                                <form onSubmit={handleCloseShift}>
                                    <label className="text-xs font-mono font-bold text-slate-500">EFECTIVO CONTADO</label>
                                    <div className="relative mb-6">
                                        <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                                        <input
                                            type="number"
                                            autoFocus
                                            className="w-full pl-10 py-3 text-2xl font-bold border border-slate-300 rounded-lg focus:ring-2 focus:ring-nortex-500 outline-none text-slate-800"
                                            placeholder="0.00"
                                            value={declaredCash}
                                            onChange={e => setDeclaredCash(e.target.value)}
                                            required
                                        />
                                    </div>
                                    <div className="flex gap-3">
                                        <button type="button" onClick={() => setShowCloseShift(false)} className="flex-1 py-3 text-slate-600 font-medium hover:bg-slate-50 rounded-lg">Cancelar</button>
                                        <button type="submit" disabled={shiftLoading} className="flex-1 py-3 bg-red-600 text-white font-bold rounded-lg hover:bg-red-700">
                                            {shiftLoading ? 'CERRANDO...' : 'REALIZAR CORTE Z'}
                                        </button>
                                    </div>
                                </form>
                            </div>
                        ) : (
                            <div className="bg-slate-50">
                                <div className="p-8 text-center border-b border-slate-200 bg-white text-slate-800">
                                    <div className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 ${shiftReport.diff >= 0 ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600'}`}>
                                        {shiftReport.diff >= 0 ? <Check size={32} /> : <AlertTriangle size={32} />}
                                    </div>
                                    <h2 className="text-2xl font-bold text-slate-800">Resumen de Cierre</h2>
                                    <p className={`text-lg font-bold mt-2 ${shiftReport.diff >= 0 ? 'text-green-600' : 'text-red-600'}`}>
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
                                    <div className="border-t border-slate-200 pt-3 flex justify-between text-base text-slate-800">
                                        <span className="font-bold text-slate-700">Diferencia</span>
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
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden border border-slate-200 text-slate-800">
                        <div className="p-5 border-b border-slate-100 flex justify-between items-center bg-slate-50 text-slate-800">
                            <h3 className="font-bold text-slate-800 flex items-center gap-2">
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
                                    <input type="text" required className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-nortex-500 text-slate-800"
                                        placeholder="Ej. Taladro Percutor 500W" value={newProduct.name} onChange={e => setNewProduct({ ...newProduct, name: e.target.value })} />
                                </div>
                                <div>
                                    <label className="block text-xs font-mono text-slate-500 mb-1">SKU / CODIGO BARRAS</label>
                                    <input type="text" className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-nortex-500 text-slate-800"
                                        placeholder="Escanea o escribe" value={newProduct.sku} onChange={e => setNewProduct({ ...newProduct, sku: e.target.value.toUpperCase() })} />
                                </div>
                                <div>
                                    <label className="block text-xs font-mono text-slate-500 mb-1">CATEGORIA</label>
                                    <select className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-nortex-500 bg-white"
                                        value={newProduct.category} onChange={e => setNewProduct({ ...newProduct, category: e.target.value })} >
                                        <option>General</option><option>Construccion</option><option>Ferreteria</option><option>Herramientas</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs font-mono text-slate-500 mb-1">PRECIO VENTA *</label>
                                    <input type="number" step="0.01" required min="0" className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-nortex-500 text-slate-800"
                                        placeholder="0.00" value={newProduct.price} onChange={e => setNewProduct({ ...newProduct, price: e.target.value })} />
                                </div>
                                <div>
                                    <label className="block text-xs font-mono text-slate-500 mb-1">COSTO (Wholesale) *</label>
                                    <input type="number" step="0.01" required min="0" className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-nortex-500 bg-slate-50 text-slate-800"
                                        placeholder="0.00" value={newProduct.costPrice} onChange={e => setNewProduct({ ...newProduct, costPrice: e.target.value })} />
                                </div>
                                <div className="col-span-2">
                                    <label className="block text-xs font-mono text-slate-500 mb-1">STOCK INICIAL *</label>
                                    <input type="number" required min="0" className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-nortex-500 text-slate-800"
                                        placeholder="0" value={newProduct.stock} onChange={e => setNewProduct({ ...newProduct, stock: e.target.value })} />
                                </div>
                            </div>
                            <button type="submit" className="w-full py-3 rounded-lg bg-nortex-900 text-white font-bold hover:bg-nortex-800 shadow-lg transition-all flex items-center justify-center gap-2">
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
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden border border-slate-200">
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
                                    className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-slate-800 font-semibold focus:ring-2 focus:ring-amber-500 outline-none"
                                />
                            </div>
                            <div>
                                <input
                                    type="text"
                                    placeholder="SKU / Codigo de barras (escanea aqui)"
                                    value={quickProduct.sku}
                                    onChange={e => setQuickProduct({ ...quickProduct, sku: e.target.value.toUpperCase() })}
                                    className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-slate-800 font-mono focus:ring-2 focus:ring-amber-500 outline-none bg-amber-50"
                                />
                            </div>
                            <div className="grid grid-cols-3 gap-2">
                                <div>
                                    <label className="text-[10px] text-slate-500 font-bold">PRECIO *</label>
                                    <input
                                        required type="number" step="0.01" min="0"
                                        placeholder="0.00"
                                        value={quickProduct.price}
                                        onChange={e => setQuickProduct({ ...quickProduct, price: e.target.value })}
                                        className="w-full px-2 py-2 border border-slate-300 rounded-lg text-slate-800 font-bold text-lg focus:ring-2 focus:ring-amber-500 outline-none"
                                    />
                                </div>
                                <div>
                                    <label className="text-[10px] text-slate-500 font-bold">COSTO</label>
                                    <input
                                        type="number" step="0.01" min="0"
                                        placeholder="0.00"
                                        value={quickProduct.cost}
                                        onChange={e => setQuickProduct({ ...quickProduct, cost: e.target.value })}
                                        className="w-full px-2 py-2 border border-slate-300 rounded-lg text-slate-800 focus:ring-2 focus:ring-amber-500 outline-none"
                                    />
                                </div>
                                <div>
                                    <label className="text-[10px] text-slate-500 font-bold">STOCK</label>
                                    <input
                                        type="number" min="0"
                                        value={quickProduct.stock}
                                        onChange={e => setQuickProduct({ ...quickProduct, stock: e.target.value })}
                                        className="w-full px-2 py-2 border border-slate-300 rounded-lg text-slate-800 focus:ring-2 focus:ring-amber-500 outline-none"
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
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden border border-slate-200">
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
                            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                                <p className="text-xs text-blue-800 font-medium mb-1">Columnas esperadas en el archivo:</p>
                                <p className="text-[11px] text-blue-700 font-mono">Nombre | SKU | Precio | Costo | Stock | Categoria | Unidad</p>
                                <p className="text-[10px] text-blue-600 mt-1">Acepta .xlsx y .csv. Los nombres de columna son flexibles (Nombre/name/producto, etc.)</p>
                            </div>

                            {/* File Input */}
                            <div>
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    accept=".xlsx,.xls,.csv"
                                    onChange={handleFileUpload}
                                    className="w-full text-sm text-slate-600 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:font-bold file:bg-blue-100 file:text-blue-700 hover:file:bg-blue-200 file:cursor-pointer"
                                />
                            </div>

                            {/* Progress Bar */}
                            {importProgress && (
                                <div>
                                    <div className="flex justify-between text-xs mb-1">
                                        <span className="text-slate-600 font-medium">{importProgress.step}</span>
                                        <span className="text-slate-500">{importProgress.pct}%</span>
                                    </div>
                                    <div className="w-full bg-slate-200 rounded-full h-2.5 overflow-hidden">
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
                                    <p className="text-sm font-bold text-slate-700 mb-2">Vista previa ({importData.length} productos):</p>
                                    <div className="max-h-40 overflow-y-auto border border-slate-200 rounded-lg">
                                        <table className="w-full text-xs">
                                            <thead className="bg-slate-100 sticky top-0">
                                                <tr>
                                                    <th className="text-left px-2 py-1.5 text-slate-600">SKU</th>
                                                    <th className="text-left px-2 py-1.5 text-slate-600">Nombre</th>
                                                    <th className="text-right px-2 py-1.5 text-slate-600">Precio</th>
                                                    <th className="text-right px-2 py-1.5 text-slate-600">Stock</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-slate-100">
                                                {importData.slice(0, 10).map((row, i) => (
                                                    <tr key={i} className="hover:bg-slate-50">
                                                        <td className="px-2 py-1 font-mono text-slate-500">{row.sku}</td>
                                                        <td className="px-2 py-1 text-slate-700">{row.name}</td>
                                                        <td className="px-2 py-1 text-right text-slate-700">{row.price}</td>
                                                        <td className="px-2 py-1 text-right text-slate-700">{row.stock}</td>
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
                                    <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 text-center">
                                        <Check size={32} className="text-emerald-500 mx-auto mb-2" />
                                        <p className="font-bold text-emerald-800">Importacion Completada</p>
                                        <div className="flex justify-center gap-6 mt-2">
                                            <div>
                                                <p className="text-2xl font-bold text-emerald-600">{importResult.created}</p>
                                                <p className="text-[10px] text-emerald-700">Creados</p>
                                            </div>
                                            <div>
                                                <p className="text-2xl font-bold text-blue-600">{importResult.updated}</p>
                                                <p className="text-[10px] text-blue-700">Actualizados</p>
                                            </div>
                                        </div>
                                    </div>

                                    {importResult.errors.length > 0 && (
                                        <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                                            <p className="text-xs font-bold text-red-700 mb-1">Errores ({importResult.errors.length}):</p>
                                            <ul className="text-[10px] text-red-600 space-y-0.5 max-h-20 overflow-y-auto">
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
            <div className="w-full lg:flex-1 flex flex-col p-4 lg:p-6 mt-14 overflow-hidden mb-16 lg:mb-0">
                <div className="mb-4 flex gap-2">
                    <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
                        <input
                            type="text"
                            placeholder="Buscar producto o escanear codigo..."
                            className="w-full pl-10 pr-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-nortex-500 shadow-sm text-slate-800"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            onKeyDown={handleSearchKeyDown}
                        />
                    </div>
                    {/* Quick Create */}
                    <button
                        onClick={() => setShowQuickCreate(true)}
                        className="bg-gradient-to-r from-amber-500 to-orange-500 text-white px-3 rounded-xl flex items-center gap-1.5 font-bold text-sm hover:from-amber-600 hover:to-orange-600 shadow-md transition-all"
                        title="Producto Rapido"
                    >
                        <Zap size={18} /> <span className="hidden xl:inline">Rapido</span>
                    </button>
                    {/* Full Create */}
                    <button onClick={() => setShowAddModal(true)} className="bg-nortex-500 text-white px-3 rounded-xl flex items-center gap-1.5 font-medium text-sm">
                        <Plus size={18} /> <span className="hidden xl:inline">Nuevo</span>
                    </button>
                    {/* Import */}
                    <button
                        onClick={() => setShowImportModal(true)}
                        className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white px-3 rounded-xl flex items-center gap-1.5 font-bold text-sm hover:from-blue-700 hover:to-indigo-700 shadow-md transition-all"
                        title="Importar Excel"
                    >
                        <Upload size={18} /> <span className="hidden xl:inline">Excel</span>
                    </button>
                </div>

                <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 overflow-y-auto pb-4 custom-scrollbar">
                    {filteredProducts.map(product => (
                        <button key={product.id} onClick={() => { addToCart(product); playBeep(); }} className="bg-white p-4 rounded-xl border border-slate-200 hover:border-nortex-500 hover:shadow-md transition-all text-left flex flex-col justify-between text-slate-800 active:scale-[0.98]">
                            <div>
                                <div className="flex justify-between items-start mb-1">
                                    <span className="text-xs font-mono text-slate-400">{product.sku}</span>
                                    <span className="text-[10px] px-1.5 py-0.5 bg-slate-100 text-slate-500 rounded font-medium">{product.category}</span>
                                </div>
                                <h3 className="font-semibold text-slate-800 leading-tight mt-1">{product.name}</h3>
                            </div>
                            <div className="mt-3 flex justify-between items-end">
                                <span className="text-lg font-bold text-slate-900">C$ {product.price.toFixed(2)}</span>
                                <span className={`text-xs px-2 py-1 rounded ${product.stock === 0 ? 'bg-red-100 text-red-600 font-bold' : product.stock <= 5 ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500'}`}>
                                    {product.stock === 0 ? 'AGOTADO' : `Stock: ${product.stock}`}
                                </span>
                            </div>
                        </button>
                    ))}
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
          fixed inset-0 z-50 bg-white lg:static lg:z-auto lg:w-96 lg:border-l lg:border-slate-200 lg:flex flex-col lg:shadow-xl lg:mt-14 transition-transform duration-300
          ${showMobileCart ? 'translate-y-0' : 'translate-y-full lg:translate-y-0'}
      `}>
                <div className="p-5 border-b border-slate-100 bg-slate-50 text-slate-800 flex items-center justify-between">
                    <h2 className="font-bold text-slate-800 flex items-center gap-2"><ShoppingCart size={20} /> Ticket</h2>
                    {/* Mobile Close Button */}
                    <button onClick={() => setShowMobileCart(false)} className="lg:hidden p-2 bg-slate-200 rounded-full text-slate-600">
                        <ArrowDownCircle size={24} />
                    </button>
                </div>

                {/* EMPLOYEE AUTO-ASSIGNED (from PIN on shift open) */}
                {currentShift?.employee && (
                    <div className="px-4 pt-3">
                        <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 flex items-center gap-2">
                            <div className="w-7 h-7 bg-emerald-200 rounded-full flex items-center justify-center text-emerald-700 font-bold text-xs">
                                {currentShift.employee.firstName[0]}{currentShift.employee.lastName[0]}
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="text-sm font-bold text-emerald-800 truncate">{currentShift.employee.firstName} {currentShift.employee.lastName}</p>
                                <p className="text-[10px] text-emerald-600 uppercase">{currentShift.employee.role} - Vendedor asignado</p>
                            </div>
                        </div>
                    </div>
                )}

                {/* SMART CUSTOMER SEARCH */}
                <div className="px-4 pt-4 relative">
                    <div className="relative">
                        <User className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                        <input
                            type="text"
                            placeholder="Seleccionar Cliente..."
                            className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-lg outline-none focus:border-nortex-500"
                            value={selectedCustomer ? selectedCustomer.name : customerSearch}
                            onChange={(e) => {
                                setCustomerSearch(e.target.value);
                                setSelectedCustomer(null);
                                setShowCustomerDropdown(true);
                            }}
                            onFocus={() => setShowCustomerDropdown(true)}
                        />
                        {selectedCustomer && (
                            <button onClick={() => { setSelectedCustomer(null); setCustomerSearch(''); }} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-red-500">
                                <X size={14} />
                            </button>
                        )}
                    </div>

                    {/* Dropdown Results */}
                    {showCustomerDropdown && !selectedCustomer && (
                        <div className="absolute left-4 right-4 top-12 bg-white border border-slate-200 rounded-lg shadow-lg z-20 max-h-48 overflow-y-auto text-slate-800">
                            {filteredCustomers.length === 0 ? (
                                <div className="p-3 text-xs text-slate-400 text-center">No encontrado. Ir a Clientes para crear.</div>
                            ) : (
                                filteredCustomers.map(c => (
                                    <button
                                        key={c.id}
                                        onClick={() => {
                                            setSelectedCustomer(c);
                                            setShowCustomerDropdown(false);
                                        }}
                                        className="w-full text-left p-2 hover:bg-slate-50 text-sm border-b border-slate-50 last:border-0 text-slate-800"
                                    >
                                        <div className="font-bold text-slate-800">{c.name}</div>
                                        <div className="text-[10px] text-slate-500">Limite: ${c.creditLimit} | Deuda: ${c.currentDebt}</div>
                                    </button>
                                ))
                            )}
                        </div>
                    )}

                    {/* Credit Status Indicator */}
                    {selectedCustomer && (
                        <div className={`mt-2 p-2 rounded text-xs border ${selectedCustomer.isBlocked ? 'bg-red-50 border-red-200 text-red-700' : 'bg-blue-50 border-blue-100 text-blue-700'}`}>
                            <div className="flex justify-between font-bold mb-1">
                                <span>{selectedCustomer.isBlocked ? 'BLOQUEADO' : 'Linea Disponible:'}</span>
                                {!selectedCustomer.isBlocked && <span>${(selectedCustomer.creditLimit - selectedCustomer.currentDebt).toFixed(2)}</span>}
                            </div>
                            {!selectedCustomer.isBlocked && (
                                <div className="w-full bg-blue-200 h-1.5 rounded-full overflow-hidden">
                                    <div className="bg-blue-500 h-full" style={{ width: `${Math.min((selectedCustomer.currentDebt / selectedCustomer.creditLimit) * 100, 100)}%` }}></div>
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
                        cart.map(item => (
                            <div key={item.id} className="flex items-center gap-3 bg-slate-50 p-3 rounded-lg border border-slate-100 text-slate-800">
                                <div className="flex-1">
                                    <h4 className="text-sm font-medium text-slate-800 line-clamp-1">{item.name}</h4>
                                    <div className="text-xs text-slate-500 mt-1">C$ {item.price.toFixed(2)}</div>
                                </div>
                                <div className="flex items-center gap-2 bg-white rounded border border-slate-200 p-1 text-slate-800">
                                    <button onClick={() => updateQuantity(item.id, -1)} className="p-1 hover:bg-slate-100 rounded text-slate-600"><Minus size={14} /></button>
                                    <span className="text-sm font-mono w-4 text-center">{item.quantity}</span>
                                    <button onClick={() => updateQuantity(item.id, 1)} className="p-1 hover:bg-slate-100 rounded text-slate-600"><Plus size={14} /></button>
                                </div>
                                <div className="text-right min-w-[60px]">
                                    <div className="text-sm font-bold text-slate-900">C$ {(item.price * item.quantity).toFixed(2)}</div>
                                    <button onClick={() => removeFromCart(item.id)} className="text-red-400 hover:text-red-600 mt-1"><Trash2 size={14} className="ml-auto" /></button>
                                </div>
                            </div>
                        ))
                    )}
                </div>
                <div className="p-5 border-t border-slate-100 bg-slate-50 text-slate-800">
                    <div className="flex justify-between text-xl font-bold text-nortex-900 mb-4 pt-2 border-t border-slate-200 text-slate-800"><span>Total</span><span>C$ {grandTotal.toFixed(2)}</span></div>

                    <div className="grid grid-cols-2 gap-2 mb-2">
                        <button onClick={() => handleCheckout('CASH')} disabled={!currentShift || processing} className="py-3 bg-green-600 text-white font-bold rounded-lg hover:bg-green-700 text-sm flex items-center justify-center gap-1">
                            <DollarSign size={16} /> EFECTIVO
                        </button>
                        <button
                            onClick={() => handleCheckout('CREDIT')}
                            disabled={!currentShift || processing || isCreditBlocked}
                            className={`py-3 font-bold rounded-lg text-sm flex items-center justify-center gap-1 ${isCreditBlocked ? 'bg-slate-300 text-slate-500 cursor-not-allowed' : 'bg-nortex-900 text-white hover:bg-nortex-800'}`}
                        >
                            {isCreditBlocked ? <Ban size={16} /> : <ShieldAlert size={16} />} CREDITO
                        </button>
                    </div>
                    {isCreditBlocked && selectedCustomer && (
                        <p className="text-[10px] text-center text-red-500 font-bold">Credito no disponible: Limite excedido o cliente bloqueado.</p>
                    )}
                </div>
            </div>

            {/* =============================== */}
            {/* POST-SALE SUCCESS MODAL         */}
            {/* =============================== */}
            {completedSale && (
                <div className="absolute inset-0 z-50 bg-slate-900/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden border border-slate-200">

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
                            <div className="bg-slate-50 rounded-xl p-4 mb-4 border border-slate-100">
                                <div className="flex justify-between items-center mb-2">
                                    <span className="text-sm text-slate-500">Cliente</span>
                                    <span className="font-bold text-slate-800">{completedSale.customerName}</span>
                                </div>
                                <div className="flex justify-between items-center mb-2">
                                    <span className="text-sm text-slate-500">Metodo</span>
                                    <span className="font-medium text-slate-700">
                                        {completedSale.paymentMethod === 'CASH' ? 'Efectivo' :
                                            completedSale.paymentMethod === 'CREDIT' ? 'Credito' :
                                                completedSale.paymentMethod === 'CARD' ? 'Tarjeta' : completedSale.paymentMethod}
                                    </span>
                                </div>
                                <div className="border-t border-slate-200 pt-2 mt-2">
                                    <div className="flex justify-between items-center">
                                        <span className="text-lg font-bold text-slate-800">Total Cobrado</span>
                                        <span className="text-2xl font-bold text-emerald-600">C$ {completedSale.grandTotal.toFixed(2)}</span>
                                    </div>
                                </div>

                                {/* Cash change calculator - only for CASH */}
                                {completedSale.paymentMethod === 'CASH' && (
                                    <div className="mt-3 pt-3 border-t border-slate-200">
                                        <div className="flex items-center gap-2 mb-2">
                                            <label className="text-xs font-mono text-slate-500 font-bold">EFECTIVO RECIBIDO</label>
                                        </div>
                                        <div className="relative">
                                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-sm">C$</span>
                                            <input
                                                type="number"
                                                autoFocus
                                                className="w-full pl-10 pr-4 py-2 border border-slate-300 rounded-lg text-lg font-bold text-slate-800 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/30"
                                                placeholder={completedSale.grandTotal.toFixed(2)}
                                                value={cashReceived}
                                                onChange={e => setCashReceived(e.target.value)}
                                            />
                                        </div>
                                        {cashReceived && parseFloat(cashReceived) >= completedSale.grandTotal && (
                                            <div className="flex justify-between items-center mt-2 bg-emerald-50 px-3 py-2 rounded-lg border border-emerald-200">
                                                <span className="font-bold text-emerald-700 text-sm">CAMBIO</span>
                                                <span className="text-xl font-bold text-emerald-600">
                                                    C$ {(parseFloat(cashReceived) - completedSale.grandTotal).toFixed(2)}
                                                </span>
                                            </div>
                                        )}
                                        {cashReceived && parseFloat(cashReceived) < completedSale.grandTotal && (
                                            <div className="flex justify-between items-center mt-2 bg-red-50 px-3 py-2 rounded-lg border border-red-200">
                                                <span className="font-bold text-red-600 text-sm">FALTANTE</span>
                                                <span className="text-xl font-bold text-red-600">
                                                    C$ {(completedSale.grandTotal - parseFloat(cashReceived)).toFixed(2)}
                                                </span>
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
        </div>
    );
};

export default POS;
