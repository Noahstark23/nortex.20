/**
 * Identidad del cajero al abrir la caja — reglas PURAS (sin Prisma, sin Express).
 *
 * EL PROBLEMA QUE RESUELVE: abrir la caja pedía SIEMPRE un PIN de 4 dígitos, y
 * el muro no caía al entrar a la app sino al apretar "Cobrar" por primera vez
 * —o sea, a medio cobro, con el cliente enfrente—. Para el dueño de una
 * pulpería era puro trámite: la propia pantalla imprimía el PIN inicial y
 * además lo precargaba. Un secreto que la pantalla revela y rellena no es un
 * control de acceso.
 *
 * QUÉ APORTABA EL PIN DE VERDAD (menos de lo que parece): la atribución de la
 * VENTA no depende de él —`Sale.soldById` sale de `req.userId` (el JWT)—. Lo
 * único que aporta es distinguir cajeros cuando VARIOS COMPARTEN UN MISMO
 * LOGIN. Si cada quien entra con su usuario, `Shift.userId` ya lo resuelve.
 *
 * POR QUÉ IGUAL NO SE BORRA: el `Shift.difference` del arqueo es el número que
 * acusa a alguien de un faltante. En una tienda con tres cajeros sobre una sola
 * cuenta, sin PIN ese número queda sin dueño. Por eso el PIN sigue disponible y
 * se puede EXIGIR por negocio (`Tenant.requireCashierPin`), pero apagado por
 * defecto — que es como debió empezar.
 *
 * REGLA DURA: cuando no se puede determinar quién es el cajero, la apertura NO
 * se inventa una identidad. Deja `employeeId` en null (el schema ya lo permite)
 * y el modo queda registrado en la auditoría. Adivinar un empleado sería peor
 * que no tener ninguno: pondría el faltante a nombre de quien no estaba.
 */

/** Cómo se determinó quién tiene la gaveta. Viaja al AuditLog. */
export type ModoIdentidad =
    /** El cajero tecleó su PIN. Es el único modo que prueba presencia. */
    | 'PIN'
    /** El usuario del JWT tiene un Employee enlazado (Employee.userId). */
    | 'USUARIO'
    /** El negocio tiene UN SOLO empleado activo: no hay ambigüedad posible. */
    | 'UNICO_EMPLEADO'
    /** Varios empleados y ninguna pista. La caja se abre a nombre del usuario. */
    | 'SIN_IDENTIDAD';

export interface DatosIdentidad {
    /** ¿El negocio exige PIN? (`Tenant.requireCashierPin`) */
    requierePin: boolean;
    /** PIN recibido, ya normalizado. Cadena vacía o null = no vino. */
    pinDado: string | null;
    /** Empleado que coincide con el PIN, si se buscó y se encontró. */
    empleadoDelPin: string | null;
    /** Empleado enlazado al usuario del JWT (`Employee.userId`). */
    empleadoDelUsuario: string | null;
    /**
     * Empleados ACTIVOS del negocio, tope 2: solo interesa distinguir
     * "exactamente uno" de "más de uno". Traer la lista entera sería un
     * findMany sin límite sobre una tabla que crece con el negocio.
     */
    empleadosActivos: string[];
}

export type CodigoRechazoApertura = 'PIN_REQUERIDO' | 'PIN_INCORRECTO';

export interface IdentidadResuelta {
    ok: boolean;
    /** Empleado al que se le atribuye la gaveta. `null` es un valor VÁLIDO. */
    employeeId: string | null;
    modo: ModoIdentidad;
    codigo?: CodigoRechazoApertura;
    mensaje?: string;
}

/** Un PIN de puros espacios no es un PIN. */
export function pinNormalizado(pin: unknown): string | null {
    if (pin === null || pin === undefined) return null;
    const limpio = String(pin).trim();
    return limpio.length > 0 ? limpio : null;
}

/**
 * ¿Quién abre esta caja?
 *
 * El orden importa: el PIN gana siempre que venga, porque es el único modo que
 * prueba que la persona estaba ahí. Recién si no vino se cae a las pistas
 * automáticas, y solo cuando el negocio no exige PIN.
 */
export function decidirIdentidadCajero(datos: DatosIdentidad): IdentidadResuelta {
    // 1. Vino PIN → manda el PIN, exija o no el negocio. Que alguien se tome el
    //    trabajo de teclearlo no puede terminar en una atribución distinta.
    if (datos.pinDado !== null) {
        if (datos.empleadoDelPin === null) {
            return {
                ok: false,
                employeeId: null,
                modo: 'PIN',
                codigo: 'PIN_INCORRECTO',
                mensaje: 'PIN incorrecto. No se encontró ningún empleado con ese PIN.',
            };
        }
        return { ok: true, employeeId: datos.empleadoDelPin, modo: 'PIN' };
    }

    // 2. No vino PIN y el negocio lo exige → se pide, no se adivina. Este es el
    //    caso de la tienda con varios cajeros sobre una sola cuenta: ahí el PIN
    //    es lo único que le pone nombre a un faltante.
    if (datos.requierePin) {
        return {
            ok: false,
            employeeId: null,
            modo: 'SIN_IDENTIDAD',
            codigo: 'PIN_REQUERIDO',
            mensaje: 'Este negocio pide PIN para abrir la caja. Ingresá el tuyo.',
        };
    }

    // 3. El usuario del JWT tiene su Employee enlazado. Es la pista más fuerte
    //    que existe sin teclear nada: el registro ya lo enlaza al crear el
    //    negocio, así que el dueño entra por acá y nunca ve un PIN.
    if (datos.empleadoDelUsuario !== null) {
        return { ok: true, employeeId: datos.empleadoDelUsuario, modo: 'USUARIO' };
    }

    // 4. Un solo empleado activo: no hay a quién más atribuirle la gaveta.
    if (datos.empleadosActivos.length === 1) {
        return { ok: true, employeeId: datos.empleadosActivos[0], modo: 'UNICO_EMPLEADO' };
    }

    // 5. Varios empleados y ninguna pista. La caja se abre igual —bloquearla
    //    sería devolver la fricción que este cambio vino a sacar— pero SIN
    //    inventar un cajero. El turno queda a nombre del usuario del JWT, que
    //    es un dato real, y la auditoría deja dicho que no hubo identidad de
    //    gaveta. Si al negocio le importa, prende `requireCashierPin`.
    return { ok: true, employeeId: null, modo: 'SIN_IDENTIDAD' };
}

/** Texto para el AuditLog: por qué la gaveta quedó a nombre de quien quedó. */
export function explicarModo(modo: ModoIdentidad): string {
    switch (modo) {
        case 'PIN':
            return 'El cajero tecleó su PIN.';
        case 'USUARIO':
            return 'Empleado enlazado al usuario que abrió la caja.';
        case 'UNICO_EMPLEADO':
            return 'Único empleado activo del negocio.';
        case 'SIN_IDENTIDAD':
            return 'Sin identidad de cajero: la caja quedó a nombre del usuario.';
    }
}
