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

export interface Sale {
  id: string;
  total: number;
  date: string;
  items: number;
  status: 'COMPLETED' | 'PENDING';
}

export type ViewMode = 'POS' | 'DASHBOARD' | 'BLUEPRINT' | 'SETTINGS';

export interface BlueprintFile {
  name: string;
  language: string;
  content: string;
  description: string;
}