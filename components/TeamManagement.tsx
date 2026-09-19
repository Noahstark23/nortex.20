import React, { useState, useEffect } from 'react';
import {
    Users, Plus, Shield, Eye, ShoppingCart, UserCog, Copy, Check,
    Trash2, Clock, Mail, ChevronDown, AlertCircle, Loader2, UserPlus, Calculator, Package
} from 'lucide-react';
import { TEAM_ASSIGNABLE_ROLES } from '../utils/roleCapabilities';

const API = import.meta.env.VITE_API_URL || '';

interface TeamUser {
    id: string;
    name: string;
    email: string;
    role: string;
    status: string;
    lastLogin: string | null;
    invitedBy: string | null;
    createdAt: string;
}

interface Invitation {
    id: string;
    email: string;
    role: string;
    status: string;
    token: string;
    expiresAt: string;
    createdAt: string;
}

type RoleTone = 'positive' | 'warning' | 'info' | 'neutral';

interface RoleVisualConfig {
    label: string;
    icon: React.ReactNode;
    color: `nx-tone-${RoleTone}`;
    bg: `nx-tone-${RoleTone}-bg`;
    description: string;
}

const ROLE_CONFIG: Record<string, RoleVisualConfig> = {
    OWNER: {
        label: 'Dueño',
        icon: <Shield size={14} />,
        color: 'nx-tone-warning',
        bg: 'nx-tone-warning-bg',
        description: 'Acceso total al sistema'
    },
    ADMIN: {
        label: 'Admin',
        icon: <Shield size={14} />,
        color: 'nx-tone-warning',
        bg: 'nx-tone-warning-bg',
        description: 'Acceso total al sistema'
    },
    MANAGER: {
        label: 'Gerente',
        icon: <UserCog size={14} />,
        color: 'nx-tone-info',
        bg: 'nx-tone-info-bg',
        description: 'Dashboard, POS, inventario, clientes, reportes, compras'
    },
    CASHIER: {
        label: 'Cajero',
        icon: <ShoppingCart size={14} />,
        color: 'nx-tone-positive',
        bg: 'nx-tone-positive-bg',
        description: 'Punto de Venta e inventario (solo lectura)'
    },
    VIEWER: {
        label: 'Visor',
        icon: <Eye size={14} />,
        color: 'nx-tone-neutral',
        bg: 'nx-tone-neutral-bg',
        description: 'Solo lectura: dashboard, reportes, clientes'
    },
    EMPLOYEE: {
        label: 'Empleado',
        icon: <Users size={14} />,
        color: 'nx-tone-neutral',
        bg: 'nx-tone-neutral-bg',
        description: 'POS e inventario básico'
    },
    VENDEDOR: {
        label: 'Vendedor',
        icon: <ShoppingCart size={14} />,
        color: 'nx-tone-info',
        bg: 'nx-tone-info-bg',
        description: 'Vende y cobra su cartera: POS, sus clientes, fiado y su reporte'
    },
    BODEGUERO: {
        label: 'Bodeguero',
        icon: <Package size={14} />,
        color: 'nx-tone-info',
        bg: 'nx-tone-info-bg',
        description: 'Existencias, transferencias, conteos y recepción. Sin acceso a ventas ni dinero'
    },
    ACCOUNTANT: {
        label: 'Contador',
        icon: <Calculator size={14} />,
        color: 'nx-tone-warning',
        bg: 'nx-tone-warning-bg',
        description: 'Reportes fiscales DGI, constancias, auditoría'
    },
};

