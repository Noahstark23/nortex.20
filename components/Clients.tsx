import Decimal from 'decimal.js';
import React, { useEffect, useMemo, useState } from 'react';
import {
    AlertCircle,
    ArrowLeft,
    Ban,
    CalendarClock,
    CheckCircle,
    ChevronRight,
    Clock3,
    Mail,
    MessageSquare,
    Pencil,
    Phone,
    Plus,
    Save,
    Search,
    Shield,
    Sparkles,
    Users,
    X,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { authFetch } from '../utils/auth';
import { formatMoney } from '../utils/money';
import { normalizeApiFailure } from '../utils/posActivation';
import { currentSessionRole } from '../utils/roleCapabilities';
import { CustomerHubSegment } from '../utils/customerHub';

interface SellerRef {
    id: string;
    name: string;
    role?: string;
    status?: string;
}

interface CustomerHubListItem {
    id: string;
    name: string;
    taxId: string | null;
    phone: string | null;
    email: string | null;
    address: string | null;
    creditLimit: number;
    currentDebt: number;
    isBlocked: boolean;
    isWholesale: boolean;
    sellerId?: string | null;
    seller?: SellerRef | null;
    createdAt: string;
    lastSaleAt: string | null;
    segment: CustomerHubSegment;
    nextAction: string;
    stats: {
        salesCount: number;
        creditSalesCount: number;
        openInvoices: number;
        overdueInvoices: number;
        totalSales: number;
        outstandingBalance: number;
    };
}

interface CustomerHubDetail {
    profile: CustomerHubListItem;
    receivables: {
        totals: {
            billed: number;
            paid: number;
            balance: number;
            overdue: number;
        };
        invoices: Array<{
            id: string;
            invoiceNumber: string | null;
            total: number;
            paid: number;
            balance: number;
            dueDate: string | null;
            date: string;
            status: 'OVERDUE' | 'PENDING' | 'PAID';
            soldBy?: SellerRef | null;
            payments: Array<{
                id: string;
                amount: number;
                method: string;
                date: string;
                collectedBy: string | null;
            }>;
        }>;
    };
    recentSales: Array<{
        id: string;
        createdAt: string;
        total: number;
        balance: number;
        paymentMethod: string;
        invoiceNumber: string | null;
        soldBy?: SellerRef | null;
    }>;
    recentPayments: Array<{
        id: string;
        createdAt: string;
        amount: number;
        method: string;
        collectedBy: string | null;
        saleId: string | null;
        invoiceNumber: string | null;
    }>;
    interactions: Array<{
        id: string;
        type: 'NOTE' | 'CALL' | 'WHATSAPP' | 'VISIT' | 'PROMISE';
        note: string;
        status: 'OPEN' | 'COMPLETED' | 'CANCELLED';
        promisedAmount: number | null;
        promisedAt: string | null;
        followUpAt: string | null;
        completedAt: string | null;
        createdAt: string;
        creator: { id: string; name: string } | null;
    }>;
    timeline: Array<{
        id: string;
        type: string;
        happenedAt: string;
        title: string;
        subtitle: string;
        amount: number | null;
        meta: string | null;
    }>;
}

interface Vendedor {
    id: string;
    name: string;
    role: string;
    status: string;
}

type CustomerFormValues = {
    name: string;
    taxId: string;
    phone: string;
    email: string;
    address: string;
    creditLimit: string;
    sellerId: string;
};

type CustomerFormErrors = Partial<Record<keyof CustomerFormValues, string>> & {
    general?: string;
};

type InteractionFormValues = {
    type: 'NOTE' | 'CALL' | 'WHATSAPP' | 'VISIT' | 'PROMISE';
    note: string;
    promisedAmount: string;
    promisedAt: string;
    followUpAt: string;
};

const EMPTY_INTERACTION_FORM: InteractionFormValues = {
    type: 'NOTE',
    note: '',
    promisedAmount: '',
    promisedAt: '',
    followUpAt: '',
};

function canCreateCustomers(role: string): boolean {
    return ['OWNER', 'ADMIN', 'SUPER_ADMIN', 'MANAGER', 'CASHIER', 'EMPLOYEE', 'VENDEDOR'].includes(role);
}

const SEGMENT_OPTIONS: Array<{ id: string; label: string }> = [
    { id: 'all', label: 'Todos' },
    { id: 'withDebt', label: 'Con deuda' },
    { id: 'overlimit', label: 'Sobre límite' },
    { id: 'blocked', label: 'Bloqueados' },
    { id: 'wholesale', label: 'Mayoreo' },
    { id: 'inactive', label: 'Inactivos' },
    { id: 'unassigned', label: 'Sin vendedor' },
];

const segmentTone: Record<CustomerHubSegment, string> = {
    active: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20',
    blocked: 'bg-red-500/10 text-red-300 border-red-500/20',
    inactive: 'bg-slate-500/10 text-slate-300 border-slate-500/20',
    overlimit: 'bg-amber-500/10 text-amber-300 border-amber-500/20',
    wholesale: 'bg-indigo-500/10 text-indigo-300 border-indigo-500/20',
    withDebt: 'bg-orange-500/10 text-orange-300 border-orange-500/20',
};

const segmentLabel: Record<CustomerHubSegment, string> = {
    active: 'Activo',
    blocked: 'Bloqueado',
    inactive: 'Inactivo',
    overlimit: 'Sobre límite',
    wholesale: 'Mayoreo',
    withDebt: 'Con deuda',
};

const fmtMoney = (value: number) => formatMoney(value);
const fmtDate = (value: string | null) => value
    ? new Date(value).toLocaleDateString('es-NI', { day: '2-digit', month: 'short', year: 'numeric' })
    : 'Sin actividad';

const EMPTY_FORM: CustomerFormValues = {
    name: '',
    taxId: '',
    phone: '',
    email: '',
    address: '',
    creditLimit: '',
    sellerId: '',
};

const PROFILE_EDIT_ROLES = new Set(['OWNER', 'ADMIN', 'SUPER_ADMIN', 'MANAGER', 'VENDEDOR']);
const CUSTOMER_IDENTITY_EDIT_ROLES = new Set(['OWNER', 'ADMIN', 'SUPER_ADMIN']);
const CUSTOMER_CONTROL_ROLES = new Set(['OWNER', 'ADMIN', 'SUPER_ADMIN']);
const INTERACTION_WRITE_ROLES = new Set(['OWNER', 'ADMIN', 'SUPER_ADMIN', 'MANAGER', 'CASHIER', 'VENDEDOR']);

function toEditableCustomerForm(customer: CustomerHubListItem): CustomerFormValues {
    return {
        name: customer.name,
        taxId: customer.taxId ?? '',
        phone: customer.phone ?? '',
        email: customer.email ?? '',
        address: customer.address ?? '',
        creditLimit: customer.creditLimit > 0 ? new Decimal(customer.creditLimit).toFixed(2) : '',
        sellerId: customer.sellerId ?? '',
    };
}

function validateCustomerForm(
    values: CustomerFormValues,
    permissions: { allowIdentityInput: boolean; allowCreditLimitInput: boolean },
): CustomerFormErrors {
    const errors: CustomerFormErrors = {};
    if (permissions.allowIdentityInput) {
        const name = values.name.trim();
        if (!name) errors.name = 'Escribí el nombre o razón social.';
        if (name.length > 160) errors.name = 'El nombre no puede superar 160 caracteres.';
        if (values.taxId.trim().length > 80) errors.taxId = 'El documento es demasiado largo.';
    }
    if (values.phone.trim().length > 40) errors.phone = 'El teléfono es demasiado largo.';
    if (values.address.trim().length > 240) errors.address = 'La dirección es demasiado larga.';

    const email = values.email.trim();
    if (email) {
        const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
        if (!emailOk) errors.email = 'Ingresá un correo válido.';
        if (email.length > 160) errors.email = 'El correo es demasiado largo.';
    }

    if (permissions.allowCreditLimitInput && values.creditLimit.trim()) {
        try {
            const amount = new Decimal(values.creditLimit.trim());
            if (!amount.isFinite() || amount.isNegative()) {
                errors.creditLimit = 'El límite debe ser cero o mayor.';
            } else if (amount.decimalPlaces() > 2) {
                errors.creditLimit = 'El límite admite máximo 2 decimales.';
            } else if (amount.greaterThan('99999999.99')) {
                errors.creditLimit = 'El límite excede el máximo permitido.';
            }
        } catch {
            errors.creditLimit = 'Ingresá un límite válido.';
        }
    }

    return errors;
}

const Clients: React.FC = () => {
    const navigate = useNavigate();
    const role = currentSessionRole();
    const canManageControls = CUSTOMER_CONTROL_ROLES.has(role);
    const canEditLegalIdentity = CUSTOMER_IDENTITY_EDIT_ROLES.has(role);
    const canCreateCustomer = canCreateCustomers(role);
    const canEditProfile = PROFILE_EDIT_ROLES.has(role);
    const canWriteInteraction = INTERACTION_WRITE_ROLES.has(role);
    const [customers, setCustomers] = useState<CustomerHubListItem[]>([]);
    const [detail, setDetail] = useState<CustomerHubDetail | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState('');
    const [loadingDetail, setLoadingDetail] = useState(false);
    const [detailError, setDetailError] = useState('');
    const [showModal, setShowModal] = useState(false);
    const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
    const [editingCustomerId, setEditingCustomerId] = useState<string | null>(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [segment, setSegment] = useState('all');
    const [sellerFilter, setSellerFilter] = useState('');
    const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
    const [vendedores, setVendedores] = useState<Vendedor[]>([]);
    const puedeAsignar = canManageControls && vendedores.length > 0;
    const canEditIdentityFields = !editingCustomerId || canEditLegalIdentity;
    const [formData, setFormData] = useState<CustomerFormValues>(EMPTY_FORM);
    const [formErrors, setFormErrors] = useState<CustomerFormErrors>({});
    const [savingForm, setSavingForm] = useState(false);
    const [showInteractionModal, setShowInteractionModal] = useState(false);
    const [interactionForm, setInteractionForm] = useState<InteractionFormValues>(EMPTY_INTERACTION_FORM);
    const [interactionError, setInteractionError] = useState('');
    const [savingInteraction, setSavingInteraction] = useState(false);

    const fetchCustomers = async (preferredId?: string | null) => {
        setLoading(true);
        setLoadError('');
        try {
            const params = new URLSearchParams();
            if (searchTerm.trim()) params.set('search', searchTerm.trim());
            if (segment) params.set('segment', segment);
            if (sellerFilter) params.set('sellerId', sellerFilter);
            params.set('limit', '80');

            const res = await authFetch(`/api/customers/hub?${params.toString()}`);
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                setLoadError(normalizeApiFailure(res.status, data, 'No pudimos cargar la cartera de clientes.').message);
                return;
            }

            const nextCustomers: CustomerHubListItem[] = Array.isArray(data) ? data : [];
            setCustomers(nextCustomers);

            const desired = preferredId ?? selectedCustomerId;
            const nextSelected = nextCustomers.find((customer) => customer.id === desired)?.id ?? nextCustomers[0]?.id ?? null;
            setSelectedCustomerId(nextSelected);
            if (!nextSelected) {
                setDetail(null);
                setDetailError('');
            }
        } catch (error) {
            console.error(error);
            setLoadError('No pudimos conectarnos para cargar clientes.');
        } finally {
            setLoading(false);
        }
    };

    const fetchDetail = async (customerId: string) => {
        setLoadingDetail(true);
        setDetailError('');
        try {
            const res = await authFetch(`/api/customers/${customerId}/hub`);
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                setDetail(null);
                setDetailError(normalizeApiFailure(res.status, data, 'No pudimos abrir el detalle del cliente.').message);
                return;
            }
            setDetail(data);
        } catch (error) {
            console.error(error);
            setDetail(null);
            setDetailError('No pudimos conectarnos para abrir el detalle del cliente.');
        } finally {
            setLoadingDetail(false);
        }
    };

    useEffect(() => {
        fetchCustomers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [segment, sellerFilter]);

    useEffect(() => {
        const handle = window.setTimeout(() => {
            fetchCustomers();
        }, 250);
        return () => window.clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [searchTerm]);

    useEffect(() => {
        if (!selectedCustomerId) {
            setDetail(null);
            return;
        }
        fetchDetail(selectedCustomerId);
    }, [selectedCustomerId]);

    useEffect(() => {
        if (!canManageControls) {
            setVendedores([]);
            return;
        }
        (async () => {
            try {
                const res = await authFetch('/api/team');
                if (!res.ok) return;
                const data = await res.json();
                const users = Array.isArray(data) ? data : (data.users ?? []);
                setVendedores(users.filter((user: Vendedor) => user.status !== 'DISABLED'));
            } catch {
                setVendedores([]);
            }
        })();
    }, [canManageControls]);

    const summary = useMemo(() => {
        return customers.reduce((acc, customer) => {
            acc.total += 1;
            acc.debt += customer.currentDebt;
            acc.overdue += customer.stats.overdueInvoices;
            acc.blocked += customer.isBlocked ? 1 : 0;
            return acc;
        }, { total: 0, debt: 0, overdue: 0, blocked: 0 });
    }, [customers]);
    const interactions = detail?.interactions ?? [];

    const closeModal = () => {
        if (savingForm) return;
        setShowModal(false);
        setEditingCustomerId(null);
        setFormData(EMPTY_FORM);
        setFormErrors({});
    };

    const openCreateModal = () => {
        if (!canCreateCustomer) return;
        setEditingCustomerId(null);
        setFormData(EMPTY_FORM);
        setFormErrors({});
        setShowModal(true);
    };

    const openEditModal = () => {
        if (!detail || !canEditProfile) return;
        setEditingCustomerId(detail.profile.id);
        setFormData(toEditableCustomerForm(detail.profile));
        setFormErrors({});
        setShowModal(true);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (savingForm) return;
        if (!editingCustomerId && !canCreateCustomer) return;
        if (editingCustomerId && !canEditProfile) return;

        const isEditing = Boolean(editingCustomerId);
        const canWriteLegalIdentity = !isEditing || canEditLegalIdentity;
        const localErrors = validateCustomerForm(formData, {
            allowIdentityInput: canWriteLegalIdentity,
            allowCreditLimitInput: canManageControls,
        });
        if (Object.keys(localErrors).length > 0) {
            setFormErrors(localErrors);
            return;
        }

        const payload: Record<string, unknown> = {
            phone: formData.phone.trim() || null,
            email: formData.email.trim() || null,
            address: formData.address.trim() || null,
        };
        if (canWriteLegalIdentity) {
            payload.name = formData.name.trim();
            payload.taxId = formData.taxId.trim() || null;
        }
        if (canManageControls) {
            const normalizedCreditLimit = formData.creditLimit.trim();
            if (normalizedCreditLimit !== '') {
                payload.creditLimit = normalizedCreditLimit;
            } else if (isEditing && canManageControls) {
                payload.creditLimit = '0';
            }
        }
        if (puedeAsignar) {
            payload.sellerId = formData.sellerId || null;
        }

        setSavingForm(true);
        setFormErrors({});
        try {
            const res = await authFetch(isEditing ? `/api/customers/${editingCustomerId}` : '/api/customers', {
                method: isEditing ? 'PUT' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            const body = await res.json().catch(() => ({}));
            if (!res.ok) {
                const failure = normalizeApiFailure(
                    res.status,
                    body,
                    editingCustomerId ? 'No pudimos guardar la ficha del cliente.' : 'No pudimos crear el cliente.',
                );
                setFormErrors({
                    ...failure.fields,
                    general: Object.keys(failure.fields).length > 0 ? 'Revisá los campos marcados.' : failure.message,
                });
                return;
            }

            const targetId = editingCustomerId ?? String(body.id ?? '');
            setShowModal(false);
            setEditingCustomerId(null);
            setFormData(EMPTY_FORM);
            setFormErrors({});
            await fetchCustomers(targetId || selectedCustomerId);
            if (targetId) {
                setSelectedCustomerId(targetId);
                setMobileDetailOpen(true);
                await fetchDetail(targetId);
            }
        } catch {
            setFormErrors({
                general: editingCustomerId
                    ? 'No pudimos guardar la ficha. Revisá la conexión e intentá de nuevo.'
                    : 'No pudimos crear el cliente. Revisá la conexión e intentá de nuevo.',
            });
        } finally {
            setSavingForm(false);
        }
    };

    const openInteractionModal = () => {
        if (!detail || !canWriteInteraction) return;
        setInteractionForm(EMPTY_INTERACTION_FORM);
        setInteractionError('');
        setShowInteractionModal(true);
    };

    const closeInteractionModal = () => {
        if (savingInteraction) return;
        setShowInteractionModal(false);
        setInteractionForm(EMPTY_INTERACTION_FORM);
        setInteractionError('');
    };

    const handleInteractionSubmit = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!detail || !canWriteInteraction || savingInteraction) return;

        const note = interactionForm.note.trim();
        if (note.length < 2) {
            setInteractionError('Escribí brevemente qué pasó en la gestión.');
            return;
        }
        if (interactionForm.type === 'PROMISE' && !interactionForm.promisedAt) {
            setInteractionError('Indicá cuándo prometió pagar.');
            return;
        }
        if (interactionForm.promisedAmount.trim()) {
            try {
                const promised = new Decimal(interactionForm.promisedAmount.trim());
                if (!promised.isFinite() || !promised.greaterThan(0) || promised.decimalPlaces() > 2 || promised.greaterThan('99999999.99')) {
                    setInteractionError('El monto prometido debe ser positivo y tener máximo 2 decimales.');
                    return;
                }
            } catch {
                setInteractionError('El monto prometido no tiene un formato válido.');
                return;
            }
        }

        const toIso = (value: string) => value ? new Date(value).toISOString() : null;
        setSavingInteraction(true);
        setInteractionError('');
        try {
            const response = await authFetch(`/api/customers/${detail.profile.id}/interactions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    type: interactionForm.type,
                    note,
                    promisedAmount: interactionForm.type === 'PROMISE' && interactionForm.promisedAmount.trim()
                        ? interactionForm.promisedAmount.trim()
                        : null,
                    promisedAt: interactionForm.type === 'PROMISE' ? toIso(interactionForm.promisedAt) : null,
                    followUpAt: toIso(interactionForm.followUpAt),
                }),
            });
            const body = await response.json().catch(() => ({}));
            if (!response.ok) {
                setInteractionError(normalizeApiFailure(response.status, body, 'No pudimos registrar la gestión.').message);
                return;
            }
            setShowInteractionModal(false);
            setInteractionForm(EMPTY_INTERACTION_FORM);
            await fetchDetail(detail.profile.id);
        } catch {
            setInteractionError('No pudimos registrar la gestión. Revisá la conexión e intentá de nuevo.');
        } finally {
            setSavingInteraction(false);
        }
    };

    const resolveInteraction = async (interactionId: string, status: 'COMPLETED' | 'CANCELLED') => {
        if (!detail || !canWriteInteraction) return;
        setDetailError('');
        try {
            const response = await authFetch(`/api/customers/${detail.profile.id}/interactions/${interactionId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status }),
            });
            const body = await response.json().catch(() => ({}));
            if (!response.ok) {
                setDetailError(normalizeApiFailure(response.status, body, 'No pudimos actualizar la gestión.').message);
                return;
            }
            await fetchDetail(detail.profile.id);
        } catch {
            setDetailError('No pudimos actualizar la gestión por un problema de conexión.');
        }
    };

    const toggleBlock = async (customer: CustomerHubListItem) => {
        if (!confirm(`¿${customer.isBlocked ? 'Desbloquear' : 'Bloquear'} crédito para ${customer.name}?`)) return;
        try {
            const res = await authFetch(`/api/customers/${customer.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ isBlocked: !customer.isBlocked }),
            });
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                setDetailError(normalizeApiFailure(res.status, body, 'No pudimos actualizar el bloqueo de crédito.').message);
                return;
            }
            await fetchCustomers(customer.id);
            await fetchDetail(customer.id);
        } catch {
            setDetailError('No pudimos actualizar el bloqueo de crédito.');
        }
    };

    const toggleWholesale = async (customer: CustomerHubListItem) => {
        try {
            const res = await authFetch(`/api/customers/${customer.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ isWholesale: !customer.isWholesale }),
            });
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                setDetailError(normalizeApiFailure(res.status, body, 'No pudimos actualizar las condiciones de mayoreo.').message);
                return;
            }
            await fetchCustomers(customer.id);
            await fetchDetail(customer.id);
        } catch {
            setDetailError('No pudimos actualizar las condiciones de mayoreo.');
        }
    };

    const reasignarVendedor = async (customerId: string, nextSellerId: string) => {
        try {
            const res = await authFetch(`/api/customers/${customerId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sellerId: nextSellerId || null }),
            });
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                setDetailError(normalizeApiFailure(res.status, body, 'No pudimos reasignar el cliente.').message);
                return;
            }
            await fetchCustomers(customerId);
            await fetchDetail(customerId);
        } catch {
            setDetailError('No pudimos reasignar el cliente por un problema de conexión.');
        }
    };

    return (
        <div className="h-full overflow-hidden bg-surface-950">
            <div className="grid h-full grid-cols-1 xl:grid-cols-[420px_minmax(0,1fr)]">
                <aside className={`${mobileDetailOpen ? 'hidden xl:flex' : 'flex'} h-full flex-col border-r border-white/[0.06] bg-surface-900/95`}>
                    <div className="border-b border-white/[0.06] p-5">
                        <div className="flex items-start justify-between gap-3">
                            <div>
                                <h1 className="flex items-center gap-2 text-2xl font-black text-slate-100">
                                    <Users className="text-nortex-500" /> Clientes
                                </h1>
                                <p className="mt-1 text-sm text-slate-400">Ahora funciona como cartera viva: perfil, deuda, actividad y siguiente acción.</p>
                            </div>
                            {canCreateCustomer && (
                                <button
                                    type="button"
                                    onClick={openCreateModal}
                                    className="inline-flex items-center gap-2 rounded-xl bg-nortex-900 px-4 py-2 text-sm font-bold text-white hover:bg-nortex-800"
                                >
                                    <Plus size={16} /> Nuevo
                                </button>
                            )}
                        </div>

                        <div className="mt-4 grid grid-cols-2 gap-3">
                            <div className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-3">
                                <span className="text-[11px] font-mono uppercase text-slate-500">Clientes</span>
                                <div className="mt-1 text-xl font-black text-slate-100">{summary.total}</div>
                            </div>
                            <div className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-3">
                                <span className="text-[11px] font-mono uppercase text-slate-500">Saldo vivo</span>
                                <div className="mt-1 text-xl font-black text-amber-300">{fmtMoney(summary.debt)}</div>
                            </div>
                            <div className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-3">
                                <span className="text-[11px] font-mono uppercase text-slate-500">Facturas vencidas</span>
                                <div className="mt-1 text-xl font-black text-red-300">{summary.overdue}</div>
                            </div>
                            <div className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-3">
                                <span className="text-[11px] font-mono uppercase text-slate-500">Bloqueados</span>
                                <div className="mt-1 text-xl font-black text-slate-100">{summary.blocked}</div>
                            </div>
                        </div>

                        <div className="relative mt-4">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                            <input
                                aria-label="Buscar clientes"
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                placeholder="Buscar por nombre, documento, teléfono o email"
                                className="w-full rounded-2xl border border-white/[0.06] bg-white/[0.03] py-3 pl-10 pr-4 text-sm text-slate-100 outline-none focus:border-nortex-500"
                            />
                        </div>

                        <div className="mt-4 flex flex-wrap gap-2">
                            {SEGMENT_OPTIONS.map((option) => (
                                <button
                                    type="button"
                                    key={option.id}
                                    onClick={() => setSegment(option.id)}
                                    aria-pressed={segment === option.id}
                                    className={`rounded-full border px-3 py-1.5 text-xs font-bold transition-colors ${
                                        segment === option.id
                                            ? 'border-nortex-500 bg-nortex-500/15 text-nortex-300'
                                            : 'border-white/[0.06] bg-white/[0.03] text-slate-400 hover:text-slate-200'
                                    }`}
                                >
                                    {option.label}
                                </button>
                            ))}
                        </div>

                        {puedeAsignar && (
                            <div className="mt-4">
                                <label htmlFor="customer-seller-filter" className="mb-1 block text-[11px] font-mono uppercase text-slate-500">Vendedor</label>
                                <select
                                    id="customer-seller-filter"
                                    value={sellerFilter}
                                    onChange={(e) => setSellerFilter(e.target.value)}
                                    className="w-full rounded-2xl border border-white/[0.06] bg-white/[0.03] px-3 py-3 text-sm text-slate-100 outline-none focus:border-nortex-500"
                                >
                                    <option value="">Todos</option>
                                    <option value="none">Sin asignar</option>
                                    {vendedores.map((vendedor) => (
                                        <option key={vendedor.id} value={vendedor.id}>
                                            {vendedor.name}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        )}

                        {loadError && (
                            <div className="mt-4 rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                                <div className="font-bold">No pudimos cargar la cartera.</div>
                                <div className="mt-1 text-red-100/80">{loadError}</div>
                                <button
                                    onClick={() => fetchCustomers(selectedCustomerId)}
                                    className="mt-3 rounded-xl border border-red-400/30 px-3 py-2 text-xs font-bold text-red-100 hover:bg-red-500/10"
                                >
                                    Reintentar
                                </button>
                            </div>
                        )}
                    </div>

                    <div className="min-h-0 flex-1 overflow-y-auto p-3">
                        {loading ? (
                            <div className="space-y-3">
                                {Array.from({ length: 6 }).map((_, index) => (
                                    <div key={index} className="h-32 animate-pulse rounded-2xl border border-white/[0.06] bg-white/[0.03]" />
                                ))}
                            </div>
                        ) : customers.length === 0 ? (
                            <div className="rounded-3xl border border-dashed border-white/[0.08] bg-white/[0.02] p-6 text-center">
                                <Users className="mx-auto text-slate-500" size={28} />
                                <h3 className="mt-3 text-lg font-bold text-slate-200">No hay clientes en este filtro</h3>
                                <p className="mt-1 text-sm text-slate-500">Probá otro segmento o crea un cliente nuevo para empezar a poblar la cartera.</p>
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {customers.map((customer) => {
                                    const selected = selectedCustomerId === customer.id;
                                    const usage = customer.creditLimit > 0 ? Math.min(100, (customer.currentDebt / customer.creditLimit) * 100) : 0;
                                    return (
                                        <button
                                            key={customer.id}
                                            onClick={() => {
                                                setSelectedCustomerId(customer.id);
                                                setMobileDetailOpen(true);
                                            }}
                                            className={`w-full rounded-3xl border p-4 text-left transition-all ${
                                                selected
                                                    ? 'border-nortex-500 bg-nortex-500/10 shadow-[0_0_0_1px_rgba(87,196,255,0.12)]'
                                                    : 'border-white/[0.06] bg-white/[0.03] hover:bg-white/[0.05]'
                                            }`}
                                        >
                                            <div className="flex items-start justify-between gap-3">
                                                <div>
                                                    <div className="text-base font-black text-slate-100">{customer.name}</div>
                                                    <div className="mt-1 text-xs text-slate-400">
                                                        {customer.taxId || 'Sin documento'} · {customer.seller?.name || 'Sin vendedor'}
                                                    </div>
                                                </div>
                                                <span className={`rounded-full border px-2.5 py-1 text-[11px] font-bold ${segmentTone[customer.segment]}`}>
                                                    {segmentLabel[customer.segment]}
                                                </span>
                                            </div>

                                            <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                                                <div>
                                                    <div className="text-[11px] font-mono uppercase text-slate-500">Deuda</div>
                                                    <div className="mt-1 font-bold text-amber-300">{fmtMoney(customer.currentDebt)}</div>
                                                </div>
                                                <div>
                                                    <div className="text-[11px] font-mono uppercase text-slate-500">Límite</div>
                                                    <div className="mt-1 font-bold text-slate-100">{fmtMoney(customer.creditLimit)}</div>
                                                </div>
                                            </div>

                                            <div className="mt-3 h-2 rounded-full bg-white/[0.06]">
                                                <div
                                                    className={`h-2 rounded-full ${usage > 90 ? 'bg-red-400' : usage > 60 ? 'bg-amber-400' : 'bg-emerald-400'}`}
                                                    style={{ width: `${usage}%` }}
                                                />
                                            </div>

                                            <div className="mt-3 flex items-center justify-between gap-3 text-xs text-slate-400">
                                                <div>{customer.stats.openInvoices} facturas abiertas · {customer.stats.overdueInvoices} vencidas</div>
                                                <div className="inline-flex items-center gap-1">
                                                    Abrir <ChevronRight size={14} />
                                                </div>
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </aside>

                <main className={`${mobileDetailOpen ? 'block' : 'hidden xl:block'} h-full overflow-y-auto bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.12),_transparent_32%),linear-gradient(180deg,_rgba(6,17,27,0.9),_rgba(6,17,27,1))] p-4 sm:p-5`}>
                    <button
                        type="button"
                        onClick={() => setMobileDetailOpen(false)}
                        className="mb-4 inline-flex items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-sm font-bold text-slate-200 xl:hidden"
                    >
                        <ArrowLeft size={16} /> Volver a clientes
                    </button>
                    {!selectedCustomerId ? (
                        <div className="flex h-full items-center justify-center">
                            <div className="max-w-md rounded-3xl border border-dashed border-white/[0.08] bg-white/[0.02] p-8 text-center">
                                <Sparkles className="mx-auto text-nortex-400" size={30} />
                                <h2 className="mt-4 text-2xl font-black text-slate-100">Elegí un cliente</h2>
                                <p className="mt-2 text-sm text-slate-400">Acá vas a ver el perfil operativo, la deuda viva, las últimas ventas y la actividad reciente.</p>
                            </div>
                        </div>
                    ) : detailError ? (
                        <div className="flex h-full items-center justify-center">
                            <div className="max-w-lg rounded-3xl border border-red-500/20 bg-red-500/10 p-8 text-center">
                                <AlertCircle className="mx-auto text-red-300" size={30} />
                                <h2 className="mt-4 text-2xl font-black text-slate-100">No pudimos abrir la ficha</h2>
                                <p className="mt-2 text-sm text-red-100/80">{detailError}</p>
                                <button
                                    onClick={() => void fetchDetail(selectedCustomerId)}
                                    className="mt-4 rounded-2xl bg-red-500/15 px-4 py-3 text-sm font-bold text-red-100 hover:bg-red-500/20"
                                >
                                    Reintentar detalle
                                </button>
                            </div>
                        </div>
                    ) : loadingDetail || !detail ? (
                        <div className="space-y-4">
                            <div className="h-48 animate-pulse rounded-3xl border border-white/[0.06] bg-white/[0.03]" />
                            <div className="grid gap-4 lg:grid-cols-3">
                                <div className="h-56 animate-pulse rounded-3xl border border-white/[0.06] bg-white/[0.03]" />
                                <div className="h-56 animate-pulse rounded-3xl border border-white/[0.06] bg-white/[0.03]" />
                                <div className="h-56 animate-pulse rounded-3xl border border-white/[0.06] bg-white/[0.03]" />
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-5">
                            <section className="rounded-card border border-white/[0.06] bg-surface-900/85 p-5 shadow-2xl shadow-black/10">
                                <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
                                    <div>
                                        <div className="flex flex-wrap items-center gap-2">
                                            <h2 className="text-3xl font-black text-slate-100">{detail.profile.name}</h2>
                                            <span className={`rounded-full border px-2.5 py-1 text-[11px] font-bold ${segmentTone[detail.profile.segment]}`}>
                                                {segmentLabel[detail.profile.segment]}
                                            </span>
                                            {detail.profile.isWholesale && (
                                                <span className="rounded-full border border-indigo-500/20 bg-indigo-500/10 px-2.5 py-1 text-[11px] font-bold text-indigo-300">
                                                    Mayoreo
                                                </span>
                                            )}
                                        </div>
                                        <div className="mt-3 flex flex-wrap gap-4 text-sm text-slate-400">
                                            <span className="inline-flex items-center gap-2"><Phone size={14} /> {detail.profile.phone || 'Sin teléfono'}</span>
                                            <span className="inline-flex items-center gap-2"><Mail size={14} /> {detail.profile.email || 'Sin email'}</span>
                                            <span className="inline-flex items-center gap-2"><CalendarClock size={14} /> Última venta: {fmtDate(detail.profile.lastSaleAt)}</span>
                                        </div>
                                        {detail.profile.address && (
                                            <p className="mt-3 max-w-3xl text-sm text-slate-500">{detail.profile.address}</p>
                                        )}
                                    </div>

                                    <div className="grid w-full gap-2 xl:w-[330px]">
                                        {canEditProfile && (
                                            <button
                                                onClick={openEditModal}
                                                className="inline-flex items-center justify-center gap-2 rounded-2xl bg-white/[0.06] px-4 py-3 text-sm font-bold text-slate-100 hover:bg-white/[0.10]"
                                            >
                                                <Pencil size={16} /> Editar ficha
                                            </button>
                                        )}
                                        {canWriteInteraction && (
                                            <button
                                                onClick={openInteractionModal}
                                                className="inline-flex items-center justify-center gap-2 rounded-2xl bg-nortex-500/15 px-4 py-3 text-sm font-bold text-nortex-200 hover:bg-nortex-500/20"
                                            >
                                                <MessageSquare size={16} /> Registrar gestión
                                            </button>
                                        )}
                                        <button
                                            onClick={() => navigate(`/app/receivables?customerId=${detail.profile.id}`)}
                                            className="rounded-2xl bg-amber-500/15 px-4 py-3 text-sm font-bold text-amber-200 hover:bg-amber-500/20"
                                        >
                                            Abrir cobranza
                                        </button>
                                        {canManageControls && (
                                            <>
                                                <button
                                                    onClick={() => toggleBlock(detail.profile)}
                                                    className={`rounded-2xl px-4 py-3 text-sm font-bold ${
                                                        detail.profile.isBlocked
                                                            ? 'bg-emerald-500/15 text-emerald-300'
                                                            : 'bg-red-500/15 text-red-300'
                                                    }`}
                                                >
                                                    {detail.profile.isBlocked ? 'Desbloquear crédito' : 'Bloquear crédito'}
                                                </button>
                                                <button
                                                    onClick={() => toggleWholesale(detail.profile)}
                                                    className="rounded-2xl bg-indigo-500/15 px-4 py-3 text-sm font-bold text-indigo-300"
                                                >
                                                    {detail.profile.isWholesale ? 'Quitar mayoreo' : 'Activar mayoreo'}
                                                </button>
                                                {puedeAsignar && (
                                                    <select
                                                        aria-label="Vendedor asignado"
                                                        value={detail.profile.sellerId || ''}
                                                        onChange={(e) => reasignarVendedor(detail.profile.id, e.target.value)}
                                                        className="rounded-2xl border border-white/[0.06] bg-white/[0.03] px-4 py-3 text-sm text-slate-100 outline-none focus:border-nortex-500"
                                                    >
                                                        <option value="">Sin vendedor</option>
                                                        {vendedores.map((vendedor) => (
                                                            <option key={vendedor.id} value={vendedor.id}>
                                                                {vendedor.name}
                                                            </option>
                                                        ))}
                                                    </select>
                                                )}
                                            </>
                                        )}
                                    </div>
                                </div>

                                <div className="mt-5 grid gap-4 lg:grid-cols-4">
                                    <div className="rounded-3xl border border-white/[0.06] bg-white/[0.03] p-4">
                                        <div className="text-[11px] font-mono uppercase text-slate-500">Saldo actual</div>
                                        <div className="mt-2 text-2xl font-black text-amber-300">{fmtMoney(detail.profile.currentDebt)}</div>
                                    </div>
                                    <div className="rounded-3xl border border-white/[0.06] bg-white/[0.03] p-4">
                                        <div className="text-[11px] font-mono uppercase text-slate-500">Límite</div>
                                        <div className="mt-2 text-2xl font-black text-slate-100">{fmtMoney(detail.profile.creditLimit)}</div>
                                    </div>
                                    <div className="rounded-3xl border border-white/[0.06] bg-white/[0.03] p-4">
                                        <div className="text-[11px] font-mono uppercase text-slate-500">Ventas acumuladas</div>
                                        <div className="mt-2 text-2xl font-black text-slate-100">{fmtMoney(detail.profile.stats.totalSales)}</div>
                                    </div>
                                    <div className="rounded-3xl border border-white/[0.06] bg-white/[0.03] p-4">
                                        <div className="text-[11px] font-mono uppercase text-slate-500">Siguiente acción</div>
                                        <div className="mt-2 text-sm font-bold text-slate-200">{detail.profile.nextAction}</div>
                                    </div>
                                </div>
                            </section>

                            <section className="grid gap-5 xl:grid-cols-[1.05fr_0.95fr]">
                                <div className="space-y-5">
                                    <div className="rounded-card border border-white/[0.06] bg-surface-900/85 p-5">
                                        <div className="flex items-center justify-between gap-3">
                                            <div>
                                                <h3 className="text-xl font-black text-slate-100">Cobranza</h3>
                                                <p className="text-sm text-slate-400">Facturas abiertas, vencidas y últimos abonos.</p>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <span className="rounded-full bg-white/[0.04] px-3 py-1 text-xs font-bold text-slate-300">
                                                    {detail.receivables.invoices.length} facturas
                                                </span>
                                                <button
                                                    onClick={() => navigate(`/app/receivables?customerId=${detail.profile.id}`)}
                                                    className="rounded-full border border-amber-400/20 bg-amber-500/10 px-3 py-1 text-xs font-bold text-amber-200 hover:bg-amber-500/15"
                                                >
                                                    Ver en módulo
                                                </button>
                                            </div>
                                        </div>

                                        <div className="mt-4 grid gap-3 md:grid-cols-4">
                                            <div className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-3">
                                                <div className="text-[11px] font-mono uppercase text-slate-500">Facturado</div>
                                                <div className="mt-1 text-lg font-black text-slate-100">{fmtMoney(detail.receivables.totals.billed)}</div>
                                            </div>
                                            <div className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-3">
                                                <div className="text-[11px] font-mono uppercase text-slate-500">Cobrado</div>
                                                <div className="mt-1 text-lg font-black text-emerald-300">{fmtMoney(detail.receivables.totals.paid)}</div>
                                            </div>
                                            <div className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-3">
                                                <div className="text-[11px] font-mono uppercase text-slate-500">Saldo</div>
                                                <div className="mt-1 text-lg font-black text-amber-300">{fmtMoney(detail.receivables.totals.balance)}</div>
                                            </div>
                                            <div className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-3">
                                                <div className="text-[11px] font-mono uppercase text-slate-500">Vencido</div>
                                                <div className="mt-1 text-lg font-black text-red-300">{fmtMoney(detail.receivables.totals.overdue)}</div>
                                            </div>
                                        </div>

                                        <div className="mt-4 space-y-3">
                                            {detail.receivables.invoices.length === 0 ? (
                                                <div className="rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.02] p-4 text-sm text-slate-500">
                                                    Este cliente todavía no tiene ventas a crédito abiertas.
                                                </div>
                                            ) : detail.receivables.invoices.slice(0, 6).map((invoice) => (
                                                <div key={invoice.id} className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-4">
                                                    <div className="flex flex-wrap items-start justify-between gap-3">
                                                        <div>
                                                            <div className="font-bold text-slate-100">
                                                                {invoice.invoiceNumber ? `Factura #${invoice.invoiceNumber}` : `Venta ${invoice.id.slice(0, 8)}`}
                                                            </div>
                                                            <div className="mt-1 text-xs text-slate-400">
                                                                Emitida {fmtDate(invoice.date)} · vence {fmtDate(invoice.dueDate)}
                                                            </div>
                                                        </div>
                                                        <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${
                                                            invoice.status === 'OVERDUE'
                                                                ? 'bg-red-500/15 text-red-300'
                                                                : invoice.status === 'PAID'
                                                                    ? 'bg-emerald-500/15 text-emerald-300'
                                                                    : 'bg-amber-500/15 text-amber-300'
                                                        }`}>
                                                            {invoice.status === 'OVERDUE' ? 'Vencida' : invoice.status === 'PAID' ? 'Pagada' : 'Pendiente'}
                                                        </span>
                                                    </div>
                                                    <div className="mt-3 grid gap-3 text-sm md:grid-cols-3">
                                                        <div>
                                                            <div className="text-[11px] font-mono uppercase text-slate-500">Total</div>
                                                            <div className="mt-1 font-bold text-slate-100">{fmtMoney(invoice.total)}</div>
                                                        </div>
                                                        <div>
                                                            <div className="text-[11px] font-mono uppercase text-slate-500">Abonado</div>
                                                            <div className="mt-1 font-bold text-emerald-300">{fmtMoney(invoice.paid)}</div>
                                                        </div>
                                                        <div>
                                                            <div className="text-[11px] font-mono uppercase text-slate-500">Saldo</div>
                                                            <div className="mt-1 font-bold text-amber-300">{fmtMoney(invoice.balance)}</div>
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>

                                    <div className="rounded-card border border-white/[0.06] bg-surface-900/85 p-5">
                                        <h3 className="text-xl font-black text-slate-100">Ventas recientes</h3>
                                        <div className="mt-4 space-y-3">
                                            {detail.recentSales.length === 0 ? (
                                                <div className="rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.02] p-4 text-sm text-slate-500">
                                                    Este cliente no tiene ventas registradas todavía.
                                                </div>
                                            ) : detail.recentSales.map((sale) => (
                                                <div key={sale.id} className="flex items-center justify-between rounded-2xl border border-white/[0.06] bg-white/[0.03] p-4">
                                                    <div>
                                                        <div className="font-bold text-slate-100">
                                                            {sale.invoiceNumber ? `Factura #${sale.invoiceNumber}` : `Venta ${sale.id.slice(0, 8)}`}
                                                        </div>
                                                        <div className="mt-1 text-xs text-slate-400">
                                                            {fmtDate(sale.createdAt)} · {sale.paymentMethod === 'CREDIT' ? 'Crédito' : sale.paymentMethod}
                                                            {sale.soldBy?.name ? ` · ${sale.soldBy.name}` : ''}
                                                        </div>
                                                    </div>
                                                    <div className="text-right">
                                                        <div className="font-black text-slate-100">{fmtMoney(sale.total)}</div>
                                                        {sale.balance > 0 && (
                                                            <div className="mt-1 text-xs font-bold text-amber-300">Saldo {fmtMoney(sale.balance)}</div>
                                                        )}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>

                                <div className="space-y-5">
                                    <div className="rounded-card border border-white/[0.06] bg-surface-900/85 p-5">
                                        <div className="flex items-start justify-between gap-3">
                                            <div>
                                                <h3 className="text-xl font-black text-slate-100">Seguimiento</h3>
                                                <p className="mt-1 text-sm text-slate-400">Notas, contactos, visitas y promesas que sí quedan guardadas.</p>
                                            </div>
                                            {canWriteInteraction && (
                                                <button
                                                    type="button"
                                                    onClick={openInteractionModal}
                                                    className="rounded-xl bg-nortex-500/15 px-3 py-2 text-xs font-bold text-nortex-200 hover:bg-nortex-500/20"
                                                >
                                                    Nueva gestión
                                                </button>
                                            )}
                                        </div>
                                        <div className="mt-4 space-y-3">
                                            {interactions.length === 0 ? (
                                                <div className="rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.02] p-4 text-sm text-slate-500">
                                                    Todavía no hay gestiones registradas para este cliente.
                                                </div>
                                            ) : interactions.slice(0, 8).map((interaction) => (
                                                <div key={interaction.id} className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-4">
                                                    <div className="flex items-start justify-between gap-3">
                                                        <div className="min-w-0">
                                                            <div className="flex flex-wrap items-center gap-2">
                                                                <span className="text-sm font-bold text-slate-100">
                                                                    {interaction.type === 'PROMISE' ? 'Promesa de pago'
                                                                        : interaction.type === 'CALL' ? 'Llamada'
                                                                            : interaction.type === 'WHATSAPP' ? 'WhatsApp'
                                                                                : interaction.type === 'VISIT' ? 'Visita' : 'Nota'}
                                                                </span>
                                                                <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                                                                    interaction.status === 'OPEN'
                                                                        ? 'bg-amber-500/15 text-amber-200'
                                                                        : interaction.status === 'COMPLETED'
                                                                            ? 'bg-emerald-500/15 text-emerald-200'
                                                                            : 'bg-slate-500/15 text-slate-300'
                                                                }`}>
                                                                    {interaction.status === 'OPEN' ? 'Pendiente' : interaction.status === 'COMPLETED' ? 'Completada' : 'Cancelada'}
                                                                </span>
                                                            </div>
                                                            <p className="mt-2 whitespace-pre-wrap break-words text-sm text-slate-300">{interaction.note}</p>
                                                            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
                                                                <span>{interaction.creator?.name || 'Sistema'} · {fmtDate(interaction.createdAt)}</span>
                                                                {interaction.followUpAt && <span>Seguimiento: {fmtDate(interaction.followUpAt)}</span>}
                                                                {interaction.promisedAt && <span>Prometió: {fmtDate(interaction.promisedAt)}</span>}
                                                                {interaction.promisedAmount !== null && <span>{fmtMoney(interaction.promisedAmount)}</span>}
                                                            </div>
                                                        </div>
                                                        {interaction.status === 'OPEN' && canWriteInteraction && (
                                                            <button
                                                                type="button"
                                                                onClick={() => resolveInteraction(interaction.id, 'COMPLETED')}
                                                                className="shrink-0 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-xs font-bold text-emerald-200 hover:bg-emerald-500/15"
                                                            >
                                                                Completar
                                                            </button>
                                                        )}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>

                                    <div className="rounded-card border border-white/[0.06] bg-surface-900/85 p-5">
                                        <h3 className="text-xl font-black text-slate-100">Timeline operativa</h3>
                                        <p className="mt-1 text-sm text-slate-400">Ventas, abonos, gestiones y cambios sensibles del perfil, en orden real.</p>
                                        <div className="mt-4 space-y-3">
                                            {detail.timeline.length === 0 ? (
                                                <div className="rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.02] p-4 text-sm text-slate-500">
                                                    Sin actividad relevante todavía.
                                                </div>
                                            ) : detail.timeline.map((event) => (
                                                <div key={event.id} className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-4">
                                                    <div className="flex items-start justify-between gap-3">
                                                        <div>
                                                            <div className="flex items-center gap-2 text-sm font-bold text-slate-100">
                                                                {event.type === 'payment'
                                                                    ? <CheckCircle size={16} className="text-emerald-300" />
                                                                    : event.type === 'sale'
                                                                        ? <Clock3 size={16} className="text-nortex-300" />
                                                                        : <AlertCircle size={16} className="text-amber-300" />}
                                                                {event.title}
                                                            </div>
                                                            <div className="mt-1 text-xs text-slate-400">{event.subtitle}</div>
                                                            {event.meta && <div className="mt-2 text-xs text-slate-500">{event.meta}</div>}
                                                        </div>
                                                        <div className="text-right">
                                                            <div className="text-xs text-slate-500">{fmtDate(event.happenedAt)}</div>
                                                            {event.amount !== null && (
                                                                <div className="mt-1 text-sm font-black text-slate-100">{fmtMoney(event.amount)}</div>
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>

                                    <div className="rounded-card border border-white/[0.06] bg-surface-900/85 p-5">
                                        <h3 className="text-xl font-black text-slate-100">Últimos abonos</h3>
                                        <div className="mt-4 space-y-3">
                                            {detail.recentPayments.length === 0 ? (
                                                <div className="rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.02] p-4 text-sm text-slate-500">
                                                    No hay abonos registrados para este cliente.
                                                </div>
                                            ) : detail.recentPayments.map((payment) => (
                                                <div key={payment.id} className="flex items-center justify-between rounded-2xl border border-white/[0.06] bg-white/[0.03] p-4">
                                                    <div>
                                                        <div className="font-bold text-slate-100">{fmtMoney(payment.amount)}</div>
                                                        <div className="mt-1 text-xs text-slate-400">
                                                            {payment.invoiceNumber ? `Factura #${payment.invoiceNumber}` : 'Sin factura visible'} · {payment.method}
                                                        </div>
                                                        <div className="mt-1 text-xs text-slate-500">
                                                            {payment.collectedBy || 'Sistema'} · {fmtDate(payment.createdAt)}
                                                        </div>
                                                    </div>
                                                    <Clock3 size={18} className="text-emerald-300" />
                                                </div>
                                            ))}
                                        </div>
                                    </div>

                                    <div className="rounded-card border border-white/[0.06] bg-gradient-to-br from-nortex-500/10 to-transparent p-5">
                                        <div className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-nortex-200">
                                            <Shield size={16} /> Recomendación
                                        </div>
                                        <p className="mt-3 text-sm leading-6 text-slate-300">
                                            {detail.profile.nextAction}. Usá “Registrar gestión” para que la próxima persona vea qué se habló, qué prometió el cliente y cuándo hay que volver a contactarlo.
                                        </p>
                                    </div>
                                </div>
                            </section>
                        </div>
                    )}
                </main>
            </div>

            {showModal && (canCreateCustomer || canEditProfile) && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm">
                    <div
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="customer-form-title"
                        className="max-h-[calc(100dvh-2rem)] w-full max-w-xl overflow-y-auto rounded-card border border-white/[0.08] bg-surface-900 shadow-2xl"
                    >
                        <div className="flex items-center justify-between border-b border-white/[0.06] p-6">
                            <div>
                                <h3 id="customer-form-title" className="text-xl font-black text-slate-100">{editingCustomerId ? 'Editar cliente' : 'Nuevo cliente'}</h3>
                                <p className="text-sm text-slate-400">
                                    {editingCustomerId
                                        ? canEditLegalIdentity
                                            ? 'Corregí identidad, contacto y datos operativos sin salir del hub.'
                                            : 'Actualizá teléfono, correo y dirección. Los datos legales están protegidos.'
                                        : 'Alta rápida para que la venta y la cartera queden vinculadas desde el inicio.'}
                                </p>
                            </div>
                            <button type="button" onClick={closeModal} aria-label="Cerrar ficha de cliente" className="rounded-full p-2 text-slate-400 hover:bg-white/[0.04] hover:text-slate-200">
                                <X size={18} />
                            </button>
                        </div>

                        <form onSubmit={handleSubmit} className="space-y-4 p-6">
                            {editingCustomerId && !canEditLegalIdentity && (
                                <div id="customer-identity-readonly-note" role="note" className="rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                                    El nombre o razón social y el DNI/RUC son datos legales. Solo administración puede cambiarlos.
                                </div>
                            )}

                            <div>
                                <label htmlFor="customer-name" className="text-xs font-mono font-bold text-slate-500">NOMBRE / RAZÓN SOCIAL</label>
                                <input
                                    id="customer-name"
                                    required={canEditIdentityFields}
                                    readOnly={!canEditIdentityFields}
                                    value={formData.name}
                                    onChange={(e) => {
                                        if (!canEditIdentityFields) return;
                                        setFormData({ ...formData, name: e.target.value });
                                        setFormErrors((previous) => ({ ...previous, name: undefined, general: undefined }));
                                    }}
                                    aria-readonly={!canEditIdentityFields}
                                    aria-describedby={!canEditIdentityFields ? 'customer-identity-readonly-note' : undefined}
                                    aria-invalid={canEditIdentityFields && Boolean(formErrors.name)}
                                    className={`mt-1 w-full rounded-2xl border p-3 outline-none ${canEditIdentityFields ? 'bg-white/[0.03] text-slate-100 focus:border-nortex-500' : 'cursor-not-allowed bg-slate-800/60 text-slate-400'} ${formErrors.name ? 'border-red-500/70' : 'border-white/[0.08]'}`}
                                />
                                {formErrors.name && <p className="mt-1 text-xs text-red-300">{formErrors.name}</p>}
                            </div>

                            <div className="grid gap-4 md:grid-cols-2">
                                <div>
                                    <label htmlFor="customer-tax-id" className="text-xs font-mono font-bold text-slate-500">DNI / RUC</label>
                                    <input
                                        id="customer-tax-id"
                                        readOnly={!canEditIdentityFields}
                                        value={formData.taxId}
                                        onChange={(e) => {
                                            if (!canEditIdentityFields) return;
                                            setFormData({ ...formData, taxId: e.target.value });
                                            setFormErrors((previous) => ({ ...previous, taxId: undefined, general: undefined }));
                                        }}
                                        aria-readonly={!canEditIdentityFields}
                                        aria-describedby={!canEditIdentityFields ? 'customer-identity-readonly-note' : undefined}
                                        aria-invalid={canEditIdentityFields && Boolean(formErrors.taxId)}
                                        className={`mt-1 w-full rounded-2xl border p-3 outline-none ${canEditIdentityFields ? 'bg-white/[0.03] text-slate-100 focus:border-nortex-500' : 'cursor-not-allowed bg-slate-800/60 text-slate-400'} ${formErrors.taxId ? 'border-red-500/70' : 'border-white/[0.08]'}`}
                                    />
                                    {formErrors.taxId && <p className="mt-1 text-xs text-red-300">{formErrors.taxId}</p>}
                                </div>
                                <div>
                                    <label htmlFor="customer-phone" className="text-xs font-mono font-bold text-slate-500">TELÉFONO</label>
                                    <input
                                        id="customer-phone"
                                        value={formData.phone}
                                        onChange={(e) => {
                                            setFormData({ ...formData, phone: e.target.value });
                                            setFormErrors((previous) => ({ ...previous, phone: undefined, general: undefined }));
                                        }}
                                        aria-invalid={Boolean(formErrors.phone)}
                                        className={`mt-1 w-full rounded-2xl border bg-white/[0.03] p-3 text-slate-100 outline-none focus:border-nortex-500 ${formErrors.phone ? 'border-red-500/70' : 'border-white/[0.08]'}`}
                                    />
                                    {formErrors.phone && <p className="mt-1 text-xs text-red-300">{formErrors.phone}</p>}
                                </div>
                            </div>

                            <div className={`grid gap-4 ${canManageControls ? 'md:grid-cols-2' : 'md:grid-cols-1'}`}>
                                <div>
                                    <label htmlFor="customer-email" className="text-xs font-mono font-bold text-slate-500">EMAIL</label>
                                    <input
                                        id="customer-email"
                                        type="email"
                                        value={formData.email}
                                        onChange={(e) => {
                                            setFormData({ ...formData, email: e.target.value });
                                            setFormErrors((previous) => ({ ...previous, email: undefined, general: undefined }));
                                        }}
                                        aria-invalid={Boolean(formErrors.email)}
                                        className={`mt-1 w-full rounded-2xl border bg-white/[0.03] p-3 text-slate-100 outline-none focus:border-nortex-500 ${formErrors.email ? 'border-red-500/70' : 'border-white/[0.08]'}`}
                                    />
                                    {formErrors.email && <p className="mt-1 text-xs text-red-300">{formErrors.email}</p>}
                                </div>
                                {canManageControls && (
                                    <div>
                                        <label htmlFor="customer-credit-limit" className="text-xs font-mono font-bold text-slate-500">LÍMITE DE CRÉDITO</label>
                                        <input
                                            id="customer-credit-limit"
                                            inputMode="decimal"
                                            value={formData.creditLimit}
                                            onChange={(e) => {
                                                setFormData({ ...formData, creditLimit: e.target.value });
                                                setFormErrors((previous) => ({ ...previous, creditLimit: undefined, general: undefined }));
                                            }}
                                            aria-invalid={Boolean(formErrors.creditLimit)}
                                            className={`mt-1 w-full rounded-2xl border bg-blue-500/10 p-3 text-lg font-black text-slate-100 outline-none focus:border-nortex-500 ${formErrors.creditLimit ? 'border-red-500/70' : 'border-blue-500/20'}`}
                                            placeholder="0.00"
                                        />
                                        {formErrors.creditLimit && <p className="mt-1 text-xs text-red-300">{formErrors.creditLimit}</p>}
                                    </div>
                                )}
                            </div>

                            <div>
                                <label htmlFor="customer-address" className="text-xs font-mono font-bold text-slate-500">DIRECCIÓN</label>
                                <input
                                    id="customer-address"
                                    value={formData.address}
                                    onChange={(e) => {
                                        setFormData({ ...formData, address: e.target.value });
                                        setFormErrors((previous) => ({ ...previous, address: undefined, general: undefined }));
                                    }}
                                    aria-invalid={Boolean(formErrors.address)}
                                    className={`mt-1 w-full rounded-2xl border bg-white/[0.03] p-3 text-slate-100 outline-none focus:border-nortex-500 ${formErrors.address ? 'border-red-500/70' : 'border-white/[0.08]'}`}
                                />
                                {formErrors.address && <p className="mt-1 text-xs text-red-300">{formErrors.address}</p>}
                            </div>

                            {puedeAsignar && (
                                <div>
                                    <label htmlFor="customer-seller" className="text-xs font-mono font-bold text-slate-500">VENDEDOR ASIGNADO</label>
                                    <select
                                        id="customer-seller"
                                        value={formData.sellerId}
                                        onChange={(e) => {
                                            setFormData({ ...formData, sellerId: e.target.value });
                                            setFormErrors((previous) => ({ ...previous, sellerId: undefined, general: undefined }));
                                        }}
                                        className="mt-1 w-full rounded-2xl border border-white/[0.08] bg-white/[0.03] p-3 text-slate-100 outline-none focus:border-nortex-500"
                                    >
                                        <option value="">Sin asignar</option>
                                        {vendedores.map((vendedor) => (
                                            <option key={vendedor.id} value={vendedor.id}>
                                                {vendedor.name}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            )}

                            <div className="rounded-2xl border border-blue-500/15 bg-blue-500/10 p-4 text-xs text-blue-200">
                                <div className="flex items-center gap-2 font-bold"><Shield size={14} /> Este cliente queda listo para POS, fiado y cobranza.</div>
                                <p className="mt-1 text-blue-100/80">Después podés registrar llamadas, visitas, notas y promesas desde su ficha.</p>
                            </div>

                            {formErrors.general && (
                                <div role="alert" className="rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                                    {formErrors.general}
                                </div>
                            )}

                            <button
                                type="submit"
                                disabled={savingForm}
                                className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-nortex-900 px-4 py-3 text-sm font-bold text-white hover:bg-nortex-800 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                                <Save size={16} /> {savingForm ? 'Guardando...' : 'Guardar ficha'}
                            </button>
                        </form>
                    </div>
                </div>
            )}

            {showInteractionModal && detail && canWriteInteraction && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-sm">
                    <div
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="customer-interaction-title"
                        className="max-h-[calc(100dvh-2rem)] w-full max-w-xl overflow-y-auto rounded-card border border-white/[0.08] bg-surface-900 shadow-2xl"
                    >
                        <div className="flex items-start justify-between gap-4 border-b border-white/[0.06] p-6">
                            <div>
                                <h3 id="customer-interaction-title" className="text-xl font-black text-slate-100">Registrar gestión</h3>
                                <p className="mt-1 text-sm text-slate-400">{detail.profile.name} · dejá contexto y una próxima acción concreta.</p>
                            </div>
                            <button
                                type="button"
                                onClick={closeInteractionModal}
                                aria-label="Cerrar registro de gestión"
                                className="rounded-full p-2 text-slate-400 hover:bg-white/[0.04] hover:text-slate-200"
                            >
                                <X size={18} />
                            </button>
                        </div>

                        <form onSubmit={handleInteractionSubmit} className="space-y-4 p-6">
                            <div>
                                <label htmlFor="interaction-type" className="text-xs font-mono font-bold text-slate-500">TIPO DE GESTIÓN</label>
                                <select
                                    id="interaction-type"
                                    value={interactionForm.type}
                                    onChange={(event) => {
                                        const type = event.target.value as InteractionFormValues['type'];
                                        setInteractionForm((previous) => ({
                                            ...previous,
                                            type,
                                            promisedAmount: type === 'PROMISE' ? previous.promisedAmount : '',
                                            promisedAt: type === 'PROMISE' ? previous.promisedAt : '',
                                        }));
                                        setInteractionError('');
                                    }}
                                    className="mt-1 w-full rounded-2xl border border-white/[0.08] bg-white/[0.03] p-3 text-slate-100 outline-none focus:border-nortex-500"
                                >
                                    <option value="NOTE">Nota interna</option>
                                    <option value="CALL">Llamada</option>
                                    <option value="WHATSAPP">WhatsApp</option>
                                    <option value="VISIT">Visita</option>
                                    <option value="PROMISE">Promesa de pago</option>
                                </select>
                            </div>

                            <div>
                                <label htmlFor="interaction-note" className="text-xs font-mono font-bold text-slate-500">RESULTADO / NOTA</label>
                                <textarea
                                    id="interaction-note"
                                    rows={4}
                                    maxLength={2000}
                                    required
                                    value={interactionForm.note}
                                    onChange={(event) => {
                                        setInteractionForm((previous) => ({ ...previous, note: event.target.value }));
                                        setInteractionError('');
                                    }}
                                    placeholder="Ej.: confirmó que pagará el viernes; prefiere contacto por WhatsApp."
                                    className="mt-1 w-full resize-y rounded-2xl border border-white/[0.08] bg-white/[0.03] p-3 text-slate-100 outline-none focus:border-nortex-500"
                                />
                                <div className="mt-1 text-right text-[11px] text-slate-500">{interactionForm.note.length}/2000</div>
                            </div>

                            {interactionForm.type === 'PROMISE' && (
                                <div className="grid gap-4 sm:grid-cols-2">
                                    <div>
                                        <label htmlFor="interaction-promised-amount" className="text-xs font-mono font-bold text-slate-500">MONTO PROMETIDO</label>
                                        <input
                                            id="interaction-promised-amount"
                                            inputMode="decimal"
                                            value={interactionForm.promisedAmount}
                                            onChange={(event) => {
                                                setInteractionForm((previous) => ({ ...previous, promisedAmount: event.target.value }));
                                                setInteractionError('');
                                            }}
                                            placeholder="Opcional"
                                            className="mt-1 w-full rounded-2xl border border-white/[0.08] bg-white/[0.03] p-3 text-slate-100 outline-none focus:border-nortex-500"
                                        />
                                    </div>
                                    <div>
                                        <label htmlFor="interaction-promised-at" className="text-xs font-mono font-bold text-slate-500">FECHA PROMETIDA</label>
                                        <input
                                            id="interaction-promised-at"
                                            type="datetime-local"
                                            required
                                            value={interactionForm.promisedAt}
                                            onChange={(event) => {
                                                setInteractionForm((previous) => ({ ...previous, promisedAt: event.target.value }));
                                                setInteractionError('');
                                            }}
                                            className="mt-1 w-full rounded-2xl border border-white/[0.08] bg-white/[0.03] p-3 text-slate-100 outline-none focus:border-nortex-500"
                                        />
                                    </div>
                                </div>
                            )}

                            <div>
                                <label htmlFor="interaction-follow-up" className="text-xs font-mono font-bold text-slate-500">PRÓXIMO SEGUIMIENTO</label>
                                <input
                                    id="interaction-follow-up"
                                    type="datetime-local"
                                    value={interactionForm.followUpAt}
                                    onChange={(event) => {
                                        setInteractionForm((previous) => ({ ...previous, followUpAt: event.target.value }));
                                        setInteractionError('');
                                    }}
                                    className="mt-1 w-full rounded-2xl border border-white/[0.08] bg-white/[0.03] p-3 text-slate-100 outline-none focus:border-nortex-500"
                                />
                                <p className="mt-1 text-xs text-slate-500">Si lo dejás vacío, una nota o contacto queda cerrado; una promesa permanece pendiente.</p>
                            </div>

                            {interactionError && (
                                <div role="alert" className="rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                                    {interactionError}
                                </div>
                            )}

                            <button
                                type="submit"
                                disabled={savingInteraction}
                                className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-nortex-900 px-4 py-3 text-sm font-bold text-white hover:bg-nortex-800 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                                <MessageSquare size={16} /> {savingInteraction ? 'Guardando gestión…' : 'Guardar gestión'}
                            </button>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Clients;
