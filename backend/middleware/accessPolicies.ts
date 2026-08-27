/**
 * Matriz de minimo privilegio para los flujos operativos que comparten POS,
 * pedidos y cotizaciones. `checkRole` conserva el bypass de OWNER, ADMIN y
 * SUPER_ADMIN; aun asi se incluyen aqui para que la politica sea legible y
 * testeable sin depender de ese detalle del middleware.
 */

export const POS_SALE_ROLES = [
    'OWNER',
    'ADMIN',
    'SUPER_ADMIN',
    'MANAGER',
    'CASHIER',
    'EMPLOYEE',
    'VENDEDOR',
];

/** Lookup básico de clientes en POS; EMPLOYEE lo necesita para facturar. */
export const CUSTOMER_READ_ROLES = [
    'OWNER',
    'ADMIN',
    'SUPER_ADMIN',
    'MANAGER',
    'CASHIER',
    'VIEWER',
    'EMPLOYEE',
    'VENDEDOR',
    'ACCOUNTANT',
];

/** Hub, cartera y cobranza: refleja los roles con `customers:read`. */
export const CUSTOMER_HUB_READ_ROLES = [
    'OWNER',
    'ADMIN',
    'SUPER_ADMIN',
    'MANAGER',
    'CASHIER',
    'VIEWER',
    'VENDEDOR',
    'ACCOUNTANT',
];

/** Alta de clientes desde POS/CRM; VIEWER nunca muta. */
export const CUSTOMER_CREATE_ROLES = [
    'OWNER',
    'ADMIN',
    'SUPER_ADMIN',
    'MANAGER',
    'CASHIER',
    'EMPLOYEE',
    'VENDEDOR',
];

/** Identidad legal del cliente: solo administración puede cambiar nombre o documento. */
export const CUSTOMER_IDENTITY_UPDATE_ROLES = [
    'OWNER',
    'ADMIN',
    'SUPER_ADMIN',
];

/** Edición de contacto; VENDEDOR queda limitado a su propia cartera. */
export const CUSTOMER_CONTACT_UPDATE_ROLES = [
    'OWNER',
    'ADMIN',
    'SUPER_ADMIN',
    'MANAGER',
    'VENDEDOR',
];

/** Bloqueo, cupo, mayoreo y asignación son controles administrativos. */
export const CUSTOMER_CONTROL_ROLES = [
    'OWNER',
    'ADMIN',
    'SUPER_ADMIN',
];

/** Entrada al PUT; la autorización fina por grupo se aplica después. */
export const CUSTOMER_UPDATE_ROLES = [
    'OWNER',
    'ADMIN',
    'SUPER_ADMIN',
    'MANAGER',
    'VENDEDOR',
];

export type CustomerCreateIntent = {
    financialControls: boolean;
    sellerAssignment: boolean;
};

/**
 * El alta operativa admite la ficha básica. Cupo/mayoreo y asignación manual
 * requieren administración; VENDEDOR es la única excepción de cartera porque
 * el servidor ignora el destino solicitado y lo fuerza al usuario autenticado.
 */
export function isCustomerCreateAuthorized(
    role: string | undefined,
    intent: CustomerCreateIntent,
): boolean {
    const currentRole = role || '';
    const canManageControls = CUSTOMER_CONTROL_ROLES.includes(currentRole);
    return (!intent.financialControls || canManageControls)
        && (!intent.sellerAssignment || currentRole === 'VENDEDOR' || canManageControls);
}

export function resolveCustomerSellerIdForCreate(
    role: string | undefined,
    userId: string,
    requestedSellerId: string | null | undefined,
): string | null | undefined {
    if (role === 'VENDEDOR') return userId;
    if (CUSTOMER_CONTROL_ROLES.includes(role || '')) return requestedSellerId;
    return undefined;
}

export type CustomerUpdateIntent = {
    identity: boolean;
    contact: boolean;
    controls: boolean;
};

/**
 * Autoriza el payload completo antes de abrir la transacción. Si un solo grupo
 * no está permitido, se rechaza todo el cambio para evitar actualizaciones
 * parciales de contacto, identidad legal o controles financieros.
 */
export function isCustomerUpdateAuthorized(
    role: string | undefined,
    intent: CustomerUpdateIntent,
): boolean {
    const currentRole = role || '';
    return (!intent.identity || CUSTOMER_IDENTITY_UPDATE_ROLES.includes(currentRole))
        && (!intent.contact || CUSTOMER_CONTACT_UPDATE_ROLES.includes(currentRole))
        && (!intent.controls || CUSTOMER_CONTROL_ROLES.includes(currentRole));
}

/** Registrar gestiones y promesas en la cartera propia o global. */
export const CUSTOMER_INTERACTION_WRITE_ROLES = [
    'OWNER',
    'ADMIN',
    'SUPER_ADMIN',
    'MANAGER',
    'CASHIER',
    'VENDEDOR',
];

/** Registrar abonos: excluye explícitamente VIEWER/EMPLOYEE/BODEGUERO. */
export const CUSTOMER_PAYMENT_ROLES = [
    'OWNER',
    'ADMIN',
    'SUPER_ADMIN',
    'MANAGER',
    'CASHIER',
    'VENDEDOR',
];

/**
 * Lectura de estados financieros, libros, cierres y reportes de antigüedad.
 *
 * Estos endpoints exponen saldos de todo el negocio, por lo que no heredan
 * los roles operativos de POS/CRM. SUPER_ADMIN se declara explícitamente para
 * que la política sea legible aunque `checkRole` también preserve su bypass.
 */
export const ACCOUNTING_READ_ROLES = [
    'OWNER',
    'ADMIN',
    'SUPER_ADMIN',
    'ACCOUNTANT',
];

/** Lectura operativa de pedidos; VIEWER puede observar, nunca mutar. */
export const PEDIDO_READ_ROLES = [
    'OWNER',
    'ADMIN',
    'SUPER_ADMIN',
    'MANAGER',
    'CASHIER',
    'VIEWER',
];

/** Preparar, despachar, cancelar y asignar un pedido existente. */
export const PEDIDO_WRITE_ROLES = [
    'OWNER',
    'ADMIN',
    'SUPER_ADMIN',
    'MANAGER',
    'CASHIER',
];

/** La busqueda expone datos de venta/deuda y comparte el rol de POST returns. */
export const RETURN_SEARCH_ROLES = [
    'OWNER',
    'ADMIN',
    'SUPER_ADMIN',
];

/** VIEWER puede consultar proformas y pedidos web, pero no convertir/crear. */
export const QUOTATION_READ_ROLES = [
    'OWNER',
    'ADMIN',
    'SUPER_ADMIN',
    'MANAGER',
    'CASHIER',
    'VIEWER',
];

/** Crear proformas y convertir pedidos web es una operacion de venta. */
export const QUOTATION_WRITE_ROLES = [
    'OWNER',
    'ADMIN',
    'SUPER_ADMIN',
    'MANAGER',
    'CASHIER',
];

/** Reportes y exportaciones fiscales que el contador prepara para DGI. */
export const FISCAL_DGI_ROLES = ACCOUNTING_READ_ROLES;
