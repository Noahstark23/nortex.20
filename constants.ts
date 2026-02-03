import { Product, Tenant, BlueprintFile, Sale, Wholesaler, CatalogItem } from './types';

export const MOCK_TENANT: Tenant = {
  id: 'tnt_01_alpha',
  name: 'Ferretería El Tornillo',
  type: 'FERRETERIA',
  creditScore: 785,
  creditLimit: 50000.00,
  walletBalance: 12450.50,
  subscriptionStatus: 'TRIALING',
  plan: 'PRO_MONTHLY',
  trialEndsAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString()
};

export const MOCK_PRODUCTS: Product[] = [
  { id: '1', name: 'Cemento Sol 50kg', price: 28.50, stock: 150, sku: 'CEM-001', category: 'Construcción' },
  { id: '2', name: 'Fierro 1/2" x 9m', price: 45.00, stock: 300, sku: 'FIE-002', category: 'Construcción' },
  { id: '3', name: 'Ladrillo King Kong', price: 1.20, stock: 5000, sku: 'LAD-003', category: 'Albañilería' },
  { id: '4', name: 'Pintura Latek 1GL', price: 35.00, stock: 45, sku: 'PIN-004', category: 'Acabados' },
  { id: '5', name: 'Tubo PVC 4"', price: 18.90, stock: 120, sku: 'TUB-005', category: 'Gasfitería' },
  { id: '6', name: 'Martillo Carpintero', price: 25.00, stock: 15, sku: 'HER-006', category: 'Herramientas' },
  { id: '7', name: 'Thinner Acrílico', price: 12.00, stock: 40, sku: 'QUI-007', category: 'Químicos' },
];

export const MOCK_DEBTORS: Sale[] = [
  {
    id: 'sale_991',
    total: 1500.00,
    balance: 800.00,
    date: '2023-10-25T10:00:00Z',
    items: 4,
    status: 'CREDIT_PENDING',
    paymentMethod: 'CREDIT',
    customerName: 'Constructora Los Andes SAC',
    dueDate: '2023-11-25T10:00:00Z',
    payments: [
      { id: 'pay_1', amount: 700.00, date: '2023-10-26T14:30:00Z', method: 'TRANSFER' }
    ]
  },
  {
    id: 'sale_992',
    total: 240.50,
    balance: 240.50,
    date: '2023-10-28T09:15:00Z',
    items: 2,
    status: 'CREDIT_PENDING',
    paymentMethod: 'CREDIT',
    customerName: 'Juan Pérez (Maestro Obra)',
    dueDate: '2023-11-05T00:00:00Z',
    payments: []
  },
  {
    id: 'sale_993',
    total: 4500.00,
    balance: 0,
    date: '2023-10-01T11:00:00Z',
    items: 12,
    status: 'PAID',
    paymentMethod: 'CREDIT',
    customerName: 'Constructora Los Andes SAC',
    dueDate: '2023-10-15T00:00:00Z',
    payments: [
      { id: 'pay_2', amount: 4500.00, date: '2023-10-10T09:00:00Z', method: 'TRANSFER' }
    ]
  }
];

// --- FASE 7: MARKETPLACE DATA ---

export const MOCK_WHOLESALERS: Wholesaler[] = [
  { id: 'ws_01', name: 'Distribuidora La Universal', sector: 'ABARROTES' },
  { id: 'ws_02', name: 'Droguería Central', sector: 'FARMACIA' },
  { id: 'ws_03', name: 'Holcim Industrial', sector: 'FERRETERIA' },
  { id: 'ws_04', name: 'Textiles Masaya', sector: 'MODA' },
  { id: 'ws_05', name: 'TechZone Mayorista', sector: 'TECNOLOGIA' }
];

