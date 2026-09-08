import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { MessageSquare } from 'lucide-react';
import { ASSISTANT_OPEN_EVENT } from './assistantOpenEvent';
import { useNortexAssistant } from '../../hooks/useNortexAssistant';
const NortexAssistantPanel = lazy(() => import('./NortexAssistantPanel'));

export default function NortexAssistantLauncher() {
    const controller = useNortexAssistant(); const [openedSession, setOpenedSession] = useState<string | null>(null);
    const [visitedSession, setVisitedSession] = useState<string | null>(null);
    const location = useLocation(); const handledLink = useRef('');
    const open = openedSession === controller.sessionKey;
    useEffect(() => { setOpenedSession(null); setVisitedSession(null); }, [controller.sessionKey]);
    useEffect(() => {
        const show = () => {
            if (!controller.capabilities?.enabled) return;
            setVisitedSession(controller.sessionKey); setOpenedSession(controller.sessionKey);
            void controller.refreshCapabilities();
        };
        window.addEventListener(ASSISTANT_OPEN_EVENT, show);
        return () => window.removeEventListener(ASSISTANT_OPEN_EVENT, show);
    }, [controller.sessionKey, controller.capabilities?.enabled, controller.refreshCapabilities]);
    useEffect(() => {
        if (!controller.capabilities?.enabled) return;
        const params = new URLSearchParams(location.search); const conversation = params.get('assistantConversation'); const extraction = params.get('assistantExtraction');
        const valid = (id: string | null) => !!id && /^[a-zA-Z0-9-]{1,80}$/.test(id);
        const linkKey = `${controller.sessionKey}:${location.search}`;
        if ((!valid(conversation) && !valid(extraction)) || handledLink.current === linkKey) return;
        handledLink.current = linkKey; setVisitedSession(controller.sessionKey); setOpenedSession(controller.sessionKey);
        if (controller.conversationId || controller.proposal || controller.job || controller.pendingMessage || controller.operations?.proposal) return;
        void (async () => { if (valid(conversation)) await controller.recoverConversation(conversation!); if (valid(extraction)) await controller.recover('extractions', extraction!); })();
    }, [location.search, controller]);
    return <>
        {controller.capabilities?.enabled && <button type="button" aria-label="Abrir NortexGPT" aria-haspopup="dialog" aria-expanded={open}
            className="nx-shell-control nx-fluid-press fixed bottom-24 right-3 z-dropdown inline-flex min-h-tap items-center gap-2 rounded-full border px-4 py-3 text-sm font-semibold shadow-lg lg:bottom-5 lg:right-5"
            onClick={() => { setVisitedSession(controller.sessionKey); setOpenedSession(controller.sessionKey); void controller.refreshCapabilities(); }}><MessageSquare size={19} aria-hidden="true" /><span>NortexGPT</span></button>}
        {visitedSession === controller.sessionKey && <Suspense fallback={null}><NortexAssistantPanel key={controller.sessionKey} controller={controller} open={open} onClose={() => setOpenedSession(null)} /></Suspense>}
    </>;
}
