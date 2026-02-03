import { Product, Tenant, BlueprintFile, Customer } from './types';

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

// --- CODIGO BACKEND PARA VISUALIZACION EN BLUEPRINT VIEWER ---

const PRISMA_SCHEMA_CODE = `// ESTO VA EN: /backend/prisma/schema.prisma

// ... (Anterior datasource y generator) ...

model Tenant {
  // ... (Campos existentes) ...
  customers     Customer[] // Relación agregada
}

// NUEVA ENTIDAD: CLIENTE FINAL (Vital para Scoring futuro)
model Customer {
  id            String    @id @default(uuid())
  name          String
  taxId         String    // DNI / RUC
  email         String?
  phone         String?
  
  tenantId      String
  tenant        Tenant    @relation(fields: [tenantId], references: [id])
  
  sales         Sale[]    // Historial de compras del cliente

  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  @@unique([tenantId, taxId]) // No duplicar clientes en el mismo tenant
}

model Sale {
  // ... (Campos existentes) ...
  
  customerId    String?   // Opcional (Null = Venta Anónima)
  customer      Customer? @relation(fields: [customerId], references: [id])
}
`;

const SERVER_CODE = `// ESTO VA EN: /backend/server.ts

// ... (Imports y Config) ...

// 4. GESTIÓN DE CLIENTES
app.get('/api/customers', requireTenant, async (req, res) => {
  try {
    const customers = await prisma.customer.findMany({
      where: { tenantId: req.tenantId },
      orderBy: { name: 'asc' }
    });
    res.json(customers);
  } catch (error) {
    res.status(500).json({ error: 'Error cargando clientes' });
  }
});

// Actualización en POST /api/sales
/*
  En el body ahora recibimos: { items, paymentMethod, customerId }
  Y en prisma.sale.create data: {
     ...
     customerId: customerId || null,
     ...
  }
*/
`;

export const BLUEPRINTS: BlueprintFile[] = [
  {
    name: 'schema.prisma',
    language: 'prisma',
    content: PRISMA_SCHEMA_CODE,
    description: 'Schema actualizado con modelo Customer para CRM.'
  },
  {
    name: 'server.ts',
    language: 'typescript',
    content: SERVER_CODE,
    description: 'API actualizada con endpoints de Clientes.'
  },
  // ... (docker-compose igual)
];