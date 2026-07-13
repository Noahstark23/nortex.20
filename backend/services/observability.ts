/**
 * NORTEX — Observabilidad (errores estructurados + Sentry opcional).
 *
 * Sin SENTRY_DSN el sistema opera igual que hoy (gate suave, mismo patrón que
 * NORTEX_LEDGER_KEYS): los errores salen como JSON estructurado a stdout, que
 * Coolify/docker logs ya recolectan. Con SENTRY_DSN, además viajan a Sentry.
 *
 * Uso en server.ts:
 *   initObservability();                      // ANTES de crear rutas
 *   app.use(errorTelemetry);                  // DESPUÉS de las rutas, antes de listen
 */
import type { Request, Response, NextFunction } from 'express';

let sentry: typeof import('@sentry/node') | null = null;

/** Log estructurado (una línea JSON) — grep-able y parseable por cualquier stack. */
export function logError(scope: string, err: unknown, extra?: Record<string, unknown>): void {
    const e = err instanceof Error ? err : new Error(String(err));
    console.error(JSON.stringify({
        level: 'error',
        scope,
        message: e.message,
        stack: e.stack?.split('\n').slice(0, 6).join(' | '),
        ...extra,
        ts: new Date().toISOString(),
    }));
    sentry?.captureException(e, { extra: { scope, ...extra } });
}

export function initObservability(): void {
    // Crash-visibility SIEMPRE (aun sin Sentry): un unhandled no muere silencioso.
    process.on('unhandledRejection', (reason) => logError('unhandledRejection', reason));
    process.on('uncaughtException', (err) => {
        logError('uncaughtException', err);
        // No process.exit: el server sigue; Docker/Coolify reinicia si el estado quedó malo.
    });

    const dsn = process.env.SENTRY_DSN;
    if (!dsn) {
        console.log('ℹ️ Observabilidad: logs estructurados activos (SENTRY_DSN no configurado — sin telemetría externa)');
        return;
    }
    // Import perezoso: si el paquete faltara, degradar a logs (nunca tumbar el server).
    import('@sentry/node')
        .then((mod) => {
            mod.init({ dsn, tracesSampleRate: 0.1, environment: process.env.NODE_ENV || 'development' });
            sentry = mod;
            console.log('✅ Sentry inicializado');
        })
        .catch((e) => console.error('⚠️ Sentry no disponible, siguiendo con logs estructurados:', e?.message));
}

/** Middleware de errores de Express: registra estructurado y responde genérico. */
export function errorTelemetry(err: unknown, req: Request, res: Response, _next: NextFunction): void {
    logError('express', err, {
        method: req.method,
        path: req.path,
        tenantId: (req as { tenantId?: string }).tenantId ?? null,
    });
    if (res.headersSent) return;
    res.status(500).json({ error: 'Error interno del servidor' });
}
