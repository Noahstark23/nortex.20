import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * QA HTTP real del rail fiscal protegido.
 *
 * Se omite en la suite normal porque necesita una instancia descartable con
 * MySQL. Ejecución:
 *   NORTEX_QA_BASE_URL=http://127.0.0.1:3300 vitest run tests/fiscalFlow.integration.test.ts
 */
const QA_BASE_URL = process.env.NORTEX_QA_BASE_URL?.replace(/\/$/, '');
const qaDescribe = QA_BASE_URL ? describe.sequential : describe.skip;

type JsonResult = { response: Response; body: any };
type FiscalEndpoint = {
  name: string;
  path: string;
  init?: RequestInit;
};

let ownerToken = '';
let accountantToken = '';
let cashierToken = '';
let foreignOwnerToken = '';
let purchaseId = '';
let fiscalMonth = 0;
let fiscalYear = 0;

let xssCompanyName = '';
let foreignCompanyName = '';
let xssSupplierName = '';
let xssInvoiceNumber = '';
let xssFiscalAddress = '';
let xssFiscalPhone = '';
let xssDgiCode = '';
let xssSupplierRuc = '';
let xssSupplierPhone = '';

const qaStats = {
  httpRequests: 0,
  registrationRequests: 0,
  stabilityRounds: 0,
  stabilityRequests: 0,
};
let inStabilityLoop = false;

async function request(path: string, token = ownerToken, init: RequestInit = {}) {
  if (!QA_BASE_URL) throw new Error('NORTEX_QA_BASE_URL no esta definido');

  qaStats.httpRequests += 1;
  if (path === '/api/auth/register') qaStats.registrationRequests += 1;
  if (inStabilityLoop) qaStats.stabilityRequests += 1;

  const headers = new Headers(init.headers);
  if (token) headers.set('authorization', `Bearer ${token}`);
  if (init.body) headers.set('content-type', 'application/json');

  return fetch(`${QA_BASE_URL}${path}`, { ...init, headers });
}

async function jsonRequest(path: string, token = ownerToken, init: RequestInit = {}): Promise<JsonResult> {
  const response = await request(path, token, init);
  const text = await response.text();
  let body: any = null;
  if (text) {
    try { body = JSON.parse(text); } catch { body = text; }
  }
  return { response, body };
}

async function post(path: string, body: unknown, token = ownerToken) {
  return jsonRequest(path, token, { method: 'POST', body: JSON.stringify(body) });
}

async function put(path: string, body: unknown, token = ownerToken) {
  return jsonRequest(path, token, { method: 'PUT', body: JSON.stringify(body) });
}

function expectStatus(result: JsonResult, expected: number) {
  expect(result.response.status, JSON.stringify(result.body)).toBe(expected);
}

function fiscalEndpoints(): FiscalEndpoint[] {
  return [
    {
      name: 'constancia',
      path: `/api/fiscal/constancia-retencion/${purchaseId}`,
    },
    {
      name: 'DMI',
      path: `/api/tax-report/dmi?month=${fiscalMonth}&year=${fiscalYear}`,
    },
    {
      name: 'generar declaración',
      path: '/api/tax-report/generate',
      init: {
        method: 'POST',
        body: JSON.stringify({ month: fiscalMonth, year: fiscalYear }),
      },
    },
    {
      name: 'reporte almacenado',
      path: `/api/tax-report/${fiscalMonth}/${fiscalYear}`,
    },
    {
      name: 'libro de ventas',
      path: `/api/fiscal/libro-ventas/${fiscalMonth}/${fiscalYear}`,
    },
    {
      name: 'libro de compras',
      path: `/api/fiscal/libro-compras/${fiscalMonth}/${fiscalYear}`,
    },
    {
      name: 'resumen VET',
      path: `/api/fiscal/vet-export/${fiscalMonth}/${fiscalYear}`,
    },
  ];
}

