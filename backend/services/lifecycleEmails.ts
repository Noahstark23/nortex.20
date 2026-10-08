/**
 * NORTEX — Secuencia de emails del ciclo de vida del trial (retención R1).
 *
 * Problema que resuelve (docs/AUDITORIA_UX_RETENCION.md, gap A5): el trial
 * vencía EN SILENCIO — checkExpiredSubscriptions marca PAST_DUE sin avisar a
 * nadie, y el único email del sistema era el reset de contraseña. Nadie le
 * recordaba al dueño cargar un producto, hacer su primera venta ni que su
 * prueba estaba por terminar.
 *
 * Diseño:
 *  - `decideLifecycleEmail` es PURA (testeada en CI): decide qué email (si
 *    alguno) corresponde a un tenant hoy. Máximo UN email por corrida y por
 *    tenant; prioridad: vencido > por vencer > sin venta > sin producto.
 *  - `runLifecycleEmails` corre a diario (setInterval en server.ts, junto a
 *    la depreciación). Candidatos acotados (take) y conteos agregados en la
 *    BD (groupBy) — sin N+1 (guardrails de escalabilidad #2/#4).
 *  - Idempotencia: se registra un AuditLog con la acción del email ANTES de
 *    enviar (claim). Si el envío falla, el log queda y NO se reintenta — es
 *    marketing, preferimos no duplicar. El índice [tenantId, action, createdAt]
 *    ya existe. ⚠️ Con >1 instancia el claim reduce pero no elimina la carrera
 *    (ventana entre el findMany y el create); hoy corremos single-instance
 *    (docs/SCALING_AUDIT.md) — al escalar, mover a un job con lock (BullMQ).
 *  - LENDER no vende productos: los empujones de producto/venta no aplican
 *    (sus hitos son préstamos); solo recibe los emails de vencimiento.
 */
import prisma from '../lib/prisma';
import { sendLifecycleEmail } from './email';

export const LIFECYCLE_ACTIONS = [
    'EMAIL_TRIAL_NOPRODUCT',
    'EMAIL_TRIAL_NOSALE',
    'EMAIL_TRIAL_ENDING',
    'EMAIL_TRIAL_EXPIRED',
] as const;
export type LifecycleAction = typeof LIFECYCLE_ACTIONS[number];

const DAY_MS = 24 * 60 * 60 * 1000;

export interface LifecycleTenantSnapshot {
    type: string | null;                 // giro (LENDER no recibe empujones de producto/venta)
    createdAt: Date;
    trialEndsAt: Date | null;
    subscriptionStatus: string | null;   // TRIAL | PAST_DUE | ...
    productCount: number;
    saleCount: number;
    alreadySent: ReadonlySet<string>;    // acciones EMAIL_* ya registradas en AuditLog
}

/**
 * Decide el email del día para un tenant (o null). PURA: sin BD, sin red.
 * Reglas (primera que aplique gana — un email por corrida):
 *  1. EXPIRED : trial vencido (status TRIAL/PAST_DUE con trialEndsAt < hoy).
 *  2. ENDING  : status TRIAL y vence dentro de ≤3 días.
 *  3. NOSALE  : lleva ≥3 días registrado, tiene productos pero 0 ventas (no LENDER).
 *  4. NOPRODUCT: lleva ≥1 día registrado y 0 productos (no LENDER).
 * Nunca repite un email ya registrado, y solo aplica a cuentas en su ciclo de
 * prueba (TRIAL, o PAST_DUE que viene de un trial vencido).
 */
export function decideLifecycleEmail(t: LifecycleTenantSnapshot, now: Date): LifecycleAction | null {
    const status = t.subscriptionStatus || 'TRIAL';
    if (status !== 'TRIAL' && status !== 'PAST_DUE') return null; // ACTIVE/CANCELLED: fuera del ciclo

    const trialEnds = t.trialEndsAt ? t.trialEndsAt.getTime() : null;
    const ageMs = now.getTime() - t.createdAt.getTime();
    const isLender = (t.type || '').toUpperCase() === 'LENDER';

    // 1. Vencido (aplica también a PAST_DUE recién marcado por el cron)
    if (trialEnds !== null && trialEnds < now.getTime()) {
        // Tras el vencimiento solo cabe el email de vencido — nunca empujones
        // de activación a una cuenta cuyo trial ya terminó.
        return t.alreadySent.has('EMAIL_TRIAL_EXPIRED') ? null : 'EMAIL_TRIAL_EXPIRED';
    }
    if (status !== 'TRIAL') return null; // PAST_DUE sin trial vencido reciente: nada

    // 2. Por vencer (≤3 días)
    if (
        trialEnds !== null &&
        trialEnds >= now.getTime() &&
        trialEnds - now.getTime() <= 3 * DAY_MS &&
        !t.alreadySent.has('EMAIL_TRIAL_ENDING')
    ) {
        return 'EMAIL_TRIAL_ENDING';
    }

    // 3/4. Empujones de activación — no aplican al giro LENDER (no vende productos)
    if (isLender) return null;

    if (ageMs >= 3 * DAY_MS && t.productCount > 0 && t.saleCount === 0 && !t.alreadySent.has('EMAIL_TRIAL_NOSALE')) {
        return 'EMAIL_TRIAL_NOSALE';
    }
    if (ageMs >= 1 * DAY_MS && t.productCount === 0 && !t.alreadySent.has('EMAIL_TRIAL_NOPRODUCT')) {
        return 'EMAIL_TRIAL_NOPRODUCT';
    }
    return null;
}

