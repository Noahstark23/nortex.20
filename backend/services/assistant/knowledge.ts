import type { AssistantCitation } from '../../../shared/assistant.js';
import { POS_SALE_ROLES, PURCHASE_READ_ROLES, ACCOUNTING_READ_ROLES, SUPPLIER_RETURN_WRITE_ROLES } from '../../middleware/accessPolicies.js';
import { ASSISTANT_KNOWN_ROLES, ASSISTANT_INVENTORY_ROLES } from './access.js';

interface HelpArticle {
    citation: AssistantCitation;
    roles: readonly string[];
    keywords: string;
    answer: string;
}

const article = (id: string, section: string, roles: readonly string[], keywords: string, answer: string, version = '2026-09-05.1'): HelpArticle => ({
    citation: { id, title: 'Ayuda de Nortex', section, version, path: `nortex-help:${id}` },
    roles, keywords, answer,
});

/** Ayuda de producto explícita y revisable. Nunca indexa el repositorio ni documentos privados. */
export const ASSISTANT_HELP_ARTICLES: readonly HelpArticle[] = [
    article('asistente', 'Qué puede hacer NortexGPT', ASSISTANT_KNOWN_ROLES,
        'nortexgpt asistente ayuda funciones permisos empezar hola',
        'Podés consultar información permitida para tu rol y pedir ayuda para usar Nortex. Las consultas muestran su período y procedencia. Una propuesta de compra no cambia inventario ni dinero: primero tenés que revisarla y confirmarla.'),
    article('ventas', 'Vender y cobrar', POS_SALE_ROLES,
        'vender venta ventas cobrar cobro caja carrito lector pago vuelto',
        'En Punto de venta, agregá los productos al carrito y revisá cantidades y total. Elegí el medio de pago y comprobá el recibido y el vuelto antes de registrar. Conservá el comprobante; cerrar una ventana no demuestra que la venta quedó registrada.'),
    article('offline', 'Ventas pendientes de sincronización', POS_SALE_ROLES,
        'offline internet conexion pendiente sincronizar sincronizacion avisos cola',
        'Una venta guardada en el dispositivo sigue pendiente hasta que Nortex confirme su registro. Consultá Avisos y usá el reintento disponible. Conservá la venta original: no la cobrés de nuevo ni la recreés para resolver una duda de sincronización.'),
    article('compras', 'Revisar una factura de compra', PURCHASE_READ_ROLES,
        'compra compras factura proveedor recibida recepcion mercaderia credito contado impuestos',
        'Revisá proveedor, número de factura, fecha, productos, cantidades, unidades, costos e impuestos. Confirmá por separado si recibiste la mercadería y si pagaste. Si la factura corresponde a una recepción de orden de compra, vinculá esa recepción para evitar ingresar existencias otra vez. Registrar requiere un rol autorizado de compras.'),
    article('lotes', 'Lotes y vencimientos', ASSISTANT_INVENTORY_ROLES,
        'lote lotes vencimiento vencimientos farmacia fecha vencida vencido inventario existencias stock',
        'Para productos con seguimiento por lote, comprobá el número de lote y el vencimiento antes de recibir. Los vencimientos se interpretan como días del catálogo tomando el día vigente en Managua. El stock físico puede incluir unidades retenidas o vencidas: no lo confundás con disponibilidad para vender.'),
    article('contabilidad', 'Leer los resultados del negocio', ACCOUNTING_READ_ROLES,
        'utilidad ganancia ganancias balance contabilidad ingresos egresos gastos deuda cuentas',
        'Las ventas registradas no equivalen a utilidad ni a dinero recibido. Revisá por separado devoluciones, gastos y saldos por cobrar y pagar. Una cifra sin respaldo suficiente debe aparecer como no disponible; compará el período y la fecha de consulta antes de tomar decisiones.'),
    article('reposicion', 'Preparar reposición', ASSISTANT_INVENTORY_ROLES,
        'reposicion reponer consumo cobertura faltante agotamiento orden pendiente',
        'La cobertura es una estimación basada en salidas verificadas de los últimos 30 días completos. Revisá existencias vendibles, unidades, mínimos y entradas pendientes. Con pocos datos no se puede prometer una fecha exacta de agotamiento. Una orden preparada queda en borrador: todavía requiere aprobación y envío; no agrega existencias ni deuda.', '2026-09-05.2'),
    article('salida-proveedor', 'Devolver físicamente al proveedor', SUPPLIER_RETURN_WRITE_ROLES,
        'devolver devolucion proveedor salida fisica remitir retiro',
        'Seleccioná el proveedor y la línea de compra o recepción original, revisá producto, lote, bodega y cantidad. Confirmá expresamente que corresponde registrar la salida física. El comprobante de devolución no reduce por sí solo la cuenta por pagar; una nota de crédito del proveedor se concilia por separado.', '2026-09-05.2'),
    article('merma', 'Registrar una baja de lote', ['OWNER','ADMIN','SUPER_ADMIN'],
        'merma baja perdida deterioro destruccion retiro vencido',
        'Una fecha vencida no demuestra que las unidades fueron retiradas físicamente. Revisá lote, bodega, cantidad y motivo; la vista de confirmación muestra la salida y su valor. Confirmar registra inventario, asiento, auditoría y comprobante juntos. Si cambian los datos después de revisar, actualizá la propuesta.', '2026-09-05.2'),
    article('promociones', 'Revisar precios promocionales al cobrar', POS_SALE_ROLES,
        'promocion promociones descuento temporal vigencia detalle mayoreo pack',
        'Cuando el negocio habilita promociones, los precios se revisan con conexión antes del cobro. Cada promoción tiene productos y fechas explícitas en Managua; cubre todos los lotes vendibles de esos productos. No se acumula con descuento manual de su línea ni global del ticket. Si cambia el total, revisalo y aceptalo antes de cobrar. Ante una respuesta incierta, conservá la referencia y comprobá el registro.', '2026-09-05.2'),
    article('comparacion', 'Comparar períodos y explicar resultados', [...ACCOUNTING_READ_ROLES,'MANAGER',...POS_SALE_ROLES],
        'comparar comparacion variacion disminucion aumento causa hipotesis corte periodo',
        'Una consulta diaria compara por defecto con el mismo día de la semana anterior hasta la misma hora de Managua. Varios días se comparan con una ventana anterior equivalente. Separá hechos, estimaciones e hipótesis: una variación no demuestra su causa. Cada rol ve sólo sus cifras autorizadas.', '2026-09-05.2'),
    article('canal-privado', 'Vincular WhatsApp privado', ASSISTANT_KNOWN_ROLES,
        'whatsapp privado vincular desvincular codigo equipo telefono',
        'Si el negocio habilita el canal privado, iniciá la vinculación desde tu sesión de Nortex con un código de un solo uso. Podés consultar y preparar trabajo según tu rol. La confirmación abre la propuesta exacta en Nortex y requiere tu sesión autenticada. Desvincular revoca el acceso de ese teléfono; es un canal separado del que atiende a clientes.', '2026-09-05.2'),
];

