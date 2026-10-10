import React, { useCallback, useEffect, useState } from 'react';
import AdminOverviewPanel from './admin/AdminOverviewPanel';
import { AssistantBudgetRequests } from './admin/AssistantBudgetRequests';
import { AssistantKnowledgeEditorial } from './admin/AssistantKnowledgeEditorial';
import { AssistantPilotActivation } from './admin/AssistantPilotActivation';
import CommerceSupport from './whatsapp/CommerceSupport';
import AdminDemoReset from './admin/AdminDemoReset';
import { useAdminOverviewSession } from '../hooks/useAdminOverviewSession';
import { readActivationSession } from '../hooks/useActivationJourney';
import { clearEditorialDraft, hasPendingEditorialWork } from './admin/knowledge/editorialDraftMemory';

/** /admin conserva soporte y edición actuales; métricas SaaS en un módulo propio. */
const SuperAdmin: React.FC = () => {
    const session = useAdminOverviewSession();
    const [pending, setPending] = useState({ key: session.key, value: false });
    const setPendingEditorialWork = useCallback((value: boolean) => setPending({ key: session.key, value }), [session.key]);
    const pendingEditorialWork = (pending.key === session.key && pending.value) || hasPendingEditorialWork(readActivationSession().key);
    const [editorialExitBlocked, setEditorialExitBlocked] = useState(false);
    useEffect(() => {
        if (!pendingEditorialWork) return;
        const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
        window.addEventListener('beforeunload', guard);
        return () => window.removeEventListener('beforeunload', guard);
    }, [pendingEditorialWork]);
    const exit = () => {
        clearEditorialDraft();
        for (const key of ['nortex_token', 'nortex_user', 'nortex_tenant_id', 'nortex_tenant_data']) localStorage.removeItem(key);
        window.dispatchEvent(new Event('nortex:data-changed'));
        window.location.href = '/login';
    };
    const handleLogout = () => {
        if (pendingEditorialWork || hasPendingEditorialWork(readActivationSession().key)) { setEditorialExitBlocked(true); return; }
        exit();
    };
    return <AdminOverviewPanel operations={(tenants, refresh) => <AdminDemoReset tenants={tenants.map(({ id, businessName, owner }) => ({ id, businessName, owner }))} onChanged={refresh} />} onExit={handleLogout} navigation={<div className="space-y-2">
        <button type="button" onClick={handleLogout} className="min-h-11 px-4 rounded-lg border border-surface-700">LOGOUT</button>
        {editorialExitBlocked && pendingEditorialWork && <div role="alert" className="text-sm text-amber-300">
            <p>Guardá o descartá tu trabajo editorial antes de salir.</p>
            <button type="button" className="min-h-11 underline" onClick={exit}>Descartar trabajo editorial y cerrar sesión</button>
        </div>}
    </div>}>
        <section className="space-y-5" aria-label="Herramientas administrativas existentes">
            <div className="flex flex-wrap gap-3 items-center justify-between">
                <h2 className="text-xl font-semibold">Ayuda y operación de Nortex</h2>
            </div>
            <AssistantBudgetRequests />
            <AssistantKnowledgeEditorial onPendingWorkChange={setPendingEditorialWork} />
            <AssistantPilotActivation />
            <CommerceSupport />
        </section>
    </AdminOverviewPanel>;
};
export default SuperAdmin;
