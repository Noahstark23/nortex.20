import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    AlertTriangle,
    CheckCircle2,
    ChevronRight,
    FlaskConical,
    Link2,
    Loader2,
    Plus,
    RefreshCw,
    Save,
    Scale,
    Send,
    ShieldAlert,
    Trash2,
    Unplug,
    Usb,
    XCircle,
} from 'lucide-react';
import { authFetch } from '../utils/auth';
import { formatMoney } from '../utils/money';
import { formatQuantity } from '../utils/quantity';
import {
    SimulatedScaleAdapter,
    WebSerialTextScaleAdapter,
    detectWebSerialScaleSupport,
    type ScaleConnectionState,
    type ScaleStateSnapshot,
} from '../utils/scaleAdapters';

type VersionStatus = 'DRAFT' | 'PUBLISHED' | 'REVOKED';
type ValueKind = 'WEIGHT' | 'TOTAL_PRICE' | 'COUNT';
type PricePolicy = 'RECALCULATE' | 'REQUIRE_MATCH' | 'ACCEPT_LABEL_TOTAL';

interface MeasuredProduct {
    id: string;
    name: string;
    sku?: string;
    unit: string;
    price: number;
    saleMode?: 'COUNTED' | 'MEASURED' | null;
    quantityStep?: string | number | null;
}

interface ScaleMapping {
    id?: string;
    plu: string;
    productId: string;
    sourceUnit: string;
    product?: MeasuredProduct;
}

interface ScaleProfileVersion {
    id: string;
    profileId: string;
    version: number;
    status: VersionStatus;
    symbology: 'EAN_13';
    totalLength: number;
    prefixes: string[];
    itemStart: number;
    itemLength: number;
    valueStart: number;
    valueLength: number;
    valueKind: ValueKind;
    impliedDecimals: number;
    sourceUnit: string;
    checksumMode: 'EAN13' | 'NONE';
    pricePolicy: PricePolicy;
    roundingTolerance: string;
    minValue: string;
    maxValue: string;
    publishedAt?: string | null;
    revokedAt?: string | null;
    createdAt: string;
    mappings: ScaleMapping[];
}

interface ScaleProfile {
    id: string;
    name: string;
    status?: string;
    createdAt?: string;
    updatedAt?: string;
    versions: ScaleProfileVersion[];
}

interface ActiveContext {
    schemaVersion: number;
    cacheVersion: string;
    generatedAt: string;
    profiles: ScaleProfileVersion[];
}

type PreviewResult =
    | { classification: 'SKU' }
    | {
        classification: 'SCALE_LABEL';
        profileVersionId: string;
        profileVersion: number;
        product: MeasuredProduct;
        plu: string;
        sourceValue: string;
        sourceUnit: string;
        baseQuantity: string | null;
        encodedPrice?: string;
        calculatedTotal: string | null;
        pricingPolicy: PricePolicy;
        quantityResolution?: 'BARCODE' | 'MANUAL_REQUIRED';
        requiresManualQuantity?: boolean;
        warnings: string[];
    };

interface DraftForm {
    profileName: string;
    symbology: 'EAN_13';
    totalLength: number;
    prefixesText: string;
    itemStart: number;
    itemLength: number;
    valueStart: number;
    valueLength: number;
    valueKind: ValueKind;
    impliedDecimals: number;
    sourceUnit: string;
    checksumMode: 'EAN13' | 'NONE';
    pricePolicy: PricePolicy;
    roundingTolerance: string;
    minValue: string;
    maxValue: string;
    mappings: ScaleMapping[];
}

const DEFAULT_DRAFT: DraftForm = {
    profileName: '',
    symbology: 'EAN_13',
    totalLength: 13,
    prefixesText: '20',
    itemStart: 2,
    itemLength: 5,
    valueStart: 7,
    valueLength: 5,
    valueKind: 'WEIGHT',
    impliedDecimals: 3,
    sourceUnit: 'kg',
    checksumMode: 'EAN13',
    pricePolicy: 'RECALCULATE',
    roundingTolerance: '0.01',
    minValue: '0.001',
    maxValue: '99.999',
    mappings: [],
};

const STATUS_COPY: Record<VersionStatus, string> = {
    DRAFT: 'Borrador',
    PUBLISHED: 'Publicada',
    REVOKED: 'Revocada',
};

const STATUS_CLASS: Record<VersionStatus, string> = {
    DRAFT: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
    PUBLISHED: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    REVOKED: 'bg-red-500/15 text-red-300 border-red-500/30',
};

const ADAPTER_STATE_COPY: Record<ScaleConnectionState, string> = {
    DISCONNECTED: 'Desconectada',
    CONNECTING: 'Conectando',
    UNSTABLE: 'Peso inestable',
    STABLE: 'Peso estable',
    NEGATIVE: 'Peso negativo',
    OVERLOAD: 'Sobrecarga',
    ERROR: 'Error',
};

const EMPTY_SCALE_STATE: ScaleStateSnapshot = {
    state: 'DISCONNECTED',
    reading: null,
    message: 'Balanza desconectada',
};

const unwrapData = <T,>(payload: unknown): T => {
    if (payload && typeof payload === 'object' && 'data' in payload) {
        return (payload as { data: T }).data;
    }
    return payload as T;
};

const api = async <T,>(path: string, options: RequestInit = {}): Promise<T> => {
    const response = await authFetch(path, options);
    let payload: unknown = null;
    try { payload = await response.json(); } catch { /* respuesta sin JSON */ }
    if (!response.ok) {
        const body = payload as { error?: string; issues?: Array<{ message?: string }> } | null;
        const issues = body?.issues?.map(issue => issue.message).filter(Boolean).join(' · ');
        throw new Error(issues || body?.error || `La operación falló (${response.status})`);
    }
    return unwrapData<T>(payload);
};

