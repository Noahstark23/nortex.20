import React, { useState, useEffect } from 'react';
import {
    Users, Plus, Shield, Eye, ShoppingCart, UserCog, Copy, Check,
    Trash2, Clock, Mail, ChevronDown, AlertCircle, Loader2, UserPlus, Calculator, Package
} from 'lucide-react';

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

const ROLE_CONFIG: Record<string, { label: string; icon: React.ReactNode; color: string; bg: string; description: string }> = {
    OWNER: {
        label: 'Dueño',
        icon: <Shield size={14} />,
        color: 'text-amber-400',
        bg: 'bg-amber-500/10 border-amber-500/30',
        description: 'Acceso total al sistema'
    },
    ADMIN: {
        label: 'Admin',
        icon: <Shield size={14} />,
        color: 'text-amber-400',
        bg: 'bg-amber-500/10 border-amber-500/30',
        description: 'Acceso total al sistema'
    },
    MANAGER: {
        label: 'Gerente',
        icon: <UserCog size={14} />,
        color: 'text-blue-400',
        bg: 'bg-blue-500/10 border-blue-500/30',
        description: 'Dashboard, POS, inventario, clientes, reportes, compras'
    },
    CASHIER: {
        label: 'Cajero',
        icon: <ShoppingCart size={14} />,
        color: 'text-emerald-400',
        bg: 'bg-emerald-500/10 border-emerald-500/30',
        description: 'Punto de Venta e inventario (solo lectura)'
    },
    VIEWER: {
        label: 'Visor',
        icon: <Eye size={14} />,
        color: 'text-purple-400',
        bg: 'bg-purple-500/10 border-purple-500/30',
        description: 'Solo lectura: dashboard, reportes, clientes'
    },
    EMPLOYEE: {
        label: 'Empleado',
        icon: <Users size={14} />,
        color: 'text-slate-400',
        bg: 'bg-slate-500/10 border-slate-500/30',
        description: 'POS e inventario básico'
    },
    VENDEDOR: {
        label: 'Vendedor',
        icon: <ShoppingCart size={14} />,
        color: 'text-cyan-400',
        bg: 'bg-cyan-500/10 border-cyan-500/30',
        description: 'Vende y cobra su cartera: POS, sus clientes, fiado y su reporte'
    },
    ACCOUNTANT: {
        label: 'Contador',
        icon: <Calculator size={14} />,
        color: 'text-amber-400',
        bg: 'bg-amber-500/10 border-amber-500/30',
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
            <div className="flex items-center justify-center h-64">
                <Loader2 className="animate-spin text-nortex-accent" size={32} />
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-white flex items-center gap-2">
                        <Users className="text-nortex-accent" /> Mi Equipo
                    </h1>
                    <p className="text-slate-400 text-sm mt-1">
                        Gestiona quién tiene acceso a tu sistema — {users.length} miembro{users.length !== 1 && 's'}
                    </p>
                </div>
                <button
                    onClick={() => {
                        setShowInviteModal(true);
                        setInviteEmail('');
                        setInviteRole('CASHIER');
                        setGeneratedLink('');
                        setError('');
                    }}
                    className="flex items-center gap-2 px-5 py-2.5 bg-nortex-accent text-nortex-900 font-bold rounded-lg hover:bg-emerald-400 transition-all shadow-lg shadow-nortex-accent/20"
                >
                    <UserPlus size={18} /> Invitar Miembro
                </button>
            </div>

            {/* Success message */}
            {successMsg && (
                <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-3 text-emerald-400 text-sm flex items-center gap-2">
                    <Check size={16} /> {successMsg}
                </div>
            )}

            {/* Error a nivel de página: los fallos de desactivar/cambiar rol/
                cancelar invitación eran mudos (solo console.error) — el botón
                parecía no hacer nada. */}
            {error && !showInviteModal && (
                <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-red-400 text-sm flex items-center gap-2">
                    <AlertCircle size={16} /> {error}
                </div>
            )}

            {/* Team Members */}
            <div className="bg-nortex-800/50 border border-slate-700/50 rounded-xl overflow-hidden">
                <div className="px-5 py-3 border-b border-slate-700/50">
                    <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">Miembros Activos</h2>
                </div>
                <div className="divide-y divide-slate-700/30">
                    {users.map(u => {
                        const rc = ROLE_CONFIG[u.role] || ROLE_CONFIG.EMPLOYEE;
                        const isOwner = ['OWNER', 'ADMIN'].includes(u.role);
                        return (
                            <div key={u.id} className="px-5 py-4 flex flex-col sm:flex-row sm:items-center gap-3 hover:bg-slate-800/30 transition-colors">
                                {/* Avatar + Info */}
                                <div className="flex items-center gap-3 flex-1 min-w-0">
                                    <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold ${rc.bg} ${rc.color} border shrink-0`}>
                                        {u.name.charAt(0).toUpperCase()}
                                    </div>
                                    <div className="min-w-0">
                                        <div className="flex items-center gap-2">
                                            <span className="font-semibold text-white truncate">{u.name}</span>
                                            {u.status === 'DISABLED' && (
                                                <span className="text-[10px] bg-red-500/20 text-red-400 px-1.5 py-0.5 rounded font-mono">DESACTIVADO</span>
                                            )}
                                        </div>
                                        <p className="text-xs text-slate-500 truncate">{u.email}</p>
                                    </div>
                                </div>

                                {/* Role Badge */}
                                <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border ${rc.bg} ${rc.color} shrink-0`}>
                                    {rc.icon} {rc.label}
                                </div>

                                {/* Last Login */}
                                <div className="text-xs text-slate-500 flex items-center gap-1 shrink-0 w-40">
                                    <Clock size={12} />
                                    <span>{formatDate(u.lastLogin)}</span>
                                </div>

                                {/* Actions */}
                                {!isOwner && u.status === 'ACTIVE' && (
                                    <div className="flex items-center gap-2 shrink-0">
                                        <select
                                            value={u.role}
                                            onChange={(e) => handleChangeRole(u.id, e.target.value)}
                                            className="bg-slate-800 border border-slate-600 rounded text-xs text-slate-300 px-2 py-1 cursor-pointer hover:border-slate-500"
                                        >
                                            <option value="MANAGER">Gerente</option>
                                            <option value="CASHIER">Cajero</option>
                                            <option value="VENDEDOR">Vendedor</option>
                                            <option value="VIEWER">Visor</option>
                                            <option value="EMPLOYEE">Empleado</option>
                                            <option value="ACCOUNTANT">Contador</option>
                                        </select>
                                        {u.role === 'VENDEDOR' && (
                                            <button
                                                onClick={() => abrirCatalogo(u.id, u.name)}
                                                className="p-1.5 text-cyan-400 hover:bg-cyan-500/10 rounded transition-colors"
                                                title="Catálogo asignado (qué productos vende)"
                                            >
                                                <Package size={14} />
                                            </button>
                                        )}
                                        <button
                                            onClick={() => handleDisableUser(u.id, u.name)}
                                            className="p-1.5 text-red-400 hover:bg-red-500/10 rounded transition-colors"
                                            title="Desactivar usuario"
                                        >
                                            <Trash2 size={14} />
                                        </button>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Pending Invitations */}
            {invitations.length > 0 && (
                <div className="bg-nortex-800/50 border border-slate-700/50 rounded-xl overflow-hidden">
                    <div className="px-5 py-3 border-b border-slate-700/50">
                        <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">Invitaciones Pendientes</h2>
                    </div>
                    <div className="divide-y divide-slate-700/30">
                        {invitations.map(inv => {
                            const rc = ROLE_CONFIG[inv.role] || ROLE_CONFIG.EMPLOYEE;
                            const expiresIn = Math.max(0, Math.floor((new Date(inv.expiresAt).getTime() - Date.now()) / 3600000));
                            const baseUrl = window.location.origin;
                            const link = `${baseUrl}/invite/${inv.token}`;
                            return (
                                <div key={inv.id} className="px-5 py-4 flex flex-col sm:flex-row sm:items-center gap-3 hover:bg-slate-800/30 transition-colors">
                                    <div className="flex items-center gap-3 flex-1 min-w-0">
                                        <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm bg-slate-700/50 text-slate-400 border border-dashed border-slate-600 shrink-0">
                                            <Mail size={16} />
                                        </div>
                                        <div className="min-w-0">
                                            <p className="text-white font-medium truncate">{inv.email}</p>
                                            <p className="text-xs text-slate-500">Expira en {expiresIn}h</p>
                                        </div>
                                    </div>
                                    <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border ${rc.bg} ${rc.color} shrink-0`}>
                                        {rc.icon} {rc.label}
                                    </div>
                                    <div className="flex items-center gap-2 shrink-0">
                                        <button
                                            onClick={() => { navigator.clipboard.writeText(link); setSuccessMsg('Link copiado!'); setTimeout(() => setSuccessMsg(''), 2000); }}
                                            className="flex items-center gap-1 px-3 py-1.5 bg-slate-700 text-slate-300 rounded text-xs hover:bg-slate-600 transition-colors"
                                        >
                                            <Copy size={12} /> Copiar Link
                                        </button>
                                        <button
                                            onClick={() => handleCancelInvite(inv.id)}
                                            className="p-1.5 text-red-400 hover:bg-red-500/10 rounded transition-colors"
                                        >
                                            <Trash2 size={14} />
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* Role Permissions Info */}
            <div className="bg-nortex-800/50 border border-slate-700/50 rounded-xl p-5">
                <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider mb-4">Permisos por Rol</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    {['MANAGER', 'CASHIER', 'VENDEDOR', 'VIEWER', 'EMPLOYEE', 'ACCOUNTANT'].map(role => {
                        const rc = ROLE_CONFIG[role];
                        return (
                            <div key={role} className={`p-3 rounded-lg border ${rc.bg}`}>
                                <div className={`flex items-center gap-1.5 font-semibold text-sm mb-1 ${rc.color}`}>
                                    {rc.icon} {rc.label}
                                </div>
                                <p className="text-xs text-slate-400">{rc.description}</p>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* ====== INVITE MODAL ====== */}
            {showInviteModal && (
                <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="bg-nortex-800 border border-slate-700 rounded-2xl w-full max-w-md shadow-2xl">
                        <div className="p-6">
                            <h2 className="text-xl font-bold text-white flex items-center gap-2 mb-1">
                                <UserPlus className="text-nortex-accent" size={22} /> Invitar Miembro
                            </h2>
                            <p className="text-sm text-slate-400 mb-6">El invitado recibirá un link para crear su cuenta.</p>

                            {!generatedLink ? (
                                <>
                                    {/* Email */}
                                    <div className="mb-4">
                                        <label className="text-sm font-medium text-slate-300 block mb-1.5">Email</label>
                                        <input
                                            type="email"
                                            value={inviteEmail}
                                            onChange={e => setInviteEmail(e.target.value)}
                                            placeholder="empleado@ejemplo.com"
                                            className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-2.5 text-white placeholder:text-slate-500 focus:border-nortex-accent focus:outline-none"
                                        />
                                    </div>

                                    {/* Role */}
                                    <div className="mb-6">
                                        <label className="text-sm font-medium text-slate-300 block mb-2">Rol</label>
                                        <div className="grid grid-cols-2 gap-2">
                                            {['MANAGER', 'CASHIER', 'VENDEDOR', 'VIEWER', 'EMPLOYEE', 'ACCOUNTANT'].map(role => {
                                                const rc = ROLE_CONFIG[role];
                                                const isSelected = inviteRole === role;
                                                return (
                                                    <button
                                                        key={role}
                                                        onClick={() => setInviteRole(role)}
                                                        className={`p-3 rounded-lg border text-left transition-all ${isSelected
                                                            ? `${rc.bg} border-current ${rc.color} ring-1 ring-current`
                                                            : 'border-slate-700 hover:border-slate-600'
                                                            }`}
                                                    >
                                                        <div className={`flex items-center gap-1.5 text-sm font-medium mb-0.5 ${isSelected ? rc.color : 'text-slate-300'}`}>
                                                            {rc.icon} {rc.label}
                                                        </div>
                                                        <p className="text-[11px] text-slate-500">{rc.description}</p>
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>

                                    {error && (
                                        <div className="mb-4 bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-sm text-red-400 flex items-center gap-2">
                                            <AlertCircle size={16} /> {error}
                                        </div>
                                    )}

                                    <div className="flex gap-3">
                                        <button
                                            onClick={() => setShowInviteModal(false)}
                                            className="flex-1 px-4 py-2.5 border border-slate-600 text-slate-300 rounded-lg hover:bg-slate-700 transition-colors"
                                        >
                                            Cancelar
                                        </button>
                                        <button
                                            onClick={handleInvite}
                                            disabled={!inviteEmail || inviteLoading}
                                            className="flex-1 px-4 py-2.5 bg-nortex-accent text-nortex-900 font-bold rounded-lg hover:bg-emerald-400 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                                        >
                                            {inviteLoading ? <Loader2 className="animate-spin" size={16} /> : <Plus size={16} />}
                                            {inviteLoading ? 'Creando...' : 'Crear Invitación'}
                                        </button>
                                    </div>
                                </>
                            ) : (
                                /* Link Generated */
                                <div className="space-y-4">
                                    <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-4 text-center">
                                        <Check className="text-emerald-400 mx-auto mb-2" size={32} />
                                        <p className="text-emerald-400 font-medium">¡Invitación Creada!</p>
                                        <p className="text-xs text-slate-400 mt-1">Comparte este link con <strong className="text-white">{inviteEmail}</strong></p>
                                    </div>

                                    <div className="bg-slate-900 rounded-lg p-3 flex items-center gap-2">
                                        <input
                                            readOnly
                                            value={generatedLink}
                                            className="flex-1 bg-transparent text-sm text-nortex-accent font-mono truncate border-none outline-none"
                                        />
                                        <button
                                            onClick={handleCopyLink}
                                            className={`shrink-0 px-3 py-1.5 rounded text-sm font-medium transition-all flex items-center gap-1 ${copiedLink
                                                ? 'bg-emerald-500/20 text-emerald-400'
                                                : 'bg-slate-700 text-white hover:bg-slate-600'
                                                }`}
                                        >
                                            {copiedLink ? <><Check size={14} /> Copiado</> : <><Copy size={14} /> Copiar</>}
                                        </button>
                                    </div>

                                    <p className="text-xs text-slate-500 text-center">
                                        El link expira en 48 horas. Puedes compartirlo por WhatsApp, email, etc.
                                    </p>

                                    <button
                                        onClick={() => setShowInviteModal(false)}
                                        className="w-full px-4 py-2.5 bg-slate-700 text-white rounded-lg hover:bg-slate-600 transition-colors"
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
                <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={() => setCatalogModal(null)}>
                    <div className="bg-slate-900 border border-slate-700 rounded-xl w-full max-w-lg max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
                        <div className="p-4 border-b border-slate-700">
                            <h3 className="font-bold text-white flex items-center gap-2">
                                <Package size={16} className="text-cyan-400" /> Catálogo de {catalogModal.sellerName}
                            </h3>
                            <p className="text-xs text-slate-500 mt-1">
                                Marcá qué productos vende. Sin ninguno marcado, ve el catálogo completo
                                (así funciona hoy). Con uno o más, su POS muestra SOLO esos.
                            </p>
                            <input
                                value={catalogSearch}
                                onChange={e => setCatalogSearch(e.target.value)}
                                placeholder="Buscar producto…"
                                className="mt-3 w-full bg-slate-800 border border-slate-600 rounded px-3 py-1.5 text-sm text-slate-200"
                            />
                        </div>
                        <div className="flex-1 overflow-y-auto p-2">
                            {catalogProducts
                                .filter(pr => pr.name.toLowerCase().includes(catalogSearch.toLowerCase()) || (pr.sku ?? '').toLowerCase().includes(catalogSearch.toLowerCase()))
                                .slice(0, 300)
                                .map(pr => (
                                    <label key={pr.id} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-slate-800 cursor-pointer text-sm text-slate-300">
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
                                        {pr.sku && <span className="text-[10px] text-slate-500 font-mono ml-auto shrink-0">{pr.sku}</span>}
                                    </label>
                                ))}
                            {catalogProducts.length === 0 && (
                                <p className="text-center text-slate-500 text-sm py-6">Sin productos en el inventario.</p>
                            )}
                        </div>
                        <div className="p-4 border-t border-slate-700 flex items-center justify-between gap-3">
                            <span className="text-xs text-slate-500">{catalogIds.size} producto(s) asignado(s)</span>
                            <div className="flex gap-2">
                                <button onClick={() => setCatalogModal(null)} className="px-4 py-2 bg-slate-700 text-white rounded-lg text-sm hover:bg-slate-600">Cancelar</button>
                                <button onClick={guardarCatalogo} disabled={catalogSaving}
                                    className="px-4 py-2 bg-cyan-600 text-white rounded-lg text-sm font-bold hover:bg-cyan-500 disabled:opacity-50">
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
