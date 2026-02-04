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
  { id: '1', name: 'Cemento Sol 50kg', price: 28.50, costPrice: 24.00, stock: 150, sku: 'CEM-001', category: 'Construcción' },
  { id: '2', name: 'Fierro 1/2" x 9m', price: 45.00, costPrice: 38.50, stock: 300, sku: 'FIE-002', category: 'Construcción' },
  { id: '3', name: 'Ladrillo King Kong', price: 1.20, costPrice: 0.80, stock: 5000, sku: 'LAD-003', category: 'Albañilería' },
  { id: '4', name: 'Pintura Latek 1GL', price: 35.00, costPrice: 22.00, stock: 45, sku: 'PIN-004', category: 'Acabados' },
  { id: '5', name: 'Tubo PVC 4"', price: 18.90, costPrice: 12.50, stock: 120, sku: 'TUB-005', category: 'Gasfitería' },
  { id: '6', name: 'Martillo Carpintero', price: 25.00, costPrice: 15.00, stock: 15, sku: 'HER-006', category: 'Herramientas' },
  { id: '7', name: 'Thinner Acrílico', price: 12.00, costPrice: 8.00, stock: 40, sku: 'QUI-007', category: 'Químicos' },
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

export const MOCK_WHOLESALERS: Wholesaler[] = [
  { id: 'ws_01', name: 'Distribuidora La Universal', sector: 'ABARROTES' },
  { id: 'ws_02', name: 'Droguería Central', sector: 'FARMACIA' },
  { id: 'ws_03', name: 'Holcim Industrial', sector: 'FERRETERIA' },
  { id: 'ws_04', name: 'Textiles Masaya', sector: 'MODA' },
  { id: 'ws_05', name: 'TechZone Mayorista', sector: 'TECNOLOGIA' }
];

export const MOCK_CATALOG: CatalogItem[] = [
  { id: 'cat_01', wholesalerId: 'ws_01', wholesalerName: 'La Universal', name: 'Arroz Faisán 50lb', description: 'Saco de arroz grano entero 98%', sku: 'ARR-50', price: 45.00, category: 'Granos', sector: 'ABARROTES', minQuantity: 5 },
  { id: 'cat_02', wholesalerId: 'ws_01', wholesalerName: 'La Universal', name: 'Aceite Cocinero 1L x12', description: 'Caja de 12 unidades', sku: 'ACE-12', price: 28.50, category: 'Aceites', sector: 'ABARROTES', minQuantity: 2 },
  { id: 'cat_03', wholesalerId: 'ws_01', wholesalerName: 'La Universal', name: 'Coca-Cola 3L Pack', description: 'Pack de 6 unidades retornables', sku: 'COKE-06', price: 12.00, category: 'Bebidas', sector: 'ABARROTES', minQuantity: 10 },
  { id: 'cat_04', wholesalerId: 'ws_02', wholesalerName: 'Droguería Central', name: 'Panadol Forte Caja', description: 'Caja hospitalaria 100 tabletas', sku: 'PAN-100', price: 15.00, category: 'Analgésicos', sector: 'FARMACIA', minQuantity: 1 },
  { id: 'cat_05', wholesalerId: 'ws_02', wholesalerName: 'Droguería Central', name: 'Amoxicilina 500mg', description: 'Pack 50 blisters', sku: 'AMOX-50', price: 35.00, category: 'Antibióticos', sector: 'FARMACIA', minQuantity: 2 },
  { id: 'cat_06', wholesalerId: 'ws_02', wholesalerName: 'Droguería Central', name: 'Pedialyte Zinc', description: 'Caja surtida 12 botellas', sku: 'PED-12', price: 40.00, category: 'Hidratación', sector: 'FARMACIA', minQuantity: 3 },
  { id: 'cat_07', wholesalerId: 'ws_03', wholesalerName: 'Holcim', name: 'Cemento Portland Tipo I', description: 'Pallet de 40 bolsas', sku: 'CEM-PAL', price: 380.00, category: 'Obra Gris', sector: 'FERRETERIA', minQuantity: 1 },
  { id: 'cat_08', wholesalerId: 'ws_03', wholesalerName: 'Holcim', name: 'Varilla Corrugada 3/8', description: 'Atado de 50 varillas', sku: 'VAR-50', price: 210.00, category: 'Acero', sector: 'FERRETERIA', minQuantity: 1 },
  { id: 'cat_09', wholesalerId: 'ws_04', wholesalerName: 'Textiles Masaya', name: 'Camiseta Polo Básica', description: 'Docena colores surtidos', sku: 'POLO-12', price: 60.00, category: 'Caballeros', sector: 'MODA', minQuantity: 2 },
  { id: 'cat_10', wholesalerId: 'ws_04', wholesalerName: 'Textiles Masaya', name: 'Jeans Clásico', description: 'Docena tallas 28-36', sku: 'JEAN-12', price: 180.00, category: 'Damas', sector: 'MODA', minQuantity: 1 },
];

const PRISMA_SCHEMA_CODE = `// ESTO VA EN: /backend/prisma/schema.prisma

model Tenant {
  id            String    @id @default(uuid())
  // ... (campos anteriores)
  shifts        Shift[]
  auditLogs     AuditLog[]
}

model Shift {
  id                String    @id @default(uuid())
  tenantId          String
  tenant            Tenant    @relation(fields: [tenantId], references: [id])
  userId            String    // Cajero
  startTime         DateTime  @default(now())
  endTime           DateTime?
  initialCash       Decimal   @db.Decimal(10, 2)
  finalCashDeclared Decimal?  @db.Decimal(10, 2)
  systemExpectedCash Decimal? @db.Decimal(10, 2)
  difference        Decimal?  @db.Decimal(10, 2)
  status            String    @default("OPEN") // OPEN, CLOSED
  sales             Sale[]
}

model Sale {
  // ... (campos anteriores)
  shiftId       String?
  shift         Shift?    @relation(fields: [shiftId], references: [id])
}

model SaleItem {
  // ...
  costAtSale    Decimal   @db.Decimal(10, 2) // COGS tracking
}

model AuditLog {
  id          String    @id @default(uuid())
  tenantId    String
  tenant      Tenant    @relation(fields: [tenantId], references: [id])
  userId      String
  action      String    // DELETE_SALE, CLOSE_SHIFT, etc
  details     String    @db.Text
  timestamp   DateTime  @default(now())
}
`;

export const BLUEPRINTS: BlueprintFile[] = [
  {
    name: 'schema.prisma',
    language: 'prisma',
    content: PRISMA_SCHEMA_CODE,
    description: 'Schema B2B + Operaciones: Shifts, Audits & Cost Tracking.'
  },
  {
    name: 'server.ts',
    language: 'typescript',
    content: '// Endpoints para /api/shifts y /api/reports/profit',
    description: 'Backend: Lógica de Cierre de Caja y Cálculo de Utilidad.'
  },
];