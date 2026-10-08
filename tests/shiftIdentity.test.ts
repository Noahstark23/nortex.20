import { describe, it, expect } from 'vitest';
import {
    decidirIdentidadCajero,
    pinNormalizado,
    explicarModo,
    DatosIdentidad,
    ModoIdentidad,
} from '../backend/services/shiftIdentity';

/**
 * Identidad del cajero al abrir la caja — números oro.
 *
 * Lo que se defiende: que sacar la fricción del PIN NO termine poniéndole a
 * alguien un faltante que no es suyo. El `Shift.difference` del arqueo es una
 * acusación; atribuirla mal es peor que no atribuirla.
 *
 * Los casos se arman DENTRO de cada `it`: Stryker activa el mutante en runtime,
 * así que lo calculado en el cuerpo del `describe` correría sin mutante.
 */

const datos = (p: Partial<DatosIdentidad> = {}): DatosIdentidad => ({
    requierePin: false,
    pinDado: null,
    empleadoDelPin: null,
    empleadoDelUsuario: null,
    empleadosActivos: [],
    ...p,
});

describe('pinNormalizado', () => {
    it('recorta los bordes', () => {
        expect(pinNormalizado('  1234  ')).toBe('1234');
    });

    it('un PIN de puros espacios no es un PIN', () => {
        expect(pinNormalizado('    ')).toBeNull();
        expect(pinNormalizado('')).toBeNull();
    });

    it('null y undefined dan null, no la cadena "null"', () => {
        expect(pinNormalizado(null)).toBeNull();
        expect(pinNormalizado(undefined)).toBeNull();
    });

    it('un número se vuelve texto sin perder dígitos', () => {
        expect(pinNormalizado(1234)).toBe('1234');
    });
});

describe('el PIN manda cuando viene', () => {
    it('con PIN válido atribuye la gaveta a ese empleado', () => {
        const r = decidirIdentidadCajero(datos({ pinDado: '1234', empleadoDelPin: 'emp-a' }));
        expect(r.ok).toBe(true);
        expect(r.employeeId).toBe('emp-a');
        expect(r.modo).toBe('PIN');
    });

    it('con PIN que no existe RECHAZA, no cae al modo automático', () => {
        // Si tecleara un PIN equivocado y el sistema abriera igual a nombre del
        // usuario, el cajero creería que la gaveta quedó a su nombre y no es así.
        const r = decidirIdentidadCajero(datos({
            pinDado: '9999',
            empleadoDelPin: null,
            empleadoDelUsuario: 'emp-dueno',
            empleadosActivos: ['emp-dueno'],
        }));
        expect(r.ok).toBe(false);
        expect(r.codigo).toBe('PIN_INCORRECTO');
        expect(r.employeeId).toBeNull();
        // El modo dice DÓNDE murió el intento: se rechazó en el camino del PIN,
        // no en el automático. Es lo que distingue "tecleó mal" de "ni intentó",
        // que es justo lo que hay que poder leer al auditar un faltante.
        expect(r.modo).toBe('PIN');
    });

    it('el PIN gana sobre el empleado enlazado al usuario', () => {
        // El caso real: el dueño está logueado y el cajero del segundo turno
        // teclea SU PIN. La gaveta es del cajero, no del dueño.
        const r = decidirIdentidadCajero(datos({
            pinDado: '5678',
            empleadoDelPin: 'emp-cajero',
            empleadoDelUsuario: 'emp-dueno',
        }));
        expect(r.employeeId).toBe('emp-cajero');
    });

    it('el PIN vale aunque el negocio NO lo exija', () => {
        const r = decidirIdentidadCajero(datos({
            requierePin: false,
            pinDado: '1234',
            empleadoDelPin: 'emp-a',
        }));
        expect(r.ok).toBe(true);
        expect(r.modo).toBe('PIN');
    });
});

describe('sin PIN — el negocio que SÍ lo exige', () => {
    it('rechaza y lo dice, en vez de adivinar', () => {
        const r = decidirIdentidadCajero(datos({
            requierePin: true,
            empleadoDelUsuario: 'emp-dueno',
            empleadosActivos: ['emp-dueno'],
        }));
        expect(r.ok).toBe(false);
        expect(r.codigo).toBe('PIN_REQUERIDO');
        expect(r.employeeId).toBeNull();
        // Se murió sin identidad: NO se quedó con el empleado del usuario que
        // venía en los datos. Si el modo dijera 'USUARIO', el rechazo estaría
        // diciendo que igual se supo quién era, y no es cierto.
        expect(r.modo).toBe('SIN_IDENTIDAD');
    });

    it('la exigencia gana incluso con un solo empleado activo', () => {
        // Aunque no haya ambigüedad, si el negocio pidió PIN es porque quiere
        // prueba de presencia, no una deducción.
        const r = decidirIdentidadCajero(datos({
            requierePin: true,
            empleadosActivos: ['emp-unico'],
        }));
        expect(r.ok).toBe(false);
        expect(r.codigo).toBe('PIN_REQUERIDO');
    });
});