export function normalizeAssistantText(text: string): string {
    return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

const stopWords = new Set(['como', 'para', 'puedo', 'quiero', 'donde', 'esto', 'esta', 'hacer', 'tengo', 'ayuda', 'sobre', 'una', 'uno', 'los', 'las', 'del', 'con', 'sus', 'mis', 'que']);
export function retrieveAssistantHelp(query: string, role: string): { text: string; citations: AssistantCitation[] } {
    const tokens = [...new Set(normalizeAssistantText(query).match(/[a-z0-9]{3,}/g) || [])]
        .filter(token => !stopWords.has(token)).slice(0, 40);
    const ranked = ASSISTANT_HELP_ARTICLES.filter(entry => entry.roles.includes(role)).map(entry => {
        const words = new Set(normalizeAssistantText(`${entry.citation.section} ${entry.keywords}`).split(/\s+/));
        return { entry, score: tokens.reduce((sum, token) => sum + (words.has(token) ? 1 : 0), 0) };
    }).filter(item => item.score > 0).sort((a, b) => b.score - a.score || a.entry.citation.id.localeCompare(b.entry.citation.id)).slice(0, 2);
    if (!ranked.length) return {
        text: 'No encontré una respuesta en la ayuda revisada disponible para tu rol. Podés consultar sobre NortexGPT o pedir ayuda de una función que tengas habilitada.',
        citations: [],
    };
    return { text: ranked.map(({ entry }) => entry.answer).join('\n\n'), citations: ranked.map(({ entry }) => entry.citation) };
}
