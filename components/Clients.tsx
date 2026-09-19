import Decimal from 'decimal.js';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
    AlertCircle,
    ArrowLeft,
    ChevronRight,
    MessageSquare,
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
import { ToastViewport, useToast } from './ui/Toast';
import Customer360Detail from './customer/Customer360Detail';

interface SellerRef {
    id: string;
    name: string;
    role?: string;
    status?: string;
}

export interface CustomerHubListItem {
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

export interface CustomerHubDetail {
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

type CustomerBlockConfirmState = {
    id: string;
    name: string;
    nextBlockedState: boolean;
} | null;

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
    active: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    blocked: 'bg-red-50 text-red-700 border-red-200',
    inactive: 'bg-slate-100 text-slate-600 border-slate-200',
    overlimit: 'bg-amber-50 text-amber-700 border-amber-200',
    wholesale: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    withDebt: 'bg-amber-50 text-amber-700 border-amber-200',
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
const MANAGUA_TIME_ZONE = 'America/Managua';
const MANAGUA_DATE_TIME_PARTS = new Intl.DateTimeFormat('en-CA-u-ca-gregory-nu-latn', {
    timeZone: MANAGUA_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
});

type CivilDateTimeParts = {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
};

function civilDateTimeEpoch(parts: CivilDateTimeParts): number {
    // setUTCFullYear evita la regla especial de Date.UTC para los años 0–99.
    const date = new Date(0);
    date.setUTCFullYear(parts.year, parts.month - 1, parts.day);
    date.setUTCHours(parts.hour, parts.minute, 0, 0);
    return date.getTime();
}

function isSameCivilDateTime(left: CivilDateTimeParts, right: CivilDateTimeParts): boolean {
    return left.year === right.year
        && left.month === right.month
        && left.day === right.day
        && left.hour === right.hour
        && left.minute === right.minute;
}

function parseDateTimeLocal(value: string): CivilDateTimeParts | null {
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
    if (!match) return null;

    const parts: CivilDateTimeParts = {
        year: Number(match[1]),
        month: Number(match[2]),
        day: Number(match[3]),
        hour: Number(match[4]),
        minute: Number(match[5]),
    };
    const epoch = civilDateTimeEpoch(parts);
    if (!Number.isFinite(epoch)) return null;

    const roundTrip = new Date(epoch);
    return roundTrip.getUTCFullYear() === parts.year
        && roundTrip.getUTCMonth() + 1 === parts.month
        && roundTrip.getUTCDate() === parts.day
        && roundTrip.getUTCHours() === parts.hour
        && roundTrip.getUTCMinutes() === parts.minute
        ? parts
        : null;
}

function managuaPartsAt(epoch: number): CivilDateTimeParts | null {
    const date = new Date(epoch);
    if (Number.isNaN(date.getTime())) return null;

    const values: Partial<Record<Intl.DateTimeFormatPartTypes, number>> = {};
    for (const part of MANAGUA_DATE_TIME_PARTS.formatToParts(date)) {
        if (part.type === 'year' || part.type === 'month' || part.type === 'day' || part.type === 'hour' || part.type === 'minute') {
            values[part.type] = Number(part.value);
        }
    }
    if ([values.year, values.month, values.day, values.hour, values.minute].some((part) => !Number.isFinite(part))) {
        return null;
    }
    return {
        year: values.year!,
        month: values.month!,
        day: values.day!,
        hour: values.hour!,
        minute: values.minute!,
    };
}

/**
 * Convierte la hora civil ingresada en el CRM a un instante real de Managua.
 * `datetime-local` no incluye zona: usar `new Date(value)` la interpretaría en la
 * zona del navegador. Los offsets se descubren con Intl alrededor de la fecha y
 * cada candidato se verifica de vuelta; así una hora inexistente por un cambio de
 * horario se rechaza y una hora repetida elige de forma determinista la primera.
 */
export function managuaDateTimeLocalToIso(value: string): string | null {
    const target = parseDateTimeLocal(value);
    if (!target) return null;

    const civilEpoch = civilDateTimeEpoch(target);
    const possibleOffsets = new Set<number>();
    for (let deltaHours = -48; deltaHours <= 48; deltaHours += 6) {
        const probeEpoch = civilEpoch + deltaHours * 60 * 60 * 1000;
        const localParts = managuaPartsAt(probeEpoch);
        if (localParts) possibleOffsets.add(civilDateTimeEpoch(localParts) - probeEpoch);
    }

    const candidates = [...possibleOffsets]
        .map((offset) => civilEpoch - offset)
        .filter((epoch) => {
            const localParts = managuaPartsAt(epoch);
            return localParts !== null && isSameCivilDateTime(localParts, target);
        })
        .sort((left, right) => left - right);

    return candidates.length > 0 ? new Date(candidates[0]).toISOString() : null;
}

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

const DIALOG_FOCUSABLE_SELECTOR = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
].join(',');

function focusableElements(dialog: HTMLElement): HTMLElement[] {
    return Array.from(dialog.querySelectorAll<HTMLElement>(DIALOG_FOCUSABLE_SELECTOR))
        .filter((element) => element.tabIndex >= 0 && element.getAttribute('aria-hidden') !== 'true');
}

function useAccessibleDialog(
    open: boolean,
    onClose: () => void,
    initialFocusSelector: string,
) {
    const dialogRef = useRef<HTMLDivElement>(null);
    const closeRef = useRef(onClose);
    closeRef.current = onClose;

    useEffect(() => {
        if (!open) return undefined;

        const dialog = dialogRef.current;
        if (!dialog) return undefined;

        const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const initialFocus = dialog.querySelector<HTMLElement>(initialFocusSelector)
            ?? focusableElements(dialog)[0]
            ?? dialog;
        initialFocus.focus();

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                closeRef.current();
                return;
            }
            if (event.key !== 'Tab') return;

            const focusable = focusableElements(dialog);
            if (focusable.length === 0) {
                event.preventDefault();
                dialog.focus();
                return;
            }

            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            const active = document.activeElement;
            if (event.shiftKey && (active === first || !dialog.contains(active))) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
                event.preventDefault();
                first.focus();
            }
        };

        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('keydown', handleKeyDown);
            if (trigger?.isConnected) trigger.focus();
        };
    }, [initialFocusSelector, open]);

    return dialogRef;
}

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
    const { toast, showToast, dismissToast } = useToast();
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
    const [blockConfirm, setBlockConfirm] = useState<CustomerBlockConfirmState>(null);

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
            showToast({
                tone: 'success',
                title: editingCustomerId ? 'Ficha actualizada' : 'Cliente creado',
                message: editingCustomerId
                    ? 'La ficha quedó guardada y lista para POS, cartera y cobranza.'
                    : 'El cliente ya quedó listo para venderle y darle seguimiento.',
            });
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

        const promisedAt = interactionForm.type === 'PROMISE'
            ? managuaDateTimeLocalToIso(interactionForm.promisedAt)
            : null;
        if (interactionForm.type === 'PROMISE' && !promisedAt) {
            setInteractionError('La fecha prometida no representa una hora válida en Nicaragua.');
            return;
        }
        const followUpAt = interactionForm.followUpAt
            ? managuaDateTimeLocalToIso(interactionForm.followUpAt)
            : null;
        if (interactionForm.followUpAt && !followUpAt) {
            setInteractionError('El próximo seguimiento no representa una hora válida en Nicaragua.');
            return;
        }

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
                    promisedAt,
                    followUpAt,
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
            showToast({
                tone: 'success',
                title: 'Gestión registrada',
                message: 'La actividad quedó visible para el resto del equipo.',
            });
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
            showToast({
                tone: 'success',
                title: status === 'COMPLETED' ? 'Gestión completada' : 'Gestión cancelada',
                message: 'La línea de tiempo ya refleja el cambio.',
            });
        } catch {
            setDetailError('No pudimos actualizar la gestión por un problema de conexión.');
        }
    };

    const toggleBlock = async (customer: CustomerHubListItem) => {
        if (!canManageControls) return;
        setBlockConfirm({
            id: customer.id,
            name: customer.name,
            nextBlockedState: !customer.isBlocked,
        });
    };

    const confirmToggleBlock = async () => {
        if (!blockConfirm) return;
        try {
            const res = await authFetch(`/api/customers/${blockConfirm.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ isBlocked: blockConfirm.nextBlockedState }),
            });
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                setDetailError(normalizeApiFailure(res.status, body, 'No pudimos actualizar el bloqueo de crédito.').message);
                return;
            }
            await fetchCustomers(blockConfirm.id);
            await fetchDetail(blockConfirm.id);
            showToast({
                tone: 'success',
                title: blockConfirm.nextBlockedState ? 'Crédito bloqueado' : 'Crédito desbloqueado',
                message: `${blockConfirm.name} ya refleja el nuevo estado de crédito.`,
            });
        } catch {
            setDetailError('No pudimos actualizar el bloqueo de crédito.');
        } finally {
            setBlockConfirm(null);
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
            showToast({
                tone: 'success',
                title: customer.isWholesale ? 'Mayoreo desactivado' : 'Mayoreo activado',
                message: `${customer.name} ya refleja las nuevas condiciones.`,
            });
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
            const vendedor = vendedores.find((candidate) => candidate.id === nextSellerId);
            showToast({
                tone: 'success',
                title: 'Cliente reasignado',
                message: vendedor
                    ? `La cartera ahora quedó a nombre de ${vendedor.name}.`
                    : 'El cliente quedó sin vendedor asignado.',
            });
        } catch {
            setDetailError('No pudimos reasignar el cliente por un problema de conexión.');
        }
    };

    const sendStatementReminder = () => {
        if (!detail) return;
        const balance = detail.receivables.totals.balance;
        const customerName = detail.profile.name;
        const phoneDigits = (detail.profile.phone || '').replace(/\D/g, '');
        if (!phoneDigits) {
            showToast({
                tone: 'warning',
                title: 'Cliente sin teléfono',
                message: 'Agregá un número antes de enviar recordatorios desde esta ficha.',
            });
            return;
        }

        const whatsappPhone = phoneDigits.startsWith('505') ? phoneDigits : `505${phoneDigits}`;
        const draft = `Hola ${customerName}, te compartimos tu saldo pendiente en Nortex: ${fmtMoney(balance)}. Si querés, te atendemos por esta misma vía.`;
        window.open(`https://wa.me/${whatsappPhone}?text=${encodeURIComponent(draft)}`, '_blank', 'noopener,noreferrer');
        showToast({
            tone: 'success',
            title: 'Recordatorio listo',
            message: 'Se abrió WhatsApp con el borrador del estado de cuenta.',
        });
    };

    const customerFormDialogRef = useAccessibleDialog(
        showModal,
        closeModal,
        '[data-dialog-initial-focus="customer-form"]',
    );
    const interactionDialogRef = useAccessibleDialog(
        showInteractionModal,
        closeInteractionModal,
        '[data-dialog-initial-focus="customer-interaction"]',
    );
    const blockDialogRef = useAccessibleDialog(
        Boolean(blockConfirm),
        () => setBlockConfirm(null),
        '[data-dialog-initial-focus="customer-block"]',
    );

    return (
        <div className="nx-light-context nx-workspace h-full overflow-hidden bg-slate-50 text-slate-950">
            <ToastViewport toast={toast} onDismiss={dismissToast} />
            <div className="grid h-full grid-cols-1 xl:grid-cols-[340px_minmax(0,1fr)]">
                <aside className={`${mobileDetailOpen ? 'hidden xl:flex' : 'flex'} nx-list-surface h-full flex-col rounded-none border-y-0 border-l-0 bg-white`} aria-label="Cartera de clientes">
                    <div className="border-b border-slate-200 p-4 sm:p-5">
                        <div className="flex items-start justify-between gap-3">
                            <div>
                                <h1 className="nx-module-header flex items-center gap-2 text-2xl font-bold text-slate-950">
                                    <Users className="text-brand" aria-hidden="true" /> Clientes
                                </h1>
                                <p className="mt-1 text-xs text-slate-500">Cartera, riesgo y seguimiento.</p>
                            </div>
                            {canCreateCustomer && (
                                <button
                                    type="button"
                                    onClick={openCreateModal}
                                    className="nx-fluid-press inline-flex h-touch shrink-0 items-center gap-2 rounded-control bg-brand px-4 text-sm font-semibold text-brand-on shadow-sm hover:bg-brand-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-ring"
                                >
                                    <Plus size={16} aria-hidden="true" /> Nuevo
                                </button>
                            )}
                        </div>

                        <div className="nx-canvas-card mt-4 px-3 py-3 text-xs">
                            <div className="flex items-center justify-between gap-3">
                                <span className="font-semibold text-slate-700">{summary.total} clientes</span>
                                <span className="nx-num font-bold text-amber-700">{fmtMoney(summary.debt)}</span>
                            </div>
                            <div className="mt-1 flex items-center justify-between gap-3 text-slate-500">
                                <span>{summary.overdue} facturas vencidas</span>
                                <span>{summary.blocked} bloqueados</span>
                            </div>
                        </div>

                        <div className="relative mt-4">
                            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} aria-hidden="true" />
                            <input
                                aria-label="Buscar clientes"
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                placeholder="Buscar por nombre, documento, teléfono o email"
                                className="h-touch w-full rounded-control border border-slate-300 bg-white py-0 pl-10 pr-4 text-sm text-slate-900 shadow-sm outline-none placeholder:text-slate-400 focus:border-brand focus:ring-2 focus:ring-brand-ring"
                            />
                        </div>

                        <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
                            {SEGMENT_OPTIONS.map((option) => (
                                <button
                                    type="button"
                                    key={option.id}
                                    onClick={() => setSegment(option.id)}
                                    aria-pressed={segment === option.id}
                                    className={`nx-fluid-press min-h-tap shrink-0 rounded-full border px-3 text-xs font-semibold transition-colors ${
                                        segment === option.id
                                            ? 'border-brand bg-brand-soft text-emerald-800'
                                            : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-100 hover:text-slate-900'
                                    }`}
                                >
                                    {option.label}
                                </button>
                            ))}
                        </div>

                        {puedeAsignar && (
                            <div className="mt-4">
                                <label htmlFor="customer-seller-filter" className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Vendedor</label>
                                <select
                                    id="customer-seller-filter"
                                    value={sellerFilter}
                                    onChange={(e) => setSellerFilter(e.target.value)}
                                    className="h-touch w-full rounded-control border border-slate-300 bg-white px-3 text-sm text-slate-900 shadow-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand-ring"
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
                            <div className="mt-4 rounded-control border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
                                <div className="font-semibold">No pudimos cargar la cartera.</div>
                                <div className="mt-1 text-red-700">{loadError}</div>
                                <button
                                    onClick={() => fetchCustomers(selectedCustomerId)}
                                    className="nx-fluid-press mt-3 min-h-tap rounded-control border border-red-300 bg-white px-3 text-xs font-semibold text-red-700 hover:bg-red-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600"
                                >
                                    Reintentar
                                </button>
                            </div>
                        )}
                    </div>

                    <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50/70 p-2.5">
                        {loading ? (
                            <div className="space-y-2">
                                {Array.from({ length: 6 }).map((_, index) => (
                                    <div key={index} className="h-32 animate-pulse rounded-card border border-slate-200 bg-white" />
                                ))}
                            </div>
                        ) : customers.length === 0 ? (
                            <div className="nx-canvas-card border-dashed p-6 text-center">
                                <Users className="mx-auto text-slate-400" size={28} aria-hidden="true" />
                                <h3 className="mt-3 text-lg font-semibold text-slate-900">No hay clientes en este filtro</h3>
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
                                            aria-pressed={selected}
                                            className={`nx-fluid-press w-full min-h-[132px] rounded-control border p-3 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-ring ${
                                                selected
                                                    ? 'border-brand bg-brand-soft shadow-[0_0_0_1px_var(--nx-brand-ring)]'
                                                    : 'border-slate-200 bg-white shadow-sm hover:border-slate-300 hover:bg-slate-50'
                                            }`}
                                        >
                                            <div className="flex items-start justify-between gap-3">
                                                <div>
                                                    <div className="text-sm font-bold text-slate-950">{customer.name}</div>
                                                    <div className="mt-1 text-xs text-slate-500">
                                                        {customer.phone || customer.taxId || 'Sin contacto'}
                                                    </div>
                                                </div>
                                                <span className={`rounded-full border px-2.5 py-1 text-[11px] font-bold ${segmentTone[customer.segment]}`}>
                                                    {segmentLabel[customer.segment]}
                                                </span>
                                            </div>

                                            <div className="mt-3 flex items-end justify-between gap-3 text-xs">
                                                <div className="text-slate-500">{customer.seller?.name || 'Sin vendedor'}</div>
                                                <div className={`nx-num font-bold ${customer.currentDebt > 0 ? 'text-red-700' : 'text-slate-500'}`}>
                                                    {fmtMoney(customer.currentDebt)}
                                                </div>
                                            </div>

                                            <div className="mt-3 h-2 rounded-full bg-slate-200">
                                                <div
                                                    className={`h-2 rounded-full ${usage > 90 ? 'bg-red-500' : usage > 60 ? 'bg-amber-500' : 'bg-brand'}`}
                                                    style={{ width: `${usage}%` }}
                                                />
                                            </div>

                                            <div className="mt-2 flex items-center justify-between gap-3 text-[11px] text-slate-500">
                                                <div>{customer.stats.openInvoices} abiertas · {customer.stats.overdueInvoices} vencidas</div>
                                                <ChevronRight size={16} aria-hidden="true" />
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </aside>

                <main className={`${mobileDetailOpen ? 'block' : 'hidden xl:block'} nx-workspace h-full overflow-y-auto bg-slate-50 p-4 sm:p-6`}>
                    <button
                        type="button"
                        onClick={() => setMobileDetailOpen(false)}
                        className="nx-fluid-press mb-4 inline-flex h-touch items-center gap-2 rounded-control border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-ring xl:hidden"
                    >
                        <ArrowLeft size={16} /> Volver a clientes
                    </button>
                    {!selectedCustomerId ? (
                        <div className="flex h-full items-center justify-center">
                            <div className="nx-canvas-card max-w-md border-dashed p-8 text-center">
                                <Sparkles className="mx-auto text-brand" size={30} aria-hidden="true" />
                                <h2 className="nx-module-header mt-4 text-2xl font-bold text-slate-950">Elegí un cliente</h2>
                                <p className="mt-2 text-sm text-slate-500">Acá vas a ver el perfil operativo, la deuda viva, las últimas ventas y la actividad reciente.</p>
                            </div>
                        </div>
                    ) : detailError ? (
                        <div className="flex h-full items-center justify-center">
                            <div className="max-w-lg rounded-card border border-red-200 bg-red-50 p-8 text-center shadow-sm" role="alert">
                                <AlertCircle className="mx-auto text-red-600" size={30} aria-hidden="true" />
                                <h2 className="nx-module-header mt-4 text-2xl font-bold text-slate-950">No pudimos abrir la ficha</h2>
                                <p className="mt-2 text-sm text-red-700">{detailError}</p>
                                <button
                                    onClick={() => void fetchDetail(selectedCustomerId)}
                                    className="nx-fluid-press mt-4 h-touch rounded-control border border-red-300 bg-white px-4 text-sm font-semibold text-red-700 hover:bg-red-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600"
                                >
                                    Reintentar detalle
                                </button>
                            </div>
                        </div>
                    ) : loadingDetail || !detail ? (
                        <div className="space-y-4">
                            <div className="h-48 animate-pulse rounded-card border border-slate-200 bg-white" />
                            <div className="grid gap-4 lg:grid-cols-3">
                                <div className="h-56 animate-pulse rounded-card border border-slate-200 bg-white" />
                                <div className="h-56 animate-pulse rounded-card border border-slate-200 bg-white" />
                                <div className="h-56 animate-pulse rounded-card border border-slate-200 bg-white" />
                            </div>
                        </div>
                    ) : (
                        <Customer360Detail
                            detail={detail}
                            canEditProfile={canEditProfile}
                            canWriteInteraction={canWriteInteraction}
                            canManageControls={canManageControls}
                            canAssignSeller={puedeAsignar}
                            sellers={vendedores}
                            onEdit={openEditModal}
                            onRegisterInteraction={openInteractionModal}
                            onResolveInteraction={(interactionId) => void resolveInteraction(interactionId, 'COMPLETED')}
                            onSendStatement={sendStatementReminder}
                            onOpenReceivables={() => navigate(`/app/receivables?customerId=${detail.profile.id}`)}
                            onToggleBlock={(customer) => void toggleBlock(customer)}
                            onToggleWholesale={(customer) => void toggleWholesale(customer)}
                            onAssignSeller={(customerId, sellerId) => void reasignarVendedor(customerId, sellerId)}
                        />
                    )}
                </main>
            </div>

            {showModal && (canCreateCustomer || canEditProfile) && (
                <div
                    className="modal-backdrop"
                    onMouseDown={(event) => {
                        if (event.target === event.currentTarget) closeModal();
                    }}
                >
                    <div
                        ref={customerFormDialogRef}
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="customer-form-title"
                        aria-describedby="customer-form-description"
                        tabIndex={-1}
                        className="nx-dark-context nx-dark-chrome max-h-[calc(100dvh-2rem)] w-full max-w-xl overflow-y-auto rounded-card border border-white/[0.08] shadow-2xl"
                    >
                        <div className="flex items-center justify-between border-b border-white/[0.06] p-6">
                            <div>
                                <h3 id="customer-form-title" className="nx-module-header text-xl font-bold text-slate-100">{editingCustomerId ? 'Editar cliente' : 'Nuevo cliente'}</h3>
                                <p id="customer-form-description" className="text-sm text-slate-400">
                                    {editingCustomerId
                                        ? canEditLegalIdentity
                                            ? 'Corregí identidad, contacto y datos operativos sin salir del hub.'
                                            : 'Actualizá teléfono, correo y dirección. Los datos legales están protegidos.'
                                        : 'Alta rápida para que la venta y la cartera queden vinculadas desde el inicio.'}
                                </p>
                            </div>
                            <button type="button" onClick={closeModal} aria-label="Cerrar ficha de cliente" className="nx-fluid-press flex h-touch w-touch shrink-0 items-center justify-center rounded-full text-slate-400 hover:bg-white/[0.06] hover:text-slate-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-ring">
                                <X size={18} />
                            </button>
                        </div>

                        <form onSubmit={handleSubmit} className="space-y-4 p-6">
                            {editingCustomerId && !canEditLegalIdentity && (
                                <div id="customer-identity-readonly-note" role="note" className="rounded-control border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                                    El nombre o razón social y el DNI/RUC son datos legales. Solo administración puede cambiarlos.
                                </div>
                            )}

                            <div>
                                <label htmlFor="customer-name" className="text-xs font-mono font-bold text-slate-500">NOMBRE / RAZÓN SOCIAL</label>
                                <input
                                    id="customer-name"
                                    data-dialog-initial-focus={canEditIdentityFields ? 'customer-form' : undefined}
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
                                    className={`mt-1 min-h-tap w-full rounded-control border px-3 outline-none ${canEditIdentityFields ? 'bg-white/[0.04] text-slate-100 focus:border-brand focus:ring-2 focus:ring-brand-ring' : 'cursor-not-allowed bg-slate-800/60 text-slate-400'} ${formErrors.name ? 'border-red-500/70' : 'border-white/[0.10]'}`}
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
                                        className={`mt-1 min-h-tap w-full rounded-control border px-3 outline-none ${canEditIdentityFields ? 'bg-white/[0.04] text-slate-100 focus:border-brand focus:ring-2 focus:ring-brand-ring' : 'cursor-not-allowed bg-slate-800/60 text-slate-400'} ${formErrors.taxId ? 'border-red-500/70' : 'border-white/[0.10]'}`}
                                    />
                                    {formErrors.taxId && <p className="mt-1 text-xs text-red-300">{formErrors.taxId}</p>}
                                </div>
                                <div>
                                    <label htmlFor="customer-phone" className="text-xs font-mono font-bold text-slate-500">TELÉFONO</label>
                                    <input
                                        id="customer-phone"
                                        data-dialog-initial-focus={!canEditIdentityFields ? 'customer-form' : undefined}
                                        value={formData.phone}
                                        onChange={(e) => {
                                            setFormData({ ...formData, phone: e.target.value });
                                            setFormErrors((previous) => ({ ...previous, phone: undefined, general: undefined }));
                                        }}
                                        aria-invalid={Boolean(formErrors.phone)}
                                        className={`mt-1 min-h-tap w-full rounded-control border bg-white/[0.04] px-3 text-slate-100 outline-none focus:border-brand focus:ring-2 focus:ring-brand-ring ${formErrors.phone ? 'border-red-500/70' : 'border-white/[0.10]'}`}
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
                                        className={`mt-1 min-h-tap w-full rounded-control border bg-white/[0.04] px-3 text-slate-100 outline-none focus:border-brand focus:ring-2 focus:ring-brand-ring ${formErrors.email ? 'border-red-500/70' : 'border-white/[0.10]'}`}
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
                                            className={`nx-num mt-1 min-h-tap w-full rounded-control border bg-emerald-500/[0.06] px-3 text-lg font-bold text-slate-100 outline-none focus:border-brand focus:ring-2 focus:ring-brand-ring ${formErrors.creditLimit ? 'border-red-500/70' : 'border-emerald-500/25'}`}
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
                                    className={`mt-1 min-h-tap w-full rounded-control border bg-white/[0.04] px-3 text-slate-100 outline-none focus:border-brand focus:ring-2 focus:ring-brand-ring ${formErrors.address ? 'border-red-500/70' : 'border-white/[0.10]'}`}
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
                                        className="mt-1 min-h-tap w-full rounded-control border border-white/[0.10] bg-white/[0.04] px-3 text-slate-100 outline-none focus:border-brand focus:ring-2 focus:ring-brand-ring"
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

                            <div className="rounded-control border border-emerald-500/15 bg-emerald-500/[0.06] p-4 text-xs text-emerald-200">
                                <div className="flex items-center gap-2 font-bold"><Shield size={14} /> Este cliente queda listo para POS, fiado y cobranza.</div>
                                <p className="mt-1 text-emerald-100/80">Después podés registrar llamadas, visitas, notas y promesas desde su ficha.</p>
                            </div>

                            {formErrors.general && (
                                <div role="alert" className="rounded-control border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                                    {formErrors.general}
                                </div>
                            )}

                            <button
                                type="submit"
                                disabled={savingForm}
                                className="nx-fluid-press inline-flex h-pay w-full items-center justify-center gap-2 rounded-control bg-brand px-4 text-sm font-semibold text-brand-on shadow-sm hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-ring"
                            >
                                <Save size={16} /> {savingForm ? 'Guardando...' : 'Guardar ficha'}
                            </button>
                        </form>
                    </div>
                </div>
            )}

            {showInteractionModal && detail && canWriteInteraction && (
                <div
                    className="modal-backdrop"
                    onMouseDown={(event) => {
                        if (event.target === event.currentTarget) closeInteractionModal();
                    }}
                >
                    <div
                        ref={interactionDialogRef}
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="customer-interaction-title"
                        aria-describedby="customer-interaction-description"
                        tabIndex={-1}
                        className="nx-dark-context nx-dark-chrome max-h-[calc(100dvh-2rem)] w-full max-w-xl overflow-y-auto rounded-card border border-white/[0.08] shadow-2xl"
                    >
                        <div className="flex items-start justify-between gap-4 border-b border-white/[0.06] p-6">
                            <div>
                                <h3 id="customer-interaction-title" className="nx-module-header text-xl font-bold text-slate-100">Registrar gestión</h3>
                                <p id="customer-interaction-description" className="mt-1 text-sm text-slate-400">{detail.profile.name} · dejá contexto y una próxima acción concreta.</p>
                            </div>
                            <button
                                type="button"
                                onClick={closeInteractionModal}
                                aria-label="Cerrar registro de gestión"
                                className="nx-fluid-press flex h-touch w-touch shrink-0 items-center justify-center rounded-full text-slate-400 hover:bg-white/[0.06] hover:text-slate-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-ring"
                            >
                                <X size={18} />
                            </button>
                        </div>

                        <form onSubmit={handleInteractionSubmit} className="space-y-4 p-6">
                            <div>
                                <label htmlFor="interaction-type" className="text-xs font-mono font-bold text-slate-500">TIPO DE GESTIÓN</label>
                                <select
                                    id="interaction-type"
                                    data-dialog-initial-focus="customer-interaction"
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
                                    className="mt-1 min-h-tap w-full rounded-control border border-white/[0.10] bg-white/[0.04] px-3 text-slate-100 outline-none focus:border-brand focus:ring-2 focus:ring-brand-ring"
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
                                    className="mt-1 min-h-[7rem] w-full resize-y rounded-control border border-white/[0.10] bg-white/[0.04] p-3 text-slate-100 outline-none focus:border-brand focus:ring-2 focus:ring-brand-ring"
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
                                            className="nx-num mt-1 min-h-tap w-full rounded-control border border-white/[0.10] bg-white/[0.04] px-3 text-slate-100 outline-none focus:border-brand focus:ring-2 focus:ring-brand-ring"
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
                                            className="mt-1 min-h-tap w-full rounded-control border border-white/[0.10] bg-white/[0.04] px-3 text-slate-100 outline-none focus:border-brand focus:ring-2 focus:ring-brand-ring"
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
                                    className="mt-1 min-h-tap w-full rounded-control border border-white/[0.10] bg-white/[0.04] px-3 text-slate-100 outline-none focus:border-brand focus:ring-2 focus:ring-brand-ring"
                                />
                                <p className="mt-1 text-xs text-slate-500">Si lo dejás vacío, una nota o contacto queda cerrado; una promesa permanece pendiente.</p>
                            </div>

                            {interactionError && (
                                <div role="alert" className="rounded-control border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                                    {interactionError}
                                </div>
                            )}

                            <button
                                type="submit"
                                disabled={savingInteraction}
                                className="nx-fluid-press inline-flex h-pay w-full items-center justify-center gap-2 rounded-control bg-brand px-4 text-sm font-semibold text-brand-on shadow-sm hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-ring"
                            >
                                <MessageSquare size={16} /> {savingInteraction ? 'Guardando gestión…' : 'Guardar gestión'}
                            </button>
                        </form>
                    </div>
                </div>
            )}

            {blockConfirm && (
                <div
                    className="modal-backdrop"
                    onMouseDown={(event) => {
                        if (event.target === event.currentTarget) setBlockConfirm(null);
                    }}
                >
                    <div
                        ref={blockDialogRef}
                        role="alertdialog"
                        aria-modal="true"
                        aria-labelledby="customer-block-title"
                        aria-describedby="customer-block-description"
                        tabIndex={-1}
                        className="nx-dark-context nx-dark-chrome w-full max-w-md rounded-card border border-white/[0.08] shadow-2xl"
                    >
                        <div className="border-b border-white/[0.06] p-6">
                            <h3 id="customer-block-title" className="nx-module-header text-xl font-bold text-slate-100">
                                {blockConfirm.nextBlockedState ? 'Bloquear crédito' : 'Desbloquear crédito'}
                            </h3>
                            <p id="customer-block-description" className="mt-2 text-sm text-slate-400">
                                {blockConfirm.nextBlockedState
                                    ? `Las próximas ventas a crédito para ${blockConfirm.name} quedarán frenadas hasta revisar su saldo.`
                                    : `El crédito de ${blockConfirm.name} volverá a quedar disponible para nuevas ventas.`}
                            </p>
                        </div>
                        <div className="flex gap-3 p-6">
                            <button
                                type="button"
                                onClick={() => setBlockConfirm(null)}
                                data-dialog-initial-focus="customer-block"
                                className="nx-fluid-press h-touch flex-1 rounded-control border border-white/[0.10] px-4 text-sm font-semibold text-slate-200 hover:bg-white/[0.06] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-ring"
                            >
                                Cancelar
                            </button>
                            <button
                                type="button"
                                onClick={() => void confirmToggleBlock()}
                                className={`nx-fluid-press min-h-tap flex-1 rounded-control px-4 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-ring ${
                                    blockConfirm.nextBlockedState
                                        ? 'bg-red-500/15 text-red-200 hover:bg-red-500/20'
                                        : 'bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/20'
                                }`}
                            >
                                {blockConfirm.nextBlockedState ? 'Confirmar bloqueo' : 'Confirmar desbloqueo'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Clients;
