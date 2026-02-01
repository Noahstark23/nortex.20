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

export const SQL_SCHEMA = `
-- FASE 1: DATABASE SCHEMA (PostgreSQL 16)
-- Aislamiento: Row-Level Security (RLS) via tenant_id. 
-- Es más barato y escalable que schemas separados para miles de PyMEs.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. TENANTS (Inquilinos)
CREATE TABLE tenants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(50) UNIQUE NOT NULL, -- para subdominios ferreteria-a.nortex.com
    business_type VARCHAR(50) NOT NULL, -- 'FERRETERIA', 'FARMACIA'
    status VARCHAR(20) DEFAULT 'ACTIVE',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. USERS (Administradores y Cajeros)
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(20) DEFAULT 'CASHIER', -- 'ADMIN', 'OWNER'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
-- Index para búsquedas rápidas por tenant
CREATE INDEX idx_users_tenant ON users(tenant_id);

-- 3. PRODUCTS (Inventario)
CREATE TABLE products (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    sku VARCHAR(100) NOT NULL,
    name VARCHAR(255) NOT NULL,
    price DECIMAL(10, 2) NOT NULL,
    stock_quantity INTEGER DEFAULT 0,
    cost DECIMAL(10, 2), -- Para calcular margen real
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(tenant_id, sku) -- SKU único por tenant, no global
);

-- 4. SALES (El corazón del Scoring)
CREATE TABLE sales (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id),
    total_amount DECIMAL(12, 2) NOT NULL,
    payment_method VARCHAR(50) DEFAULT 'CASH', -- 'CARD', 'YAPE', 'QR'
    status VARCHAR(20) DEFAULT 'COMPLETED',
    metadata JSONB, -- Datos extra del POS
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX idx_sales_tenant_date ON sales(tenant_id, created_at DESC);

-- 5. WALLETS (Fintech Core)
CREATE TABLE wallets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE UNIQUE,
    balance DECIMAL(15, 2) DEFAULT 0.00 CHECK (balance >= 0),
    currency VARCHAR(3) DEFAULT 'USD',
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 6. TRANSACTION_LOGS (Auditoría Inmutable)
CREATE TABLE transaction_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    wallet_id UUID REFERENCES wallets(id),
    amount DECIMAL(15, 2) NOT NULL,
    type VARCHAR(50) NOT NULL, -- 'SALE_DEPOSIT', 'LOAN_DISBURSEMENT', 'WITHDRAWAL'
    reference_id UUID, -- Link a sale_id o loan_id
    balance_after DECIMAL(15, 2) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 7. CREDIT_SCORES (El Negocio Real)
CREATE TABLE credit_scores (
    tenant_id UUID REFERENCES tenants(id) PRIMARY KEY,
    score INTEGER DEFAULT 0, -- 0 a 1000
    max_credit_limit DECIMAL(12, 2) DEFAULT 0,
    last_calculated_at TIMESTAMP WITH TIME ZONE,
    risk_level VARCHAR(20) -- 'LOW', 'MEDIUM', 'HIGH'
);
`;

export const DOCKER_COMPOSE = `
# FASE 3: INFRAESTRUCTURA (Coolify / DigitalOcean)
version: '3.8'

services:
  # 1. GATEWAY (Nginx Proxy Manager o Traefik gestionado por Coolify)
  # Este servicio maneja SSL y enrutamiento a los tenants.

  # 2. API (Backend NestJS)
  api:
    image: nortex/api:latest
    build:
      context: ./backend
      dockerfile: Dockerfile
    restart: always
    environment:
      - NODE_ENV=production
      - DATABASE_URL=postgresql://nortex_user:secure_pass@db:5432/nortex_db
      - REDIS_URL=redis://redis:6379
      - JWT_SECRET=\${JWT_SECRET}
    ports:
      - "3000:3000"
    depends_on:
      - db
      - redis
    networks:
      - nortex-internal

  # 3. DATABASE (PostgreSQL 16)
  db:
    image: postgres:16-alpine
    restart: always
    environment:
      POSTGRES_USER: nortex_user
      POSTGRES_PASSWORD: \${DB_PASSWORD}
      POSTGRES_DB: nortex_db
    volumes:
      - pgdata:/var/lib/postgresql/data
    networks:
      - nortex-internal
    # No ports exposed to host for security

  # 4. REDIS (Queue & Cache)
  redis:
    image: redis:7-alpine
    restart: always
    volumes:
      - redisdata:/data
    networks:
      - nortex-internal

  # 5. WORKER (Procesamiento asíncrono de Scoring)
  worker:
    image: nortex/worker:latest
    environment:
      - DATABASE_URL=postgresql://nortex_user:secure_pass@db:5432/nortex_db
      - REDIS_URL=redis://redis:6379
    depends_on:
      - db
      - redis
    networks:
      - nortex-internal

volumes:
  pgdata:
  redisdata:

networks:
  nortex-internal:
    driver: bridge
`;

export const API_STRUCTURE = `
# FASE 2: API BLUEPRINT (Clean Architecture - NestJS)

src/
├── app.module.ts
├── main.ts
├── common/             # Decorators, Filters, Guards
│   ├── decorators/
│   │   └── current-tenant.decorator.ts # Extrae tenant_id del JWT
│   └── guards/
├── modules/
│   ├── auth/           # Auth Module
│   │   ├── controllers/
│   │   │   └── auth.controller.ts  # POST /auth/login, POST /auth/register
│   │   ├── services/
│   │   │   └── auth.service.ts
│   │   └── strategies/             # JWT Strategy
│   ├── pos/            # Point of Sale Module
│   │   ├── controllers/
│   │   │   └── sales.controller.ts # POST /pos/sales
│   │   ├── services/
│   │   │   └── sales.service.ts    # Atomic Transaction (Stock -1, Cash +1)
│   ├── fintech/        # Fintech Core
│   │   ├── controllers/
│   │   │   └── loans.controller.ts # GET /fintech/loan-offer
│   │   ├── services/
│   │   │   └── scoring.service.ts  # Logic to calculate risk
│   └── dashboard/
│       ├── controllers/
│       │   └── stats.controller.ts # GET /dashboard/stats
└── database/
    ├── entities/       # TypeORM Entities
    └── migrations/
`;

export const BLUEPRINTS: BlueprintFile[] = [
  {
    name: 'schema.sql',
    language: 'sql',
    content: SQL_SCHEMA,
    description: 'Diseño de Base de Datos PostgreSQL Multi-tenant optimizado para Fintech.'
  },
  {
    name: 'docker-compose.yml',
    language: 'yaml',
    content: DOCKER_COMPOSE,
    description: 'Orquestación de contenedores para producción en Coolify.'
  },
  {
    name: 'backend-structure',
    language: 'bash',
    content: API_STRUCTURE,
    description: 'Arquitectura de carpetas Backend (NestJS Clean Architecture).'
  }
];