export const MOCK_CATALOG: CatalogItem[] = [
  // ABARROTES
  { id: 'cat_01', wholesalerId: 'ws_01', wholesalerName: 'La Universal', name: 'Arroz Faisán 50lb', description: 'Saco de arroz grano entero 98%', sku: 'ARR-50', price: 45.00, category: 'Granos', sector: 'ABARROTES', minQuantity: 5 },
  { id: 'cat_02', wholesalerId: 'ws_01', wholesalerName: 'La Universal', name: 'Aceite Cocinero 1L x12', description: 'Caja de 12 unidades', sku: 'ACE-12', price: 28.50, category: 'Aceites', sector: 'ABARROTES', minQuantity: 2 },
  { id: 'cat_03', wholesalerId: 'ws_01', wholesalerName: 'La Universal', name: 'Coca-Cola 3L Pack', description: 'Pack de 6 unidades retornables', sku: 'COKE-06', price: 12.00, category: 'Bebidas', sector: 'ABARROTES', minQuantity: 10 },
  
  // FARMACIA
  { id: 'cat_04', wholesalerId: 'ws_02', wholesalerName: 'Droguería Central', name: 'Panadol Forte Caja', description: 'Caja hospitalaria 100 tabletas', sku: 'PAN-100', price: 15.00, category: 'Analgésicos', sector: 'FARMACIA', minQuantity: 1 },
  { id: 'cat_05', wholesalerId: 'ws_02', wholesalerName: 'Droguería Central', name: 'Amoxicilina 500mg', description: 'Pack 50 blisters', sku: 'AMOX-50', price: 35.00, category: 'Antibióticos', sector: 'FARMACIA', minQuantity: 2 },
  { id: 'cat_06', wholesalerId: 'ws_02', wholesalerName: 'Droguería Central', name: 'Pedialyte Zinc', description: 'Caja surtida 12 botellas', sku: 'PED-12', price: 40.00, category: 'Hidratación', sector: 'FARMACIA', minQuantity: 3 },

  // FERRETERIA
  { id: 'cat_07', wholesalerId: 'ws_03', wholesalerName: 'Holcim', name: 'Cemento Portland Tipo I', description: 'Pallet de 40 bolsas', sku: 'CEM-PAL', price: 380.00, category: 'Obra Gris', sector: 'FERRETERIA', minQuantity: 1 },
  { id: 'cat_08', wholesalerId: 'ws_03', wholesalerName: 'Holcim', name: 'Varilla Corrugada 3/8', description: 'Atado de 50 varillas', sku: 'VAR-50', price: 210.00, category: 'Acero', sector: 'FERRETERIA', minQuantity: 1 },

  // MODA
  { id: 'cat_09', wholesalerId: 'ws_04', wholesalerName: 'Textiles Masaya', name: 'Camiseta Polo Básica', description: 'Docena colores surtidos', sku: 'POLO-12', price: 60.00, category: 'Caballeros', sector: 'MODA', minQuantity: 2 },
  { id: 'cat_10', wholesalerId: 'ws_04', wholesalerName: 'Textiles Masaya', name: 'Jeans Clásico', description: 'Docena tallas 28-36', sku: 'JEAN-12', price: 180.00, category: 'Damas', sector: 'MODA', minQuantity: 1 },
];

const PRISMA_SCHEMA_CODE = `// ESTO VA EN: /backend/prisma/schema.prisma

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "mysql"
  url      = env("DATABASE_URL")
}

model Tenant {
  id            String    @id @default(uuid())
  name          String
  type          String    // FERRETERIA, FARMACIA, PULPERIA...
  slug          String    @unique
  walletBalance Decimal   @default(0.00) @db.Decimal(15, 2)
  creditScore   Int       @default(0)
  creditLimit   Decimal   @default(0.00) @db.Decimal(15, 2)
  subscriptionStatus String   @default("TRIALING") 
  plan               String   @default("PRO_MONTHLY")
  trialEndsAt        DateTime @default(now()) 

  users         User[]
  sales         Sale[]
  customers     Customer[]
  loans         Loan[]    
  orders        MarketplaceOrder[] // Relación B2B
}

model Wholesaler {
  id          String        @id @default(uuid())
  name        String        
  sector      String        // ABARROTES, FARMACIA, MODA...
  logoUrl     String?
  products    CatalogItem[]
  orders      MarketplaceOrder[]
}

model CatalogItem {
  id           String   @id @default(uuid())
  wholesalerId String
  wholesaler   Wholesaler @relation(fields: [wholesalerId], references: [id])
  name         String
  description  String?
  sku          String
  price        Decimal  @db.Decimal(10, 2)
  category     String   
  sector       String   
  imageUrl     String?
  minQuantity  Int      @default(1)
  
  orderItems   MarketplaceOrderItem[]
}

model MarketplaceOrder {
  id          String   @id @default(uuid())
  tenantId    String
  tenant      Tenant   @relation(fields: [tenantId], references: [id])
  wholesalerId String
  wholesaler  Wholesaler @relation(fields: [wholesalerId], references: [id])
  
  total       Decimal  @db.Decimal(12, 2)
  status      String   @default("PENDING")
  createdAt   DateTime @default(now())
  
  items       MarketplaceOrderItem[]
}

model MarketplaceOrderItem {
  id            String      @id @default(uuid())
  orderId       String
  order         MarketplaceOrder @relation(fields: [orderId], references: [id])
  catalogItemId String
  catalogItem   CatalogItem @relation(fields: [catalogItemId], references: [id])
  
  quantity      Int
  priceAtBuy    Decimal
}

// ... Resto de modelos existentes (User, Sale, Loan, etc)
`;

export const BLUEPRINTS: BlueprintFile[] = [
  {
    name: 'schema.prisma',
    language: 'prisma',
    content: PRISMA_SCHEMA_CODE,
    description: 'Schema B2B: Wholesalers, Catalog & Orders.'
  },
  {
    name: 'server.ts',
    language: 'typescript',
    content: '// Endpoints para /api/marketplace/catalog y /api/marketplace/orders',
    description: 'Backend: Lógica de filtrado multisectorial.'
  },
];