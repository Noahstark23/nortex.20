
export type SaleMode = 'COUNTED' | 'MEASURED';
export type MeasurementSource = 'MANUAL' | 'SCALE_LABEL' | 'LIVE_SCALE';
export type MeasurementPricePolicy = 'RECALCULATE' | 'REQUIRE_MATCH' | 'ACCEPT_LABEL_TOTAL';

export interface Product {
  id: string;
  name: string;
  price: number;
  costPrice: number; // NUEVO: Para calcular utilidad real
  stock: number;
  sku: string;
  category: string;
  // Foto del producto (opcional). El schema ya la tiene (`Product.imageUrl`);
  // el tipo compartido no la exponía, así que el POS no podía mostrar
  // miniatura en la grilla y quedaba un hueco donde nunca iba a haber imagen.
  imageUrl?: string | null;
  requiresBatchTracking?: boolean; // Control de lotes
  // Venta por mayor (distribuidora/miscelánea)
  wholesalePrice?: number | null;  // precio de mayoreo (null = sin mayoreo)
  wholesaleMinQty?: number | null; // cantidad mínima a partir de la cual aplica
  // Unidad de empaque (caja/fardo): atajo de cantidad + tercer nivel de precio
  packUnit?: string | null;  // nombre del empaque (caja, fardo, docena)
  packSize?: number | null;  // unidades base por empaque (ej: 12)
  packPrice?: number | null; // precio del empaque completo (null = solo atajo)
  /** Unidad base que se descuenta del inventario y se factura. */
  unit?: string | null;
  saleMode?: SaleMode | null;
  quantityStep?: number | null;
  productFamily?: string | null;
}

export interface ProductBatch {
  id: string;
  productId: string;
  batchNumber: string;
  expiryDate: string;
  stock: number;
}

export interface CartItem extends Product {
  quantity: number;
  /** Referencia opaca a la línea de cotización autoritativa. */
  quotationItemId?: string;
  /** Snapshots decimales enviados por el serializer de cotizaciones. */
  quantityExact?: string | null;
  unitPriceExact?: string | null;
  presentationAtQuote?: 'BASE' | 'PACK';
  ivaExento?: boolean;
  batchNumber?: string;
  expiryDate?: string;
  cartLineId?: string;
  /** Presentación que vio el cajero; quantity siempre queda en unidad base. */
  presentation?: {
    quantity: string;
    unit: string;
  };
  /**
   * Evidencia de captura. Para SCALE_LABEL el código crudo solo vive en el
   * carrito/venta pendiente: el servidor lo reparsea y la cola se elimina al
   * sincronizar. Nunca es autoridad de producto, cantidad ni precio.
   */
  measurement?: {
    source: MeasurementSource;
    clientEventId: string;
    capturedAt: string;
    rawCode?: string;
    profileVersionId?: string;
    previewBaseQuantity?: string;
    sourceValue?: string;
    sourceUnit?: string;
    encodedPrice?: string;
    pricingPolicy?: MeasurementPricePolicy;
    managerOverride?: boolean;
    deviceId?: string;
    stable?: boolean;
  };
  // Campos legacy de la primera exploración. Se leen para no romper carritos
  // ya guardados; todo dato nuevo usa `presentation` + `measurement`.
  displayQuantity?: number;
  displayUnit?: string;
  measurementSource?: MeasurementSource;
  measurementCode?: string;
  scaleProfileVersionId?: string;
  scalePlu?: string;
  measuredValue?: number;
  measuredUnit?: string;
  measurementPricePolicy?: MeasurementPricePolicy;
}

export interface Tenant {
  id: string;
  name: string;
  type: 'FERRETERIA' | 'FARMACIA' | 'RETAIL' | 'PULPERIA' | 'BOUTIQUE';
  creditScore: number | null; // null = sin datos suficientes (tenant sin historial)
  creditLimit: number;
  walletBalance: number;
  // 'TRIAL' (no 'TRIALING'): es el valor que usan la BD (schema.prisma), el
  // backend, auth.ts, Billing y SuperAdmin. El type decía 'TRIALING' y por eso
  // el banner de prueba del Dashboard nunca matcheaba el estado real.
  subscriptionStatus: 'TRIAL' | 'ACTIVE' | 'PAST_DUE' | 'CANCELLED';
  plan: string;
  trialEndsAt: string; 
}

