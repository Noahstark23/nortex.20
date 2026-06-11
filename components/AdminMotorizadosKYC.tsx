import React, { useState, useEffect, useCallback } from 'react';
import { Bike, CheckCircle, XCircle, Phone, MapPin, CreditCard, Hash, ExternalLink, Loader2, ShieldCheck } from 'lucide-react';

/**
 * Cola de revisión KYC de la Red NORTEX (panel SUPER_ADMIN).
 * Lista los motorizados auto-registrados, muestra sus documentos (cédula +
 * moto) y permite Aprobar (activa la cuenta) o Rechazar con nota.
 */

interface MotorizadoKYC {
    id: string;
    nombre: string;
    telefono: string;
    cedula?: string | null;
    zonaCobertura: string;
    vehiculoPlaca?: string | null;
    fotoCedulaUrl?: string | null;
    fotoVehiculoUrl?: string | null;
    kycStatus: string;
    kycNota?: string | null;
    activo: boolean;
    createdAt: string;
}

const AdminMotorizadosKYC: React.FC = () => {
    const [motorizados, setMotorizados] = useState<MotorizadoKYC[]>([]);
    const [loading, setLoading] = useState(true);
    const [actionId, setActionId] = useState<string | null>(null);
    const [rejectingId, setRejectingId] = useState<string | null>(null);
    const [rejectNota, setRejectNota] = useState('');

    const token = localStorage.getItem('nortex_token');

    const fetchMotorizados = useCallback(async () => {
        try {
            const res = await fetch('/api/admin/motorizados', {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (res.ok) {
                const data = await res.json();
                setMotorizados(data.motorizados ?? []);
            }
        } catch { /* red caída — se reintenta con el refresh del panel */ }
        finally { setLoading(false); }
    }, [token]);

    useEffect(() => { fetchMotorizados(); }, [fetchMotorizados]);

    const decide = async (id: string, decision: 'APROBADO' | 'RECHAZADO', nota?: string) => {
        setActionId(id);
        try {
            const res = await fetch(`/api/admin/motorizados/${id}/kyc`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({ decision, nota }),
            });
            if (res.ok) {
                setRejectingId(null);
                setRejectNota('');
                await fetchMotorizados();
            } else {
                const d = await res.json();
                alert(d.error || 'Error procesando la decisión');
            }
        } catch { alert('Error de conexión'); }
        finally { setActionId(null); }
    };

    const pendientes = motorizados.filter(m => m.kycStatus === 'PENDIENTE');
    const procesados = motorizados.filter(m => m.kycStatus !== 'PENDIENTE');

    return (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 mb-6">
            <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-bold text-white flex items-center gap-2 uppercase tracking-wider">
                    <Bike size={16} className="text-emerald-400" />
                    Red Nortex — Revisión KYC
                    {pendientes.length > 0 && (
                        <span className="bg-amber-500/20 text-amber-400 border border-amber-500/30 text-[10px] px-2 py-0.5 rounded-full font-black">
                            {pendientes.length} PENDIENTE{pendientes.length !== 1 ? 'S' : ''}
                        </span>
                    )}
                </h2>
                <span className="text-[10px] text-gray-500 uppercase">{procesados.length} procesados</span>
            </div>

            {loading ? (
                <div className="flex items-center justify-center py-8 text-gray-500">
                    <Loader2 className="animate-spin mr-2" size={18} /> Cargando solicitudes...
                </div>
            ) : pendientes.length === 0 ? (
                <div className="text-center py-6 text-gray-500 text-sm flex items-center justify-center gap-2">
                    <ShieldCheck size={16} className="text-emerald-500" /> Sin solicitudes pendientes de revisión.
                </div>
            ) : (
                <div className="space-y-3">
                    {pendientes.map(m => (
                        <div key={m.id} className="bg-gray-800/60 border border-gray-700 rounded-xl p-4">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <p className="font-bold text-white">{m.nombre}</p>
                                    <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1.5 text-xs text-gray-400">
                                        <span className="flex items-center gap-1"><Phone size={11} /> <span className="font-mono">{m.telefono}</span></span>
                                        <span className="flex items-center gap-1"><CreditCard size={11} /> <span className="font-mono">{m.cedula || '—'}</span></span>
                                        <span className="flex items-center gap-1"><MapPin size={11} /> {m.zonaCobertura}</span>
                                        {m.vehiculoPlaca && <span className="flex items-center gap-1"><Hash size={11} /> <span className="font-mono uppercase">{m.vehiculoPlaca}</span></span>}
                                    </div>
                                    <div className="flex gap-3 mt-2">
                                        {m.fotoCedulaUrl
                                            ? <a href={m.fotoCedulaUrl} target="_blank" rel="noopener noreferrer" className="text-[11px] text-blue-400 hover:text-blue-300 flex items-center gap-1">📄 Ver cédula <ExternalLink size={10} /></a>
                                            : <span className="text-[11px] text-red-400/70">📄 Sin foto de cédula</span>}
                                        {m.fotoVehiculoUrl
                                            ? <a href={m.fotoVehiculoUrl} target="_blank" rel="noopener noreferrer" className="text-[11px] text-blue-400 hover:text-blue-300 flex items-center gap-1">🛵 Ver moto <ExternalLink size={10} /></a>
                                            : <span className="text-[11px] text-red-400/70">🛵 Sin foto de moto</span>}
                                    </div>
                                </div>

                                <div className="flex gap-2 flex-shrink-0">
                                    <button
                                        onClick={() => decide(m.id, 'APROBADO')}
                                        disabled={actionId === m.id}
                                        className="px-4 py-2 bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded-lg font-bold text-xs hover:bg-emerald-500/30 disabled:opacity-50 flex items-center gap-1.5"
                                    >
                                        {actionId === m.id ? <Loader2 className="animate-spin" size={13} /> : <CheckCircle size={13} />} Aprobar
                                    </button>
                                    <button
                                        onClick={() => { setRejectingId(m.id); setRejectNota(''); }}
                                        disabled={actionId === m.id}
                                        className="px-4 py-2 bg-red-500/10 text-red-400 border border-red-500/20 rounded-lg font-bold text-xs hover:bg-red-500/20 disabled:opacity-50 flex items-center gap-1.5"
                                    >
                                        <XCircle size={13} /> Rechazar
                                    </button>
                                </div>
                            </div>

                            {rejectingId === m.id && (
                                <div className="mt-3 pt-3 border-t border-gray-700 flex flex-wrap gap-2 items-center">
                                    <input
                                        autoFocus
                                        placeholder="Motivo del rechazo (se guarda en el expediente)"
                                        value={rejectNota}
                                        onChange={e => setRejectNota(e.target.value)}
                                        className="flex-1 min-w-[220px] bg-gray-900 border border-gray-700 text-white text-sm px-3 py-2 rounded-lg focus:outline-none focus:border-red-500/50"
                                    />
                                    <button
                                        onClick={() => decide(m.id, 'RECHAZADO', rejectNota)}
                                        disabled={actionId === m.id}
                                        className="px-4 py-2 bg-red-500/20 text-red-400 rounded-lg font-bold text-xs hover:bg-red-500/30 disabled:opacity-50"
                                    >
                                        Confirmar rechazo
                                    </button>
                                    <button onClick={() => setRejectingId(null)} className="px-3 py-2 text-gray-500 text-xs hover:text-gray-300">
                                        Cancelar
                                    </button>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default AdminMotorizadosKYC;