/** Días (enteros, hacia arriba) hasta el fin del trial — para el asunto del ENDING. */
export function daysUntil(trialEndsAt: Date, now: Date): number {
    return Math.max(0, Math.ceil((trialEndsAt.getTime() - now.getTime()) / DAY_MS));
}

/**
 * Corrida diaria. Acotada: solo tenants en TRIAL o PAST_DUE con trial vencido
 * hace ≤7 días (después de eso, dejamos de insistir), máx. 500 por corrida.
 */
export async function runLifecycleEmails(): Promise<void> {
    try {
        const now = new Date();
        const sevenDaysAgo = new Date(now.getTime() - 7 * DAY_MS);

        const candidates = await prisma.tenant.findMany({
            where: {
                OR: [
                    { subscriptionStatus: 'TRIAL' },
                    { subscriptionStatus: 'PAST_DUE', trialEndsAt: { gte: sevenDaysAgo, lte: now } },
                ],
            },
            select: {
                id: true, businessName: true, type: true, createdAt: true,
                trialEndsAt: true, subscriptionStatus: true,
                users: { select: { id: true, email: true }, take: 1, orderBy: { createdAt: 'asc' } },
            },
            orderBy: { createdAt: 'desc' },
            take: 500,
        });
        if (candidates.length === 0) return;
        const ids = candidates.map(t => t.id);

        // Conteos y logs en 3 queries agregadas (nada de N+1 por tenant).
        const [productCounts, saleCounts, sentLogs] = await Promise.all([
            prisma.product.groupBy({ by: ['tenantId'], where: { tenantId: { in: ids } }, _count: { _all: true } }),
            prisma.sale.groupBy({ by: ['tenantId'], where: { tenantId: { in: ids } }, _count: { _all: true } }),
            prisma.auditLog.findMany({
                where: { tenantId: { in: ids }, action: { in: [...LIFECYCLE_ACTIONS] } },
                select: { tenantId: true, action: true },
            }),
        ]);
        const productBy = new Map(productCounts.map(p => [p.tenantId, p._count._all]));
        const saleBy = new Map(saleCounts.map(s => [s.tenantId, s._count._all]));
        const sentBy = new Map<string, Set<string>>();
        for (const log of sentLogs) {
            if (!sentBy.has(log.tenantId)) sentBy.set(log.tenantId, new Set());
            sentBy.get(log.tenantId)!.add(log.action);
        }

        let sent = 0;
        for (const t of candidates) {
            const owner = t.users[0];
            if (!owner?.email) continue;

            const action = decideLifecycleEmail({
                type: t.type,
                createdAt: t.createdAt,
                trialEndsAt: t.trialEndsAt,
                subscriptionStatus: t.subscriptionStatus,
                productCount: productBy.get(t.id) ?? 0,
                saleCount: saleBy.get(t.id) ?? 0,
                alreadySent: sentBy.get(t.id) ?? new Set(),
            }, now);
            if (!action) continue;

            // Claim ANTES de enviar (idempotencia): si el proceso muere a mitad,
            // preferimos un email no enviado a un email duplicado.
            await prisma.auditLog.create({
                data: {
                    tenantId: t.id,
                    userId: owner.id,
                    action,
                    details: `Email de ciclo de vida (${action}) a ${owner.email}`,
                },
            });
            const days = t.trialEndsAt ? daysUntil(t.trialEndsAt, now) : undefined;
            await sendLifecycleEmail(owner.email, action, t.businessName, days);
            sent++;
        }
        if (sent > 0) console.log(`📬 Lifecycle: ${sent} email(s) de retención enviados`);
    } catch (err) {
        // El job de retención JAMÁS tumba el server.
        console.error('⚠️ Error en runLifecycleEmails:', err);
    }
}
