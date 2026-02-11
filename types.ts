
export interface Product {
  id: string;
  name: string;
  price: number;
  costPrice: number; // NUEVO: Para calcular utilidad real
  stock: number;
  sku: string;
  category: string;
}

export interface CartItem extends Product {
  quantity: number;
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
  employeeId?: string;
  employee?: { id: string; firstName: string; lastName: string; role: string };
  startTime: string;
  endTime?: string;
  initialCash: number;
  finalCashDeclared?: number;
  systemExpectedCash?: number;
  difference?: number; // declared - expected
  status: 'OPEN' | 'CLOSED';
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
  pin?: string; // PIN de 4 dígitos para acceso rápido
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
