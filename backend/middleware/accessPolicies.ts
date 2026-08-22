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
export const FISCAL_DGI_ROLES = [
    'OWNER',
    'ADMIN',
    'ACCOUNTANT',
];