export interface Shift {
  id: string;
  userId: string;
  tenantId: string;
  startTime: string;
  endTime?: string;
  initialCash: number;
  finalCashDeclared?: number;
  systemExpectedCash?: number;
  difference?: number; // declared - expected
  status: 'OPEN' | 'CLOSED';
  // Empleado/cajero asignado al abrir turno (via PIN). Opcional: turnos
  // legacy o abiertos por el dueño pueden no tenerlo.
  employeeId?: string;
  employee?: {
    id?: string;
    firstName: string;
    lastName: string;
    role: string;
  };
  // Traspaso de caja: el backend devuelve el turno abierto de la caja aunque lo
  // haya abierto otra persona (antes devolvía null y el POS mostraba C$0.00 con
  // plata real en la gaveta). Con `esTurnoPropio: false` se ve el efectivo pero
  // NO se puede cobrar: primero hay que tomar la caja, para que el arqueo tenga
  // un responsable único.
  esTurnoPropio?: boolean;
  turnoDe?: string | null;
}

export interface CashMovement {
  id: string;
  tenantId: string;
  shiftId: string;
  userId: string;
  type: 'IN' | 'OUT';
  amount: number;
  currency: string;
  category: string;
  description: string;
  isVoided: boolean;
  createdAt: string;
}

export interface AuditLog {
  id: string;
  action: 'DELETE_SALE' | 'ADJUST_STOCK' | 'CLOSE_SHIFT' | 'OPEN_SHIFT' | 'THEFT_ALERT' | 'SURPLUS_ALERT';
  details: string;
  userId: string;
  timestamp: string;
}

export interface Payment {
  id: string;
  amount: number;
  date: string;
  method: 'CASH' | 'TRANSFER';
}

export interface Sale {
  id: string;
  total: number;
  date: string;
  items: number;
  status: 'COMPLETED' | 'CREDIT_PENDING' | 'PAID';
  paymentMethod: 'CASH' | 'CARD' | 'QR' | 'CREDIT';
  customerName?: string;
  balance: number; 
  dueDate?: string;
  payments?: Payment[];
  shiftId?: string; // Link to Shift
  employeeId?: string; // NUEVO: Para comisiones
}

export interface Loan {
  id: string;
  amount: number;
  interest: number;
  totalDue: number;
  status: 'ACTIVE' | 'PAID' | 'DEFAULT';
  dueDate: string;
  createdAt: string;
}

export interface Wholesaler {
  id: string;
  name: string;
  sector: 'ABARROTES' | 'FARMACIA' | 'FERRETERIA' | 'MODA' | 'TECNOLOGIA';
  logoUrl?: string;
}

export interface CatalogItem {
  id: string;
  wholesalerId: string;
  wholesalerName: string; 
  name: string;
  description: string;
  sku: string;
  price: number; 
  category: string;
  sector: string;
  imageUrl?: string;
  minQuantity: number;
}

export interface MarketplaceOrder {
  id: string;
  wholesalerId: string;
  total: number;
  status: 'PENDING' | 'SHIPPED' | 'DELIVERED';
  createdAt: string;
  itemsCount: number;
}

// B2B QUOTATIONS
export interface Quotation {
  id: string;
  customerName: string;
  customerRuc?: string;
  items: Array<CartItem & { quantityExact?: string | null }>;
  subtotal: number;
  tax: number;
  total: number;
  createdAt: string;
  expiresAt: string;
  status: 'DRAFT' | 'SENT' | 'CONVERTED' | 'EXPIRED';
}

// Pedido entrante del catálogo público / portal web, convertible a cotización.
export interface PublicOrder {
  id: string;
  customerName: string;
  customerPhone?: string;
  status: string; // 'PENDING' | 'CONVERTED'
  items?: unknown[];
  createdAt: string;
}

export type ViewMode = 'POS' | 'DASHBOARD' | 'BLUEPRINT' | 'SETTINGS' | 'MARKETPLACE' | 'REPORTS' | 'QUOTATIONS';

export interface BlueprintFile {
  name: string;
  language: string;
  content: string;
  description: string;
}

// HRM - RECURSOS HUMANOS
export interface Employee {
  id: string;
  firstName: string;
  lastName: string;
  role: 'MANAGER' | 'VENDEDOR' | 'BODEGA';
  baseSalary: number;
  commissionRate: number; // 0.05 = 5%
  salesMonthToDate: number;
  phone?: string;
}

export interface Payroll {
  id: string;
  employeeName: string;
  period: string;
  baseSalary: number;
  salesAmount: number;
  commissionAmount: number;
  totalPaid: number;
  status: 'PAID' | 'PENDING';
}
