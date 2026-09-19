import Decimal from 'decimal.js';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    AlertCircle, ArrowLeft, Building2, Calendar, ChevronRight, FileText,
    Hash, Mail, MapPin, Pencil, Phone, Plus, RefreshCw, Search, Trash2,
    Truck, User, Users, X,
} from 'lucide-react';
import { authFetch } from '../utils/auth';
import { formatMoney, sanitizeDecimalInput } from '../utils/money';
import { currentSessionRole } from '../utils/roleCapabilities';
import { ToastViewport, useToast } from './ui/Toast';

type SupplierStatus = 'ACTIVE' | 'SUSPENDED' | 'BLOCKED';
type SupplierLegalType = 'NATURAL' | 'JURIDICAL';

interface Supplier {
    id: string;
    name: string;
    ruc: string | null;
    contactName: string | null;
    phone: string | null;
    email: string | null;
    address: string | null;
    category: string | null;
    status: SupplierStatus;
    legalType: SupplierLegalType | null;
    fiscalCategory: string | null;
    currency: string;
    paymentTermsDays: number | null;
    creditLimit: string | number | null;
    leadTimeDays: number | null;
    minimumOrderAmount: string | number | null;
    notes: string | null;
}

interface SupplierContact {
    id: string;
    name: string;
    title: string | null;
    phone: string | null;
    email: string | null;
    isPrimary: boolean;
    notes: string | null;
}

interface SupplierDocument {
    id: string;
    kind: string;
    fileName: string;
    mimeType: string | null;
    sizeBytes: number | null;
    sha256: string | null;
    expiresAt: string | null;
    createdAt: string;
}

interface SupplierPurchaseSummary {
    id: string;
    invoiceNumber: string;
    date: string;
    total: string | number;
    balanceDue: string | number | null;
    status: string;
    paymentMethod: string;
}

interface SupplierPaymentSummary {
    id: string;
    amount: string | number;
    method: string;
    reference?: string | null;
    paidAt?: string | null;
    createdAt?: string;
    purchase?: { invoiceNumber?: string | null } | null;
}

interface SupplierAggregates {
    purchaseCount: string | number;
    paymentCount: string | number;
    totalPurchased: string | number;
    totalCreditPurchased: string | number;
    totalPaid: string | number;
    outstandingBalance: string | number;
    unappliedCredit: string | number;
}

interface SupplierDetail {
    supplier: Supplier;
    contacts: SupplierContact[];
    documents: SupplierDocument[];
    recentPurchases: SupplierPurchaseSummary[];
    recentPayments: SupplierPaymentSummary[];
    aggregates: SupplierAggregates;
}

type SupplierForm = {
    name: string;
    ruc: string;
    contactName: string;
    phone: string;
    email: string;
    address: string;
    category: string;
    status: SupplierStatus;
    legalType: '' | SupplierLegalType;
    fiscalCategory: string;
    currency: string;
    paymentTermsDays: string;
    creditLimit: string;
    leadTimeDays: string;
    minimumOrderAmount: string;
    notes: string;
};

type ContactForm = {
    name: string;
    title: string;
    phone: string;
    email: string;
    isPrimary: boolean;
    notes: string;
};

const MUTATION_ROLES = new Set(['OWNER', 'ADMIN', 'SUPER_ADMIN']);

const EMPTY_SUPPLIER_FORM: SupplierForm = {
    name: '', ruc: '', contactName: '', phone: '', email: '', address: '', category: '',
    status: 'ACTIVE', legalType: '', fiscalCategory: '', currency: 'NIO',
    paymentTermsDays: '', creditLimit: '', leadTimeDays: '', minimumOrderAmount: '', notes: '',
};

const EMPTY_CONTACT_FORM: ContactForm = {
    name: '', title: '', phone: '', email: '', isPrimary: false, notes: '',
};

const STATUS_LABELS: Record<SupplierStatus, string> = {
    ACTIVE: 'Activo',
    SUSPENDED: 'Suspendido',
    BLOCKED: 'Bloqueado',
};

const STATUS_TONES: Record<SupplierStatus, string> = {
    ACTIVE: 'border-green-500/30 bg-green-500/10 text-green-800',
    SUSPENDED: 'border-amber-500/30 bg-amber-500/10 text-amber-800',
    BLOCKED: 'border-red-500/30 bg-red-500/10 text-red-700',
};

const EMPTY_AGGREGATES: SupplierAggregates = {
    purchaseCount: 0,
    paymentCount: 0,
    totalPurchased: 0,
    totalCreditPurchased: 0,
    totalPaid: 0,
    outstandingBalance: 0,
    unappliedCredit: 0,
};

const nullable = (value: string) => value.trim() || null;

const supplierToForm = (supplier: Supplier): SupplierForm => ({
    name: supplier.name ?? '',
    ruc: supplier.ruc ?? '',
    contactName: supplier.contactName ?? '',
    phone: supplier.phone ?? '',
    email: supplier.email ?? '',
    address: supplier.address ?? '',
    category: supplier.category ?? '',
    status: supplier.status ?? 'ACTIVE',
    legalType: supplier.legalType ?? '',
    fiscalCategory: supplier.fiscalCategory ?? '',
    currency: supplier.currency ?? 'NIO',
    paymentTermsDays: supplier.paymentTermsDays === null ? '' : String(supplier.paymentTermsDays),
    creditLimit: supplier.creditLimit === null ? '' : String(supplier.creditLimit),
    leadTimeDays: supplier.leadTimeDays === null ? '' : String(supplier.leadTimeDays),
    minimumOrderAmount: supplier.minimumOrderAmount === null ? '' : String(supplier.minimumOrderAmount),
    notes: supplier.notes ?? '',
});

const contactToForm = (contact: SupplierContact): ContactForm => ({
    name: contact.name,
    title: contact.title ?? '',
    phone: contact.phone ?? '',
    email: contact.email ?? '',
    isPrimary: contact.isPrimary,
    notes: contact.notes ?? '',
});

const normalizeDetail = (payload: any): SupplierDetail => {
    const data = payload?.data ?? payload;
    return {
        supplier: data.supplier,
        contacts: Array.isArray(data.contacts) ? data.contacts : [],
        documents: Array.isArray(data.documents) ? data.documents : [],
        recentPurchases: Array.isArray(data.recentPurchases) ? data.recentPurchases : [],
        recentPayments: Array.isArray(data.recentPayments) ? data.recentPayments : [],
        aggregates: data.aggregates ?? EMPTY_AGGREGATES,
    };
};

