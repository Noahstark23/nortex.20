
export interface Product {
  id: string;
  name: string;
  price: number;
  costPrice: number; // NUEVO: Para calcular utilidad real
  stock: number;
  sku: string;
  category: string;
  requiresBatchTracking?: boolean; // Control de lotes
  // Venta por mayor (distribuidora/miscelánea)
  wholesalePrice?: number | null;  // precio de mayoreo (null = sin mayoreo)
  wholesaleMinQty?: number | null; // cantidad mínima a partir de la cual aplica
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
  batchNumber?: string;
  expiryDate?: string;
}

export interface Tenant {
  id: string;
  name: string;
  type: 'FERRETERIA' | 'FARMACIA' | 'RETAIL' | 'PULPERIA' | 'BOUTIQUE'; 
  creditScore: number;
  creditLimit: number;
  walletBalance: number;
  subscriptionStatus: 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'CANCELLED';
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
  items: CartItem[];
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
