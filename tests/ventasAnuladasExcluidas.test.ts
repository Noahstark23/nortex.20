import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ESTADO_ANULADA } from '../backend/services/saleCancellation';

/**
 * Guarda de ALCANCE: las ventas anuladas quedan fuera de los números.
 *
 * EL RIESGO QUE CUBRE: un `status = 'VOIDED'` que los reportes no respeten es
 * PEOR que no tener anulación. El dueño cree que la factura no cuenta, el
 * sistema la sigue sumando, y el descuadre aparece en el arqueo o —peor— en la
 * declaración a la DGI. Y no es hipotético: el repo ya tenía ocho exclusiones
 * de 'VOIDED' escritas mientras NADA escribía ese estado; la mitad del riesgo
 * es que el filtro esté y el otro lado no, y la otra mitad es al revés.
 *
 * CÓMO: se afirma un PISO de filtros por archivo, igual que
 * `scripts/check-mutation-scope.cjs` hace con los mutantes. Si alguien agrega
 * una consulta de dinero sobre `Sale` sin excluir las anuladas, el piso no
 * sube solo — pero si alguien BORRA un filtro existente, esto falla ruidoso.
 *
 * Los pisos SOLO SUBEN. Bajarlos para que pase un PR es exactamente lo que esta
 * guarda viene a prevenir.
 */

const raiz = join(__dirname, '..');
const leer = (ruta: string) => readFileSync(join(raiz, ruta), 'utf-8');

// Piso de exclusiones por archivo, medido al implementar la anulación (DGI-5).
const PISO_FILTROS: Record<string, number> = {
    // Arqueo de caja (4), includes del turno (4), dashboard y gráfico (3),
    // ranking y comisiones (2), reporte del período (1), reporte por vendedor (1).
    'backend/server.ts': 15,
    // Declaración mensual de IVA + rango de facturas del Libro de Ventas.
    // Estos dos son los que van a la DGI: si se pierden, se declara de más.
    'backend/services/nicaTax.ts': 2,
    // Score de crédito: sin esto un negocio inflaría su propio score
    // facturando y anulando.
    'backend/services/scoring.ts': 1,
};

const contarFiltros = (fuente: string): number =>
    ((fuente.match(/status:\s*\{\s*not:\s*ESTADO_ANULADA\s*\}/g) as string[] | null) ?? []).length;

describe('las ventas anuladas no cuentan en los números', () => {
    it.each(Object.entries(PISO_FILTROS))(
        '%s mantiene al menos %i exclusiones de ventas anuladas',
        (ruta, piso) => {
            expect(contarFiltros(leer(ruta))).toBeGreaterThanOrEqual(piso);
        }
    );

    it('el arqueo de caja excluye las anuladas en TODOS sus caminos', () => {
        // El más caro de todos: si una venta en efectivo anulada sigue contando
        // como efectivo esperado, el cajero aparece con FALTANTE en su arqueo y
        // el sistema lo acusa de un robo que no existió.
        const fuente = leer('backend/server.ts');
        const caminosDeCaja: string[] = fuente.match(/paymentMethod:\s*'CASH'[^}]*\}/g) ?? [];
        expect(caminosDeCaja.length).toBeGreaterThan(0);
        const sinFiltro = caminosDeCaja.filter(c => !c.includes('ESTADO_ANULADA'));
        expect(sinFiltro).toEqual([]);
    });

    it('nadie dejó el literal suelto en vez de la constante', () => {
        // Dos nombres para el mismo estado es como no tener ninguno: un rename
        // arreglaría la mitad de los filtros y dejaría la otra mitad muda.
        for (const ruta of ['backend/server.ts', 'backend/services/nicaTax.ts', 'backend/services/scoring.ts']) {
            expect(leer(ruta)).not.toContain(`'${ESTADO_ANULADA}'`);
        }
    });

    it('el estado anulado sigue siendo el que los reportes ya excluían', () => {
        expect(ESTADO_ANULADA).toBe('VOIDED');
    });
});