const formatSupplierMoney = (value: string | number | null | undefined, currency: string) => {
    if (currency === 'USD') return formatMoney(value, 'USD');
    if (currency === 'NIO') return formatMoney(value, 'NIO');
    try {
        return `${currency} ${new Decimal(value ?? 0).toDecimalPlaces(2).toFixed(2)}`;
    } catch {
        return `${currency || 'NIO'} 0.00`;
    }
};

const formatDate = (value: string | null | undefined) => {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleDateString('es-NI', {
        day: '2-digit', month: 'short', year: 'numeric', timeZone: 'America/Managua',
    });
};

const formatFileSize = (bytes: number | null) => {
    if (bytes === null || bytes < 0) return 'Tamaño no informado';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

function supplierFormValidation(form: SupplierForm): string {
    if (!form.name.trim()) return 'Escribí el nombre o razón social.';
    if (form.name.trim().length > 160) return 'El nombre no puede superar 160 caracteres.';
    if (form.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
        return 'Ingresá un correo válido.';
    }
    if (!/^[A-Z]{3}$/.test(form.currency.trim().toUpperCase())) {
        return 'La moneda debe usar tres letras ISO, por ejemplo NIO o USD.';
    }
    for (const [label, value] of [
        ['Los días de crédito', form.paymentTermsDays],
        ['El tiempo de entrega', form.leadTimeDays],
    ] as const) {
        if (value && (!/^\d+$/.test(value) || Number(value) < 0)) return `${label} debe ser un entero igual o mayor que cero.`;
    }
    for (const [label, value] of [
        ['El límite de crédito', form.creditLimit],
        ['La compra mínima', form.minimumOrderAmount],
    ] as const) {
        if (!value) continue;
        try {
            const amount = new Decimal(value);
            if (!amount.isFinite() || amount.isNegative()) return `${label} debe ser igual o mayor que cero.`;
            if (amount.decimalPlaces() > 4) return `${label} admite máximo cuatro decimales.`;
        } catch {
            return `${label} no es válido.`;
        }
    }
    return '';
}

const Suppliers: React.FC = () => {
    const canMutate = MUTATION_ROLES.has(currentSessionRole());
    const { toast, showToast, dismissToast } = useToast();
    const [suppliers, setSuppliers] = useState<Supplier[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState('');
    const [searchTerm, setSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState<'ALL' | SupplierStatus>('ALL');
    const [selectedSupplierId, setSelectedSupplierId] = useState<string | null>(null);
    const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
    const [detail, setDetail] = useState<SupplierDetail | null>(null);
    const [loadingDetail, setLoadingDetail] = useState(false);
    const [detailError, setDetailError] = useState('');
    const [showSupplierModal, setShowSupplierModal] = useState(false);
    const [editingSupplierId, setEditingSupplierId] = useState<string | null>(null);
    const [supplierForm, setSupplierForm] = useState<SupplierForm>(EMPTY_SUPPLIER_FORM);
    const [supplierFormError, setSupplierFormError] = useState('');
    const [savingSupplier, setSavingSupplier] = useState(false);
    const [showContactModal, setShowContactModal] = useState(false);
    const [editingContactId, setEditingContactId] = useState<string | null>(null);
    const [contactForm, setContactForm] = useState<ContactForm>(EMPTY_CONTACT_FORM);
    const [contactFormError, setContactFormError] = useState('');
    const [savingContact, setSavingContact] = useState(false);

    const fetchSuppliers = useCallback(async (preferredId?: string | null, query = searchTerm) => {
        setLoading(true);
        setLoadError('');
        try {
            const params = new URLSearchParams({ limit: '120', status: statusFilter });
            if (query.trim()) params.set('search', query.trim());
            const response = await authFetch(`/api/suppliers?${params.toString()}`);
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) {
                setLoadError(payload.error || 'No pudimos cargar los proveedores.');
                return;
            }
            const nextSuppliers: Supplier[] = Array.isArray(payload) ? payload : [];
            setSuppliers(nextSuppliers);
            setSelectedSupplierId((current) => {
                const desired = preferredId ?? current;
                return nextSuppliers.find((supplier) => supplier.id === desired)?.id
                    ?? nextSuppliers[0]?.id
                    ?? null;
            });
        } catch (error) {
            console.error(error);
            setLoadError('No pudimos conectarnos para cargar proveedores.');
        } finally {
            setLoading(false);
        }
    }, [searchTerm, statusFilter]);

    const fetchSupplierDetail = useCallback(async (supplierId: string, signal?: AbortSignal) => {
        setLoadingDetail(true);
        setDetailError('');
        try {
            const response = await authFetch(`/api/suppliers/${supplierId}`, { signal });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) {
                setDetail(null);
                setDetailError(payload.error || 'No pudimos abrir el expediente del proveedor.');
                return;
            }
            setDetail(normalizeDetail(payload));
        } catch (error: any) {
            if (error?.name === 'AbortError') return;
            console.error(error);
            setDetail(null);
            setDetailError('No pudimos conectarnos para abrir el expediente.');
        } finally {
            if (!signal?.aborted) setLoadingDetail(false);
        }
    }, []);

    useEffect(() => {
        const handle = window.setTimeout(() => void fetchSuppliers(), searchTerm ? 250 : 0);
        return () => window.clearTimeout(handle);
    }, [fetchSuppliers, searchTerm]);

    useEffect(() => {
        if (!selectedSupplierId) {
            setDetail(null);
            setDetailError('');
            return undefined;
        }
        const controller = new AbortController();
        void fetchSupplierDetail(selectedSupplierId, controller.signal);
        return () => controller.abort();
    }, [fetchSupplierDetail, selectedSupplierId]);

    const closeSupplierModal = () => {
        if (savingSupplier) return;
        setShowSupplierModal(false);
        setEditingSupplierId(null);
        setSupplierForm(EMPTY_SUPPLIER_FORM);
        setSupplierFormError('');
    };

    const openCreateSupplier = () => {
        if (!canMutate) return;
        setEditingSupplierId(null);
        setSupplierForm(EMPTY_SUPPLIER_FORM);
        setSupplierFormError('');
        setShowSupplierModal(true);
    };

    const openEditSupplier = () => {
        if (!canMutate || !detail) return;
        setEditingSupplierId(detail.supplier.id);
        setSupplierForm(supplierToForm(detail.supplier));
        setSupplierFormError('');
        setShowSupplierModal(true);
    };

    const saveSupplier = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!canMutate || savingSupplier) return;
        const validationError = supplierFormValidation(supplierForm);
        if (validationError) {
            setSupplierFormError(validationError);
            return;
        }
        const wasEditing = Boolean(editingSupplierId);
        setSavingSupplier(true);
        setSupplierFormError('');
        try {
            const response = await authFetch(editingSupplierId ? `/api/suppliers/${editingSupplierId}` : '/api/suppliers', {
                method: editingSupplierId ? 'PUT' : 'POST',
                body: JSON.stringify({
                    name: supplierForm.name.trim(),
                    ruc: nullable(supplierForm.ruc),
                    contactName: nullable(supplierForm.contactName),
                    phone: nullable(supplierForm.phone),
                    email: nullable(supplierForm.email),
                    address: nullable(supplierForm.address),
                    category: nullable(supplierForm.category),
                    status: supplierForm.status,
                    legalType: supplierForm.legalType || null,
                    fiscalCategory: nullable(supplierForm.fiscalCategory),
                    currency: supplierForm.currency.trim().toUpperCase(),
                    paymentTermsDays: supplierForm.paymentTermsDays ? Number(supplierForm.paymentTermsDays) : null,
                    creditLimit: supplierForm.creditLimit || null,
                    leadTimeDays: supplierForm.leadTimeDays ? Number(supplierForm.leadTimeDays) : null,
                    minimumOrderAmount: supplierForm.minimumOrderAmount || null,
                    notes: nullable(supplierForm.notes),
                }),
            });
            const body = await response.json().catch(() => ({}));
            if (!response.ok) {
                setSupplierFormError(body.error || 'No pudimos guardar el proveedor.');
                return;
            }
            const savedId: string | null = body?.data?.id ?? editingSupplierId;
            setShowSupplierModal(false);
            setEditingSupplierId(null);
            setSupplierForm(EMPTY_SUPPLIER_FORM);
            setSearchTerm('');
            await fetchSuppliers(savedId, '');
            if (savedId) await fetchSupplierDetail(savedId);
            showToast({
                tone: 'success',
                title: wasEditing ? 'Proveedor actualizado' : 'Proveedor creado',
                message: 'El expediente quedó listo para compras y seguimiento.',
            });
        } catch (error) {
            console.error(error);
            setSupplierFormError('No pudimos conectarnos para guardar el proveedor.');
        } finally {
            setSavingSupplier(false);
        }
    };

    const archiveSupplier = async () => {
        if (!canMutate || !detail) return;
        if (!window.confirm(`¿Archivar al proveedor "${detail.supplier.name}"? Su historial se conservará.`)) return;
        try {
            const response = await authFetch(`/api/suppliers/${detail.supplier.id}`, { method: 'DELETE' });
            const body = await response.json().catch(() => ({}));
            if (!response.ok) {
                showToast({ tone: 'error', title: 'No se pudo archivar', message: body.error || 'Reintentá en unos momentos.' });
                return;
            }
            setDetail(null);
            setSelectedSupplierId(null);
            await fetchSuppliers(null, searchTerm);
            showToast({ tone: 'success', title: 'Proveedor archivado', message: 'El historial de compras permanece disponible.' });
        } catch (error) {
            console.error(error);
            showToast({ tone: 'error', title: 'Error de conexión', message: 'No se confirmó el archivo del proveedor.' });
        }
    };

    const closeContactModal = () => {
        if (savingContact) return;
        setShowContactModal(false);
        setEditingContactId(null);
        setContactForm(EMPTY_CONTACT_FORM);
        setContactFormError('');
    };

    const openCreateContact = () => {
        if (!canMutate || !detail) return;
        setEditingContactId(null);
        setContactForm(EMPTY_CONTACT_FORM);
        setContactFormError('');
        setShowContactModal(true);
    };

    const openEditContact = (contact: SupplierContact) => {
        if (!canMutate) return;
        setEditingContactId(contact.id);
        setContactForm(contactToForm(contact));
        setContactFormError('');
        setShowContactModal(true);
    };

    const saveContact = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!canMutate || !detail || savingContact) return;
        if (!contactForm.name.trim()) {
            setContactFormError('Escribí el nombre del contacto.');
            return;
        }
        if (contactForm.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactForm.email.trim())) {
            setContactFormError('Ingresá un correo válido.');
            return;
        }
        setSavingContact(true);
        setContactFormError('');
        try {
            const endpoint = editingContactId
                ? `/api/suppliers/${detail.supplier.id}/contacts/${editingContactId}`
                : `/api/suppliers/${detail.supplier.id}/contacts`;
            const response = await authFetch(endpoint, {
                method: editingContactId ? 'PATCH' : 'POST',
                body: JSON.stringify({
                    name: contactForm.name.trim(),
                    title: nullable(contactForm.title),
                    phone: nullable(contactForm.phone),
                    email: nullable(contactForm.email),
                    isPrimary: contactForm.isPrimary,
                    notes: nullable(contactForm.notes),
                }),
            });
            const body = await response.json().catch(() => ({}));
            if (!response.ok) {
                setContactFormError(body.error || 'No pudimos guardar el contacto.');
                return;
            }
            setShowContactModal(false);
            setEditingContactId(null);
            setContactForm(EMPTY_CONTACT_FORM);
            await fetchSupplierDetail(detail.supplier.id);
            showToast({ tone: 'success', title: 'Contacto guardado', message: 'El expediente quedó actualizado.' });
        } catch (error) {
            console.error(error);
            setContactFormError('No pudimos conectarnos para guardar el contacto.');
        } finally {
            setSavingContact(false);
        }
    };

    const deleteContact = async (contact: SupplierContact) => {
        if (!canMutate || !detail) return;
        if (!window.confirm(`¿Quitar a ${contact.name} de los contactos?`)) return;
        try {
            const response = await authFetch(`/api/suppliers/${detail.supplier.id}/contacts/${contact.id}`, { method: 'DELETE' });
            const body = await response.json().catch(() => ({}));
            if (!response.ok) {
                showToast({ tone: 'error', title: 'No se pudo quitar', message: body.error || 'Reintentá en unos momentos.' });
                return;
            }
            await fetchSupplierDetail(detail.supplier.id);
            showToast({ tone: 'success', title: 'Contacto eliminado', message: 'El expediente quedó actualizado.' });
        } catch (error) {
            console.error(error);
            showToast({ tone: 'error', title: 'Error de conexión', message: 'No se confirmó la eliminación del contacto.' });
        }
    };

    const supplierCountLabel = useMemo(
        () => `${suppliers.length} ${suppliers.length === 1 ? 'proveedor' : 'proveedores'}`,
        [suppliers.length],
    );
    const selectedCurrency = detail?.supplier.currency || 'NIO';

    return (
        <div className="nx-light-context nx-workspace h-full overflow-hidden bg-slate-50 text-slate-950">
            <ToastViewport toast={toast} onDismiss={dismissToast} />
            <div className="grid h-full grid-cols-1 xl:grid-cols-[320px_minmax(0,1fr)]">
                <aside className={`${mobileDetailOpen ? 'hidden xl:flex' : 'flex'} h-full flex-col border-r border-slate-200 bg-white`}>
                    <div className="border-b border-slate-200 p-4 sm:p-5">
                        <div className="flex items-start justify-between gap-3">
                            <div>
                                <p className="nx-label mb-1 text-slate-500">Compras</p>
                                <h1 className="nx-module-header flex items-center gap-2 text-title font-bold text-slate-950"><Truck className="text-slate-500" size={21} aria-hidden="true" /> Proveedores</h1>
                                <p className="mt-1 text-xs text-slate-500">Expedientes y cuentas por pagar.</p>
                            </div>
                            {canMutate && (
                                <button type="button" onClick={openCreateSupplier} className="nx-fluid-press inline-flex h-touch items-center gap-2 rounded-control bg-brand px-4 text-sm font-semibold text-brand-on shadow-sm hover:bg-brand-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-ring">
                                    <Plus size={16} aria-hidden="true" /> Nuevo
                                </button>
                            )}
                        </div>
                        <div className="mt-4 flex items-center justify-between border-y border-slate-100 py-2 text-xs text-slate-500">
                            <span className="font-semibold text-slate-700">{loading ? 'Actualizando directorio…' : supplierCountLabel}</span>
                            <span>Directorio</span>
                        </div>
                        <div className="relative mt-4">
                            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={17} aria-hidden="true" />
                            <input aria-label="Buscar proveedores" value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="Nombre, RUC, contacto o correo" className="min-h-tap w-full rounded-control border border-slate-300 bg-white py-2.5 pl-10 pr-3 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-brand focus:ring-2 focus:ring-brand-ring" />
                        </div>
                        <label className="mt-3 block text-xs font-medium text-slate-600">
                            Estado
                            <select
                                aria-label="Filtrar proveedores por estado"
                                value={statusFilter}
                                onChange={(event) => setStatusFilter(event.target.value as 'ALL' | SupplierStatus)}
                                className="mt-1.5 min-h-tap w-full rounded-control border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-brand focus:ring-2 focus:ring-brand-ring"
                            >
                                <option value="ALL">Todos</option>
                                <option value="ACTIVE">Activos</option>
                                <option value="SUSPENDED">Suspendidos</option>
                                <option value="BLOCKED">Bloqueados</option>
                            </select>
                        </label>
                        {loadError && (
                            <div role="alert" className="mt-4 rounded-card border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-700">
                                <p className="font-semibold">No pudimos cargar el directorio.</p>
                                <p className="mt-1">{loadError}</p>
                                <button type="button" onClick={() => void fetchSuppliers(selectedSupplierId)} className="nx-fluid-press mt-3 inline-flex h-touch items-center gap-2 rounded-control border border-red-500/30 px-3 text-xs font-semibold hover:bg-red-500/10"><RefreshCw size={14} aria-hidden="true" /> Reintentar</button>
                            </div>
                        )}
                    </div>

                    <div className="min-h-0 flex-1 overflow-y-auto p-2">
                        {loading ? (
                            <div aria-label="Cargando proveedores" className="space-y-2">
                                {Array.from({ length: 5 }).map((_, index) => <div key={index} className="h-24 animate-pulse rounded-card bg-slate-100" />)}
                            </div>
                        ) : suppliers.length === 0 ? (
                            <div className="rounded-card border border-dashed border-slate-300 bg-slate-50 p-6 text-center">
                                <Truck className="mx-auto text-slate-400" size={30} aria-hidden="true" />
                                <h2 className="mt-3 text-base font-semibold text-slate-800">No hay proveedores en esta búsqueda</h2>
                                <p className="mt-1 text-sm text-slate-500">Probá otro término o creá el primer expediente.</p>
                            </div>
                        ) : (
                            <nav aria-label="Directorio de proveedores" className="divide-y divide-slate-100">
                                {suppliers.map((supplier) => (
                                    <button type="button" key={supplier.id} aria-current={supplier.id === selectedSupplierId ? 'true' : undefined} onClick={() => { setSelectedSupplierId(supplier.id); setMobileDetailOpen(true); }} className={`nx-fluid-press min-h-[88px] w-full rounded-control border px-3 py-3 text-left ${supplier.id === selectedSupplierId ? 'border-brand bg-brand-soft' : 'border-transparent bg-white hover:bg-slate-50'}`}>
                                        <div className="flex items-start justify-between gap-3">
                                            <div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-950">{supplier.name}</p><p className="mt-1 truncate text-xs text-slate-500">{supplier.category || 'Categoría general'}</p></div>
                                            <span className={`shrink-0 rounded-pill border px-2 py-1 text-[10px] font-semibold ${STATUS_TONES[supplier.status] ?? STATUS_TONES.ACTIVE}`}>{STATUS_LABELS[supplier.status] ?? supplier.status}</span>
                                        </div>
                                        <div className="mt-3 flex items-center justify-between gap-2 text-xs text-slate-500"><span className="truncate">{supplier.contactName || supplier.phone || supplier.email || 'Sin contacto principal'}</span><ChevronRight size={14} className="shrink-0" aria-hidden="true" /></div>
                                    </button>
                                ))}
                            </nav>
                        )}
                    </div>
                </aside>

                <main className={`${mobileDetailOpen ? 'block' : 'hidden xl:block'} nx-workspace h-full overflow-y-auto bg-slate-50 p-4 sm:p-6 lg:p-8`}>
                    <button type="button" onClick={() => setMobileDetailOpen(false)} className="nx-fluid-press mb-4 inline-flex h-touch items-center gap-2 rounded-control border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-100 xl:hidden"><ArrowLeft size={16} aria-hidden="true" /> Volver a proveedores</button>
                    {!selectedSupplierId ? (
                        <div className="flex h-full items-center justify-center"><div className="nx-canvas-card max-w-md p-8 text-center"><Building2 className="mx-auto text-slate-400" size={34} aria-hidden="true" /><h2 className="nx-module-header mt-4 text-title font-bold text-slate-950">Elegí un proveedor</h2><p className="mt-2 text-sm text-slate-600">Acá vas a ver su identidad fiscal, contactos, compras, pagos y documentos registrados.</p></div></div>
                    ) : detailError ? (
                        <div className="flex h-full items-center justify-center"><div role="alert" className="nx-canvas-card max-w-lg border-red-500/20 bg-red-500/10 p-8 text-center"><AlertCircle className="mx-auto text-red-600" size={32} aria-hidden="true" /><h2 className="nx-module-header mt-4 text-title font-bold text-slate-950">No pudimos abrir el expediente</h2><p className="mt-2 text-sm text-red-700">{detailError}</p><button type="button" onClick={() => void fetchSupplierDetail(selectedSupplierId)} className="nx-fluid-press mt-4 h-touch rounded-control border border-red-500/30 px-4 text-sm font-semibold text-red-700 hover:bg-red-500/10">Reintentar detalle</button></div></div>
                    ) : loadingDetail || !detail ? (
                        <div aria-label="Cargando expediente del proveedor" className="mx-auto max-w-[1480px] space-y-4"><div className="h-48 animate-pulse rounded-card bg-white" /><div className="grid gap-4 lg:grid-cols-3">{Array.from({ length: 3 }).map((_, index) => <div key={index} className="h-64 animate-pulse rounded-card bg-white" />)}</div></div>
                    ) : (
                        <div className="mx-auto max-w-[1480px] space-y-5">
                            <section className="nx-canvas-card p-5 sm:p-6">
                                <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
                                    <div><p className="nx-label mb-1 text-slate-500">Expediente del proveedor</p><div className="flex flex-wrap items-center gap-2"><h2 className="nx-module-header text-3xl font-bold text-slate-950">{detail.supplier.name}</h2><span className={`rounded-pill border px-3 py-1 text-xs font-semibold ${STATUS_TONES[detail.supplier.status] ?? STATUS_TONES.ACTIVE}`}>{STATUS_LABELS[detail.supplier.status] ?? detail.supplier.status}</span></div><p className="mt-2 text-sm text-slate-600">{detail.supplier.category || 'Sin categoría'} · {detail.supplier.currency || 'NIO'} · {detail.supplier.paymentTermsDays ?? 0} días de crédito</p></div>
                                    {canMutate && <div className="flex flex-wrap gap-2"><button type="button" onClick={openEditSupplier} className="nx-fluid-press inline-flex h-touch items-center gap-2 rounded-control border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 shadow-sm hover:bg-slate-100"><Pencil size={16} aria-hidden="true" /> Editar expediente</button><button type="button" onClick={() => void archiveSupplier()} className="nx-fluid-press inline-flex h-touch items-center gap-2 rounded-control border border-red-500/20 bg-red-500/10 px-4 text-sm font-semibold text-red-700 hover:bg-red-500/15"><Trash2 size={16} aria-hidden="true" /> Archivar</button></div>}
                                </div>
                                <div className="nx-list-surface mt-6 grid gap-px overflow-hidden bg-slate-200 sm:grid-cols-2 xl:grid-cols-4">
                                    <Metric label="Comprado acumulado" value={formatSupplierMoney(detail.aggregates.totalPurchased, selectedCurrency)} note={`${detail.aggregates.purchaseCount} facturas`} />
                                    <Metric label="Saldo pendiente" value={formatSupplierMoney(detail.aggregates.outstandingBalance, selectedCurrency)} note="CxP viva" tone="amber" />
                                    <Metric label="Pagado registrado" value={formatSupplierMoney(detail.aggregates.totalPaid, selectedCurrency)} note={`${detail.aggregates.paymentCount} pagos`} tone="emerald" />
                                    <Metric label="Límite de crédito" value={formatSupplierMoney(detail.supplier.creditLimit, selectedCurrency)} note="Condición acordada" tone="sky" />
                                </div>
                            </section>

                            <div className="grid gap-5 xl:grid-cols-3">
                                <section className="nx-canvas-card p-5">
                                    <h3 className="flex items-center gap-2 text-lg font-semibold text-slate-950"><Hash size={18} className="text-slate-500" aria-hidden="true" /> Identidad y operación</h3>
                                    <dl className="mt-4 space-y-3 text-sm">
                                        <Info label="RUC / documento" value={detail.supplier.ruc || 'No registrado'} mono />
                                        <Info label="Tipo legal" value={detail.supplier.legalType === 'JURIDICAL' ? 'Persona jurídica' : detail.supplier.legalType === 'NATURAL' ? 'Persona natural' : 'No definido'} />
                                        <Info label="Categoría fiscal" value={detail.supplier.fiscalCategory || 'No definida'} />
                                        <Info label="Entrega estimada" value={detail.supplier.leadTimeDays === null ? 'No definida' : `${detail.supplier.leadTimeDays} días`} />
                                        <Info label="Compra mínima" value={formatSupplierMoney(detail.supplier.minimumOrderAmount, selectedCurrency)} />
                                    </dl>
                                </section>

                                <section className="nx-canvas-card p-5">
                                    <div className="flex items-center justify-between gap-3"><h3 className="flex items-center gap-2 text-lg font-semibold text-slate-950"><Users size={18} className="text-brand" aria-hidden="true" /> Contactos</h3>{canMutate && <button type="button" onClick={openCreateContact} className="nx-fluid-press inline-flex h-touch items-center gap-1.5 rounded-control border border-brand/30 bg-brand-soft px-3 text-xs font-semibold text-brand-800 hover:bg-brand/15"><Plus size={14} aria-hidden="true" /> Agregar</button>}</div>
                                    <div className="mt-4 space-y-3">
                                        {detail.contacts.length === 0 ? <EmptyText> Todavía no hay contactos adicionales. </EmptyText> : detail.contacts.map((contact) => (
                                            <div key={contact.id} className="rounded-card border border-slate-200 bg-slate-50 p-3">
                                                <div className="flex items-start justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><p className="font-semibold text-slate-900">{contact.name}</p>{contact.isPrimary && <span className="rounded-pill border border-brand/30 bg-brand-soft px-2 py-0.5 text-[10px] font-semibold text-brand-800">Principal</span>}</div><p className="mt-0.5 text-xs text-slate-500">{contact.title || 'Sin cargo'}</p></div>{canMutate && <div className="flex gap-1"><button type="button" onClick={() => openEditContact(contact)} aria-label={`Editar contacto ${contact.name}`} className="nx-fluid-press flex h-touch w-touch items-center justify-center rounded-control text-slate-500 hover:bg-slate-200 hover:text-slate-800"><Pencil size={15} aria-hidden="true" /></button><button type="button" onClick={() => void deleteContact(contact)} aria-label={`Eliminar contacto ${contact.name}`} className="nx-fluid-press flex h-touch w-touch items-center justify-center rounded-control text-slate-500 hover:bg-red-500/10 hover:text-red-700"><Trash2 size={15} aria-hidden="true" /></button></div>}</div>
                                                <div className="mt-3 space-y-1 text-xs text-slate-600">{contact.phone && <p className="flex items-center gap-2"><Phone size={13} aria-hidden="true" /> {contact.phone}</p>}{contact.email && <p className="flex items-center gap-2"><Mail size={13} aria-hidden="true" /> {contact.email}</p>}</div>
                                            </div>
                                        ))}
                                    </div>
                                </section>

                                <section className="nx-canvas-card p-5">
                                    <h3 className="flex items-center gap-2 text-lg font-semibold text-slate-950"><FileText size={18} className="text-slate-500" aria-hidden="true" /> Documentos</h3>
                                    <p className="mt-1 text-xs text-slate-500">Metadatos privados. La carga y descarga de archivos todavía no está habilitada.</p>
                                    <div className="mt-4 space-y-3">
                                        {detail.documents.length === 0 ? <EmptyText>No hay documentos registrados.</EmptyText> : detail.documents.map((document) => (
                                            <div key={document.id} className="rounded-card border border-slate-200 bg-slate-50 p-3"><p className="break-words font-semibold text-slate-900">{document.fileName}</p><p className="nx-sku mt-1 text-xs text-slate-600">{document.kind}</p><p className="mt-2 text-xs text-slate-500">{formatFileSize(document.sizeBytes)} · registrado {formatDate(document.createdAt)}</p>{document.expiresAt && <p className="mt-1 flex items-center gap-1.5 text-xs text-amber-800"><Calendar size={13} aria-hidden="true" /> Vence {formatDate(document.expiresAt)}</p>}</div>
                                        ))}
                                    </div>
                                </section>
                            </div>

                            <div className="grid gap-5 xl:grid-cols-2">
                                <section className="nx-canvas-card overflow-hidden p-5"><h3 className="text-lg font-semibold text-slate-950">Compras recientes</h3><div className="nx-list-surface mt-4 divide-y divide-slate-200 overflow-hidden">{detail.recentPurchases.length === 0 ? <EmptyText>Sin facturas registradas.</EmptyText> : detail.recentPurchases.map((purchase) => <div key={purchase.id} className="flex min-h-[72px] items-center justify-between gap-4 bg-white p-3"><div><p className="nx-sku text-sm font-semibold text-slate-900">#{purchase.invoiceNumber}</p><p className="mt-1 text-xs text-slate-500">{formatDate(purchase.date)} · {purchase.status === 'PARTIALLY_PAID' ? 'Abono parcial' : purchase.status === 'COMPLETED' ? 'Pagada' : 'Pendiente'}</p></div><div className="text-right"><p className="nx-num font-semibold text-slate-950">{formatSupplierMoney(purchase.total, selectedCurrency)}</p>{purchase.balanceDue !== null && <p className="mt-1 text-xs text-amber-800">Saldo {formatSupplierMoney(purchase.balanceDue, selectedCurrency)}</p>}</div></div>)}</div></section>
                                <section className="nx-canvas-card overflow-hidden p-5"><h3 className="text-lg font-semibold text-slate-950">Pagos recientes</h3><div className="nx-list-surface mt-4 divide-y divide-slate-200 overflow-hidden">{detail.recentPayments.length === 0 ? <EmptyText>Sin pagos registrados.</EmptyText> : detail.recentPayments.map((payment) => <div key={payment.id} className="flex min-h-[72px] items-center justify-between gap-4 bg-white p-3"><div><p className="font-semibold text-slate-900">{payment.method}</p><p className="mt-1 text-xs text-slate-500">{formatDate(payment.paidAt ?? payment.createdAt)}{payment.purchase?.invoiceNumber ? ` · #${payment.purchase.invoiceNumber}` : ''}</p></div><p className="nx-num font-semibold text-slate-950">{formatSupplierMoney(payment.amount, selectedCurrency)}</p></div>)}</div></section>
                            </div>

                            <section className="nx-canvas-card p-5"><h3 className="text-lg font-semibold text-slate-950">Contacto principal y notas</h3><div className="mt-4 grid gap-4 md:grid-cols-2"><div className="space-y-3 text-sm text-slate-700"><p className="flex items-center gap-2"><User size={16} className="text-slate-400" aria-hidden="true" /> {detail.supplier.contactName || 'Sin contacto principal'}</p><p className="flex items-center gap-2"><Phone size={16} className="text-slate-400" aria-hidden="true" /> {detail.supplier.phone || 'Sin teléfono'}</p><p className="flex items-center gap-2"><Mail size={16} className="text-slate-400" aria-hidden="true" /> {detail.supplier.email || 'Sin correo'}</p><p className="flex items-center gap-2"><MapPin size={16} className="text-slate-400" aria-hidden="true" /> {detail.supplier.address || 'Sin dirección'}</p></div><div className="rounded-card border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-600">{detail.supplier.notes || 'No hay notas operativas para este proveedor.'}</div></div></section>
                        </div>
                    )}
                </main>
            </div>

            {showSupplierModal && canMutate && <SupplierDialog form={supplierForm} setForm={setSupplierForm} editing={Boolean(editingSupplierId)} error={supplierFormError} saving={savingSupplier} onClose={closeSupplierModal} onSubmit={saveSupplier} />}
            {showContactModal && canMutate && detail && <ContactDialog supplierName={detail.supplier.name} form={contactForm} setForm={setContactForm} editing={Boolean(editingContactId)} error={contactFormError} saving={savingContact} onClose={closeContactModal} onSubmit={saveContact} />}
        </div>
    );
};

function Metric({ label, value, note, tone = 'slate' }: { label: string; value: string; note: string; tone?: 'slate' | 'amber' | 'emerald' | 'sky' }) {
    const tones = {
        slate: 'text-slate-950',
        amber: 'text-amber-800',
        emerald: 'text-green-800',
        sky: 'text-slate-950',
    };
    return <div className="bg-white p-4"><p className="nx-label text-slate-500">{label}</p><p className={`nx-num mt-1 text-xl font-semibold ${tones[tone]}`}>{value}</p><p className="mt-1 text-xs text-slate-500">{note}</p></div>;
}

function Info({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
    return <div><dt className="text-xs text-slate-500">{label}</dt><dd className={`mt-1 text-slate-800 ${mono ? 'nx-sku font-semibold text-slate-800' : ''}`}>{value}</dd></div>;
}

function EmptyText({ children }: { children: React.ReactNode }) {
    return <p className="rounded-card border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500">{children}</p>;
}

interface SupplierDialogProps {
    form: SupplierForm;
    setForm: React.Dispatch<React.SetStateAction<SupplierForm>>;
    editing: boolean;
    error: string;
    saving: boolean;
    onClose: () => void;
    onSubmit: (event: React.FormEvent) => void;
}

function SupplierDialog({ form, setForm, editing, error, saving, onClose, onSubmit }: SupplierDialogProps) {
    const fieldClass = 'min-h-tap w-full rounded-control border border-white/10 bg-white/[0.04] px-3 py-2.5 text-slate-100 outline-none placeholder:text-slate-500 focus:border-brand focus:ring-2 focus:ring-brand-ring';
    return (
        <div className="fixed inset-0 z-modal flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
            <div role="dialog" aria-modal="true" aria-labelledby="supplier-form-title" className="nx-dark-context nx-ticket-surface max-h-[calc(100dvh-2rem)] w-full max-w-3xl overflow-y-auto rounded-card border border-white/[0.08] bg-surface-900 shadow-2xl">
                <div className="nx-dark-chrome sticky top-0 z-sticky flex items-center justify-between border-b border-white/[0.06] p-5"><div><p className="nx-label mb-1 text-slate-500">Expediente</p><h2 id="supplier-form-title" className="nx-module-header text-xl font-semibold text-slate-100">{editing ? 'Editar proveedor' : 'Nuevo proveedor'}</h2><p className="mt-1 text-sm text-slate-400">Identidad fiscal, condiciones comerciales y operación.</p></div><button type="button" onClick={onClose} disabled={saving} aria-label="Cerrar formulario de proveedor" className="nx-fluid-press flex h-touch w-touch items-center justify-center rounded-control text-slate-400 hover:bg-white/[0.06] hover:text-white disabled:opacity-50"><X size={19} aria-hidden="true" /></button></div>
                <form onSubmit={onSubmit} className="space-y-5 p-5">
                    <div className="grid gap-4 md:grid-cols-2">
                        <label className="space-y-1.5 text-sm text-slate-300 md:col-span-2">Nombre / razón social *<input autoFocus required aria-label="Nombre / razón social" value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} className={fieldClass} /></label>
                        <label className="space-y-1.5 text-sm text-slate-300">RUC / documento<input aria-label="RUC / documento" value={form.ruc} onChange={(event) => setForm((current) => ({ ...current, ruc: event.target.value }))} className={`${fieldClass} font-mono`} /></label>
                        <label className="space-y-1.5 text-sm text-slate-300">Estado<select aria-label="Estado" value={form.status} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value as SupplierStatus }))} className={`${fieldClass} bg-surface-950`}>{Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                        <label className="space-y-1.5 text-sm text-slate-300">Tipo legal<select aria-label="Tipo legal" value={form.legalType} onChange={(event) => setForm((current) => ({ ...current, legalType: event.target.value as SupplierForm['legalType'] }))} className={`${fieldClass} bg-surface-950`}><option value="">No definido</option><option value="NATURAL">Persona natural</option><option value="JURIDICAL">Persona jurídica</option></select></label>
                        <label className="space-y-1.5 text-sm text-slate-300">Categoría fiscal<input aria-label="Categoría fiscal" list="supplier-fiscal-categories" value={form.fiscalCategory} onChange={(event) => setForm((current) => ({ ...current, fiscalCategory: event.target.value.toUpperCase() }))} placeholder="GENERAL" className={`${fieldClass} font-mono`} /><datalist id="supplier-fiscal-categories"><option value="GENERAL" /><option value="CUOTA_FIJA" /><option value="EXEMPT" /><option value="OTHER" /></datalist></label>
                        <label className="space-y-1.5 text-sm text-slate-300">Categoría comercial<input aria-label="Categoría comercial" value={form.category} onChange={(event) => setForm((current) => ({ ...current, category: event.target.value }))} placeholder="Carnes, concentrado, ferretería…" className={fieldClass} /></label>
                        <label className="space-y-1.5 text-sm text-slate-300">Moneda ISO<input aria-label="Moneda ISO" value={form.currency} maxLength={3} onChange={(event) => setForm((current) => ({ ...current, currency: event.target.value.toUpperCase().replace(/[^A-Z]/g, '') }))} className={`${fieldClass} font-mono`} /></label>
                        <label className="space-y-1.5 text-sm text-slate-300">Días de crédito<input aria-label="Días de crédito" inputMode="numeric" value={form.paymentTermsDays} onChange={(event) => setForm((current) => ({ ...current, paymentTermsDays: event.target.value.replace(/\D/g, '') }))} className={fieldClass} /></label>
                        <label className="space-y-1.5 text-sm text-slate-300">Límite de crédito<input aria-label="Límite de crédito" inputMode="decimal" value={form.creditLimit} onChange={(event) => setForm((current) => ({ ...current, creditLimit: sanitizeDecimalInput(event.target.value) }))} className={fieldClass} /></label>
                        <label className="space-y-1.5 text-sm text-slate-300">Entrega estimada (días)<input aria-label="Entrega estimada (días)" inputMode="numeric" value={form.leadTimeDays} onChange={(event) => setForm((current) => ({ ...current, leadTimeDays: event.target.value.replace(/\D/g, '') }))} className={fieldClass} /></label>
                        <label className="space-y-1.5 text-sm text-slate-300">Compra mínima<input aria-label="Compra mínima" inputMode="decimal" value={form.minimumOrderAmount} onChange={(event) => setForm((current) => ({ ...current, minimumOrderAmount: sanitizeDecimalInput(event.target.value) }))} className={fieldClass} /></label>
                        <label className="space-y-1.5 text-sm text-slate-300">Contacto principal<input aria-label="Contacto principal" value={form.contactName} onChange={(event) => setForm((current) => ({ ...current, contactName: event.target.value }))} className={fieldClass} /></label>
                        <label className="space-y-1.5 text-sm text-slate-300">Teléfono<input aria-label="Teléfono" value={form.phone} onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))} className={fieldClass} /></label>
                        <label className="space-y-1.5 text-sm text-slate-300">Correo<input aria-label="Correo" type="email" value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} className={fieldClass} /></label>
                        <label className="space-y-1.5 text-sm text-slate-300">Dirección<input aria-label="Dirección" value={form.address} onChange={(event) => setForm((current) => ({ ...current, address: event.target.value }))} className={fieldClass} /></label>
                    </div>
                    <label className="block space-y-1.5 text-sm text-slate-300">Notas operativas<textarea aria-label="Notas operativas" rows={3} value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} className={fieldClass} /></label>
                    {error && <p role="alert" className="rounded-card border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</p>}
                    <div className="flex justify-end gap-3 border-t border-white/[0.06] pt-4"><button type="button" onClick={onClose} disabled={saving} className="nx-fluid-press h-touch rounded-control border border-white/10 px-4 text-sm font-semibold text-slate-300 hover:bg-white/[0.05] disabled:opacity-50">Cancelar</button><button type="submit" disabled={saving} className="nx-fluid-press nx-ticket-primary h-touch rounded-control bg-brand px-5 text-sm font-semibold text-brand-on hover:bg-brand-hover disabled:opacity-60">{saving ? 'Guardando…' : 'Guardar proveedor'}</button></div>
                </form>
            </div>
        </div>
    );
}

