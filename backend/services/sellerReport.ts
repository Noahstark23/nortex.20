/**
 * NORTEX — Reporte por vendedor (Fase A de "Vendedores"): fold PURO.
 *
 * Responde las dos preguntas del dueño: cuánto VENDE cada vendedor (ventas
 * atribuidas por Sale.soldById, con su split contado/crédito) y cuánto COBRA
 * (abonos de CxC por Payment.collectedBy).
 *
 * Este módulo es deliberadamente puro (sin Prisma): recibe los GRUPOS que ya
 * agregó la base de datos y los pliega en filas por vendedor. El fold opera
 * sobre grupos (vendedores × métodos de pago), nunca sobre filas de venta —
 * la regla de escalabilidad del repo: agregar en la BD, no sumar en JS.
 *
 * Semántica pactada (decirla siempre, o el número miente):
 *  · "Cobrado" = abonos de CUENTAS POR COBRAR. El efectivo de una venta de
 *    contado NO aparece acá (executeSale no crea Payment para contado del
 *    POS); se ve como "ventas de contado". Unificar canales es Fase E.
 *  · soldById null = "Sin vendedor" (histórico anterior al campo + ventas del
 *    driver): se MUESTRA como fila propia, jamás se excluye del total.
 */
import Decimal from 'decimal.js';

// Sin Decimal.set: los defaults de decimal.js YA son precision 20 y
// ROUND_HALF_UP — la llamada era redundante, y como corre al importar (antes
// de que Stryker atribuya cobertura) su mutante sobrevivía siempre.

/** Grupo del prisma.sale.groupBy(['soldById','paymentMethod']). */
export interface GrupoVenta {
    soldById: string | null;
    paymentMethod: string;
    /** _sum.total como string/number/Decimal — se normaliza con decimal.js. */
    total: Decimal.Value | null;
    count: number;
}

/** Grupo del prisma.payment.groupBy(['collectedBy']) (abonos de crédito). */
export interface GrupoCobro {
    collectedBy: string;
    amount: Decimal.Value | null;
    count: number;
}

export interface FilaVendedor {
    sellerId: string | null;      // null = "Sin vendedor"
    nombre: string;               // resuelto contra users; "Sin vendedor"/"Desconocido"
    ventasTotal: string;          // Decimal 2dp como string (nunca Number intermedio)
    ventasCount: number;
    contadoTotal: string;
    creditoTotal: string;
    cobradoTotal: string;
    cobradoCount: number;
}

export const SIN_VENDEDOR = 'Sin vendedor';
/** collectedBy apuntando a un User que ya no se puede resolver (dato viejo/roto). */
export const DESCONOCIDO = 'Desconocido';

const d2 = (v: Decimal) => v.toDecimalPlaces(2).toString();

/**
 * Pliega los grupos de la BD en filas por vendedor.
 *
 * `usuarios` es el LEFT-JOIN semántico: los ids del tenant con su nombre. Un
 * collectedBy/soldById que no esté ahí se reporta como DESCONOCIDO en vez de
 * reventar — Payment no tiene tenantId y el histórico puede traer sorpresas.
 * Orden: por ventasTotal descendente; la fila "Sin vendedor" siempre al final
 * (es contexto, no competencia).
 */
export function plegarReporteVendedores(
    ventas: GrupoVenta[],
    cobros: GrupoCobro[],
    usuarios: { id: string; name: string }[],
): FilaVendedor[] {
    const nombres = new Map(usuarios.map(u => [u.id, u.name]));
    const filas = new Map<string | null, {
        ventas: Decimal; count: number; contado: Decimal; credito: Decimal;
        cobrado: Decimal; cobradoCount: number;
    }>();

    const fila = (key: string | null) => {
        let f = filas.get(key);
        if (!f) {
            f = { ventas: new Decimal(0), count: 0, contado: new Decimal(0), credito: new Decimal(0), cobrado: new Decimal(0), cobradoCount: 0 };
            filas.set(key, f);
        }
        return f;
    };

    for (const g of ventas) {
        const f = fila(g.soldById);
        const monto = new Decimal(g.total ?? 0);
        f.ventas = f.ventas.plus(monto);
        f.count += g.count;
        // El split sale del MISMO groupBy por método: CREDIT es crédito, todo
        // lo demás (CASH, CARD, TRANSFER…) cuenta como contado — coincide con
        // la semántica de executeSale, donde solo CREDIT deja saldo.
        if (g.paymentMethod === 'CREDIT') f.credito = f.credito.plus(monto);
        else f.contado = f.contado.plus(monto);
    }

    for (const g of cobros) {
        const f = fila(g.collectedBy);
        f.cobrado = f.cobrado.plus(new Decimal(g.amount ?? 0));
        f.cobradoCount += g.count;
    }

    const out: FilaVendedor[] = [];
    for (const [key, f] of filas) {
        out.push({
            sellerId: key,
            nombre: key === null ? SIN_VENDEDOR : (nombres.get(key) ?? DESCONOCIDO),
            ventasTotal: d2(f.ventas),
            ventasCount: f.count,
            contadoTotal: d2(f.contado),
            creditoTotal: d2(f.credito),
            cobradoTotal: d2(f.cobrado),
            cobradoCount: f.cobradoCount,
        });
    }
    // "Sin vendedor" va al final por CONSTRUCCIÓN (partición + concat), no con
    // un comparador de ramas: un comparador con `if null` era inconsistente
    // (el resultado dependía del orden de llegada) y sus mutantes no morían.
    const conVendedor = out
        .filter(f => f.sellerId !== null)
        .sort((a, b) => new Decimal(b.ventasTotal).minus(a.ventasTotal).toNumber());
    const sinVendedor = out.filter(f => f.sellerId === null);
    return [...conVendedor, ...sinVendedor];
}

/**
 * ¿Este rol ve el reporte completo o solo su propia fila?
 *
 * Regla con else EXPLÍCITO (el frontend no gatea rutas, así que cualquier rol
 * puede pegarle al endpoint): OWNER/ADMIN/MANAGER ven todo; TODO otro rol
 * (VENDEDOR, CASHIER, ACCOUNTANT, VIEWER, EMPLOYEE, o uno futuro) queda
 * forzado a self-only. Un rol nuevo mal registrado degrada a ver lo suyo,
 * nunca a ver lo de todos.
 */
export function alcanceDelReporte(role: string | undefined): 'todos' | 'propio' {
    return role === 'OWNER' || role === 'ADMIN' || role === 'MANAGER' ? 'todos' : 'propio';
}