describe('sin PIN — el camino sin fricción', () => {
    it('usa el empleado enlazado al usuario del JWT', () => {
        const r = decidirIdentidadCajero(datos({
            empleadoDelUsuario: 'emp-dueno',
            empleadosActivos: ['emp-dueno', 'emp-otro'],
        }));
        expect(r.ok).toBe(true);
        expect(r.employeeId).toBe('emp-dueno');
        expect(r.modo).toBe('USUARIO');
    });

    it('el enlace al usuario gana sobre el único empleado activo', () => {
        const r = decidirIdentidadCajero(datos({
            empleadoDelUsuario: 'emp-dueno',
            empleadosActivos: ['emp-otro'],
        }));
        expect(r.employeeId).toBe('emp-dueno');
        expect(r.modo).toBe('USUARIO');
    });

    it('con UN solo empleado activo se lo atribuye a él', () => {
        const r = decidirIdentidadCajero(datos({ empleadosActivos: ['emp-unico'] }));
        expect(r.ok).toBe(true);
        expect(r.employeeId).toBe('emp-unico');
        expect(r.modo).toBe('UNICO_EMPLEADO');
    });

    it('con DOS empleados activos NO adivina: abre sin identidad', () => {
        // El corazón del cambio. Elegir uno de dos pondría el faltante a nombre
        // de quien quizá ni estaba en el local.
        const r = decidirIdentidadCajero(datos({ empleadosActivos: ['emp-a', 'emp-b'] }));
        expect(r.ok).toBe(true);
        expect(r.employeeId).toBeNull();
        expect(r.modo).toBe('SIN_IDENTIDAD');
    });

    it('sin ningún empleado activo abre igual, sin identidad', () => {
        // Un negocio recién creado que borró su empleado sembrado no puede
        // quedarse sin poder vender.
        const r = decidirIdentidadCajero(datos({ empleadosActivos: [] }));
        expect(r.ok).toBe(true);
        expect(r.employeeId).toBeNull();
        expect(r.modo).toBe('SIN_IDENTIDAD');
    });
});

describe('la apertura nunca se bloquea por falta de identidad', () => {
    it('todo caso sin PIN exigido termina en ok, con o sin empleado', () => {
        const casos: DatosIdentidad[] = [
            datos({ empleadosActivos: [] }),
            datos({ empleadosActivos: ['a'] }),
            datos({ empleadosActivos: ['a', 'b'] }),
            datos({ empleadoDelUsuario: 'u' }),
            datos({ pinDado: '1234', empleadoDelPin: 'p' }),
        ];
        for (const c of casos) {
            expect(decidirIdentidadCajero(c).ok).toBe(true);
        }
    });

    it('los únicos dos rechazos traen código Y mensaje útil', () => {
        const rechazos = [
            decidirIdentidadCajero(datos({ pinDado: '0000', empleadoDelPin: null })),
            decidirIdentidadCajero(datos({ requierePin: true })),
        ];
        for (const r of rechazos) {
            expect(r.ok).toBe(false);
            expect(r.codigo).toBeTruthy();
            expect((r.mensaje ?? '').length).toBeGreaterThan(10);
            expect(r.employeeId).toBeNull();
        }
    });
});

describe('explicarModo', () => {
    it('cada modo tiene una explicación propia y no vacía', () => {
        const modos: ModoIdentidad[] = ['PIN', 'USUARIO', 'UNICO_EMPLEADO', 'SIN_IDENTIDAD'];
        const textos = modos.map(explicarModo);
        // Distintas entre sí: un texto repetido en la auditoría no explica nada.
        expect(new Set(textos).size).toBe(modos.length);
        for (const t of textos) expect(t.length).toBeGreaterThan(10);
    });

    it('el modo sin identidad dice explícitamente que NO hubo cajero', () => {
        // Quien lea la auditoría en seis meses tiene que poder distinguir
        // "no se supo quién" de "fue el dueño".
        expect(explicarModo('SIN_IDENTIDAD')).toContain('Sin identidad');
    });
});
