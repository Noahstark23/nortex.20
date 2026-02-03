import { Product, Tenant, BlueprintFile, Customer, Supplier } from './types';

export const MOCK_TENANT: Tenant = {
  id: 'tnt_01_alpha',
  name: 'Ferretería El Tornillo',
  type: 'FERRETERIA',
  creditScore: 785,
  creditLimit: 50000.00,
  walletBalance: 12450.50
};

export const MOCK_PRODUCTS: Product[] = [
  { id: '1', name: 'Cemento Sol 50kg', price: 28.50, stock: 150, sku: 'CEM-001' },
  { id: '2', name: 'Fierro 1/2" x 9m', price: 45.00, stock: 300, sku: 'FIE-002' },
  { id: '3', name: 'Ladrillo King Kong', price: 1.20, stock: 5000, sku: 'LAD-003' },
  { id: '4', name: 'Pintura Latek 1GL', price: 35.00, stock: 45, sku: 'PIN-004' },
  { id: '5', name: 'Tubo PVC 4"', price: 18.90, stock: 120, sku: 'TUB-005' },
];

export const MOCK_CUSTOMERS: Customer[] = [
  { id: 'c1', name: 'Constructora Hnos. Perez', taxId: '20100200300', email: 'compras@perez.com' },
  { id: 'c2', name: 'Juan Mecánico', taxId: '1045678901', phone: '999-888-777' },
  { id: 'c3', name: 'Municipalidad Distrital', taxId: '20505050501', email: 'logistica@muni.gob.pe' },
];

export const MOCK_SUPPLIERS: Supplier[] = [
  { id: 's1', name: 'Distribuidora Aceros Arequipa', taxId: '20100100100', phone: '01-200-3000' },
  { id: 's2', name: 'Cementos Lima S.A.', taxId: '20200200200', email: 'ventas@cementos.com' },
];

// --- CODIGO BACKEND PARA VISUALIZACION EN BLUEPRINT VIEWER ---

const PRISMA_SCHEMA_CODE = `// ESTO VA EN: /backend/prisma/schema.prisma

model Tenant {
  // ... (Campos existentes) ...
  loans         Loan[]
  creditScore   Int       @default(300)
  creditLimit   Decimal   @default(0)
}

// NUEVA ENTIDAD: PRÉSTAMO FINTECH
model Loan {
  id            String    @id @default(uuid())
  amount        Decimal   // Monto solicitado (Principal)
  interest      Decimal   // 5% Flat fee
  totalDue      Decimal   // Monto + Interes
  
  status        String    @default("ACTIVE") // ACTIVE, PAID, DEFAULT
  
  createdAt     DateTime  @default(now())
  dueDate       DateTime  // +30 días
  
  tenantId      String
  tenant        Tenant    @relation(fields: [tenantId], references: [id])
}

// ... (Resto del schema: Purchases, Suppliers, Sales)
`;

const SERVER_CODE = `// SERVER.TS UPDATES

// 7. LENDING ENGINE (Sistema de Préstamos)

// GET: Obtener préstamos
app.get('/api/loans', requireTenant, async (req, res) => {
  const loans = await prisma.loan.findMany({
    where: { tenantId: req.tenantId },
    orderBy: { createdAt: 'desc' }
  });
  res.json(loans);
});

// POST: Solicitar desembolso
app.post('/api/loans/request', requireTenant, async (req, res) => {
  const { amount } = req.body; // Monto solicitado
  const requestedAmount = Number(amount);
  
  try {
    await prisma.$transaction(async (tx) => {
      // 1. ANÁLISIS DE RIESGO
      const tenant = await tx.tenant.findUnique({ where: { id: req.tenantId } });
      
      if (tenant.creditScore < 500) {
        throw new Error('Score insuficiente. Mejora tus ventas para calificar.');
      }
      
      // Verificar capacidad de endeudamiento (Mock logic: creditLimit es el tope global)
      // En prod: Sumaríamos deuda activa actual + requestedAmount
      if (requestedAmount > Number(tenant.creditLimit)) {
        throw new Error('El monto excede tu línea de crédito pre-aprobada.');
      }

      // 2. CÁLCULO FINANCIERO
      const INTEREST_RATE = 0.05; // 5% mensual flat
      const interest = requestedAmount * INTEREST_RATE;
      const totalDue = requestedAmount + interest;
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + 30); // Vence en 30 días

      // 3. EJECUCIÓN (Crear Préstamo)
      const loan = await tx.loan.create({
        data: {
          tenantId: req.tenantId,
          amount: requestedAmount,
          interest: interest,
          totalDue: totalDue,
          status: 'ACTIVE',
          dueDate: dueDate
        }
      });

      // 4. DESEMBOLSO (Inyectar liquidez a la Wallet)
      await tx.tenant.update({
        where: { id: req.tenantId },
        data: {
          walletBalance: { increment: requestedAmount },
          // Opcional: Reducir creditLimit temporalmente o manejarlo con "AvailableCredit" calculado
        }
      });
      
      return loan;
    });

    res.json({ success: true, message: 'Fondos desembolsados exitosamente.' });

  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});
`;

export const BLUEPRINTS: BlueprintFile[] = [
  {
    name: 'schema.prisma',
    language: 'prisma',
    content: PRISMA_SCHEMA_CODE,
    description: 'Schema actualizado con Suppliers, Purchases y Expenses.'
  },
  {
    name: 'lending_engine.ts',
    language: 'typescript',
    content: SERVER_CODE,
    description: 'Lógica de backend para cálculo de riesgo y desembolso de préstamos.'
  },
];