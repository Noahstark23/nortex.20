import React from 'react';
import type { AssistantRunDTO } from '../../shared/assistantOperations';
import { assistantButtonClass } from './AssistantCatalogSelect';
import { AssistantOperationalEvidence } from './AssistantOperationalEvidence';

export function AssistantRunView({ run, busy, onCancel, onRecover, onReview, onInvestigate, investigationDisabled }: { run: AssistantRunDTO; busy: boolean; onCancel: () => void; onRecover: () => void; onReview: (id: string) => void; onInvestigate?: (shiftId: string, reportHash?: string) => void; investigationDisabled?: boolean }) {
    const active = run.status === 'PENDING' || run.status === 'RUNNING';
    const investigation = run.result?.evidence.some(({ data }) => data && typeof data === 'object' && !Array.isArray(data) && data.kind === 'CASH_CLOSE_INVESTIGATION');
    return <section aria-label="Trabajo de NortexGPT" className="nx-shell-control min-w-0 space-y-3 rounded-card border p-4">
        <h3 className="nx-shell-text font-semibold">{active ? 'NortexGPT está trabajando' : run.status === 'CANCELLED' ? 'Consulta cancelada' : run.status === 'FAILED' ? 'La consulta no terminó' : 'Resultado de la consulta'}</h3>
        <ol aria-label="Progreso de la consulta" className="nx-shell-text space-y-2 text-sm">{run.steps.map(step => <li key={step.id}>{step.label} · {step.status === 'RUNNING' ? 'En curso' : step.status === 'SUCCEEDED' ? 'Comprobado' : 'No disponible'}</li>)}</ol>
        {run.result && <><p className="nx-shell-text whitespace-pre-wrap break-words text-sm">{run.result.text}</p>{run.result.degraded && <p className="nx-tone-warning text-sm">{investigation ? 'Consulta directa de fuentes. Los pendientes requieren revisión; esta lectura no acredita una causa.' : 'Parte de la información no estuvo disponible. Revisá las fuentes y los datos pendientes.'}</p>}
            {run.result.evidence.map(evidence => <div key={evidence.id}><AssistantOperationalEvidence evidence={evidence} onInvestigate={onInvestigate} investigationDisabled={investigationDisabled || busy || active} /></div>)}
            {run.result.actionProposalIds.map((id, index) => <button key={id} type="button" disabled={busy} className={assistantButtonClass} onClick={() => onReview(id)}>Revisar propuesta {index + 1}</button>)}
        </>}
        <p className="nx-shell-muted break-all text-xs">Referencia de consulta: {run.id}</p>
        {active ? <button type="button" disabled={busy} className={assistantButtonClass} onClick={onCancel}>Cancelar consulta</button> : run.status !== 'SUCCEEDED' && <button type="button" disabled={busy} className={assistantButtonClass} onClick={onRecover}>Retomar consulta</button>}
        {active && <p role="status" className="nx-shell-muted text-xs">Podés cerrar el panel y retomar el progreso. Preparar una propuesta no ejecuta sus efectos.</p>}
    </section>;
}