async function inviteAndAccept(runId: string, role: 'ACCOUNTANT' | 'CASHIER', name: string) {
  const invitation = await post('/api/team/invite', {
    email: `qa-fiscal-${role.toLowerCase()}-${runId}@example.com`,
    role,
  });
  expectStatus(invitation, 200);

  const accepted = await post(`/api/invite/${invitation.body.invitation.token}/accept`, {
    name,
    password: `Qa-${runId}-${role}-Seguro!`,
  }, '');
  expectStatus(accepted, 200);
  expect(accepted.body.user.role).toBe(role);
  expect(typeof accepted.body.token).toBe('string');
  return accepted.body.token as string;
}

async function expectJsonFiscalSuccess(token: string) {
  const declaration = await post('/api/tax-report/generate', {
    month: fiscalMonth,
    year: fiscalYear,
  }, token);
  expectStatus(declaration, 200);
  expect(declaration.body.month).toBe(fiscalMonth);
  expect(declaration.body.year).toBe(fiscalYear);
  // La compra fue ingresada después, pero su fecha civil de factura pertenece
  // a este período y debe alimentar la declaración fiscal retroactiva.
  expect(declaration.body.totalPurchases).toBe(230);
  expect(declaration.body.totalIVAPaid).toBe(30);

  const stored = await jsonRequest(`/api/tax-report/${fiscalMonth}/${fiscalYear}`, token);
  expectStatus(stored, 200);
  expect(stored.body.month).toBe(fiscalMonth);
  expect(stored.body.year).toBe(fiscalYear);

  const dmi = await jsonRequest(
    `/api/tax-report/dmi?month=${fiscalMonth}&year=${fiscalYear}`,
    token,
  );
  expectStatus(dmi, 200);
  expect(dmi.body.month).toBe(fiscalMonth);
  expect(dmi.body.year).toBe(fiscalYear);
  expect(dmi.body.dmiReport).toContain('DECLARACIÓN MENSUAL DE IMPUESTOS');
  expect(dmi.body.totalPurchases).toBe(230);
  expect(dmi.body.totalIVAPaid).toBe(30);
  expect(dmi.body.tenantName).toBe(xssCompanyName);
}

async function expectConstanciaSuccess(token: string) {
  const response = await request(`/api/fiscal/constancia-retencion/${purchaseId}`, token);
  const html = await response.text();
  expect(response.status, html).toBe(200);
  expect(response.headers.get('content-type')).toContain('text/html');
  expect(html).toContain('Constancia de Retención en la Fuente');
  // La compra fixture tiene subtotal C$200, IVA C$30 y no genera filas de
  // FiscalRetention antes de pedir la constancia. El fallback debe mantener el
  // mismo desglose que generateRetentions: IR C$4 + IMI C$2 + IVA C$30.
  expect(html).toContain('IVA Retenido');
  expect(html).toContain('C$ 36.00');
  expect(html).toContain('C$ 194.00');
  expect(html).toContain('31 de julio de 2026');
}

async function expectFiscalFilesSuccess(token: string) {
  const books = [
    `/api/fiscal/libro-ventas/${fiscalMonth}/${fiscalYear}`,
    `/api/fiscal/libro-compras/${fiscalMonth}/${fiscalYear}`,
  ];

  for (const endpoint of books) {
    const response = await request(endpoint, token);
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('spreadsheetml.sheet');
    expect(String.fromCharCode(...bytes.slice(0, 2))).toBe('PK');
    expect(bytes.byteLength).toBeGreaterThan(100);
  }

  const vet = await request(`/api/fiscal/vet-export/${fiscalMonth}/${fiscalYear}`, token);
  const vetText = await vet.text();
  expect(vet.status, vetText).toBe(200);
  expect(vet.headers.get('content-type')).toContain('text/plain');
  expect(vet.headers.get('content-disposition')).toContain(`VET-${fiscalYear}${String(fiscalMonth).padStart(2, '0')}.txt`);
  expect(vetText).toContain('## LIBRO DE COMPRAS');
  expect(vetText).toContain(xssInvoiceNumber);
  expect(vetText).toContain('C|20260731|');
}

async function expectFiscalRailSuccess(token: string) {
  await expectJsonFiscalSuccess(token);
  await expectConstanciaSuccess(token);
  await expectFiscalFilesSuccess(token);
}