const currentRole = (): string => {
    try {
        const token = localStorage.getItem('nortex_token');
        if (!token) return '';
        const encoded = token.split('.')[1]?.replace(/-/g, '+').replace(/_/g, '/');
        if (!encoded) return '';
        const padded = encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '=');
        return JSON.parse(atob(padded)).role ?? '';
    } catch {
        return '';
    }
};

const versionToDraft = (profile: ScaleProfile, version: ScaleProfileVersion): DraftForm => ({
    profileName: profile.name,
    symbology: version.symbology,
    totalLength: version.totalLength,
    prefixesText: version.prefixes.join(', '),
    itemStart: version.itemStart,
    itemLength: version.itemLength,
    valueStart: version.valueStart,
    valueLength: version.valueLength,
    valueKind: version.valueKind,
    impliedDecimals: version.impliedDecimals,
    sourceUnit: version.sourceUnit,
    checksumMode: version.checksumMode,
    pricePolicy: version.pricePolicy,
    roundingTolerance: String(version.roundingTolerance),
    minValue: String(version.minValue),
    maxValue: String(version.maxValue),
    mappings: version.mappings.map(mapping => ({
        id: mapping.id,
        plu: mapping.plu,
        productId: mapping.productId,
        sourceUnit: mapping.sourceUnit,
        product: mapping.product,
    })),
});

const versionPayload = (form: DraftForm) => ({
    symbology: form.symbology,
    totalLength: form.totalLength,
    prefixes: form.prefixesText.split(',').map(prefix => prefix.trim()).filter(Boolean),
    itemStart: form.itemStart,
    itemLength: form.itemLength,
    valueStart: form.valueStart,
    valueLength: form.valueLength,
    valueKind: form.valueKind,
    impliedDecimals: form.impliedDecimals,
    sourceUnit: form.sourceUnit.trim(),
    checksumMode: form.checksumMode,
    pricePolicy: form.pricePolicy,
    roundingTolerance: form.roundingTolerance.trim(),
    minValue: form.minValue.trim(),
    maxValue: form.maxValue.trim(),
});

const statusDate = (version: ScaleProfileVersion): string => {
    const raw = version.revokedAt || version.publishedAt || version.createdAt;
    return raw ? new Date(raw).toLocaleString('es-NI') : '—';
};

const Field: React.FC<{
    label: string;
    hint?: string;
    children: React.ReactNode;
}> = ({ label, hint, children }) => (
    <label className="block space-y-1.5">
        <span className="text-xs font-semibold text-slate-300">{label}</span>
        {children}
        {hint && <span className="block text-[11px] leading-relaxed text-slate-500">{hint}</span>}
    </label>
);

const inputClass = 'w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm text-white outline-none transition focus:border-brand disabled:cursor-not-allowed disabled:opacity-60';

const DirectScaleFoundation: React.FC = () => {
    const parserConfig = useMemo(() => ({
        defaultUnit: 'kg' as const,
        maxQuantity: '60',
        maxDecimalPlaces: 3,
        stableReadings: 3,
        stabilityTolerance: '0.002',
    }), []);
    const support = useMemo(() => detectWebSerialScaleSupport(), []);
    const simulator = useMemo(() => new SimulatedScaleAdapter(parserConfig), [parserConfig]);
    const serial = useMemo(() => new WebSerialTextScaleAdapter({ parser: parserConfig }), [parserConfig]);
    const [simState, setSimState] = useState<ScaleStateSnapshot>(EMPTY_SCALE_STATE);
    const [serialState, setSerialState] = useState<ScaleStateSnapshot>(EMPTY_SCALE_STATE);

    useEffect(() => simulator.onState(setSimState), [simulator]);
    useEffect(() => serial.onState(setSerialState), [serial]);
    useEffect(() => () => {
        void simulator.disconnect();
        void serial.disconnect();
    }, [serial, simulator]);

    const simulateStable = async () => {
        if (simState.state === 'DISCONNECTED' || simState.state === 'ERROR') await simulator.connect();
        simulator.emitTestFrame('ST,1.250,kg');
        simulator.emitTestFrame('ST,1.251,kg');
        simulator.emitTestFrame('ST,1.250,kg');
    };

    const connectSerial = async () => {
        try { await serial.connect(); } catch { /* snapshot muestra el motivo */ }
    };

    const AdapterStatus = ({ snapshot }: { snapshot: ScaleStateSnapshot }) => (
        <div className="rounded-lg border border-slate-700 bg-slate-950/70 p-3">
            <div className="flex items-center justify-between gap-3">
                <span className="text-xs font-bold uppercase tracking-wide text-slate-400">
                    {ADAPTER_STATE_COPY[snapshot.state]}
                </span>
                {snapshot.reading && (
                    <span className={`font-mono text-lg font-bold ${snapshot.reading.stable ? 'text-emerald-300' : 'text-amber-300'}`}>
                        {formatQuantity(snapshot.reading.quantity, snapshot.reading.unit)}
                    </span>
                )}
            </div>
            <p className="mt-1 text-xs text-slate-500">{snapshot.message}</p>
        </div>
    );

    return (
        <section className="rounded-2xl border border-slate-700 bg-slate-800/40 p-5">
            <div className="flex items-start gap-3">
                <Usb className="mt-0.5 text-brand" size={22} />
                <div>
                    <h2 className="font-bold text-white">Conexión directa: fundación experimental</h2>
                    <p className="mt-1 text-sm leading-relaxed text-slate-400">
                        Solo lee peso. Nortex no envía tara, calibración, comandos ni configuración a la balanza.
                        La compatibilidad debe validarse con cada modelo físico antes de usarlo en caja.
                    </p>
                </div>
            </div>

            <div className="mt-5 grid gap-4 xl:grid-cols-2">
                <div className="rounded-xl border border-violet-500/25 bg-violet-500/5 p-4">
                    <div className="flex items-center justify-between gap-3">
                        <div>
                            <p className="flex items-center gap-2 font-bold text-white"><FlaskConical size={17} /> Simulador</p>
                            <p className="text-xs font-semibold text-violet-300">SOLO PRUEBA · no proviene de hardware</p>
                        </div>
                        <button type="button" onClick={() => void simulator.disconnect()} className="rounded-lg p-2 text-slate-400 hover:bg-white/5 hover:text-white" aria-label="Desconectar simulador">
                            <Unplug size={17} />
                        </button>
                    </div>
                    <div className="mt-3"><AdapterStatus snapshot={simState} /></div>
                    <div className="mt-3 flex flex-wrap gap-2">
                        <button type="button" onClick={() => void simulateStable()} className="rounded-lg bg-violet-500 px-3 py-2 text-xs font-bold text-white">Simular 1.250 kg estable</button>
                        <button type="button" onClick={async () => { if (simState.state === 'DISCONNECTED') await simulator.connect(); simulator.emitTestFrame('-0.100 kg'); }} className="rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-300">Negativo</button>
                        <button type="button" onClick={async () => { if (simState.state === 'DISCONNECTED') await simulator.connect(); simulator.emitTestFrame('OL'); }} className="rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-300">Sobrecarga</button>
                    </div>
                </div>

                <div className="rounded-xl border border-slate-700 bg-slate-900/50 p-4">
                    <div className="flex items-start justify-between gap-3">
                        <div>
                            <p className="flex items-center gap-2 font-bold text-white"><Link2 size={17} /> Web Serial de texto</p>
                            <p className={`mt-1 text-xs ${support.supported ? 'text-emerald-300' : 'text-amber-300'}`}>{support.reason}</p>
                        </div>
                        <span className="whitespace-nowrap rounded border border-slate-700 px-2 py-1 text-[10px] font-bold uppercase text-slate-400">9600 baud</span>
                    </div>
                    <div className="mt-3"><AdapterStatus snapshot={serialState} /></div>
                    <div className="mt-3 flex gap-2">
                        <button type="button" disabled={!support.supported || serialState.state === 'CONNECTING'} onClick={() => void connectSerial()} className="rounded-lg bg-brand px-3 py-2 text-xs font-bold text-white disabled:cursor-not-allowed disabled:opacity-40">
                            Seleccionar puerto y leer
                        </button>
                        <button type="button" onClick={() => void serial.disconnect()} className="rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-300">Desconectar</button>
                    </div>
                    <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
                        Parser genérico acotado: frames como <code className="text-slate-300">ST,1.250,kg</code>, máximo 60 kg y tres lecturas repetidas. No implica compatibilidad con ninguna marca.
                    </p>
                </div>
            </div>
        </section>
    );
};