interface ContactDialogProps {
    supplierName: string;
    form: ContactForm;
    setForm: React.Dispatch<React.SetStateAction<ContactForm>>;
    editing: boolean;
    error: string;
    saving: boolean;
    onClose: () => void;
    onSubmit: (event: React.FormEvent) => void;
}

function ContactDialog({ supplierName, form, setForm, editing, error, saving, onClose, onSubmit }: ContactDialogProps) {
    const fieldClass = 'min-h-tap w-full rounded-control border border-white/10 bg-white/[0.04] px-3 py-2.5 text-slate-100 outline-none placeholder:text-slate-500 focus:border-brand focus:ring-2 focus:ring-brand-ring';
    return (
        <div className="fixed inset-0 z-modal flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
            <div role="dialog" aria-modal="true" aria-labelledby="supplier-contact-title" className="nx-dark-context nx-ticket-surface w-full max-w-lg rounded-card border border-white/[0.08] bg-surface-900 shadow-2xl">
                <div className="nx-dark-chrome flex items-center justify-between border-b border-white/[0.06] p-5"><div><p className="nx-label mb-1 text-slate-500">Contacto</p><h2 id="supplier-contact-title" className="nx-module-header text-xl font-semibold text-slate-100">{editing ? 'Editar contacto' : 'Nuevo contacto'}</h2><p className="mt-1 text-sm text-slate-400">{supplierName}</p></div><button type="button" onClick={onClose} disabled={saving} aria-label="Cerrar formulario de contacto" className="nx-fluid-press flex h-touch w-touch items-center justify-center rounded-control text-slate-400 hover:bg-white/[0.06] hover:text-white disabled:opacity-50"><X size={19} aria-hidden="true" /></button></div>
                <form onSubmit={onSubmit} className="space-y-4 p-5">
                    <label className="block space-y-1.5 text-sm text-slate-300">Nombre *<input autoFocus required aria-label="Nombre del contacto" value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} className={fieldClass} /></label>
                    <div className="grid gap-4 sm:grid-cols-2"><label className="space-y-1.5 text-sm text-slate-300">Cargo<input aria-label="Cargo" value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} className={fieldClass} /></label><label className="space-y-1.5 text-sm text-slate-300">Teléfono<input aria-label="Teléfono del contacto" value={form.phone} onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))} className={fieldClass} /></label></div>
                    <label className="block space-y-1.5 text-sm text-slate-300">Correo<input aria-label="Correo del contacto" type="email" value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} className={fieldClass} /></label>
                    <label className="block space-y-1.5 text-sm text-slate-300">Notas<textarea aria-label="Notas del contacto" rows={3} value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} className={fieldClass} /></label>
                    <label className="flex min-h-tap items-center gap-3 rounded-control border border-white/[0.08] bg-white/[0.04] p-3 text-sm text-slate-300"><input type="checkbox" checked={form.isPrimary} onChange={(event) => setForm((current) => ({ ...current, isPrimary: event.target.checked }))} className="h-4 w-4 accent-brand" /> Contacto principal del proveedor</label>
                    {error && <p role="alert" className="rounded-card border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</p>}
                    <div className="flex justify-end gap-3 border-t border-white/[0.06] pt-4"><button type="button" onClick={onClose} disabled={saving} className="nx-fluid-press h-touch rounded-control border border-white/10 px-4 text-sm font-semibold text-slate-300 hover:bg-white/[0.05] disabled:opacity-50">Cancelar</button><button type="submit" disabled={saving} className="nx-fluid-press nx-ticket-primary h-touch rounded-control bg-brand px-5 text-sm font-semibold text-brand-on hover:bg-brand-hover disabled:opacity-60">{saving ? 'Guardando…' : 'Guardar contacto'}</button></div>
                </form>
            </div>
        </div>
    );
}

export default Suppliers;
