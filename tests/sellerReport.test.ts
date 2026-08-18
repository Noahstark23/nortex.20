/**
 * NORTEX — Red del reporte por vendedor (Fase A de "Vendedores").
 *
 * plegarReporteVendedores es el número que el dueño usa para pagar o reclamar:
 * "cuánto vendió y cuánto cobró cada quien". Los casos fijan valores absolutos
 * calculados a mano, no corriendo la función.
 */
import { describe, it, expect } from 'vitest';
// OJO: los nombres se aseveran como LITERALES a propósito. Si el test importa
// SIN_VENDEDOR/DESCONOCIDO, Stryker muta la constante y el test compara la
// mutación contra sí misma — pasa siempre y el mutante sobrevive.
import { plegarReporteVendedores, alcanceDelReporte } from '../backend/services/sellerReport';

const USERS = [
    { id: 'u-maria', name: 'María' },
    { id: 'u-jose', name: 'José' },
];

describe('Fold del reporte — plegarReporteVendedores', () => {
    it('pliega ventas por vendedor con su split contado/crédito', () => {
        // María: 1000 CASH (3 ventas) + 500 CREDIT (1) · José: 200 CASH (1).
        const filas = plegarReporteVendedores(
            [
                { soldById: 'u-maria', paymentMethod: 'CASH', total: '1000.00', count: 3 },
                { soldById: 'u-maria', paymentMethod: 'CREDIT', total: '500.00', count: 1 },
                { soldById: 'u-jose', paymentMethod: 'CASH', total: '200.00', count: 1 },
            ],
            [], USERS,
        );
        expect(filas.map(f => f.nombre)).toEqual(['María', 'José']);   // por ventas desc
        const maria = filas[0];
        expect(maria.ventasTotal).toBe('1500');
        expect(maria.ventasCount).toBe(4);
        expect(maria.contadoTotal).toBe('1000');
        expect(maria.creditoTotal).toBe('500');
    });

    it('TARJETA y TRANSFERENCIA cuentan como contado (solo CREDIT deja saldo)', () => {
        const filas = plegarReporteVendedores(
            [
                { soldById: 'u-jose', paymentMethod: 'CARD', total: '300.00', count: 1 },
                { soldById: 'u-jose', paymentMethod: 'TRANSFER', total: '200.00', count: 1 },
            ],
            [], USERS,
        );
        expect(filas[0].contadoTotal).toBe('500');
        expect(filas[0].creditoTotal).toBe('0');
    });

    it('cruza los cobros con las ventas del mismo vendedor', () => {
        const filas = plegarReporteVendedores(
            [{ soldById: 'u-maria', paymentMethod: 'CREDIT', total: '500.00', count: 1 }],
            [{ collectedBy: 'u-maria', amount: '320.50', count: 2 }],
            USERS,
        );
        expect(filas[0].cobradoTotal).toBe('320.5');
        expect(filas[0].cobradoCount).toBe(2);
    });

    it('quien SOLO cobró (sin vender en el período) igual aparece', () => {
        const filas = plegarReporteVendedores(
            [],
            [{ collectedBy: 'u-jose', amount: '150.00', count: 1 }],
            USERS,
        );
        expect(filas).toHaveLength(1);
        expect(filas[0].nombre).toBe('José');
        expect(filas[0].ventasTotal).toBe('0');
        expect(filas[0].cobradoTotal).toBe('150');
    });

    it('soldById null se muestra como "Sin vendedor" y SIEMPRE al final', () => {
        // El histórico anterior al campo y las ventas del driver caen acá:
        // se muestran (el total del negocio no miente), nunca compiten arriba.
        const filas = plegarReporteVendedores(
            [
                { soldById: null, paymentMethod: 'CASH', total: '9999.00', count: 50 },
                { soldById: 'u-jose', paymentMethod: 'CASH', total: '10.00', count: 1 },
            ],
            [], USERS,
        );
        expect(filas.map(f => f.nombre)).toEqual(['José', 'Sin vendedor']);
        expect(filas[1].ventasTotal).toBe('9999');
    });

    it('el orden es por ventas descendente entre vendedores, con "Sin vendedor" al final aunque venda más', () => {
        // null con monto INTERMEDIO: si el sort lo tratara como un vendedor más,
        // quedaría en el medio; la partición lo manda al final siempre.
        // El input llega en orden INVERSO al esperado, y con montos 9 vs 100:
        // si el sort desapareciera (orden de inserción) o comparara strings
        // ('9' > '100' lexicográficamente), el resultado cambia y el test cae.
        const filas = plegarReporteVendedores(
            [
                { soldById: null, paymentMethod: 'CASH', total: '50.00', count: 1 },
                { soldById: 'u-maria', paymentMethod: 'CASH', total: '9.00', count: 1 },
                { soldById: 'u-jose', paymentMethod: 'CASH', total: '100.00', count: 1 },
            ],
            [], USERS,
        );
        expect(filas.map(f => f.nombre)).toEqual(['José', 'María', 'Sin vendedor']);
    });

    it('un collectedBy que no resuelve a User del tenant sale como "Desconocido", no revienta', () => {
        const filas = plegarReporteVendedores(
            [],
            [{ collectedBy: 'id-fantasma', amount: '50.00', count: 1 }],
            USERS,
        );
        expect(filas[0].nombre).toBe('Desconocido');
    });

    it('los montos son Decimal a 2dp: 0.1 + 0.2 da 0.3, no 0.30000000000000004', () => {
        const filas = plegarReporteVendedores(
            [
                { soldById: 'u-maria', paymentMethod: 'CASH', total: '0.1', count: 1 },
                { soldById: 'u-maria', paymentMethod: 'CARD', total: '0.2', count: 1 },
            ],
            [], USERS,
        );
        expect(filas[0].ventasTotal).toBe('0.3');
    });

    it('con todo vacío devuelve lista vacía (sin filas fantasma)', () => {
        expect(plegarReporteVendedores([], [], USERS)).toEqual([]);
    });

    it('un _sum null (grupo sin montos) cuenta como 0', () => {
        const filas = plegarReporteVendedores(
            [{ soldById: 'u-jose', paymentMethod: 'CASH', total: null, count: 1 }],
            [{ collectedBy: 'u-jose', amount: null, count: 1 }],
            USERS,
        );
        expect(filas[0].ventasTotal).toBe('0');
        expect(filas[0].cobradoTotal).toBe('0');
    });
});

describe('Alcance del reporte — alcanceDelReporte', () => {
    it('OWNER, ADMIN y MANAGER ven todo', () => {
        expect(alcanceDelReporte('OWNER')).toBe('todos');
        expect(alcanceDelReporte('ADMIN')).toBe('todos');
        expect(alcanceDelReporte('MANAGER')).toBe('todos');
    });
    it('TODO otro rol queda en su propia fila — else explícito, sin fall-through', () => {
        // El frontend no gatea rutas: cualquier rol puede pegarle al endpoint.
        // Un rol nuevo mal registrado degrada a ver LO SUYO, jamás lo de todos.
        for (const r of ['VENDEDOR', 'CASHIER', 'ACCOUNTANT', 'VIEWER', 'EMPLOYEE', 'ROL_FUTURO', undefined]) {
            expect(alcanceDelReporte(r)).toBe('propio');
        }
    });
});
