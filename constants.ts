import { Product, Tenant, BlueprintFile } from './types';

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

// --- CODIGO BACKEND PARA VISUALIZACION EN BLUEPRINT VIEWER ---

const PRISMA_SCHEMA_CODE = `// ESTO VA EN: /backend/prisma/schema.prisma

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "mysql"
  url      = env("DATABASE_URL")
}

// 1. EL INQUILINO (La PyME)
model Tenant {
  id            String    @id @default(uuid())
  name          String
  type          String    // 'FERRETERIA', 'FARMACIA'
  slug          String    @unique // subdominio
  
  // Fintech Core
  walletBalance Decimal   @default(0.00) @db.Decimal(15, 2)
  creditScore   Int       @default(0)
  creditLimit   Decimal   @default(0.00) @db.Decimal(15, 2)
  
  users         User[]
  products      Product[]
  sales         Sale[]
  transactions  Transaction[]

  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  @@index([slug])
}

// 2. USUARIOS (Seguridad)
model User {
  id            String    @id @default(uuid())
  email         String    @unique
  passwordHash  String
  role          String    // 'OWNER', 'CASHIER'
  
  tenantId      String
  tenant        Tenant    @relation(fields: [tenantId], references: [id])
  
  sales         Sale[]

  createdAt     DateTime  @default(now())
}

// 3. INVENTARIO (Activos)
model Product {
  id            String    @id @default(uuid())
  sku           String
  name          String
  price         Decimal   @db.Decimal(10, 2)
  cost          Decimal   @db.Decimal(10, 2) // Para calcular margen
  stock         Int       @default(0)
  
  tenantId      String
  tenant        Tenant    @relation(fields: [tenantId], references: [id])
  
  saleItems     SaleItem[]

  @@unique([tenantId, sku]) // El SKU es único por tienda, no global
}

// 4. VENTAS (El motor del Scoring)
model Sale {
  id            String     @id @default(uuid())
  total         Decimal    @db.Decimal(12, 2)
  status        String     @default("COMPLETED") // 'COMPLETED', 'REFUNDED'
  paymentMethod String     // 'CASH', 'CARD', 'QR'
  
  tenantId      String
  tenant        Tenant     @relation(fields: [tenantId], references: [id])
  
  userId        String
  user          User       @relation(fields: [userId], references: [id])
  
  items         SaleItem[]
  
  createdAt     DateTime   @default(now())

  @@index([tenantId, createdAt])
}

model SaleItem {
  id            String   @id @default(uuid())
  saleId        String
  sale          Sale     @relation(fields: [saleId], references: [id])
  
  productId     String
  product       Product  @relation(fields: [productId], references: [id])
  
  quantity      Int
  priceAtSale   Decimal  @db.Decimal(10, 2) // Precio histórico
}

// 5. AUDITORÍA FINANCIERA (Inmutable)
model Transaction {
  id            String   @id @default(uuid())
  amount        Decimal  @db.Decimal(15, 2)
  type          String   // 'SALE_INCOME', 'LOAN_DISBURSEMENT', 'WITHDRAWAL'
  
  tenantId      String
  tenant        Tenant   @relation(fields: [tenantId], references: [id])
  
  referenceId   String?  // ID de la Venta o del Préstamo
  balanceAfter  Decimal  @db.Decimal(15, 2)
  
  createdAt     DateTime @default(now())
}`;

const SERVER_CODE = `// ESTO VA EN: /backend/server.ts
import express from 'express';
import cors from 'cors';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const app = express();

app.use(cors());
app.use(express.json());

// MIDDLEWARE: Simulación de Auth
const requireTenant = async (req, res, next) => {
  const tenantId = req.headers['x-tenant-id'] || 'tnt_01_alpha';
  req.tenantId = tenantId;
  next();
};

// --- RUTAS DE VENTAS (CORE FINTECH) ---
// POST /api/sales - Venta Atómica (El corazón de Nortex)
app.post('/api/sales', requireTenant, async (req, res) => {
  const { items, paymentMethod, userId } = req.body;

  try {
    // INICIO DE TRANSACCIÓN ACID
    const result = await prisma.$transaction(async (tx) => {
      let totalAmount = 0;
      const saleItemsData = [];

      // 1. Validar Stock y Calcular Totales
      for (const item of items) {
        const product = await tx.product.findUnique({ where: { id: item.productId } });

        if (product.stock < item.quantity) {
          throw new Error(\`Insufficient stock for \${product.name}\`);
        }

        await tx.product.update({
          where: { id: item.productId },
          data: { stock: { decrement: item.quantity } }
        });

        totalAmount += Number(product.price) * item.quantity;
        saleItemsData.push({
          productId: item.productId,
          quantity: item.quantity,
          priceAtSale: product.price
        });
      }

      // 2. Crear Venta
      const sale = await tx.sale.create({
        data: {
          tenantId: req.tenantId,
          userId: userId || 'system_user',
          total: totalAmount,
          paymentMethod: paymentMethod,
          items: { create: saleItemsData }
        }
      });

      // 3. ACTUALIZAR TENANT (Wallet & Scoring)
      const scoreIncrease = Math.floor(totalAmount / 100);
      const updatedTenant = await tx.tenant.update({
        where: { id: req.tenantId },
        data: {
          walletBalance: { increment: totalAmount },
          creditScore: { increment: scoreIncrease }
        }
      });

      // 4. LOG FINANCIERO
      await tx.transaction.create({
        data: {
          tenantId: req.tenantId,
          amount: totalAmount,
          type: 'SALE_INCOME',
          referenceId: sale.id,
          balanceAfter: updatedTenant.walletBalance
        }
      });

      return sale;
    });

    res.status(201).json({ success: true, saleId: result.id });

  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(\`🚀 Nortex API Core running on port \${PORT}\`);
});`;

export const BLUEPRINTS: BlueprintFile[] = [
  {
    name: 'schema.prisma',
    language: 'prisma',
    content: PRISMA_SCHEMA_CODE,
    description: 'Schema de Base de Datos MySQL + Prisma. Define la relación entre Ventas, Wallet y Scoring.'
  },
  {
    name: 'server.ts',
    language: 'typescript',
    content: SERVER_CODE,
    description: 'API Principal (Express). Contiene la lógica de TRANSACCIÓN ATÓMICA para ventas.'
  },
  {
    name: 'docker-compose.yml',
    language: 'yaml',
    content: `
version: '3.8'
services:
  api:
    build: .
    environment:
      - DATABASE_URL=mysql://user:pass@db:3306/nortex
    ports:
      - "3000:3000"
    depends_on:
      - db
  db:
    image: mysql:8.0
    environment:
      MYSQL_ROOT_PASSWORD: root
      MYSQL_DATABASE: nortex
    volumes:
      - mysql_data:/var/lib/mysql
volumes:
  mysql_data:
`,
    description: 'Infraestructura Local para desarrollo.'
  }
];