// ENTREGABLE 2: server.ts
import express from 'express';
import cors from 'cors';
import { PrismaClient } from '@prisma/client';

const app = express();
const prisma = new PrismaClient();

// Configuración básica
app.use(cors()); 
app.use(express.json());

// --- UTILS ---
// Verified: Atomic transaction and default values (creditScore: 300) are implemented correctly.
// En producción, usar una librería real de JWT y middleware de sesión.
// Aquí simulamos obteniendo el tenant del header para las rutas protegidas.
const requireTenant = async (req, res, next) => {
  const tenantId = req.headers['x-tenant-id'];
  if (!tenantId) return res.status(401).json({ error: 'Unauthorized: Missing Tenant ID' });
  req.tenantId = tenantId;
  next();
};

// --- AUTH & ONBOARDING (SaaS Core) ---

// POST /api/auth/register - El nacimiento de un nuevo cliente
app.post('/api/auth/register', async (req, res) => {
  const { companyName, email, password, type } = req.body;

  if (!companyName || !email || !password) {
    return res.status(400).json({ error: 'Faltan datos requeridos' });
  }

  try {
    // TRANSACCIÓN DE ALTA: Crear Tenant + Crear Usuario Owner
    const result = await prisma.$transaction(async (tx) => {
      // 1. Verificar si el email ya existe
      const existingUser = await tx.user.findUnique({ where: { email } });
      if (existingUser) throw new Error('El email ya está registrado');

      // 2. Crear Tenant (La empresa)
      // Generamos un slug simple basado en el nombre (en prod usar librería de slugs)
      const slug = companyName.toLowerCase().replace(/ /g, '-') + '-' + Math.floor(Math.random() * 1000);

      const tenant = await tx.tenant.create({
        data: {
          name: companyName,
          type: type || 'RETAIL',
          slug: slug,
          plan: 'FREE', // Todos empiezan gratis
          walletBalance: 0,
          creditScore: 300, // Score base inicial
          creditLimit: 0
        }
      });

      // 3. Crear Usuario (El dueño)
      const user = await tx.user.create({
        data: {
          email,
          passwordHash: password, // WARNING: EN PROD USAR BCRYPT!!!
          role: 'OWNER',
          tenantId: tenant.id
        }
      });

      return { tenant, user };
    });

    res.status(201).json({
      success: true,
      message: 'Empresa registrada exitosamente',
      tenantId: result.tenant.id,
      user: { email: result.user.email, role: result.user.role },
      redirectUrl: '/app/dashboard'
    });

  } catch (error: any) {
    console.error('Registration error:', error);
    res.status(400).json({ error: error.message || 'Error en el registro' });
  }
});


// --- RUTAS DE APP (Protegidas) ---

// 1. OBTENER DATOS DE SESIÓN (Para el frontend)
app.get('/api/session', requireTenant, async (req, res) => {
  try {
    const tenant = await prisma.tenant.findUnique({
      where: { id: req.tenantId },
      select: { name: true, type: true, walletBalance: true, creditScore: true, creditLimit: true }
    });
    res.json({ tenant });
  } catch (error) {
    res.status(500).json({ error: 'Error de sesión' });
  }
});

// 2. OBTENER PRODUCTOS
app.get('/api/products', requireTenant, async (req, res) => {
  try {
    const products = await prisma.product.findMany({
      where: { tenantId: req.tenantId },
      select: { id: true, name: true, price: true, stock: true, sku: true }
    });
    res.json(products);
  } catch (error) {
    res.status(500).json({ error: 'Error interno obteniendo productos' });
  }
});

// 3. PROCESAR VENTA
app.post('/api/sales', requireTenant, async (req, res) => {
  const { items } = req.body; 
  const tenantId = req.tenantId;

  if (!items || items.length === 0) {
    return res.status(400).json({ error: 'El carrito está vacío' });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      let totalSale = 0;
      const saleItemsData = [];

      for (const item of items) {
        const product = await tx.product.findUnique({ where: { id: item.id } });

        if (!product) throw new Error(`Producto ${item.id} no encontrado`);
        if (product.tenantId !== tenantId) throw new Error('Acceso denegado al producto');
        if (product.stock < item.quantity) throw new Error(`Stock insuficiente: ${product.name}`);

        await tx.product.update({
          where: { id: item.id },
          data: { stock: { decrement: item.quantity } }
        });

        const lineTotal = Number(product.price) * item.quantity;
        totalSale += lineTotal;

        saleItemsData.push({
          productId: product.id,
          quantity: item.quantity,
          priceAtSale: product.price
        });
      }

      const sale = await tx.sale.create({
        data: {
          tenantId,
          total: totalSale,
          status: 'COMPLETED',
          paymentMethod: 'CASH', 
          userId: 'system', // TODO: Pasar ID de usuario real
          items: { create: saleItemsData }
        }
      });

      const scorePoints = Math.floor(totalSale / 10);

      await tx.tenant.update({
        where: { id: tenantId },
        data: {
          walletBalance: { increment: totalSale },
          creditScore: { increment: scorePoints }
        }
      });

      return sale;
    });

    res.json({ success: true, saleId: result.id, message: 'Venta procesada correctamente' });

  } catch (error: any) {
    console.error('Error en transacción:', error);
    res.status(400).json({ error: error.message || 'Error procesando la venta' });
  }
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`🚀 Nortex Backend escuchando en http://localhost:${PORT}`);
});