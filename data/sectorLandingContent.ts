export type SectorKey = 'farmacia' | 'ferreteria';

export const sectorLandingContent = {
  farmacia: {
    key: 'farmacia',
    path: '/farmacias',
    title: 'Software para farmacias en Nicaragua | Lotes y vencimientos | Nortex',
    description: 'Registrá lotes, revisá avisos de vencimiento y consultá el movimiento de inventario. Conocé el flujo de farmacia en Nortex.',
    hero: 'Controlá lotes y vencimientos en tu farmacia con Nortex',
    intro: 'Registrá lotes con fecha, revisá avisos y consultá el movimiento de inventario. La salida por FEFO depende de la configuración de lotes de tu negocio.',
    journeyTitle: 'Software para farmacias en Nicaragua: del lote a la venta',
    steps: [
      { title: 'Registrá el lote', body: 'En Inventario, activá el control por lotes y registrá número, fecha y cantidad.' },
      { title: 'Revisá los avisos', body: 'Avisos separa lotes con existencia próximos a vencer en 30 días de los ya vencidos. Usa el día civil de Managua.' },
      { title: 'Vendé y consultá Kardex', body: 'Con control por lotes configurado, la venta toma lotes vigentes por FEFO y registra la salida. Revisá el lote físico antes de entregar.' },
    ],
    example: 'Ejemplo sintético: lote A, 10 unidades, vence el 15/10/2026; lote B, 8 unidades, vence el 15/12/2026. Si ambos están vigentes y tienen saldo, FEFO prioriza A. No son existencias reales.',
    limit: 'El aviso informa; el encargado decide cómo retirar o ajustar un lote vencido. Este ejemplo no consulta el inventario de quien visita la página.',
    guides: [
      { to: '/blog/como-controlar-vencimientos-farmacia-fefo', label: 'Guía para controlar vencimientos con FEFO' },
      { to: '/blog/como-administrar-una-farmacia-nicaragua', label: 'Guía para administrar una farmacia' },
    ],
    cta: 'Crear cuenta para mi farmacia',
  },
  ferreteria: {
    key: 'ferreteria',
    path: '/ferreterias',
    title: 'Software para ferreterías en Nicaragua | POS e inventario | Nortex',
    description: 'Encontrá productos en el POS, confirmá ventas y consultá inventario y cuentas por cobrar en tu ferretería. Conocé el recorrido y creá tu cuenta.',
    hero: 'Vendé y controlá el inventario de tu ferretería con Nortex',
    intro: 'Encontrá un producto por nombre o código, prepará la venta y consultá el inventario cuando quede confirmada.',
    journeyTitle: 'Software para ferreterías en Nicaragua: mostrador e inventario',
    steps: [
      { title: 'Mostrador → venta', body: 'Buscá un producto, agregalo al carrito y confirmá la venta desde el POS con turno abierto y permisos.' },
      { title: 'Venta → inventario', body: 'La venta confirmada actualiza existencias y Kardex. Una venta sin conexión queda pendiente hasta que se confirme la sincronización.' },
      { title: 'Cliente → crédito → saldo', body: 'Elegí un cliente, usá el flujo de crédito autorizado y consultá su cuenta por cobrar antes de registrar un abono.' },
    ],
    example: 'Ejemplo sintético: buscás «codo PVC», agregás 2 unidades, confirmás la venta y consultás existencias y Kardex. Por separado, elegís un cliente y revisás su saldo.',
    limit: 'Para empezar, creá tu cuenta, cargá un producto y abrí turno. Importar desde Excel valida cada fila; la existencia de un producto ya creado se corrige desde inventario. El crédito requiere cliente y permisos.',
    guides: [
      { to: '/blog/como-administrar-una-ferreteria-nicaragua', label: 'Guía para administrar una ferretería' },
      { to: '/blog/control-de-inventario-kardex-nicaragua', label: 'Cómo leer el Kardex' },
      { to: '/blog/gestion-de-cobranza-cuentas-por-cobrar', label: 'Guía de cuentas por cobrar' },
    ],
    cta: 'Crear cuenta para mi ferretería',
    demo: '/demo?source=landing_ferreteria',
  },
} as const;
