import { Product, Tenant, BlueprintFile, Sale } from './types';

export const MOCK_TENANT: Tenant = {
  id: 'tnt_01_alpha',
  name: 'Ferretería El Tornillo',
  type: 'FERRETERIA',
  creditScore: 785,
  creditLimit: 50000.00,
  walletBalance: 12450.50
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

// --- CODIGO BACKEND PARA VISUALIZACION EN BLUEPRINT VIEWER ---

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
  type          String    
  slug          String    @unique
  walletBalance Decimal   @default(0.00) @db.Decimal(15, 2)
  creditScore   Int       @default(0)
  creditLimit   Decimal   @default(0.00) @db.Decimal(15, 2) // Cupo disponible
  
  users         User[]
  sales         Sale[]
  customers     Customer[]
  loans         Loan[]    // Relación con Préstamos
}

model User {
  id            String    @id @default(uuid())
  email         String    @unique
  password      String
  role          String    @default("OWNER")
  tenantId      String
  tenant        Tenant    @relation(fields: [tenantId], references: [id])
  createdAt     DateTime  @default(now())
}

model Loan {
  id            String    @id @default(uuid())
  amount        Decimal   @db.Decimal(15, 2) // Capital prestado
  interest      Decimal   @db.Decimal(15, 2) // Interés generado
  totalDue      Decimal   @db.Decimal(15, 2) // Total a pagar
  status        String    @default("ACTIVE") // ACTIVE, PAID, DEFAULT
  dueDate       DateTime
  
  tenantId      String
  tenant        Tenant    @relation(fields: [tenantId], references: [id])
  
  createdAt     DateTime  @default(now())
}

model Customer {
  id            String    @id @default(uuid())
  name          String
  taxId         String?   
  phone         String?
  tenantId      String
  tenant        Tenant    @relation(fields: [tenantId], references: [id])
  sales         Sale[]
  
  @@unique([tenantId, name])
}

model Sale {
  id            String     @id @default(uuid())
  total         Decimal    @db.Decimal(12, 2)
  status        String     @default("COMPLETED")
  paymentMethod String     
  balance       Decimal    @default(0.00) @db.Decimal(12, 2)
  dueDate       DateTime?  
  tenantId      String
  tenant        Tenant     @relation(fields: [tenantId], references: [id])
  customerId    String?
  customer      Customer?  @relation(fields: [customerId], references: [id])
  items         SaleItem[]
  payments      Payment[]
  createdAt     DateTime   @default(now())
}

model Payment {
  id            String    @id @default(uuid())
  amount        Decimal   @db.Decimal(12, 2)
  method        String
  date          DateTime  @default(now())
  saleId        String
  sale          Sale      @relation(fields: [saleId], references: [id])
}

model SaleItem {
  id            String   @id @default(uuid())
  saleId        String
  sale          Sale     @relation(fields: [saleId], references: [id])
  productId     String
  quantity      Int
  priceAtSale   Decimal  @db.Decimal(10, 2)
}`;

const SERVER_CODE = `// LÓGICA DE PRÉSTAMOS (LENDING)

// GET /api/loans
app.get('/api/loans', authenticate, async (req, res) => {
  const loans = await prisma.loan.findMany({
    where: { tenantId: req.user.tenantId },
    orderBy: { createdAt: 'desc' }
  });
  res.json(loans);
});

// POST /api/loans/request
app.post('/api/loans/request', authenticate, async (req, res) => {
  const { amount } = req.body;
  const tenantId = req.user.tenantId;

  try {
    const result = await prisma.$transaction(async (tx) => {
      // 1. Obtener Tenant y Validar
      const tenant = await tx.tenant.findUnique({ where: { id: tenantId } });
      
      if (tenant.creditScore < 500) throw new Error("Score insuficiente para créditos.");
      if (Number(tenant.creditLimit) < amount) throw new Error("Monto excede línea disponible.");
      
      // 2. Calcular Interés (Flat 5%)
      const interest = amount * 0.05;
      const totalDue = amount + interest;
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + 30); // 30 días plazo

      // 3. Crear Préstamo
      const loan = await tx.loan.create({
        data: {
          tenantId,
          amount,
          interest,
          totalDue,
          status: 'ACTIVE',
          dueDate
        }
      });

      // 4. Inyectar Dinero en Wallet y Reducir Cupo
      await tx.tenant.update({
        where: { id: tenantId },
        data: {
          walletBalance: { increment: amount },
          creditLimit: { decrement: amount }
        }
      });

      return loan;
    });

    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});`;

export const BLUEPRINTS: BlueprintFile[] = [
  {
    name: 'schema.prisma',
    language: 'prisma',
    content: PRISMA_SCHEMA_CODE,
    description: 'Schema actualizado: Sistema de Préstamos (Loans).'
  },
  {
    name: 'server.ts',
    language: 'typescript',
    content: SERVER_CODE,
    description: 'Backend: Motor de Decisión Crediticia y Transacciones.'
  },
  {
    name: 'docker-compose.yml',
    language: 'yaml',
    content: `version: '3.8'\nservices:\n  db:\n    image: mysql:8.0`,
    description: 'Infraestructura sin cambios.'
  }
];