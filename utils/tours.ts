import { driver, type DriveStep } from 'driver.js';
import 'driver.js/dist/driver.css';

/**
 * Tours interactivos (coach-marks) con driver.js.
 *
 * - Inventario: resalta elementos reales de la pantalla (botón Nuevo Producto,
 *   buscador) — coach-marks de verdad.
 * - POS: recorrido paso a paso superpuesto a la caja (popovers centrados), para
 *   no instrumentar el componente gigante del POS.
 *
 * Se disparan desde el Centro de Ayuda y desde el checklist de primeros pasos,
 * navegando a la pantalla con ?tour=pos|inv (maybeAutostartTour los arranca).
 */

const baseOpts = {
  showProgress: true,
  nextBtnText: 'Siguiente',
  prevBtnText: 'Atrás',
  doneBtnText: 'Listo',
  progressText: '{{current}} de {{total}}',
  allowClose: true,
};

export function startInventoryTour() {
  const steps: DriveStep[] = [
    {
      popover: {
        title: '📦 Inventario',
        description:
          'Acá controlás tus productos: cuánto tenés, su precio y su costo. Te muestro lo básico en unos pasos.',
      },
    },
    {
      element: '[data-tour="inv-new"]',
      popover: {
        title: 'Agregá productos',
        description:
          'Con “Nuevo Producto” cargás un artículo (nombre, precio, stock). También podés importar muchos desde Excel.',
        side: 'bottom',
        align: 'start',
      },
    },
    {
      element: '[data-tour="inv-search"]',
      popover: {
        title: 'Buscá rápido',
        description:
          'Filtrá por nombre, SKU o categoría. La lista pagina sola aunque tengas miles de productos.',
        side: 'bottom',
        align: 'start',
      },
    },
    {
      popover: {
        title: '¡Listo!',
        description:
          'Cuando tengas productos podés vender en el POS. El stock baja solo con cada venta.',
      },
    },
  ];
  driver({ ...baseOpts, steps }).drive();
}

export function startPosTour() {
  const steps: DriveStep[] = [
    {
      popover: {
        title: '🛒 Punto de Venta',
        description: 'Esta es tu caja registradora. Te muestro cómo cobrar en 4 pasos.',
      },
    },
    {
      popover: {
        title: '1. Buscá el producto',
        description:
          'Escribí el nombre o escaneá el código de barras: el producto se agrega al carrito. Repetí por cada artículo.',
      },
    },
    {
      popover: {
        title: '2. Elegí el cliente (opcional)',
        description:
          'Si es venta al crédito (fiado), seleccioná el cliente. Debe tener cupo de crédito disponible.',
      },
    },
    {
      popover: {
        title: '3. Cobrá',
        description: 'Elegí Efectivo o Crédito y confirmá. El IVA (15%) se calcula solo.',
      },
    },
    {
      popover: {
        title: '4. Entregá el ticket',
        description:
          'Imprimí el ticket o enviálo por WhatsApp. El inventario y la contabilidad se actualizan solos. ¡Venta lista!',
      },
    },
  ];
  driver({ ...baseOpts, steps }).drive();
}

export function startFiadoTour() {
  const steps: DriveStep[] = [
    {
      popover: {
        title: '📒 Fiado y Cobros',
        description:
          'Acá vive todo lo que te deben. Te muestro cómo cobrar sin perder ni una cuenta.',
      },
    },
    {
      popover: {
        title: '1. Mirá quién te debe',
        description:
          'La lista ordena las deudas por antigüedad: lo más vencido arriba. Eso es lo primero que conviene cobrar — mientras más vieja la deuda, más cuesta recuperarla.',
      },
    },
    {
      popover: {
        title: '2. Usá "Cobrar hoy"',
        description:
          'El filtro "Cobrar hoy" te deja solo lo vencido y lo que vence pronto: tu lista de tareas del día.',
      },
    },
    {
      popover: {
        title: '3. Registrá el abono',
        description:
          'Cuando el cliente paga (todo o una parte), registrá el abono ahí mismo. El saldo se actualiza solo.',
      },
    },
    {
      popover: {
        title: '4. Avisale por WhatsApp',
        description:
          'Podés mandarle al cliente su estado de cuenta por WhatsApp con un botón — recordar amable cobra más que pelear. ¡Eso es todo!',
      },
    },
  ];
  driver({ ...baseOpts, steps }).drive();
}

export function startComprasTour() {
  const steps: DriveStep[] = [
    {
      popover: {
        title: '🚚 Compras',
        description:
          'Acá registrás la mercadería que le comprás a tus proveedores. Te muestro por qué vale la pena hacerlo siempre.',
      },
    },
    {
      popover: {
        title: '1. Registrá cada compra',
        description:
          'Cuando te llega mercadería, registrá la factura del proveedor: qué productos, cuántos y a qué costo.',
      },
    },
    {
      popover: {
        title: '2. El stock sube solo',
        description:
          'Al guardar la compra, el inventario se actualiza solo y el costo de tus productos se recalcula (promedio ponderado). Nada de contar a mano.',
      },
    },
    {
      popover: {
        title: '3. Tu ganancia sale bien',
        description:
          'Con el costo real registrado, el sistema te dice cuánto ganás de verdad en cada venta. Comprar sin registrar = ganancia a ciegas.',
      },
    },
  ];
  driver({ ...baseOpts, steps }).drive();
}

const TOURS: Record<string, () => void> = {
  pos: startPosTour,
  inv: startInventoryTour,
  fiado: startFiadoTour,
  compras: startComprasTour,
};

/**
 * Si la URL trae ?tour=pos|inv arranca el tour correspondiente y limpia el
 * parámetro para que no se repita al re-renderizar. Lo llaman POS e Inventory
 * al montar. El pequeño retraso da tiempo a que la pantalla pinte sus elementos.
 */
export function maybeAutostartTour() {
  try {
    const tour = new URLSearchParams(window.location.search).get('tour');
    const run = tour ? TOURS[tour] : undefined;
    if (!run) return;
    window.history.replaceState({}, '', window.location.pathname);
    setTimeout(run, 400);
  } catch {
    /* el tutorial nunca debe romper la pantalla */
  }
}