const ScaleSettings: React.FC = () => {
    const role = currentRole();
    const canManage = role === 'OWNER' || role === 'ADMIN';
    const [profiles, setProfiles] = useState<ScaleProfile[]>([]);
    const [activeContext, setActiveContext] = useState<ActiveContext | null>(null);
    const [products, setProducts] = useState<MeasuredProduct[]>([]);
    const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
    const [form, setForm] = useState<DraftForm>(DEFAULT_DRAFT);
    const [newProfileName, setNewProfileName] = useState('');
    const [previewCode, setPreviewCode] = useState('');
    const [preview, setPreview] = useState<PreviewResult | null>(null);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState<string | null>(null);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [publishConfirmed, setPublishConfirmed] = useState(false);
    const [revokeConfirmed, setRevokeConfirmed] = useState(false);

    const selected = useMemo(() => {
        for (const profile of profiles) {
            const version = profile.versions.find(candidate => candidate.id === selectedVersionId);
            if (version) return { profile, version };
        }
        return null;
    }, [profiles, selectedVersionId]);

    const loadAll = useCallback(async (preferVersionId?: string) => {
        setLoading(true);
        setError('');
        try {
            const [profileData, contextData, productPayload] = await Promise.all([
                api<ScaleProfile[]>('/api/scale-labels/profiles'),
                api<ActiveContext>('/api/scale-labels/active-context'),
                api<MeasuredProduct[] | { products: MeasuredProduct[] }>('/api/products'),
            ]);
            const sortedProfiles = profileData.map(profile => ({
                ...profile,
                versions: [...(profile.versions ?? [])].sort((a, b) => b.version - a.version),
            }));
            const productList = Array.isArray(productPayload) ? productPayload : productPayload.products;
            setProfiles(sortedProfiles);
            setActiveContext(contextData);
            setProducts(productList.filter(product => product.saleMode === 'MEASURED'));

            const allVersions = sortedProfiles.flatMap(profile => profile.versions);
            const nextId = preferVersionId && allVersions.some(version => version.id === preferVersionId)
                ? preferVersionId
                : selectedVersionId && allVersions.some(version => version.id === selectedVersionId)
                    ? selectedVersionId
                    : allVersions.find(version => version.status === 'DRAFT')?.id ?? allVersions[0]?.id ?? null;
            setSelectedVersionId(nextId);
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'No fue posible cargar la configuración');
        } finally {
            setLoading(false);
        }
    }, [selectedVersionId]);

    useEffect(() => {
        if (canManage) void loadAll();
        else setLoading(false);
        // Carga inicial; las recargas posteriores se disparan explícitamente.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [canManage]);

    useEffect(() => {
        if (!selected) return;
        setForm(versionToDraft(selected.profile, selected.version));
        setPreview(null);
        setPublishConfirmed(false);
        setRevokeConfirmed(false);
    }, [selected]);

    const run = async (key: string, operation: () => Promise<void>) => {
        setBusy(key);
        setError('');
        setNotice('');
        try { await operation(); }
        catch (cause) { setError(cause instanceof Error ? cause.message : 'La operación no pudo completarse'); }
        finally { setBusy(null); }
    };

    const createProfile = () => run('create', async () => {
        const name = newProfileName.trim();
        if (!name) throw new Error('Escribí un nombre para el perfil');
        const created = await api<ScaleProfile>('/api/scale-labels/profiles', {
            method: 'POST',
            body: JSON.stringify({ name, ...versionPayload({ ...DEFAULT_DRAFT, profileName: name }) }),
        });
        const versionId = created.versions[0]?.id;
        setNewProfileName('');
        setNotice('Perfil creado como borrador. Configurá y probá antes de publicar.');
        await loadAll(versionId);
    });

    const createVersion = () => {
        if (!selected) return;
        void run('new-version', async () => {
            const version = await api<ScaleProfileVersion>(`/api/scale-labels/profiles/${selected.profile.id}/versions`, {
                method: 'POST',
                body: JSON.stringify({
                    ...versionPayload(form),
                    mappings: form.mappings.map(({ plu, productId, sourceUnit }) => ({ plu, productId, sourceUnit })),
                }),
            });
            setNotice(`Versión ${version.version} creada como borrador desde la configuración anterior.`);
            await loadAll(version.id);
        });
    };

    const assertDraftClientSide = () => {
        const prefixes = form.prefixesText.split(',').map(prefix => prefix.trim()).filter(Boolean);
        if (!form.profileName.trim()) throw new Error('El perfil necesita un nombre');
        if (prefixes.length === 0 || prefixes.some(prefix => !/^\d{1,12}$/.test(prefix))) {
            throw new Error('Cada prefijo debe contener entre 1 y 12 dígitos');
        }
        if (form.itemStart + form.itemLength > 12 || form.valueStart + form.valueLength > 12) {
            throw new Error('PLU y valor deben quedar dentro de los 12 dígitos anteriores al checksum');
        }
        const pluEnd = form.itemStart + form.itemLength;
        const valueEnd = form.valueStart + form.valueLength;
        if (form.itemStart < valueEnd && form.valueStart < pluEnd) throw new Error('Los campos PLU y valor no pueden solaparse');
        if (form.mappings.some(mapping => !new RegExp(`^\\d{${form.itemLength}}$`).test(mapping.plu))) {
            throw new Error(`Cada PLU mapeado debe tener exactamente ${form.itemLength} dígitos`);
        }
        const plus = new Set(form.mappings.map(mapping => mapping.plu));
        if (plus.size !== form.mappings.length) throw new Error('No se puede repetir el mismo PLU en una versión');
        if (form.mappings.some(mapping => !mapping.productId)) throw new Error('Cada PLU debe apuntar a un producto medido');
    };

    const persistDraft = async (): Promise<void> => {
        if (!selected || selected.version.status !== 'DRAFT') throw new Error('Solo se puede guardar una versión en borrador');
        assertDraftClientSide();
        if (form.profileName.trim() !== selected.profile.name) {
            await api(`/api/scale-labels/profiles/${selected.profile.id}`, {
                method: 'PATCH',
                body: JSON.stringify({ name: form.profileName.trim() }),
            });
        }
        await api(`/api/scale-labels/versions/${selected.version.id}`, {
            method: 'PATCH',
            body: JSON.stringify(versionPayload(form)),
        });
        await api(`/api/scale-labels/versions/${selected.version.id}/mappings`, {
            method: 'PUT',
            body: JSON.stringify({
                mappings: form.mappings.map(({ plu, productId, sourceUnit }) => ({ plu, productId, sourceUnit })),
            }),
        });
    };

    const saveDraft = () => void run('save', async () => {
        await persistDraft();
        setNotice('Borrador guardado. Ya podés probar una etiqueta con estas reglas.');
        await loadAll(selectedVersionId ?? undefined);
    });

    const publish = () => void run('publish', async () => {
        if (!selected || !publishConfirmed) throw new Error('Confirmá la advertencia antes de publicar');
        if (form.mappings.length === 0) throw new Error('Agregá al menos un mapeo PLU → producto antes de publicar');
        await persistDraft();
        await api(`/api/scale-labels/versions/${selected.version.id}/publish`, { method: 'POST', body: JSON.stringify({}) });
        setNotice(`Versión ${selected.version.version} publicada. El POS recibirá esta versión exacta.`);
        await loadAll(selected.version.id);
    });

    const revoke = () => void run('revoke', async () => {
        if (!selected || !revokeConfirmed) throw new Error('Confirmá la advertencia antes de revocar');
        await api(`/api/scale-labels/versions/${selected.version.id}/revoke`, { method: 'POST', body: JSON.stringify({}) });
        setNotice(`Versión ${selected.version.version} revocada. No se reinterpretarán ventas históricas.`);
        await loadAll(selected.version.id);
    });

    const deleteDraft = () => void run('delete', async () => {
        if (!selected || selected.version.status !== 'DRAFT') return;
        await api(`/api/scale-labels/versions/${selected.version.id}`, { method: 'DELETE' });
        setNotice('Borrador eliminado. Las versiones publicadas permanecen intactas.');
        await loadAll();
    });

    const testLabel = () => void run('preview', async () => {
        if (!selected || !previewCode.trim()) throw new Error('Escaneá o escribí una etiqueta EAN-13');
        if (selected.version.status === 'DRAFT') await persistDraft();
        const result = await api<PreviewResult>('/api/scale-labels/preview', {
            method: 'POST',
            body: JSON.stringify({ rawCode: previewCode.trim(), profileVersionId: selected.version.id }),
        });
        setPreview(result);
        if (selected.version.status === 'DRAFT') await loadAll(selected.version.id);
    });

    const addMapping = () => setForm(previous => ({
        ...previous,
        mappings: [...previous.mappings, {
            plu: ''.padStart(previous.itemLength, '0'),
            productId: '',
            sourceUnit: previous.valueKind === 'TOTAL_PRICE' ? 'kg' : previous.sourceUnit,
        }],
    }));

    const updateMapping = (index: number, changes: Partial<ScaleMapping>) => setForm(previous => ({
        ...previous,
        mappings: previous.mappings.map((mapping, mappingIndex) => mappingIndex === index ? { ...mapping, ...changes } : mapping),
    }));

    if (!canManage) {
        return (
            <div className="mx-auto max-w-3xl p-6">
                <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-6 text-center">
                    <ShieldAlert className="mx-auto text-amber-300" size={34} />
                    <h1 className="mt-3 text-xl font-bold text-white">Configuración restringida</h1>
                    <p className="mt-2 text-sm text-slate-300">Solo el dueño o un administrador puede cambiar perfiles y mapeos de balanza.</p>
                </div>
            </div>
        );
    }

    return (
        <div className="mx-auto max-w-7xl space-y-6 p-4 pb-24 sm:p-6">
            <header className="flex flex-wrap items-start justify-between gap-4">
                <div>
                    <h1 className="flex items-center gap-2 text-2xl font-bold text-white"><Scale className="text-brand" /> Balanzas y etiquetas</h1>
                    <p className="mt-1 max-w-3xl text-sm leading-relaxed text-slate-400">
                        Configurá cómo Nortex interpreta las etiquetas impresas por peso, precio o conteo. El servidor vuelve a leer la etiqueta al facturar; la vista previa no decide el total final.
                    </p>
                </div>
                <button type="button" onClick={() => void loadAll(selectedVersionId ?? undefined)} disabled={loading} className="flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-300 hover:bg-white/5 disabled:opacity-50">
                    <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Actualizar
                </button>
            </header>

            <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 p-4 text-sm text-amber-100">
                <div className="flex items-start gap-3">
                    <AlertTriangle className="mt-0.5 shrink-0 text-amber-300" size={19} />
                    <p><strong>Ruta recomendada:</strong> empezar con etiquetas EAN-13 impresas por la balanza. La conexión directa depende del navegador y del protocolo del modelo; se mantiene deshabilitada donde no exista transporte compatible.</p>
                </div>
            </div>

            <section aria-labelledby="scale-sale-guide-title" className="rounded-2xl border border-slate-700 bg-slate-800/40 p-5">
                <h2 id="scale-sale-guide-title" className="font-bold text-white">Cómo se factura carne por peso hoy</h2>
                <div className="mt-4 grid gap-3 md:grid-cols-3">
                    <div className="rounded-xl border border-slate-700 bg-slate-950/60 p-4">
                        <p className="text-xs font-bold uppercase text-brand">1 · Cualquier balanza</p>
                        <p className="mt-2 text-sm font-semibold text-white">Escribir el peso</p>
                        <p className="mt-1 text-xs leading-relaxed text-slate-400">Pesá la carne, elegí el producto medido en Vender y escribí la lectura estable. No hace falta conectar un cable.</p>
                    </div>
                    <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-4">
                        <p className="text-xs font-bold uppercase text-emerald-300">2 · Con impresora</p>
                        <p className="mt-2 text-sm font-semibold text-white">Escanear la etiqueta</p>
                        <p className="mt-1 text-xs leading-relaxed text-slate-400">La balanza imprime el EAN-13 con peso. Conectá al POS un lector USB/Bluetooth en modo teclado, no la balanza.</p>
                    </div>
                    <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-4">
                        <p className="text-xs font-bold uppercase text-amber-300">3 · Cable serial</p>
                        <p className="mt-2 text-sm font-semibold text-white">Solo diagnóstico</p>
                        <p className="mt-1 text-xs leading-relaxed text-slate-400">La prueba Web Serial muestra lecturas, pero todavía no agrega peso al ticket ni está certificada para ventas reales.</p>
                    </div>
                </div>
            </section>

            {error && (
                <div role="alert" className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
                    <XCircle className="mt-0.5 shrink-0" size={18} /><span>{error}</span>
                </div>
            )}
            {notice && (
                <div className="flex items-start gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-200">
                    <CheckCircle2 className="mt-0.5 shrink-0" size={18} /><span>{notice}</span>
                </div>
            )}

            <div className="grid gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
                <aside className="space-y-4">
                    <div className="rounded-2xl border border-slate-700 bg-slate-800/40 p-4">
                        <h2 className="font-bold text-white">Nuevo perfil</h2>
                        <p className="mt-1 text-xs text-slate-500">Ejemplo: “Balanza carnicería mostrador”.</p>
                        <input value={newProfileName} onChange={event => setNewProfileName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void createProfile(); }} maxLength={80} placeholder="Nombre del perfil" className={`${inputClass} mt-3`} />
                        <button type="button" onClick={() => void createProfile()} disabled={busy !== null} className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg bg-brand px-3 py-2.5 text-sm font-bold text-white disabled:opacity-50">
                            {busy === 'create' ? <Loader2 className="animate-spin" size={16} /> : <Plus size={16} />} Crear borrador
                        </button>
                    </div>

                    <div className="overflow-hidden rounded-2xl border border-slate-700 bg-slate-800/40">
                        <div className="border-b border-slate-700 px-4 py-3">
                            <h2 className="font-bold text-white">Perfiles y versiones</h2>
                            <p className="mt-1 text-xs text-slate-500">Una versión publicada nunca se edita.</p>
                        </div>
                        {loading ? (
                            <div className="flex items-center justify-center p-10 text-slate-500"><Loader2 className="animate-spin" size={22} /></div>
                        ) : profiles.length === 0 ? (
                            <p className="p-5 text-sm text-slate-500">Todavía no hay perfiles.</p>
                        ) : (
                            <div className="max-h-[620px] divide-y divide-slate-700/70 overflow-y-auto">
                                {profiles.map(profile => (
                                    <div key={profile.id} className="p-3">
                                        <p className="px-1 pb-2 text-sm font-bold text-slate-200">{profile.name}</p>
                                        <div className="space-y-1">
                                            {profile.versions.map(version => (
                                                <button key={version.id} type="button" onClick={() => setSelectedVersionId(version.id)} className={`flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left transition ${selectedVersionId === version.id ? 'border-brand/50 bg-brand/10' : 'border-transparent hover:bg-white/5'}`}>
                                                    <div className="min-w-0 flex-1">
                                                        <div className="flex items-center gap-2">
                                                            <span className="text-sm font-semibold text-white">Versión {version.version}</span>
                                                            <span className={`rounded border px-1.5 py-0.5 text-[9px] font-bold uppercase ${STATUS_CLASS[version.status]}`}>{STATUS_COPY[version.status]}</span>
                                                        </div>
                                                        <span className="text-[10px] text-slate-500">{statusDate(version)}</span>
                                                    </div>
                                                    <ChevronRight size={15} className="text-slate-600" />
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    <div className="rounded-xl border border-slate-700 bg-slate-900/60 p-4 text-xs text-slate-400">
                        <p className="font-bold text-slate-300">Contexto distribuido al POS</p>
                        <p className="mt-2">Perfiles publicados: <strong className="text-white">{activeContext?.profiles?.length ?? 0}</strong></p>
                        <p className="mt-1 break-all">Cache: <span className="font-mono text-slate-300">{activeContext?.cacheVersion ?? 'sin generar'}</span></p>
                    </div>
                </aside>

                <main className="min-w-0">
                    {!selected ? (
                        <div className="rounded-2xl border border-dashed border-slate-700 p-14 text-center text-slate-500">Creá o seleccioná una versión para empezar.</div>
                    ) : (
                        <div className="space-y-5">
                            <section className="rounded-2xl border border-slate-700 bg-slate-800/40 p-5">
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                    <div>
                                        <div className="flex items-center gap-2">
                                            <h2 className="text-lg font-bold text-white">{selected.profile.name} · versión {selected.version.version}</h2>
                                            <span className={`rounded border px-2 py-1 text-[10px] font-bold uppercase ${STATUS_CLASS[selected.version.status]}`}>{STATUS_COPY[selected.version.status]}</span>
                                        </div>
                                        <p className="mt-1 text-xs text-slate-500">ID inmutable: <span className="font-mono">{selected.version.id}</span></p>
                                    </div>
                                    <button type="button" onClick={createVersion} disabled={busy !== null} className="flex items-center gap-2 rounded-lg border border-slate-600 px-3 py-2 text-xs font-bold text-slate-200 hover:bg-white/5 disabled:opacity-50"><Plus size={15} /> Nueva versión</button>
                                </div>

                                {selected.version.status !== 'DRAFT' && (
                                    <div className="mt-4 rounded-lg border border-slate-700 bg-slate-950/60 p-3 text-xs text-slate-400">
                                        Esta versión es de solo lectura. Creá una nueva versión para cambiar reglas o mapeos; así las ventas históricas conservan exactamente el parser que usaron.
                                    </div>
                                )}

                                <fieldset disabled={selected.version.status !== 'DRAFT'} className="mt-5 space-y-5">
                                    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                                        <div className="sm:col-span-2 xl:col-span-4">
                                            <Field label="Nombre del perfil"><input value={form.profileName} onChange={event => setForm(previous => ({ ...previous, profileName: event.target.value }))} maxLength={80} className={inputClass} /></Field>
                                        </div>
                                        <Field label="Simbología"><select value={form.symbology} disabled className={inputClass}><option value="EAN_13">EAN-13</option></select></Field>
                                        <Field label="Longitud total"><input value={form.totalLength} disabled type="number" className={inputClass} /></Field>
                                        <Field label="Prefijos" hint="Separados por coma; ej. 20, 21"><input value={form.prefixesText} onChange={event => setForm(previous => ({ ...previous, prefixesText: event.target.value }))} className={inputClass} /></Field>
                                        <Field label="Checksum"><select value={form.checksumMode} onChange={event => setForm(previous => ({ ...previous, checksumMode: event.target.value as DraftForm['checksumMode'] }))} className={inputClass}><option value="EAN13">Validar EAN-13</option><option value="NONE">Sin checksum</option></select></Field>
                                        <Field label="Inicio PLU" hint="Posición base cero"><input min={0} max={11} type="number" value={form.itemStart} onChange={event => setForm(previous => ({ ...previous, itemStart: Number(event.target.value) }))} className={inputClass} /></Field>
                                        <Field label="Largo PLU"><input min={1} max={10} type="number" value={form.itemLength} onChange={event => setForm(previous => ({ ...previous, itemLength: Number(event.target.value) }))} className={inputClass} /></Field>
                                        <Field label="Inicio del valor" hint="Posición base cero"><input min={0} max={11} type="number" value={form.valueStart} onChange={event => setForm(previous => ({ ...previous, valueStart: Number(event.target.value) }))} className={inputClass} /></Field>
                                        <Field label="Largo del valor"><input min={1} max={10} type="number" value={form.valueLength} onChange={event => setForm(previous => ({ ...previous, valueLength: Number(event.target.value) }))} className={inputClass} /></Field>
                                        <Field label="Qué codifica"><select value={form.valueKind} onChange={event => {
                                            const valueKind = event.target.value as ValueKind;
                                            setForm(previous => ({
                                                ...previous,
                                                valueKind,
                                                pricePolicy: 'RECALCULATE',
                                                sourceUnit: valueKind === 'TOTAL_PRICE'
                                                    ? 'NIO'
                                                    : previous.sourceUnit === 'NIO' ? 'kg' : previous.sourceUnit,
                                            }));
                                        }} className={inputClass}><option value="WEIGHT">Peso</option><option value="TOTAL_PRICE">Precio total</option><option value="COUNT">Conteo</option></select></Field>
                                        <Field label="Decimales implícitos"><input min={0} max={4} type="number" value={form.impliedDecimals} onChange={event => setForm(previous => ({ ...previous, impliedDecimals: Number(event.target.value) }))} className={inputClass} /></Field>
                                        <Field label="Unidad codificada"><select value={form.sourceUnit} onChange={event => setForm(previous => ({ ...previous, sourceUnit: event.target.value }))} className={inputClass}><option value="kg">kg</option><option value="g">g</option><option value="lb">lb</option><option value="oz">oz</option><option value="unidad">unidad</option><option value="NIO">Córdoba (NIO)</option></select></Field>
                                        <Field label="Política de precio" hint="EAN-13 actual codifica un solo valor; coincidencia/aceptación de total requieren un layout futuro con peso y total."><select value={form.pricePolicy} onChange={event => setForm(previous => ({ ...previous, pricePolicy: event.target.value as PricePolicy }))} className={inputClass}><option value="RECALCULATE">Recalcular con Nortex</option><option value="REQUIRE_MATCH" disabled>Exigir coincidencia (no disponible)</option><option value="ACCEPT_LABEL_TOTAL" disabled>Aceptar total (no disponible)</option></select></Field>
                                        <Field label="Tolerancia de redondeo"><input inputMode="decimal" value={form.roundingTolerance} onChange={event => setForm(previous => ({ ...previous, roundingTolerance: event.target.value }))} className={inputClass} /></Field>
                                        <Field label="Valor mínimo"><input inputMode="decimal" value={form.minValue} onChange={event => setForm(previous => ({ ...previous, minValue: event.target.value }))} className={inputClass} /></Field>
                                        <Field label="Valor máximo"><input inputMode="decimal" value={form.maxValue} onChange={event => setForm(previous => ({ ...previous, maxValue: event.target.value }))} className={inputClass} /></Field>
                                    </div>

                                    {form.valueKind === 'TOTAL_PRICE' && (
                                        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs leading-relaxed text-amber-100">
                                            <strong>Solo diagnóstico:</strong> un EAN-13 que contiene únicamente precio total no permite recuperar un peso fiable si cambió el precio maestro. Podés probar la etiqueta, pero esta versión no se podrá publicar; configurá la balanza para codificar peso/conteo o capturá la cantidad manualmente.
                                        </div>
                                    )}
                                    {form.pricePolicy !== 'RECALCULATE' && (
                                        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs leading-relaxed text-red-200">
                                            Esta política pertenece a una configuración anterior y no es publicable con el layout EAN-13 de un solo valor. Cambiala a “Recalcular con Nortex”.
                                        </div>
                                    )}
                                </fieldset>

                                {selected.version.status === 'DRAFT' && (
                                    <div className="mt-5 flex flex-wrap gap-2 border-t border-slate-700 pt-4">
                                        <button type="button" onClick={saveDraft} disabled={busy !== null} className="flex items-center gap-2 rounded-lg bg-brand px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50">{busy === 'save' ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />} Guardar borrador</button>
                                        <button type="button" onClick={deleteDraft} disabled={busy !== null} className="flex items-center gap-2 rounded-lg border border-red-500/30 px-4 py-2.5 text-sm text-red-300 hover:bg-red-500/10 disabled:opacity-50"><Trash2 size={16} /> Eliminar borrador</button>
                                    </div>
                                )}
                            </section>

                            <section className="rounded-2xl border border-slate-700 bg-slate-800/40 p-5">
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                    <div>
                                        <h2 className="font-bold text-white">Mapeos PLU → producto medido</h2>
                                        <p className="mt-1 text-xs text-slate-500">El PLU pertenece a esta versión, no al producto global. Eso permite que dos balanzas usen catálogos distintos.</p>
                                    </div>
                                    {selected.version.status === 'DRAFT' && <button type="button" onClick={addMapping} className="flex items-center gap-2 rounded-lg border border-slate-600 px-3 py-2 text-xs font-bold text-slate-200"><Plus size={15} /> Agregar PLU</button>}
                                </div>

                                {products.length === 0 && (
                                    <div className="mt-4 rounded-lg border border-amber-500/25 bg-amber-500/10 p-3 text-xs text-amber-100">Primero marcá al menos un producto como “medido” en Mis Productos. Un producto contado no puede recibir peso.</div>
                                )}
                                <div className="mt-4 space-y-2">
                                    {form.mappings.map((mapping, index) => (
                                        <div key={mapping.id ?? `new-${index}`} className="grid gap-2 rounded-xl border border-slate-700 bg-slate-900/50 p-3 sm:grid-cols-[140px_minmax(0,1fr)_120px_40px]">
                                            <input disabled={selected.version.status !== 'DRAFT'} aria-label={`PLU ${index + 1}`} value={mapping.plu} maxLength={form.itemLength} onChange={event => updateMapping(index, { plu: event.target.value.replace(/\D/g, '') })} placeholder={'0'.repeat(form.itemLength)} className={`${inputClass} font-mono`} />
                                            <select disabled={selected.version.status !== 'DRAFT'} aria-label={`Producto ${index + 1}`} value={mapping.productId} onChange={event => {
                                                const product = products.find(candidate => candidate.id === event.target.value);
                                                updateMapping(index, {
                                                    productId: event.target.value,
                                                    product,
                                                    // Para etiquetas por peso/conteo, esta es la unidad
                                                    // codificada por la balanza; para precio total, la
                                                    // cantidad se deriva y usa la unidad del producto.
                                                    sourceUnit: form.valueKind === 'TOTAL_PRICE'
                                                        ? product?.unit || mapping.sourceUnit
                                                        : mapping.sourceUnit,
                                                });
                                            }} className={inputClass}>
                                                <option value="">Seleccionar producto medido…</option>
                                                {products.map(product => <option key={product.id} value={product.id}>{product.name} · {product.unit} · {product.sku ?? 'sin SKU'}</option>)}
                                                {mapping.product && !products.some(product => product.id === mapping.productId) && <option value={mapping.productId}>{mapping.product.name} · {mapping.product.unit}</option>}
                                            </select>
                                            <select disabled={selected.version.status !== 'DRAFT'} aria-label={`Unidad de origen ${index + 1}`} value={mapping.sourceUnit} onChange={event => updateMapping(index, { sourceUnit: event.target.value })} className={inputClass}>
                                                <option value="kg">kg</option><option value="g">g</option><option value="lb">lb</option><option value="oz">oz</option><option value="unidad">unidad</option>
                                            </select>
                                            <button disabled={selected.version.status !== 'DRAFT'} type="button" aria-label={`Quitar mapeo ${index + 1}`} onClick={() => setForm(previous => ({ ...previous, mappings: previous.mappings.filter((_, mappingIndex) => mappingIndex !== index) }))} className="flex items-center justify-center rounded-lg text-slate-500 hover:bg-red-500/10 hover:text-red-300 disabled:opacity-30"><Trash2 size={17} /></button>
                                        </div>
                                    ))}
                                    {form.mappings.length === 0 && <div className="rounded-xl border border-dashed border-slate-700 p-8 text-center text-sm text-slate-500">Sin mapeos. Las etiquetas reconocidas no podrán convertirse en productos hasta agregar uno.</div>}
                                </div>
                            </section>

                            <section className="rounded-2xl border border-slate-700 bg-slate-800/40 p-5">
                                <h2 className="font-bold text-white">Probar una etiqueta</h2>
                                <p className="mt-1 text-xs text-slate-500">El servidor interpreta el código con la versión seleccionada y devuelve producto, cantidad y total calculado.</p>
                                <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                                    <input value={previewCode} onChange={event => setPreviewCode(event.target.value.replace(/[^\d\r\n]/g, '').slice(0, 32))} onKeyDown={event => { if (event.key === 'Enter') testLabel(); }} inputMode="numeric" autoComplete="off" placeholder="Escaneá o escribí los 13 dígitos" className={`${inputClass} flex-1 font-mono text-base tracking-wider`} />
                                    <button type="button" onClick={testLabel} disabled={busy !== null || !previewCode.trim()} className="flex items-center justify-center gap-2 rounded-lg bg-brand px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50">{busy === 'preview' ? <Loader2 className="animate-spin" size={16} /> : <Send size={16} />} Interpretar</button>
                                </div>
                                {preview?.classification === 'SKU' && <div className="mt-4 rounded-lg border border-slate-700 bg-slate-900/60 p-4 text-sm text-slate-300">El código no coincide con este perfil de balanza. Nortex lo trataría como SKU normal.</div>}
                                {preview?.classification === 'SCALE_LABEL' && (
                                    <div className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4">
                                        <div className="flex flex-wrap items-start justify-between gap-3">
                                            <div><p className="text-xs font-bold uppercase text-emerald-300">Etiqueta reconocida</p><p className="mt-1 font-bold text-white">{preview.product.name}</p><p className="text-xs text-slate-400">PLU {preview.plu} · versión {preview.profileVersion}</p></div>
                                            <div className="text-right">
                                                {preview.requiresManualQuantity || preview.baseQuantity === null ? (
                                                    <>
                                                        <p className="text-sm font-bold text-amber-200">Cantidad manual requerida</p>
                                                        {preview.encodedPrice && <p className="text-sm text-slate-300">Total impreso {formatMoney(preview.encodedPrice)}</p>}
                                                    </>
                                                ) : (
                                                    <>
                                                        <p className="font-mono text-lg font-bold text-white">{formatQuantity(preview.baseQuantity, preview.product.unit)}</p>
                                                        {preview.calculatedTotal !== null && <p className="text-sm text-emerald-200">Total {formatMoney(preview.calculatedTotal)}</p>}
                                                    </>
                                                )}
                                            </div>
                                        </div>
                                        <div className="mt-3 grid gap-2 text-xs text-slate-300 sm:grid-cols-3"><span>Origen: {formatQuantity(preview.sourceValue, preview.sourceUnit)}</span><span>Política: {preview.pricingPolicy}</span><span>Versión ID: {preview.profileVersionId.slice(0, 8)}…</span></div>
                                        {preview.warnings?.length > 0 && <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-amber-200">{preview.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul>}
                                    </div>
                                )}
                            </section>

                            {selected.version.status === 'DRAFT' && (
                                <section className="rounded-2xl border border-amber-500/25 bg-amber-500/5 p-5">
                                    <h2 className="font-bold text-white">Publicar versión {selected.version.version}</h2>
                                    <p className="mt-1 text-sm leading-relaxed text-slate-400">Publicar vuelve inmutables estas reglas y mapeos. Las terminales POS usarán el ID de esta versión y el servidor conservará la trazabilidad.</p>
                                    <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-lg border border-amber-500/20 p-3 text-sm text-amber-100"><input type="checkbox" checked={publishConfirmed} onChange={event => setPublishConfirmed(event.target.checked)} className="mt-1" /><span>Verifiqué una etiqueta real, los offsets, el checksum, la unidad, la política de precio y todos los PLU.</span></label>
                                    <button type="button" onClick={publish} disabled={!publishConfirmed || busy !== null} className="mt-3 flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-40">{busy === 'publish' ? <Loader2 className="animate-spin" size={16} /> : <CheckCircle2 size={16} />} Guardar y publicar</button>
                                </section>
                            )}

                            {selected.version.status === 'PUBLISHED' && (
                                <section className="rounded-2xl border border-red-500/25 bg-red-500/5 p-5">
                                    <h2 className="font-bold text-white">Revocar versión {selected.version.version}</h2>
                                    <p className="mt-1 text-sm leading-relaxed text-slate-400">La revocación impide nuevas ventas con esta versión. Las ventas y etiquetas offline ya capturadas conservan su referencia histórica y pueden requerir conciliación.</p>
                                    <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-lg border border-red-500/20 p-3 text-sm text-red-100"><input type="checkbox" checked={revokeConfirmed} onChange={event => setRevokeConfirmed(event.target.checked)} className="mt-1" /><span>Entiendo que terminales sin sincronizar pueden quedar pendientes y ya existe una versión de reemplazo o un plan operativo.</span></label>
                                    <button type="button" onClick={revoke} disabled={!revokeConfirmed || busy !== null} className="mt-3 flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2.5 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-40">{busy === 'revoke' ? <Loader2 className="animate-spin" size={16} /> : <ShieldAlert size={16} />} Revocar versión</button>
                                </section>
                            )}
                        </div>
                    )}
                </main>
            </div>

            <DirectScaleFoundation />
        </div>
    );
};

export default ScaleSettings;
