export interface LearningStep { title: string; instruction: string; target?: string }
export interface LearningGuide { title: string; path: string; steps: LearningStep[] }
export const learningGuides: Record<string, LearningGuide> = {
  inv: { title: 'Tu primer producto', path: '/app/inventory', steps: [
    { title: 'Primero, buscá si ya existe', instruction: 'Buscá por nombre, marca o código. Si ya está en el catálogo, abrí su ficha; no lo creés otra vez.', target: '[aria-label="Buscar productos"]' },
    { title: 'Agregá solo lo que falta', instruction: 'Usá Agregar con cámara para leer el código y, si faltan datos, una foto del empaque. También podés usar Nuevo producto. Revisá nombre, marca, presentación y precio antes de guardar.', target: '[data-learning="product-create"]' },
    { title: 'Producto y existencias son cosas distintas', instruction: 'El alta con cámara crea la ficha con existencia cero. Para ingresar mercadería, registrá su recepción con cantidad, costo y bodega. Si requiere lotes, registrá también el vencimiento.' },
    { title: 'Comprobá el resultado', instruction: 'Buscá el producto guardado y revisá su ficha. El tutorial no crea productos por vos ni acredita existencias por haber leído estos pasos.', target: '[aria-label="Buscar productos"]' },
  ] },
  pos: { title: 'Cobrá una venta', path: '/app/pos', steps: [
    { title: 'Prepará tu caja', instruction: 'Si aparece Abrir caja, ingresá el efectivo real con el que empezás. Para ensayar sin movimientos, usá Practicar una venta desde Ayuda.' },
    { title: 'Elegí lo que lleva el cliente', instruction: 'Buscá o escaneá un producto disponible y agregalo al carrito. Revisá la cantidad y el precio. Un producto sin existencias necesita una entrada real.', target: '#pos-catalog-search' },
    { title: 'Revisá antes de cobrar', instruction: 'Comprobá artículos y total del carrito. Abrí Cobrar, elegí el medio de pago e ingresá lo recibido. No necesitás crear un cliente para una venta normal al contado.' },
    { title: 'Confirmación, no solo clic', instruction: 'Confirmá únicamente una venta real. Esperá el resultado y revisá el ticket. Si quedó pendiente de sincronización, todavía no está confirmada; no la repitas con otro intento.' },
  ] },
  compras: { title: 'Recibí mercadería', path: '/app/purchases', steps: [
    { title: 'Identificá el documento', instruction: 'Prepará la factura y verificá proveedor, número y bodega. Si viene de una orden de compra ya recibida, facturala desde ese flujo para no ingresar stock dos veces.' },
    { title: 'Agregá los productos recibidos', instruction: 'Buscá o escaneá cada artículo. Si todavía no existe, podés crear su ficha con cámara y volver a esta recepción.', target: '[aria-label="Agregar producto a la recepción"]' },
    { title: 'Copiá cantidades y costos reales', instruction: 'Revisá la unidad, la cantidad recibida y el costo de la factura. Precio de venta y costo de compra son distintos. Completá lotes o series cuando corresponda.' },
    { title: 'Revisá y confirmá una sola vez', instruction: 'Comprobá totales, impuestos y forma de pago en la revisión. Confirmá solo la recepción real y esperá su comprobante. Leer esta guía no registra la compra.' },
  ] },
  fiado: { title: 'Registrá un abono', path: '/app/receivables', steps: [
    { title: 'Encontrá la deuda correcta', instruction: 'Revisá el cliente y su saldo. Cobrar hoy ayuda a encontrar cuentas vencidas o próximas a vencer.', target: '[data-learning="receivables-today"]' },
    { title: 'Abrí la cuenta del cliente', instruction: 'Elegí la cuenta y revisá sus movimientos antes de tocar Registrar abono. Si no hay deuda, no hace falta inventar una para aprender.' },
    { title: 'Registrá solo lo recibido', instruction: 'Ingresá el importe efectivamente pagado y el medio de pago. Revisá antes de confirmar; la guía no confirma pagos por vos.' },
    { title: 'Verificá saldo y recibo', instruction: 'Después de la confirmación, comprobá el nuevo saldo y el recibo. Si no recibiste confirmación, revisá el resultado antes de repetir el abono.' },
  ] },
};

export function guideAt(id: string | null, path: string): string | null {
  return id && Object.hasOwn(learningGuides, id) && learningGuides[id].path === path ? id : null;
}