async function expectGenericReportsSuccess(token: string) {
  const sales = await jsonRequest('/api/reports/sales', token);
  expectStatus(sales, 200);
  expect(typeof sales.body.totalVentas).toBe('number');
  expect(Array.isArray(sales.body.chartData)).toBe(true);

  const inventory = await jsonRequest('/api/reports/inventory', token);
  expectStatus(inventory, 200);
  expect(inventory.body.totalProducts).toBeGreaterThanOrEqual(1);
  expect(Array.isArray(inventory.body.lowStock)).toBe(true);

  const expenses = await jsonRequest('/api/reports/expenses', token);
  expectStatus(expenses, 200);
  expect(typeof expenses.body.totalExpenses).toBe('number');
  expect(typeof expenses.body.count).toBe('number');
}

qaDescribe('QA integracion: documentos, DGI y reportes autenticados', () => {
  beforeAll(async () => {
    const runId = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;

    xssCompanyName = `QA Fiscal ${runId} <img src=x onerror="alert(0)">`;
    foreignCompanyName = `QA Fiscal Aislado ${runId}`;
    xssSupplierName = 'Proveedor <b>QA</b> & "Fiscal" <img src=x onerror="alert(5)">';
    xssInvoiceNumber = `FAC-${runId}-</span><script>alert(7)</script>`;
    xssFiscalAddress = '"><img src=x onerror="alert(2)">';
    xssFiscalPhone = '<script>alert(3)</script>';
    xssDgiCode = '</style><script>alert(4)</script>';
    xssSupplierRuc = '<svg/onload=alert(6)>';
    xssSupplierPhone = '"><script>alert(8)</script>';

    const registration = await post('/api/auth/register', {
      companyName: xssCompanyName,
      email: `qa-fiscal-owner-${runId}@example.com`,
      password: `Qa-${runId}-Owner-Seguro!`,
      type: 'FARMACIA',
    }, '');
    expectStatus(registration, 200);
    // El registro público representa al dueño del negocio y emite rol ADMIN;
    // checkRole trata ADMIN y OWNER como superusuarios equivalentes.
    expect(registration.body.user.role).toBe('ADMIN');
    ownerToken = registration.body.token;

    accountantToken = await inviteAndAccept(runId, 'ACCOUNTANT', 'Contador QA');
    cashierToken = await inviteAndAccept(runId, 'CASHIER', 'Cajero QA');

    const fiscalConfig = await put('/api/tenant/fiscal', {
      taxId: `RUC-${runId}-${xssSupplierRuc}`,
      address: xssFiscalAddress,
      phone: xssFiscalPhone,
      dgiAuthCode: xssDgiCode,
    });
    expectStatus(fiscalConfig, 200);

    const supplier = await post('/api/suppliers', {
      name: xssSupplierName,
      ruc: xssSupplierRuc,
      phone: xssSupplierPhone,
      category: 'QA Fiscal',
    });
    expectStatus(supplier, 200);

    const product = await post('/api/products', {
      name: 'Producto QA Fiscal',
      sku: `QA-FISCAL-${runId}`,
      category: 'QA Fiscal',
      price: 25,
      cost: 0,
      stock: 0,
      minStock: 0,
      unit: 'unidad',
      isPublished: false,
      requiresBatchTracking: false,
      ivaExento: false,
    });
    expectStatus(product, 200);

    const purchase = await post('/api/purchases', {
      supplierId: supplier.body.id,
      invoiceNumber: xssInvoiceNumber,
      // Factura civil retroactiva: el período fiscal debe seguir esta fecha,
      // no el instante actual en que el usuario registra la compra.
      date: '2026-07-31',
      // Un tenant recién registrado inicia con billetera C$0. La compra fiscal
      // a crédito permite probar el flujo real sin sembrar dinero por fuera de
      // la API y sigue entrando al Libro de Compras como PENDING_PAYMENT.
      paymentMethod: 'CREDIT',
      dueDate: '2099-12-31',
      notes: 'QA fiscal aislado',
      items: [{ productId: product.body.id, quantity: 2, unitCost: 100 }],
    });
    expectStatus(purchase, 200);
    purchaseId = purchase.body.purchase.id;
    expect(purchase.body.purchase.date).toBe('2026-07-31T12:00:00.000Z');

    fiscalMonth = 7;
    fiscalYear = 2026;

    const foreignRegistration = await post('/api/auth/register', {
      companyName: foreignCompanyName,
      email: `qa-fiscal-foreign-${runId}@example.com`,
      password: `Qa-${runId}-Foreign-Seguro!`,
      type: 'RETAIL',
    }, '');
    expectStatus(foreignRegistration, 200);
    foreignOwnerToken = foreignRegistration.body.token;

    expect(qaStats.registrationRequests).toBe(2);
  }, 120_000);

  afterAll(() => {
    console.info(`[fiscal-e2e-stats] ${JSON.stringify(qaStats)}`);
  });

  it('exige Bearer en las siete operaciones fiscales', async () => {
    for (const endpoint of fiscalEndpoints()) {
      const result = await jsonRequest(endpoint.path, '', endpoint.init);
      expect(result.response.status, `${endpoint.name}: ${JSON.stringify(result.body)}`).toBe(401);
    }
  });

  it('deniega al CASHIER constancia, DMI, generación, libros, VET y reporte almacenado', async () => {
    for (const endpoint of fiscalEndpoints()) {
      const result = await jsonRequest(endpoint.path, cashierToken, endpoint.init);
      expect(result.response.status, `${endpoint.name}: ${JSON.stringify(result.body)}`).toBe(403);
      expect(result.body.error).toContain('Permisos insuficientes');
    }
  });

  it('permite al responsable registrado y al ACCOUNTANT todo el rail fiscal', async () => {
    for (const token of [ownerToken, accountantToken]) {
      await expectFiscalRailSuccess(token);
    }
  }, 90_000);

  it('aísla compras y reportes almacenados entre tenants', async () => {
    const foreignConstancia = await jsonRequest(
      `/api/fiscal/constancia-retencion/${purchaseId}`,
      foreignOwnerToken,
    );
    expectStatus(foreignConstancia, 404);

    const foreignStored = await jsonRequest(
      `/api/tax-report/${fiscalMonth}/${fiscalYear}`,
      foreignOwnerToken,
    );
    expectStatus(foreignStored, 404);

    const foreignDmi = await jsonRequest(
      `/api/tax-report/dmi?month=${fiscalMonth}&year=${fiscalYear}`,
      foreignOwnerToken,
    );
    expectStatus(foreignDmi, 200);
    expect(foreignDmi.body.tenantName).toBe(foreignCompanyName);
    expect(foreignDmi.body.tenantName).not.toBe(xssCompanyName);
  });

  it('mantiene operativos ventas, inventario y gastos para responsable y contador', async () => {
    for (const token of [ownerToken, accountantToken]) {
      await expectGenericReportsSuccess(token);
    }
  });

  it('rechaza sin coerción períodos parciales, ausentes o fuera de rango', async () => {
    const invalidGetEndpoints = [
      '/api/tax-report/dmi?month=8foo&year=2026',
      '/api/tax-report/dmi?year=2026',
      '/api/tax-report/dmi?month=8&month=9&year=2026',
      '/api/tax-report/8foo/2026',
      '/api/tax-report/%208/2026',
      '/api/fiscal/libro-ventas/8.5/2026',
      '/api/fiscal/libro-ventas/8/2019',
      '/api/fiscal/libro-compras/13/2026',
      '/api/fiscal/libro-compras/8/2101',
      '/api/fiscal/vet-export/0/2026',
    ];

    for (const endpoint of invalidGetEndpoints) {
      const result = await jsonRequest(endpoint, accountantToken);
      expectStatus(result, 400);
      expect(result.body.error).toBe('Mes o año inválido.');
    }

    const invalidGenerateBodies = [
      { month: 8.5, year: 2026 },
      { month: 0, year: 2026 },
      { month: 13, year: 2026 },
      { month: 8, year: 2019 },
      { month: 8, year: 2101 },
      { month: '8', year: 2026 },
    ];

    for (const body of invalidGenerateBodies) {
      const result = await post('/api/tax-report/generate', body, accountantToken);
      expectStatus(result, 400);
      expect(result.body.error).toBe('Datos de entrada inválidos');
    }
  });

  it('escapa datos persistidos y aplica CSP con nonce a la constancia', async () => {
    for (const token of [ownerToken, accountantToken]) {
      const response = await request(`/api/fiscal/constancia-retencion/${purchaseId}`, token);
      const html = await response.text();
      const csp = response.headers.get('content-security-policy') || '';

      expect(response.status, html).toBe(200);
      expect(response.headers.get('cache-control')).toContain('no-store');
      expect(response.headers.get('pragma')).toBe('no-cache');
      expect(response.headers.get('x-content-type-options')).toBe('nosniff');
      expect(response.headers.get('referrer-policy')).toBe('no-referrer');
      expect(response.headers.get('x-frame-options')).toBe('SAMEORIGIN');

      expect(csp).toContain("default-src 'none'");
      expect(csp).toContain("base-uri 'none'");
      expect(csp).toContain("form-action 'none'");
      expect(csp).toContain("frame-ancestors 'self'");
      const nonceMatch = csp.match(/script-src 'nonce-([^']+)'/);
      expect(nonceMatch).not.toBeNull();
      const nonce = nonceMatch?.[1] || '';
      expect(csp.match(/script-src[^;]*/)?.[0]).not.toContain("'unsafe-inline'");
      expect(html).toContain(`<script nonce="${nonce}">`);
      expect(html).toContain(`script-src &#39;nonce-${nonce}&#39;`);
      expect(html.match(/<script\b/g)).toHaveLength(1);
      expect(html).not.toContain('onclick=');

      for (const rawPayload of [
        xssCompanyName,
        xssSupplierName,
        xssInvoiceNumber,
        xssFiscalAddress,
        xssFiscalPhone,
        xssDgiCode,
        xssSupplierRuc,
        xssSupplierPhone,
      ]) {
        expect(html).not.toContain(rawPayload);
      }

      expect(html).toContain('Proveedor &lt;b&gt;QA&lt;/b&gt; &amp; &quot;Fiscal&quot;');
      expect(html).toContain('&lt;img src=x onerror=&quot;alert(5)&quot;&gt;');
      expect(html).toContain('&lt;/span&gt;&lt;script&gt;alert(7)&lt;/script&gt;');
      expect(html).toContain('&lt;svg/onload=alert(6)&gt;');
    }
  });

  it('permanece estable durante 10 rondas completas sin volver a registrar tenants', async () => {
    const registrationsBeforeLoop = qaStats.registrationRequests;
    inStabilityLoop = true;

    try {
      for (let round = 1; round <= 10; round += 1) {
        for (const endpoint of fiscalEndpoints()) {
          const unauthenticated = await jsonRequest(endpoint.path, '', endpoint.init);
          expect(unauthenticated.response.status, `ronda ${round}, sin auth, ${endpoint.name}`).toBe(401);
        }

        for (const endpoint of fiscalEndpoints()) {
          const denied = await jsonRequest(endpoint.path, cashierToken, endpoint.init);
          expect(denied.response.status, `ronda ${round}, CASHIER, ${endpoint.name}`).toBe(403);
        }

        for (const token of [ownerToken, accountantToken]) {
          await expectFiscalRailSuccess(token);
          await expectGenericReportsSuccess(token);
        }

        const foreignConstancia = await jsonRequest(
          `/api/fiscal/constancia-retencion/${purchaseId}`,
          foreignOwnerToken,
        );
        expect(foreignConstancia.response.status, `ronda ${round}, aislamiento constancia`).toBe(404);

        const foreignStored = await jsonRequest(
          `/api/tax-report/${fiscalMonth}/${fiscalYear}`,
          foreignOwnerToken,
        );
        expect(foreignStored.response.status, `ronda ${round}, aislamiento reporte`).toBe(404);

        qaStats.stabilityRounds = round;
      }
    } finally {
      inStabilityLoop = false;
    }

    expect(qaStats.registrationRequests).toBe(registrationsBeforeLoop);
    expect(qaStats.registrationRequests).toBe(2);
    expect(qaStats.stabilityRounds).toBe(10);
    expect(qaStats.stabilityRequests).toBe(360);
  }, 240_000);
});
