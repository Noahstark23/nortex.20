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
  sales         Sale[]
  customers     Customer[]
}

model Customer {
  id            String    @id @default(uuid())
  name          String
  taxId         String?   // RUC / DNI
  phone         String?
  tenantId      String
  tenant        Tenant    @relation(fields: [tenantId], references: [id])
  sales         Sale[]
  
  @@unique([tenantId, name])
}

model Sale {
  id            String     @id @default(uuid())
  total         Decimal    @db.Decimal(12, 2)
  
  // FINTECH CORE: CRÉDITO
  status        String     @default("COMPLETED") // 'COMPLETED', 'CREDIT_PENDING', 'PAID'
  paymentMethod String     // 'CASH', 'CREDIT', etc.
  balance       Decimal    @default(0.00) @db.Decimal(12, 2) // Deuda pendiente
  dueDate       DateTime?  // Fecha límite de pago
  
  tenantId      String
  tenant        Tenant     @relation(fields: [tenantId], references: [id])
  
  customerId    String?
  customer      Customer?  @relation(fields: [customerId], references: [id])
  
  items         SaleItem[]
  payments      Payment[]  // Historial de abonos
  
  createdAt     DateTime   @default(now())
}

model Payment {
  id            String    @id @default(uuid())
  amount        Decimal   @db.Decimal(12, 2)
  method        String    // 'CASH', 'TRANSFER'
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

const SERVER_CODE = `// ESTO VA EN: /backend/server.ts

// ... imports y setup express ...

// POST /api/sales (ACTUALIZADO CON LÓGICA DE CRÉDITO)
app.post('/api/sales', requireTenant, async (req, res) => {
  const { items, paymentMethod, customerName, dueDate } = req.body;

  try {
    const result = await prisma.$transaction(async (tx) => {
      let totalAmount = 0;
      const saleItemsData = [];

      // 1. Calculo de Stock y Total (Igual que antes)
      for (const item of items) {
        // ... Logica de stock ...
        const product = await tx.product.findUnique({ where: { id: item.productId } });
        totalAmount += Number(product.price) * item.quantity;
        // ...
      }

      // 2. Manejo de Cliente (Upsert)
      let customerId = null;
      if (customerName) {
        const customer = await tx.customer.upsert({
          where: { tenantId_name: { tenantId: req.tenantId, name: customerName } },
          update: {},
          create: { name: customerName, tenantId: req.tenantId }
        });
        customerId = customer.id;
      }

      if (paymentMethod === 'CREDIT' && !customerId) {
        throw new Error('Las ventas a crédito requieren un cliente registrado.');
      }

      // 3. Crear Venta
      const isCredit = paymentMethod === 'CREDIT';
      const sale = await tx.sale.create({
        data: {
          tenantId: req.tenantId,
          total: totalAmount,
          paymentMethod: paymentMethod,
          status: isCredit ? 'CREDIT_PENDING' : 'COMPLETED',
          balance: isCredit ? totalAmount : 0, // Si es crédito, debe todo
          dueDate: isCredit ? new Date(dueDate) : null,
          customerId: customerId,
          items: { create: saleItemsData }
        }
      });

      // 4. Update Wallet (Solo si NO es crédito entra dinero a caja ya)
      if (!isCredit) {
         await tx.tenant.update({
           where: { id: req.tenantId },
           data: { walletBalance: { increment: totalAmount } }
         });
      }

      return sale;
    });
    res.json(result);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// POST /api/sales/:id/pay (NUEVO: REGISTRAR ABONO)
app.post('/api/sales/:id/pay', requireTenant, async (req, res) => {
  const { amount, method } = req.body;
  const saleId = req.params.id;

  try {
    const result = await prisma.$transaction(async (tx) => {
      // 1. Buscar Venta
      const sale = await tx.sale.findUnique({ where: { id: saleId } });
      if (!sale) throw new Error('Venta no encontrada');
      if (Number(sale.balance) < amount) throw new Error('El monto excede la deuda');

      // 2. Registrar Pago
      await tx.payment.create({
        data: {
          saleId,
          amount,
          method: method || 'CASH'
        }
      });

      // 3. Actualizar Venta (Saldo y Status)
      const newBalance = Number(sale.balance) - amount;
      const newStatus = newBalance <= 0 ? 'PAID' : 'CREDIT_PENDING';

      await tx.sale.update({
        where: { id: saleId },
        data: {
          balance: newBalance,
          status: newStatus
        }
      });

      // 4. Dinero entra a Caja (Wallet del Tenant)
      await tx.tenant.update({
        where: { id: sale.tenantId },
        data: { walletBalance: { increment: amount } }
      });

      return { newBalance, newStatus };
    });

    res.json(result);
  } catch (e) { res.status(400).json({ error: e.message }); }
});`;

export const BLUEPRINTS: BlueprintFile[] = [
  {
    name: 'schema.prisma',
    language: 'prisma',
    content: PRISMA_SCHEMA_CODE,
    description: 'Schema actualizado: Soporte para Deudas, Clientes y Pagos Parciales.'
  },
  {
    name: 'server.ts',
    language: 'typescript',
    content: SERVER_CODE,
    description: 'API Lógica Financiera: Endpoints para venta a crédito y abonos.'
  },
  {
    name: 'docker-compose.yml',
    language: 'yaml',
    content: `version: '3.8'\nservices:\n  db:\n    image: mysql:8.0`,
    description: 'Infraestructura sin cambios.'
  }
];