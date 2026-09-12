import React from 'react';
import type { AssistantJson, AssistantJsonObject, AssistantToolEvidence } from '../../shared/assistantOperations';
import { formatMoney } from '../../utils/money';
import { AssistantWeeklyCashReview } from './AssistantWeeklyCashReview';
import { AssistantCashCloseInvestigation } from './AssistantCashCloseInvestigation';

const object = (value: AssistantJson | undefined): AssistantJsonObject | null => value && typeof value === 'object' && !Array.isArray(value) ? value : null;
const readable = (value: AssistantJson | undefined) => typeof value === 'string' || typeof value === 'number' ? String(value) : 'No disponible';
const sourceTitles: Record<string, string> = { audit_business_health: 'Cómo va el negocio', check_inventory_burn_rate: 'Existencias y reposición', inspect_batch_expiry: 'Lotes y vencimientos', read_daily_brief: 'Resumen del día' };
const columns: Record<string, Array<[string, string]>> = {
    INVENTORY_BURN_RATE: [['name', 'Producto'], ['physicalStock', 'Existencias físicas'], ['sellableStock', 'Disponible para vender'], ['dailyAverage', 'Consumo neto de inventario registrado por día'], ['estimatedDaysRemaining', 'Días de cobertura estimados'], ['pendingOrderQuantity', 'Pendiente en OC'], ['suggestedQuantity', 'Cantidad sugerida']],
    BATCH_EXPIRY: [['name', 'Producto'], ['batchNumber', 'Lote'], ['expiryDate', 'Vencimiento'], ['physicalStock', 'Existencias físicas'], ['sellableStock', 'Disponible para vender']],
};
const warnings = (value: AssistantJson | undefined): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : [];
const historyLabels: Record<string, string> = { SUFFICIENT: 'Días suficientes para estimar', INSUFFICIENT: 'Días insuficientes para estimar' };
const suggestionLabels: Record<string, string> = { CONFIGURED_MINIMUM: 'Mínimo configurado', CONFIGURED_MAXIMUM: 'Máximo configurado', RECORDED_RATE: 'Salidas por venta y reintegros registrados' };
function InventoryContext({ row }: { row: AssistantJsonObject }) {
    const details = [
        ['Historial para estimar', typeof row.historyStatus === 'string' ? historyLabels[row.historyStatus] ?? 'No disponible' : 'No disponible'],
        ['Días disponibles desde el alta', readable(row.historyAvailableDays)], ['Días de historial requeridos', readable(row.historyRequiredDays)],
        ['Mínimo configurado', readable(row.configuredMinimum)], ['Máximo configurado', readable(row.configuredMaximum)],
        ['Base de la cantidad sugerida', typeof row.suggestionBasis === 'string' ? suggestionLabels[row.suggestionBasis] ?? 'No disponible' : 'No disponible'],
    ];
    return <dl className="grid gap-2 sm:grid-cols-2">{details.map(([label, value]) => <div key={label}><dt className="nx-shell-muted">{label}</dt><dd className="nx-shell-text font-medium">{value}</dd></div>)}</dl>;
}
function EvidenceRows({ rows, fields, inventory }: { rows: AssistantJsonObject[]; fields: Array<[string, string]>; inventory: boolean }) {
    return <table className="nx-shell-text w-full text-left text-xs"><thead><tr>{fields.map(([key, label]) => <th scope="col" key={key} className="nx-shell-border border-b px-2 py-2 font-semibold">{label}</th>)}<th scope="col" className="nx-shell-border border-b px-2 py-2 font-semibold">Estado de los datos</th></tr></thead>{rows.map((row, index) => {
        const label = `${readable(row.name)}${typeof row.batchNumber === 'string' ? ` · Lote ${row.batchNumber}` : ''}`;
        const rowWarnings = warnings(row.warnings);
        return <tbody key={index} aria-label={label}><tr>{fields.map(([key]) => key === 'name' ? <th scope="row" key={key} className="nx-shell-border border-b px-2 py-2 font-semibold">{readable(row[key])}</th> : <td key={key} className="nx-shell-border border-b px-2 py-2">{readable(row[key])}</td>)}<td className={`nx-shell-border border-b px-2 py-2 ${['partial', 'unavailable'].includes(String(row.status)) ? 'nx-tone-warning' : ''}`}>{row.status === 'ok' ? 'Datos verificados' : row.status === 'partial' ? 'Datos parciales' : row.status === 'unavailable' ? 'Información incompleta' : 'Estado no disponible'}</td></tr>
            {(inventory || rowWarnings.length > 0) && <tr><td colSpan={fields.length + 1} className="nx-shell-border border-b px-2 py-3"><div className="w-48 max-w-full space-y-3 sm:w-96">{inventory && <InventoryContext row={row} />}{rowWarnings.length > 0 && <ul aria-label={`Advertencias de ${label}`} className="nx-tone-warning list-disc space-y-1 break-words pl-4">{rowWarnings.map((warning, warningIndex) => <li key={warningIndex}>{warning}</li>)}</ul>}</div></td></tr>}
        </tbody>;
    })}</table>;
}
function Metrics({ value }: { value: AssistantJson | undefined }) {
    if (!Array.isArray(value)) return null;
    return <dl className="grid gap-3 sm:grid-cols-2">{value.map(object).filter(Boolean).map((metric, index) => <div key={index} className="nx-shell-border border-t pt-2">
        <dt className="nx-shell-text text-sm font-semibold">{readable(metric.label)}</dt><dd className="nx-shell-text text-base">{metric.status === 'unavailable' || metric.value == null ? 'No disponible' : metric.unit === 'money' && typeof metric.value === 'string' ? formatMoney(metric.value) : `${readable(metric.value)}${metric.unit === 'percent' ? '%' : ''}`}</dd>
        <dd className="nx-shell-muted break-words text-xs">Fuente: {readable(metric.source)}</dd>
    </div>)}</dl>;
}
function Period({ value }: { value: AssistantJson | undefined }) {
    const period = object(value); if (!period) return null;
    return <p className="nx-shell-muted text-xs">Período: {readable(period.startDate)} al {readable(period.endDate)} · Managua{period.completeDays === false ? ' · Período en curso' : ''}</p>;
}
function HelpEvidence({ data }: { data: AssistantJsonObject }) {
    const citations = Array.isArray(data.citations) ? data.citations.flatMap(value => {
        const citation = object(value);
        if (!citation || !['id', 'title', 'section', 'version'].every(key => typeof citation[key] === 'string' && String(citation[key]).trim().length > 0)) return [];
        return [{ id: String(citation.id), title: String(citation.title), section: String(citation.section), version: String(citation.version) }];
    }) : [];
    return <>
        <p className="nx-shell-text whitespace-pre-line break-words text-sm">{typeof data.text === 'string' && data.text.trim() ? data.text : 'La ayuda no está disponible en esta consulta.'}</p>
        {citations.length > 0 && <ul aria-label="Fuentes de ayuda" className="nx-shell-muted space-y-2 break-words text-xs">{citations.map((citation, index) => <li key={`${citation.id}:${citation.version}:${index}`}>{citation.title} · {citation.section} · Versión {citation.version}</li>)}</ul>}
    </>;
}
export function AssistantOperationalEvidence({ evidence, onInvestigate, investigationDisabled }: { evidence: AssistantToolEvidence; onInvestigate?: (shiftId: string, reportHash?: string) => void; investigationDisabled?: boolean }) {
    const label = sourceTitles[evidence.tool] ?? evidence.label;
    const data = object(evidence.data); const comparison = object(data?.comparison); const rows = Array.isArray(data?.rows) ? data.rows.map(object).filter(Boolean) : [];
    const fields = typeof data?.kind === 'string' ? columns[data.kind] : undefined;
    if (data?.kind === 'CASH_CLOSE_INVESTIGATION') return <AssistantCashCloseInvestigation data={data} />;
    if (data?.kind === 'WEEKLY_CASH_REVIEW') return <section aria-label="Fuente: Revisión de cierres de caja" className="nx-shell-control min-w-0 space-y-3 rounded-card border p-3">
        <AssistantWeeklyCashReview data={data} onInvestigate={onInvestigate} investigationDisabled={investigationDisabled} />
        <p className="nx-shell-muted text-xs">Consultado: {typeof data.checkedAt === 'string' && Number.isFinite(new Date(data.checkedAt).getTime()) ? new Date(data.checkedAt).toLocaleString('es-NI', { timeZone: 'America/Managua' }) : 'Fecha no disponible'} · Managua</p>
    </section>;
    return <section aria-label={`Fuente: ${label}`} className="nx-shell-control min-w-0 space-y-3 rounded-card border p-3">
        <h4 className="nx-shell-text font-semibold">{label}</h4>
        {data ? <>
            {evidence.tool === 'search_help' && <HelpEvidence data={data} />}
            <Period value={data.period} />{typeof data.checkedAt === 'string' && <p className="nx-shell-muted text-xs">Consultado: {Number.isFinite(new Date(data.checkedAt).getTime()) ? new Date(data.checkedAt).toLocaleString('es-NI', { timeZone: 'America/Managua' }) : 'Fecha no disponible'} · Managua</p>}
            {data.status === 'unavailable' && <p className="nx-tone-warning text-sm">No se pudo consultar esta información. No equivale a cero.</p>}
            <Metrics value={data.metrics} />
            {comparison && <details className="space-y-3"><summary className="nx-shell-text min-h-tap cursor-pointer text-sm">Comparar con el período anterior</summary><Period value={comparison.period} /><Metrics value={comparison.metrics} /><Metrics value={comparison.changes} /></details>}
            {data.kind === 'INVENTORY_BURN_RATE' && <p className="nx-shell-muted text-xs">El consumo mostrado considera salidas por venta menos devoluciones reintegradas al inventario. Las devoluciones en cuarentena o por pérdida no se restan. No incluye mermas ni traslados.</p>}
            {fields && rows.length > 0 && <div role="region" aria-label={`Detalle: ${label}`} tabIndex={0} className="max-w-full overflow-x-auto"><EvidenceRows rows={rows} fields={fields} inventory={data.kind === 'INVENTORY_BURN_RATE'} /></div>}
            {Array.isArray(data.warnings) && data.warnings.length > 0 && <ul className="nx-tone-warning list-disc space-y-1 break-words pl-4 text-sm">{data.warnings.filter(value => typeof value === 'string').map((warning, index) => <li key={index}>{String(warning)}</li>)}</ul>}
            {Array.isArray(data.evidence) && <ul className="nx-shell-muted space-y-1 break-words text-xs">{data.evidence.filter(value => typeof value === 'string').map((source, index) => <li key={index}>Procedencia: {String(source)}</li>)}</ul>}
        </> : <p className="nx-shell-muted text-sm">{typeof evidence.data === 'string' ? evidence.data : 'El resultado se conserva con esta consulta.'}</p>}
    </section>;
}
