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

// REMOVED MOCK PRODUCTS - Sistema empieza limpio
// Los productos se deben crear desde el inventario real
export const MOCK_PRODUCTS: Product[] = [];

// REMOVED MOCK DEBTORS - Sistema empieza limpio
export const MOCK_DEBTORS: Sale[] = [];

// Solo Tecnológica - el resto se agrega cuando tengamos aliados reales
export const MOCK_WHOLESALERS: Wholesaler[] = [
  { id: 'ws_01', name: 'Distribuidora Tecnológica S.A.', sector: 'TECNOLOGIA' }
];

// Solo productos de Tecnológica - otros proveedores se agregan cuando tengamos aliados reales
export const MOCK_CATALOG: CatalogItem[] = [
  { id: 'cat_tec_01', wholesalerId: 'ws_01', wholesalerName: 'Distribuidora Tecnológica S.A.', name: 'Laptop HP ProBook 450', description: 'Intel Core i5, 8GB RAM, 256GB SSD', sku: 'LAP-HP450', price: 650.00, category: 'Computadoras', sector: 'TECNOLOGIA', minQuantity: 1 },
  { id: 'cat_tec_02', wholesalerId: 'ws_01', wholesalerName: 'Distribuidora Tecnológica S.A.', name: 'Mouse Logitech M280', description: 'Inalámbrico Pack x12', sku: 'MOUSE-12', price: 120.00, category: 'Accesorios', sector: 'TECNOLOGIA', minQuantity: 2 },
  { id: 'cat_tec_03', wholesalerId: 'ws_01', wholesalerName: 'Distribuidora Tecnológica S.A.', name: 'Teclado Genius KB-125', description: 'USB cableado Pack x12', sku: 'KEYB-12', price: 90.00, category: 'Accesorios', sector: 'TECNOLOGIA', minQuantity: 2 },
];

const PRISMA_SCHEMA_CODE = `// ESTO VA EN: /backend/prisma/schema.prisma

// 1. Tenants & Clientes (Core Bancario)
model Tenant {
  id        String @id @default(uuid())
  name      String
  customers Customer[]
  suppliers Supplier[]
  employees Employee[]
  sales     Sale[]
  shifts    Shift[]
  b2bOrders B2BOrder[]
  expenses  Expense[]
}

// GESTIÓN DE CLIENTES Y RIESGO
model Customer {
  id          String   @id @default(uuid())
  tenantId    String
  name        String
  taxId       String?  // DNI o RUC
  phone       String?
  email       String?
  address     String?
  
  // FINTECH CORE
  creditLimit Decimal  @default(0)   @db.Decimal(12, 2)
  currentDebt Decimal  @default(0)   @db.Decimal(12, 2)
  isBlocked   Boolean  @default(false)
  
  sales       Sale[]
  payments    Payment[]
  tenant      Tenant    @relation(fields: [tenantId], references: [id])
  createdAt   DateTime  @default(now())
}

// GESTIÓN DE PROVEEDORES
model Supplier {
  id          String   @id @default(uuid())
  tenantId    String
  name        String
  contactName String?
  phone       String?
  email       String?
  category    String?  
  
  tenant      Tenant   @relation(fields: [tenantId], references: [id])
  createdAt   DateTime @default(now())
}

// --- MÓDULO RRHH (WOLF PACK) ---
model Employee {
  id             String   @id @default(uuid())
  tenantId       String
  firstName      String
  lastName       String
  role           String   @default("VENDEDOR") // MANAGER, VENDEDOR, BODEGA
  baseSalary     Decimal  @default(0)
  commissionRate Decimal  @default(0) // Ej: 0.05 para 5%
  phone          String?
  hiredAt        DateTime @default(now())
  
  tenant         Tenant   @relation(fields: [tenantId], references: [id])
  sales          Sale[]   // Relación inversa
  payrolls       Payroll[]
}

model Payroll {
  id          String   @id @default(uuid())
  employeeId  String
  periodStart DateTime
  periodEnd   DateTime
  baseSalary  Decimal
  commissions Decimal  // Calculado automático
  totalPaid   Decimal
  status      String   @default("PENDING") // PAID, PENDING
  
  employee    Employee @relation(fields: [employeeId], references: [id])
}

// 2. Control de Turnos
model Shift {
  id               String    @id @default(uuid())
  tenantId         String
  tenant           Tenant    @relation(fields: [tenantId], references: [id])
  userId           String
  startTime        DateTime  @default(now())
  endTime          DateTime?
  initialCash      Decimal   @db.Decimal(10, 2)
  finalCashDeclared Decimal? @db.Decimal(10, 2)
  systemExpectedCash Decimal? @db.Decimal(10, 2)
  difference       Decimal?  @db.Decimal(10, 2)
  status           String    @default("OPEN") 
  sales            Sale[]
}

// 3. Ventas y Crédito
model Sale {
  id            String     @id @default(uuid())
  tenantId      String
  tenant        Tenant     @relation(fields: [tenantId], references: [id])
  
  customerId    String?
  customer      Customer?  @relation(fields: [customerId], references: [id])
  customerName  String?    
  
  employeeId    String?    // Vendedor responsable
  employee      Employee?  @relation(fields: [employeeId], references: [id])

  total         Decimal    @db.Decimal(12, 2)
  balance       Decimal    @default(0.00) @db.Decimal(12, 2)
  status        String     @default("COMPLETED") 
  paymentMethod String     
  dueDate       DateTime?  
  
  shiftId       String?
  shift         Shift?     @relation(fields: [shiftId], references: [id])

  items         SaleItem[]
  payments      Payment[]
  createdAt     DateTime   @default(now())
}

// 4. Marketplace B2B (Nuevo)
model B2BOrder {
  id        String   @id @default(uuid())
  tenantId  String
  tenant    Tenant   @relation(fields: [tenantId], references: [id])
  total     Decimal  @db.Decimal(12, 2)
  items     Json     // Guardamos el carrito como JSON simple
  status    String   @default("PENDING") // PENDING, SHIPPED, DELIVERED
  createdAt DateTime @default(now())
}

// 5. Gastos Operativos (Nuevo)
model Expense {
  id          String   @id @default(uuid())
  tenantId    String
  amount      Decimal  @db.Decimal(12, 2)
  description String   // Ej: "Compra Marketplace: Cemento"
  category    String   @default("INVENTORY") // INVENTORY, RENT, UTILITIES
  date        DateTime @default(now())
  tenant      Tenant   @relation(fields: [tenantId], references: [id])
}
`;

export const BLUEPRINTS: BlueprintFile[] = [
  {
    name: 'schema.prisma',
    language: 'prisma',
    content: PRISMA_SCHEMA_CODE,
    description: 'Schema Bancario: Clientes (CRM), Proveedores (SRM), RRHH y Scoring.'
  },
  {
    name: 'server.ts',
    language: 'typescript',
    content: '// Endpoints Bancarios y de Gestión',
    description: 'Backend: Lógica de Negocio y Endpoints API.'
  },
];