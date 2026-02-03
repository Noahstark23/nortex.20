export interface Product {
  id: string;
  name: string;
  price: number;
  stock: number;
  sku: string;
}

export interface CartItem extends Product {
  quantity: number;
}

export interface Tenant {
  id: string;
  name: string;
  type: 'FERRETERIA' | 'FARMACIA' | 'RETAIL';
  creditScore: number;
  creditLimit: number;
  walletBalance: number;
}

export interface Customer {
  id: string;
  name: string;
  taxId: string; // DNI o RUC
  email?: string;
  phone?: string;
}

export interface Supplier {
  id: string;
  name: string;
  taxId: string; // RUC
  email?: string;
  phone?: string;
}

export interface PurchaseItem {
  productId: string;
  productName: string; // Denormalized for UI
  quantity: number;
  cost: number; // Costo unitario
}

export interface Sale {
  id: string;
  total: number;
  date: string;
  items: number;
  status: 'COMPLETED' | 'PENDING';
  customerId?: string; // Opcional (Venta anónima)
}

export type ViewMode = 'POS' | 'DASHBOARD' | 'BLUEPRINT' | 'SETTINGS' | 'INVENTORY';

export interface BlueprintFile {
  name: string;
  language: string;
  content: string;
  description: string;
}