const TeamManagement: React.FC = () => {
    const [users, setUsers] = useState<TeamUser[]>([]);
    const [invitations, setInvitations] = useState<Invitation[]>([]);
    const [loading, setLoading] = useState(true);
    const [showInviteModal, setShowInviteModal] = useState(false);
    const [inviteEmail, setInviteEmail] = useState('');
    const [inviteRole, setInviteRole] = useState('CASHIER');
    const [inviteLoading, setInviteLoading] = useState(false);
    const [generatedLink, setGeneratedLink] = useState('');
    // Catálogo asignado (Vendedores Fase B): modal por vendedor. `null` =
    // cerrado. Guarda el set editable de productIds + la lista de productos.
    const [catalogModal, setCatalogModal] = useState<{ sellerId: string; sellerName: string } | null>(null);
    const [catalogIds, setCatalogIds] = useState<Set<string>>(new Set());
    const [catalogProducts, setCatalogProducts] = useState<{ id: string; name: string; sku?: string }[]>([]);
    const [catalogSearch, setCatalogSearch] = useState('');
    const [catalogSaving, setCatalogSaving] = useState(false);

    const abrirCatalogo = async (sellerId: string, sellerName: string) => {
        setCatalogModal({ sellerId, sellerName });
        setCatalogSearch('');
        try {
            const [catRes, prodRes] = await Promise.all([
                fetch(`${API}/api/sellers/${sellerId}/catalog`, { headers: { Authorization: `Bearer ${token}` } }),
                fetch(`${API}/api/products`, { headers: { Authorization: `Bearer ${token}` } }),
            ]);
            const cat = catRes.ok ? await catRes.json() : { productIds: [] };
            const prods = prodRes.ok ? await prodRes.json() : [];
            setCatalogIds(new Set(cat.productIds));
            setCatalogProducts((Array.isArray(prods) ? prods : prods.products ?? []).map((p: any) => ({ id: p.id, name: p.name, sku: p.sku })));
        } catch { setCatalogProducts([]); }
    };

    const guardarCatalogo = async () => {
        if (!catalogModal) return;
        setCatalogSaving(true);
        try {
            const res = await fetch(`${API}/api/sellers/${catalogModal.sellerId}/catalog`, {
                method: 'PUT',
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ productIds: [...catalogIds] }),
            });
            const d = await res.json().catch(() => ({}));
            if (!res.ok) { alert(d.error || 'No se pudo guardar el catálogo'); return; }
            setCatalogModal(null);
        } catch { alert('Error de red'); }
        finally { setCatalogSaving(false); }
    };
    const [copiedLink, setCopiedLink] = useState(false);
    const [error, setError] = useState('');
    const [successMsg, setSuccessMsg] = useState('');

    // 'nortex_token' es LA llave del JWT en todo el repo (Login.tsx la
    // escribe). Acá decía 'token' — que no se escribe en ningún lado — así
    // que toda la pantalla operaba con Bearer null → 401: lista vacía,
    // invitaciones que "fallaban" y botones mudos. La única vía de dar de
    // alta a un empleado estaba muerta.
    const token = localStorage.getItem('nortex_token');

    const fetchTeam = async () => {
        try {
            const res = await fetch(`${API}/api/team`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            const data = await res.json();
            if (res.ok) {
                setUsers(data.users);
                setInvitations(data.invitations);
            }
        } catch (err) {
            console.error('Error fetching team:', err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchTeam(); }, []);

    const handleInvite = async () => {
        setInviteLoading(true);
        setError('');
        setGeneratedLink('');
        try {
            const res = await fetch(`${API}/api/team/invite`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify({ email: inviteEmail, role: inviteRole })
            });
            const data = await res.json();
            if (res.ok) {
                setGeneratedLink(data.inviteLink);
                fetchTeam();
            } else {
                setError(data.error || 'Error creando invitación');
            }
        } catch (err) {
            setError('Error de conexión');
        } finally {
            setInviteLoading(false);
        }
    };

    const handleCopyLink = () => {
        navigator.clipboard.writeText(generatedLink);
        setCopiedLink(true);
        setTimeout(() => setCopiedLink(false), 3000);
    };

    const handleDisableUser = async (userId: string, userName: string) => {
        if (!confirm(`¿Desactivar a ${userName}? Ya no podrá iniciar sesión.`)) return;
        try {
            const res = await fetch(`${API}/api/team/${userId}`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${token}` }
            });
            const data = await res.json();
            if (res.ok) {
                setSuccessMsg(data.message);
                fetchTeam();
                setTimeout(() => setSuccessMsg(''), 3000);
            } else {
                setError(data.error || 'No se pudo desactivar el usuario.');
            }
        } catch (err) {
            console.error(err);
            setError('No se pudo desactivar el usuario. Revisá tu conexión.');
        }
    };

    const handleChangeRole = async (userId: string, newRole: string) => {
        try {
            const res = await fetch(`${API}/api/team/${userId}/role`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify({ role: newRole })
            });
            const data = await res.json();
            if (res.ok) {
                setSuccessMsg(data.message);
                fetchTeam();
                setTimeout(() => setSuccessMsg(''), 3000);
            } else {
                setError(data.error || 'No se pudo cambiar el rol.');
            }
        } catch (err) {
            console.error(err);
            setError('No se pudo cambiar el rol. Revisá tu conexión.');
        }
    };

    const handleCancelInvite = async (invitationId: string) => {
        if (!confirm('¿Cancelar esta invitación?')) return;
        try {
            const res = await fetch(`${API}/api/team/invite/${invitationId}`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${token}` }
            });
            if (res.ok) {
                fetchTeam();
                setSuccessMsg('Invitación cancelada.');
                setTimeout(() => setSuccessMsg(''), 3000);
            } else {
                const data = await res.json().catch(() => ({}));
                setError(data.error || 'No se pudo cancelar la invitación.');
            }
        } catch (err) {
            console.error(err);
            setError('No se pudo cancelar la invitación. Revisá tu conexión.');
        }
    };

    const formatDate = (d: string | null) => {
        if (!d) return 'Nunca';
        return new Date(d).toLocaleDateString('es-NI', {
            day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
        });
    };

    if (loading) {
        return (
            <div className="nx-workspace flex h-full items-center justify-center">
                <Loader2 className="animate-spin text-brand" size={32} aria-label="Cargando equipo" />
            </div>
        );
    }

    return (
        <div className="nx-workspace mx-auto h-full w-full max-w-[1600px] space-y-6 overflow-y-auto p-4 sm:p-6 lg:p-8">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                    <h1 className="nx-module-header nx-canvas-text flex items-center gap-2 text-2xl font-bold">
                        <Users className="text-brand" aria-hidden="true" /> Mi Equipo
                    </h1>
                    <p className="nx-canvas-muted mt-1 text-sm">
                        Gestiona quién tiene acceso a tu sistema — {users.length} miembro{users.length !== 1 && 's'}
                    </p>
                </div>
                <button
                    type="button"
                    onClick={() => {
                        setShowInviteModal(true);
                        setInviteEmail('');
                        setInviteRole('CASHIER');
                        setGeneratedLink('');
                        setError('');
                    }}
                    className="nx-fluid-press flex min-h-tap items-center justify-center gap-2 rounded-control bg-brand px-5 py-2.5 font-bold text-brand-on shadow-sm transition-colors hover:bg-brand-hover"
                >
                    <UserPlus size={18} aria-hidden="true" /> Invitar Miembro
                </button>
            </div>

            {/* Success message */}
            {successMsg && (
                <div role="status" className="nx-tone-positive-bg nx-tone-positive flex items-center gap-2 rounded-control border p-3 text-sm font-medium">
                    <Check size={16} aria-hidden="true" /> {successMsg}
                </div>
            )}

            {/* Error a nivel de página: los fallos de desactivar/cambiar rol/
                cancelar invitación eran mudos (solo console.error) — el botón
                parecía no hacer nada. */}
            {error && !showInviteModal && (
                <div role="alert" className="nx-tone-danger-bg nx-tone-danger flex items-center gap-2 rounded-control border p-3 text-sm font-medium">
                    <AlertCircle size={16} aria-hidden="true" /> {error}
                </div>
            )}

            {/* Team Members */}
            <section className="nx-canvas-card overflow-hidden" aria-labelledby="active-team-title">
                <div className="border-b border-[var(--nx-canvas-border)] px-5 py-3">
                    <h2 id="active-team-title" className="nx-canvas-muted text-sm font-semibold uppercase tracking-wider">Miembros Activos</h2>
                </div>
                <div className="divide-y divide-[var(--nx-canvas-border)]">
                    {users.map(u => {
                        const rc = ROLE_CONFIG[u.role] || ROLE_CONFIG.EMPLOYEE;
                        const isOwner = ['OWNER', 'ADMIN'].includes(u.role);
                        return (
                            <div key={u.id} className="flex flex-col gap-3 px-5 py-4 transition-colors hover:bg-[var(--nx-canvas-subtle)] sm:flex-row sm:items-center">
                                {/* Avatar + Info */}
                                <div className="flex items-center gap-3 flex-1 min-w-0">
                                    <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border text-sm font-bold ${rc.bg} ${rc.color}`} aria-hidden="true">
                                        {u.name.charAt(0).toUpperCase()}
                                    </div>
                                    <div className="min-w-0">
                                        <div className="flex items-center gap-2">
                                            <span className="nx-canvas-text truncate font-semibold">{u.name}</span>
                                            {u.status === 'DISABLED' && (
                                                <span className="nx-tone-danger-bg nx-tone-danger rounded-pill px-2 py-0.5 text-[10px] font-bold">DESACTIVADO</span>
                                            )}
                                        </div>
                                        <p className="nx-canvas-muted truncate text-xs">{u.email}</p>
                                    </div>
                                </div>

                                {/* Role Badge */}
                                <div className={`flex shrink-0 items-center gap-1.5 rounded-pill border px-2.5 py-1 text-xs font-semibold ${rc.bg} ${rc.color}`}>
                                    {rc.icon} {rc.label}
                                </div>

                                {/* Last Login */}
                                <div className="nx-canvas-muted flex w-40 shrink-0 items-center gap-1 text-xs">
                                    <Clock size={12} aria-hidden="true" />
                                    <span>{formatDate(u.lastLogin)}</span>
                                </div>

                                {/* Actions */}
                                {!isOwner && u.status === 'ACTIVE' && (
                                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                                        <select
                                            aria-label={`Cambiar rol de ${u.name}`}
                                            value={u.role}
                                            onChange={(e) => handleChangeRole(u.id, e.target.value)}
                                            className="nx-canvas-text min-h-tap cursor-pointer rounded-control border border-[var(--nx-canvas-border)] bg-[var(--nx-canvas-raised)] px-3 text-xs hover:bg-[var(--nx-canvas-subtle)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-ring"
                                        >
                                            {TEAM_ASSIGNABLE_ROLES.map(role => (
                                                <option key={role} value={role}>{ROLE_CONFIG[role].label}</option>
                                            ))}
                                        </select>
                                        {u.role === 'VENDEDOR' && (
                                            <button
                                                type="button"
                                                onClick={() => abrirCatalogo(u.id, u.name)}
                                                className="nx-fluid-press nx-tone-info flex h-touch w-touch items-center justify-center rounded-control transition-colors hover:bg-[var(--nx-canvas-subtle)]"
                                                title="Catálogo asignado (qué productos vende)"
                                                aria-label={`Abrir catálogo asignado de ${u.name}`}
                                            >
                                                <Package size={16} aria-hidden="true" />
                                            </button>
                                        )}
                                        <button
                                            type="button"
                                            onClick={() => handleDisableUser(u.id, u.name)}
                                            className="nx-fluid-press nx-tone-danger flex h-touch w-touch items-center justify-center rounded-control transition-colors hover:bg-[var(--nx-danger-bg)]"
                                            title="Desactivar usuario"
                                            aria-label={`Desactivar a ${u.name}`}
                                        >
                                            <Trash2 size={16} aria-hidden="true" />
                                        </button>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </section>

            {/* Pending Invitations */}
            {invitations.length > 0 && (
                <section className="nx-canvas-card overflow-hidden" aria-labelledby="pending-invitations-title">
                    <div className="border-b border-[var(--nx-canvas-border)] px-5 py-3">
                        <h2 id="pending-invitations-title" className="nx-canvas-muted text-sm font-semibold uppercase tracking-wider">Invitaciones Pendientes</h2>
                    </div>
                    <div className="divide-y divide-[var(--nx-canvas-border)]">
                        {invitations.map(inv => {
                            const rc = ROLE_CONFIG[inv.role] || ROLE_CONFIG.EMPLOYEE;
                            const expiresIn = Math.max(0, Math.floor((new Date(inv.expiresAt).getTime() - Date.now()) / 3600000));
                            const baseUrl = window.location.origin;
                            const link = `${baseUrl}/invite/${inv.token}`;
                            return (
                                <div key={inv.id} className="flex flex-col gap-3 px-5 py-4 transition-colors hover:bg-[var(--nx-canvas-subtle)] sm:flex-row sm:items-center">
                                    <div className="flex items-center gap-3 flex-1 min-w-0">
                                        <div className="nx-tone-neutral-bg nx-tone-neutral flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-dashed">
                                            <Mail size={16} aria-hidden="true" />
                                        </div>
                                        <div className="min-w-0">
                                            <p className="nx-canvas-text truncate font-medium">{inv.email}</p>
                                            <p className="nx-canvas-muted text-xs">Expira en {expiresIn}h</p>
                                        </div>
                                    </div>
                                    <div className={`flex shrink-0 items-center gap-1.5 rounded-pill border px-2.5 py-1 text-xs font-semibold ${rc.bg} ${rc.color}`}>
                                        {rc.icon} {rc.label}
                                    </div>
                                    <div className="flex shrink-0 items-center gap-2">
                                        <button
                                            type="button"
                                            onClick={() => { navigator.clipboard.writeText(link); setSuccessMsg('Link copiado!'); setTimeout(() => setSuccessMsg(''), 2000); }}
                                            className="nx-fluid-press nx-canvas-text flex min-h-tap items-center gap-1 rounded-control border border-[var(--nx-canvas-border)] bg-[var(--nx-canvas-raised)] px-3 text-xs font-semibold transition-colors hover:bg-[var(--nx-canvas-subtle)]"
                                        >
                                            <Copy size={14} aria-hidden="true" /> Copiar Link
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => handleCancelInvite(inv.id)}
                                            className="nx-fluid-press nx-tone-danger flex h-touch w-touch items-center justify-center rounded-control transition-colors hover:bg-[var(--nx-danger-bg)]"
                                            aria-label={`Cancelar invitación de ${inv.email}`}
                                        >
                                            <Trash2 size={16} aria-hidden="true" />
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </section>
            )}

            {/* Role Permissions Info */}
            <section className="nx-canvas-card p-5" aria-labelledby="role-permissions-title">
                <h2 id="role-permissions-title" className="nx-canvas-muted mb-4 text-sm font-semibold uppercase tracking-wider">Permisos por Rol</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    {TEAM_ASSIGNABLE_ROLES.map(role => {
                        const rc = ROLE_CONFIG[role];
                        return (
                            <div key={role} className={`rounded-card border p-3 ${rc.bg}`}>
                                <div className={`mb-1 flex items-center gap-1.5 text-sm font-semibold ${rc.color}`}>
                                    {rc.icon} {rc.label}
                                </div>
                                <p className="nx-canvas-muted text-xs leading-relaxed">{rc.description}</p>
                            </div>
                        );
                    })}
                </div>
            </section>

            {/* ====== INVITE MODAL ====== */}
            {showInviteModal && (
                <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 backdrop-blur-sm sm:items-center">
                    <div role="dialog" aria-modal="true" aria-labelledby="invite-member-title" className="nx-canvas-card max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto shadow-2xl">
                        <div className="p-6">
                            <h2 id="invite-member-title" className="nx-canvas-text mb-1 flex items-center gap-2 text-xl font-bold">
                                <UserPlus className="text-brand" size={22} aria-hidden="true" /> Invitar Miembro
                            </h2>
                            <p className="nx-canvas-muted mb-6 text-sm">El invitado recibirá un link para crear su cuenta.</p>

                            {!generatedLink ? (
                                <>
                                    {/* Email */}
                                    <div className="mb-4">
                                        <label htmlFor="team-invite-email" className="nx-canvas-text mb-1.5 block text-sm font-medium">Email</label>
                                        <input
                                            id="team-invite-email"
                                            type="email"
                                            value={inviteEmail}
                                            onChange={e => setInviteEmail(e.target.value)}
                                            placeholder="empleado@ejemplo.com"
                                            className="nx-canvas-text min-h-tap w-full rounded-control border border-[var(--nx-canvas-border)] bg-[var(--nx-canvas-raised)] px-4 py-2.5 placeholder:text-[var(--nx-canvas-faint)] focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand-ring"
                                        />
                                    </div>

                                    {/* Role */}
                                    <div className="mb-6">
                                        <p className="nx-canvas-text mb-2 text-sm font-medium">Rol</p>
                                        <div className="grid grid-cols-2 gap-2">
                                            {TEAM_ASSIGNABLE_ROLES.map(role => {
                                                const rc = ROLE_CONFIG[role];
                                                const isSelected = inviteRole === role;
                                                return (
                                                    <button
                                                        type="button"
                                                        key={role}
                                                        onClick={() => setInviteRole(role)}
                                                        aria-pressed={isSelected}
                                                        className={`nx-fluid-press min-h-tap rounded-control border p-3 text-left transition-colors ${isSelected
                                                            ? `${rc.bg} ${rc.color} ring-1 ring-current`
                                                            : 'border-[var(--nx-canvas-border)] hover:bg-[var(--nx-canvas-subtle)]'
                                                            }`}
                                                    >
                                                        <div className={`mb-0.5 flex items-center gap-1.5 text-sm font-medium ${isSelected ? rc.color : 'nx-canvas-text'}`}>
                                                            {rc.icon} {rc.label}
                                                        </div>
                                                        <p className="nx-canvas-muted text-[11px] leading-relaxed">{rc.description}</p>
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>

                                    {error && (
                                        <div role="alert" className="nx-tone-danger-bg nx-tone-danger mb-4 flex items-center gap-2 rounded-control border p-3 text-sm font-medium">
                                            <AlertCircle size={16} aria-hidden="true" /> {error}
                                        </div>
                                    )}

                                    <div className="flex gap-3">
                                        <button
                                            type="button"
                                            onClick={() => setShowInviteModal(false)}
                                            className="nx-fluid-press nx-canvas-text min-h-tap flex-1 rounded-control border border-[var(--nx-canvas-border)] px-4 py-2.5 font-semibold transition-colors hover:bg-[var(--nx-canvas-subtle)]"
                                        >
                                            Cancelar
                                        </button>
                                        <button
                                            type="button"
                                            onClick={handleInvite}
                                            disabled={!inviteEmail || inviteLoading}
                                            className="nx-fluid-press flex min-h-tap flex-1 items-center justify-center gap-2 rounded-control bg-brand px-4 py-2.5 font-bold text-brand-on transition-colors hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-50"
                                        >
                                            {inviteLoading ? <Loader2 className="animate-spin" size={16} aria-hidden="true" /> : <Plus size={16} aria-hidden="true" />}
                                            {inviteLoading ? 'Creando...' : 'Crear Invitación'}
                                        </button>
                                    </div>
                                </>
                            ) : (
                                /* Link Generated */
                                <div className="space-y-4">
                                    <div className="nx-tone-positive-bg rounded-control border p-4 text-center">
                                        <Check className="nx-tone-positive mx-auto mb-2" size={32} aria-hidden="true" />
                                        <p className="nx-tone-positive font-semibold">¡Invitación Creada!</p>
                                        <p className="nx-canvas-muted mt-1 text-xs">Comparte este link con <strong className="nx-canvas-text">{inviteEmail}</strong></p>
                                    </div>

                                    <div className="flex items-center gap-2 rounded-control bg-[var(--nx-canvas-subtle)] p-3">
                                        <input
                                            readOnly
                                            value={generatedLink}
                                            aria-label="Enlace de invitación generado"
                                            className="nx-canvas-text min-w-0 flex-1 truncate border-none bg-transparent font-mono text-sm outline-none"
                                        />
                                        <button
                                            type="button"
                                            onClick={handleCopyLink}
                                            className={`nx-fluid-press flex min-h-tap shrink-0 items-center gap-1 rounded-control border px-3 text-sm font-semibold transition-colors ${copiedLink
                                                ? 'nx-tone-positive-bg nx-tone-positive'
                                                : 'nx-canvas-text border-[var(--nx-canvas-border)] bg-[var(--nx-canvas-raised)] hover:bg-[var(--nx-canvas-subtle)]'
                                                }`}
                                        >
                                            {copiedLink ? <><Check size={14} aria-hidden="true" /> Copiado</> : <><Copy size={14} aria-hidden="true" /> Copiar</>}
                                        </button>
                                    </div>

                                    <p className="nx-canvas-muted text-center text-xs">
                                        El link expira en 48 horas. Puedes compartirlo por WhatsApp, email, etc.
                                    </p>

                                    <button
                                        type="button"
                                        onClick={() => setShowInviteModal(false)}
                                        className="nx-fluid-press nx-canvas-text min-h-tap w-full rounded-control border border-[var(--nx-canvas-border)] bg-[var(--nx-canvas-raised)] px-4 py-2.5 font-semibold transition-colors hover:bg-[var(--nx-canvas-subtle)]"
                                    >
                                        Cerrar
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* ── Modal: catálogo asignado del vendedor ─────────────────── */}
            {catalogModal && (
                <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 backdrop-blur-sm sm:items-center" onClick={() => setCatalogModal(null)}>
                    <div role="dialog" aria-modal="true" aria-labelledby="seller-catalog-title" className="nx-canvas-card flex max-h-[calc(100dvh-2rem)] w-full max-w-lg flex-col overflow-hidden shadow-2xl" onClick={e => e.stopPropagation()}>
                        <div className="border-b border-[var(--nx-canvas-border)] p-4">
                            <h3 id="seller-catalog-title" className="nx-canvas-text flex items-center gap-2 font-bold">
                                <Package size={16} className="nx-tone-info" aria-hidden="true" /> Catálogo de {catalogModal.sellerName}
                            </h3>
                            <p className="nx-canvas-muted mt-1 text-xs leading-relaxed">
                                Marcá qué productos vende. Sin ninguno marcado, ve el catálogo completo
                                (así funciona hoy). Con uno o más, su POS muestra SOLO esos.
                            </p>
                            <input
                                value={catalogSearch}
                                onChange={e => setCatalogSearch(e.target.value)}
                                placeholder="Buscar producto…"
                                className="nx-canvas-text mt-3 min-h-tap w-full rounded-control border border-[var(--nx-canvas-border)] bg-[var(--nx-canvas-raised)] px-3 py-2 text-sm placeholder:text-[var(--nx-canvas-faint)] focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand-ring"
                            />
                        </div>
                        <div className="flex-1 overflow-y-auto p-2">
                            {catalogProducts
                                .filter(pr => pr.name.toLowerCase().includes(catalogSearch.toLowerCase()) || (pr.sku ?? '').toLowerCase().includes(catalogSearch.toLowerCase()))
                                .slice(0, 300)
                                .map(pr => (
                                    <label key={pr.id} className="nx-canvas-text flex min-h-tap cursor-pointer items-center gap-2 rounded-control px-2 py-1.5 text-sm transition-colors hover:bg-[var(--nx-canvas-subtle)]">
                                        <input
                                            type="checkbox"
                                            checked={catalogIds.has(pr.id)}
                                            onChange={e => {
                                                const next = new Set(catalogIds);
                                                if (e.target.checked) next.add(pr.id); else next.delete(pr.id);
                                                setCatalogIds(next);
                                            }}
                                        />
                                        <span className="truncate">{pr.name}</span>
                                        {pr.sku && <span className="nx-canvas-muted ml-auto shrink-0 font-mono text-[10px]">{pr.sku}</span>}
                                    </label>
                                ))}
                            {catalogProducts.length === 0 && (
                                <p className="nx-canvas-muted py-6 text-center text-sm">Sin productos en el inventario.</p>
                            )}
                        </div>
                        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--nx-canvas-border)] p-4">
                            <span className="nx-canvas-muted text-xs">{catalogIds.size} producto(s) asignado(s)</span>
                            <div className="flex gap-2">
                                <button type="button" onClick={() => setCatalogModal(null)} className="nx-fluid-press nx-canvas-text min-h-tap rounded-control border border-[var(--nx-canvas-border)] px-4 py-2 text-sm font-semibold transition-colors hover:bg-[var(--nx-canvas-subtle)]">Cancelar</button>
                                <button type="button" onClick={guardarCatalogo} disabled={catalogSaving}
                                    className="nx-fluid-press min-h-tap rounded-control bg-brand px-4 py-2 text-sm font-bold text-brand-on transition-colors hover:bg-brand-hover disabled:opacity-50">
                                    {catalogSaving ? 'Guardando…' : 'Guardar catálogo'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default TeamManagement;
