export interface Product {
  id: string;
  name: string;
  price: number;
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
  type: 'FERRETERIA' | 'FARMACIA' | 'RETAIL';
  creditScore: number;
  creditLimit: number;
  walletBalance: number;
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
  balance: number; // Lo que falta por pagar
  dueDate?: string;
  payments?: Payment[];
}

export type ViewMode = 'POS' | 'DASHBOARD' | 'BLUEPRINT' | 'SETTINGS';

export interface BlueprintFile {
  name: string;
  language: string;
  content: string;
  description: string;
}