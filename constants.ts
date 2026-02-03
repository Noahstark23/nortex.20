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
  suppliers     Supplier[]
  purchases     Purchase[]
  expenses      Expense[]
}

// NUEVA ENTIDAD: PROVEEDOR
model Supplier {
  id            String    @id @default(uuid())
  name          String
  taxId         String    // RUC
  email         String?
  phone         String?
  tenantId      String
  tenant        Tenant    @relation(fields: [tenantId], references: [id])
  purchases     Purchase[]
  
  @@unique([tenantId, taxId])
}

// NUEVA ENTIDAD: COMPRA DE INVENTARIO (Entry)
model Purchase {
  id            String    @id @default(uuid())
  date          DateTime  @default(now())
  total         Decimal
  status        String    @default("COMPLETED") // COMPLETED, DRAFT
  
  tenantId      String
  tenant        Tenant    @relation(fields: [tenantId], references: [id])
  
  supplierId    String
  supplier      Supplier  @relation(fields: [supplierId], references: [id])
  
  items         PurchaseItem[]
}

model PurchaseItem {
  id            String    @id @default(uuid())
  purchaseId    String
  purchase      Purchase  @relation(fields: [purchaseId], references: [id])
  
  productId     String
  product       Product   @relation(fields: [productId], references: [id])
  
  quantity      Int
  costPrice     Decimal   // Costo unitario al momento de compra
}

// NUEVA ENTIDAD: GASTOS OPERATIVOS (OPEX)
model Expense {
  id            String    @id @default(uuid())
  description   String
  amount        Decimal
  category      String    // RENTA, SERVICIOS, PLANILLA
  date          DateTime  @default(now())
  
  tenantId      String
  tenant        Tenant    @relation(fields: [tenantId], references: [id])
}
`;

const SERVER_CODE = `// SERVER.TS UPDATES

// ... imports

// 5. GESTIÓN DE PROVEEDORES
app.get('/api/suppliers', requireTenant, async (req, res) => {
  const suppliers = await prisma.supplier.findMany({ where: { tenantId: req.tenantId } });
  res.json(suppliers);
});

app.post('/api/suppliers', requireTenant, async (req, res) => {
  const { name, taxId, email, phone } = req.body;
  const supplier = await prisma.supplier.create({
    data: { name, taxId, email, phone, tenantId: req.tenantId }
  });
  res.json(supplier);
});

// 6. COMPRAS Y REABASTECIMIENTO (ACID Transaction)
app.post('/api/purchases', requireTenant, async (req, res) => {
  const { supplierId, items } = req.body; // items: [{ productId, quantity, cost }]
  
  await prisma.$transaction(async (tx) => {
    let totalCost = 0;
    
    // 1. Crear Cabecera de Compra
    const purchase = await tx.purchase.create({
      data: {
        tenantId: req.tenantId,
        supplierId,
        total: 0, // Se actualiza luego o calculamos aquí
        status: 'COMPLETED'
      }
    });

    // 2. Procesar Items y Actualizar Stock
    for (const item of items) {
       const lineTotal = item.quantity * item.cost;
       totalCost += lineTotal;
       
       // Crear detalle
       await tx.purchaseItem.create({
         data: {
           purchaseId: purchase.id,
           productId: item.productId,
           quantity: item.quantity,
           costPrice: item.cost
         }
       });
       
       // AUMENTAR STOCK (Inverso a la venta)
       await tx.product.update({
         where: { id: item.productId },
         data: { stock: { increment: item.quantity } }
       });
    }

    // 3. Actualizar Total de Compra
    await tx.purchase.update({
      where: { id: purchase.id },
      data: { total: totalCost }
    });

    // 4. DISMINUIR BILLETERA (Salida de dinero)
    await tx.tenant.update({
      where: { id: req.tenantId },
      data: { walletBalance: { decrement: totalCost } }
    });
  });
  
  res.json({ success: true });
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
    name: 'server.ts',
    language: 'typescript',
    content: SERVER_CODE,
    description: 'API endpoints para Suppliers y ACID Transactions de Compras.'
  },
];