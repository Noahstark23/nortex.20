/**
 * NORTEX — Video Demo Automatizado (v2)
 * 
 * Estrategia HÍBRIDA:
 *   1) Registra empresa + login via UI  → captura la pantalla bonita
 *   2) Crea datos via API directa       → rápido y 100% confiable
 *   3) Navega a cada módulo             → muestra UI con datos reales
 *   4) Hace la venta desde el POS UI   → la escena más importante
 *   5) Cierra caja via UI              → muestra la auditoría
 *   6) Tour de módulos                 → muestra el ecosistema completo
 * 
 * Ejecutar:  node demo-video.mjs
 */

import puppeteer from 'puppeteer';

const SITE = 'https://somosnortex.com';
const TS = Date.now();
const DEMO_EMAIL = `demo${TS}@nortex.com`;
const DEMO_PASS = 'Demo1234!';
const COMPANY = 'Ferretería Central Nica';
const EMPLOYEE_PIN = '1234';

// ─── Helpers ────────────────────────────────────────────────
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const log = (icon, msg) => console.log(`   ${icon} ${msg}`);
const banner = (title) => {
    console.log(`\n${'═'.repeat(50)}`);
    console.log(`  🎬  ${title}`);
    console.log(`${'═'.repeat(50)}`);
};

async function smoothScroll(page, distance = 300, duration = 1500) {
    await page.evaluate(async (d, dur) => {
        const container = document.querySelector('.overflow-y-auto') || document.scrollingElement;
        if (!container) return;
        const steps = 30;
        const step = d / steps;
        const delay = dur / steps;
        for (let i = 0; i < steps; i++) {
            container.scrollBy(0, step);
            await new Promise(r => setTimeout(r, delay));
        }
    }, distance, duration);
}

async function typeSlowly(page, selector, text, delay = 80) {
    await page.waitForSelector(selector, { timeout: 10000 });
    await page.click(selector);
    await page.type(selector, text, { delay });
}

async function clickText(page, text, tag = 'button') {
    await page.evaluate((t, tg) => {
        const els = [...document.querySelectorAll(tg)];
        const el = els.find(e => e.textContent.includes(t));
        if (el) el.click();
        else throw new Error(`No se encontró ${tg} con texto: "${t}"`);
    }, text, tag);
}

// Wait for navigation or network idle
async function waitForLoad(page, ms = 2000) {
    await Promise.race([
        page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 8000 }).catch(() => { }),
        sleep(ms)
    ]);
    await sleep(500);
}

// ─── API helper: make authenticated fetch from browser context ───
async function apiCall(page, method, path, body) {
    return page.evaluate(async (m, p, b) => {
        const token = localStorage.getItem('nortex_token');
        const res = await fetch(p, {
            method: m,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: b ? JSON.stringify(b) : undefined
        });
        const data = await res.json();
        return { ok: res.ok, status: res.status, data };
    }, method, path, body);
}

// ═══════════════════════════════════════════════════════
// MAIN FLOW
// ═══════════════════════════════════════════════════════
(async () => {
    const browser = await puppeteer.launch({
        headless: false,
        defaultViewport: { width: 1440, height: 900 },
        args: ['--start-maximized', '--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });

    // Override alert/confirm/prompt to not block
    await page.evaluateOnNewDocument(() => {
        window.alert = (msg) => console.log('ALERT:', msg);
        window.confirm = () => true;
        window.prompt = () => '';
    });

    try {
        // ═══════════════════════════════════════════════
        // ESCENA 1: LANDING PAGE
        // ═══════════════════════════════════════════════
        banner('ESCENA 1: Landing Page');
        await page.goto(SITE, { waitUntil: 'networkidle2', timeout: 30000 });
        log('🌐', 'Landing page cargada');
        await sleep(3000);
        await smoothScroll(page, 500, 2000);
        await sleep(2000);

        // ═══════════════════════════════════════════════
        // ESCENA 2: REGISTRO DE EMPRESA
        // ═══════════════════════════════════════════════
        banner('ESCENA 2: Registro de Empresa');
        await page.goto(`${SITE}/register`, { waitUntil: 'networkidle2' });
        await sleep(1500);

        // Fill registration form
        // Company name
        const inputs = await page.$$('input');
        if (inputs.length >= 4) {
            // RegisterTenant fields: company name, email, password, confirm password
            await inputs[0].click();
            await inputs[0].type(COMPANY, { delay: 50 });
            await sleep(500);

            await inputs[1].click();
            await inputs[1].type(DEMO_EMAIL, { delay: 40 });
            await sleep(500);

            await inputs[2].click();
            await inputs[2].type(DEMO_PASS, { delay: 40 });
            await sleep(500);

            // Check if there's a confirm password or select
            if (inputs.length >= 4) {
                await inputs[3].click();
                await inputs[3].type(DEMO_PASS, { delay: 40 });
            }
        }

        log('📝', `Empresa: ${COMPANY}`);
        log('📧', `Email: ${DEMO_EMAIL}`);
        await sleep(1000);

        // Select business type if there's a select dropdown
        const selects = await page.$$('select');
        if (selects.length > 0) {
            await selects[0].select('Retail / Tienda');
        }

        // Click register button
        log('🚀', 'Registrando...');
        await clickText(page, 'Registrar', 'button');
        await waitForLoad(page, 5000);
        await sleep(3000);
        log('✅', 'Empresa registrada exitosamente');

        // ═══════════════════════════════════════════════
        // ESCENA 3: DASHBOARD — Primera vista
        // ═══════════════════════════════════════════════
        banner('ESCENA 3: Dashboard Financiero');
        await page.goto(`${SITE}/app/dashboard`, { waitUntil: 'networkidle2' });
        await sleep(3000);
        await smoothScroll(page, 400, 2000);
        await sleep(2000);
        log('📊', 'Dashboard financiero mostrado');

        // ═══════════════════════════════════════════════
        // CREAR DATOS VIA API (invisible pero rápido)
        // ═══════════════════════════════════════════════
        banner('SEEDING: Creando datos via API');

        // --- Crear Empleado ---
        log('👤', 'Creando empleado...');
        const empResult = await apiCall(page, 'POST', '/api/employees', {
            firstName: 'María',
            lastName: 'López',
            role: 'VENDEDOR',
            baseSalary: 8000,
            commissionRate: 0.05,
            pin: EMPLOYEE_PIN,
            cedula: '001-150395-0012K',
            inss: '987654321'
        });
        log(empResult.ok ? '✅' : '❌', `Empleado: ${empResult.ok ? 'María López creada' : empResult.data?.error}`);
        await sleep(500);

        // --- Crear segundo empleado ---
        const emp2Result = await apiCall(page, 'POST', '/api/employees', {
            firstName: 'Carlos',
            lastName: 'Mendoza',
            role: 'MANAGER',
            baseSalary: 12000,
            commissionRate: 0.03,
            pin: '5678',
            cedula: '001-290488-0034M',
            inss: '123456789'
        });
        log(emp2Result.ok ? '✅' : '❌', `Empleado: ${emp2Result.ok ? 'Carlos Mendoza creado' : emp2Result.data?.error}`);

        // --- Crear Clientes ---
        log('🤝', 'Creando clientes...');
        const clients = [
            { name: 'Distribuidora El Progreso', taxId: 'J0310000012345', phone: '8888-1234', email: 'progreso@mail.com', address: 'Managua, Km 4 Carretera Norte', creditLimit: 50000 },
            { name: 'Ferretería Los Ángeles', taxId: 'J0310000067890', phone: '8888-5678', email: 'angeles@mail.com', address: 'León Centro', creditLimit: 25000 },
            { name: 'Constructora del Sur', taxId: 'J0310000099999', phone: '8888-9999', email: 'consur@mail.com', address: 'Granada, Calle Atravesada', creditLimit: 100000 },
        ];
        for (const c of clients) {
            const r = await apiCall(page, 'POST', '/api/customers', c);
            log(r.ok ? '✅' : '⚠️', `Cliente: ${c.name} ${r.ok ? '✓' : r.data?.error || ''}`);
        }

        // --- Crear Productos ---
        log('📦', 'Creando productos...');
        const products = [
            { name: 'Cemento Canal 42.5kg', sku: 'CEM-001', category: 'Construcción', price: 320, cost: 260, stock: 150, minStock: 20, unit: 'unidad' },
            { name: 'Varilla 3/8" x 6m', sku: 'VAR-038', category: 'Acero', price: 185, cost: 140, stock: 200, minStock: 30, unit: 'unidad' },
            { name: 'Tubo PVC 1/2" x 6m', sku: 'PVC-012', category: 'Plomería', price: 95, cost: 65, stock: 100, minStock: 15, unit: 'unidad' },
            { name: 'Lámina Zinc Cal.26 12ft', sku: 'LAM-026', category: 'Techos', price: 450, cost: 350, stock: 80, minStock: 10, unit: 'unidad' },
            { name: 'Pintura Corona Blanca 1gl', sku: 'PIN-001', category: 'Pinturas', price: 680, cost: 520, stock: 40, minStock: 5, unit: 'unidad' },
            { name: 'Candado Yale 40mm', sku: 'CAN-040', category: 'Seguridad', price: 250, cost: 180, stock: 60, minStock: 10, unit: 'unidad' },
            { name: 'Arena Fina m³', sku: 'ARE-001', category: 'Agregados', price: 850, cost: 600, stock: 30, minStock: 5, unit: 'unidad' },
            { name: 'Alambre Galv. #16 rollo', sku: 'ALM-016', category: 'Acero', price: 120, cost: 85, stock: 75, minStock: 10, unit: 'rollo' },
        ];
        for (const p of products) {
            const r = await apiCall(page, 'POST', '/api/products', p);
            log(r.ok ? '✅' : '⚠️', `Producto: ${p.name} ${r.ok ? '✓' : r.data?.error || ''}`);
        }
        log('🎯', `${products.length} productos + ${clients.length} clientes + 2 empleados creados`);

        // --- Abrir Turno de Caja ---
        log('🔑', 'Abriendo turno de caja...');
        const shiftResult = await apiCall(page, 'POST', '/api/shifts/open', {
            initialCash: 5000,
            employeePin: EMPLOYEE_PIN
        });
        const shiftId = shiftResult.data?.id;
        log(shiftResult.ok ? '✅' : '❌', `Turno: ${shiftResult.ok ? 'Abierto con C$5,000' : shiftResult.data?.error}`);

        // --- Hacer 3 ventas via API ---
        log('💰', 'Procesando ventas...');
        const sales = [
            {
                items: [
                    { id: '', sku: 'CEM-001', quantity: 10, price: 320, costPrice: 260 },
                    { id: '', sku: 'VAR-038', quantity: 20, price: 185, costPrice: 140 },
                ],
                paymentMethod: 'CASH',
                customerName: 'Cliente General',
                total: (320 * 10 + 185 * 20) * 1.15
            },
            {
                items: [
                    { id: '', sku: 'PIN-001', quantity: 5, price: 680, costPrice: 520 },
                    { id: '', sku: 'LAM-026', quantity: 8, price: 450, costPrice: 350 },
                ],
                paymentMethod: 'CARD',
                customerName: 'Distribuidora El Progreso',
                total: (680 * 5 + 450 * 8) * 1.15
            },
            {
                items: [
                    { id: '', sku: 'PVC-012', quantity: 15, price: 95, costPrice: 65 },
                    { id: '', sku: 'CAN-040', quantity: 4, price: 250, costPrice: 180 },
                    { id: '', sku: 'ARE-001', quantity: 2, price: 850, costPrice: 600 },
                ],
                paymentMethod: 'CASH',
                customerName: 'Constructora del Sur',
                total: (95 * 15 + 250 * 4 + 850 * 2) * 1.15
            }
        ];

        // We need product IDs — fetch them
        const prodList = await apiCall(page, 'GET', '/api/products', null);
        const prodMap = {};
        if (prodList.ok) {
            for (const p of prodList.data) {
                prodMap[p.sku] = p.id;
            }
        }

        for (let i = 0; i < sales.length; i++) {
            const sale = sales[i];
            // Map SKUs to IDs
            const items = sale.items.map(item => ({
                id: prodMap[item.sku] || item.sku,
                quantity: item.quantity,
                price: item.price,
                costPrice: item.costPrice
            }));
            const r = await apiCall(page, 'POST', '/api/sales', {
                items,
                paymentMethod: sale.paymentMethod,
                customerName: sale.customerName,
                total: sale.total
            });
            log(r.ok ? '✅' : '⚠️', `Venta ${i + 1}: ${sale.customerName} — ${sale.paymentMethod} ${r.ok ? '✓' : r.data?.error || ''}`);
        }

        // --- Cerrar turno de caja ---
        if (shiftId) {
            log('🔒', 'Cerrando turno de caja...');
            const closeResult = await apiCall(page, 'POST', '/api/shifts/close', {
                shiftId: shiftId,
                declaredCash: 14800  // Slightly different from expected to show audit
            });
            log(closeResult.ok ? '✅' : '❌', `Cierre: ${closeResult.ok ? 'Turno cerrado. Diferencia registrada.' : closeResult.data?.error}`);
        }

        // ═══════════════════════════════════════════════
        // ESCENA 4: RECURSOS HUMANOS
        // ═══════════════════════════════════════════════
        banner('ESCENA 4: Recursos Humanos');
        await page.goto(`${SITE}/app/hr`, { waitUntil: 'networkidle2' });
        await sleep(3000);
        log('👥', 'Equipo mostrado con 2 empleados');
        await smoothScroll(page, 300, 1500);
        await sleep(2000);

        // Click on "Nómina Nica" tab
        try {
            await clickText(page, 'Nómina Nica', 'button');
            await sleep(2000);
            log('💼', 'Tab Nómina visible');
        } catch (e) { log('⚠️', 'No se pudo cambiar a Nómina'); }

        // Click on "Pasivo Laboral" tab
        try {
            await clickText(page, 'Pasivo Laboral', 'button');
            await sleep(2000);
            log('⚖️', 'Tab Pasivo Laboral visible');
        } catch (e) { log('⚠️', 'No se pudo cambiar a Pasivo Laboral'); }

        // Back to team view
        try {
            await clickText(page, 'Mi Equipo', 'button');
            await sleep(1500);
        } catch (e) { }

        // ═══════════════════════════════════════════════
        // ESCENA 5: INVENTARIO BLINDADO
        // ═══════════════════════════════════════════════
        banner('ESCENA 5: Inventario');
        await page.goto(`${SITE}/app/inventory`, { waitUntil: 'networkidle2' });
        await sleep(3000);
        log('📦', `Inventario con ${products.length} productos`);
        await smoothScroll(page, 400, 2000);
        await sleep(2000);

        // ═══════════════════════════════════════════════
        // ESCENA 6: CLIENTES (CRM)
        // ═══════════════════════════════════════════════
        banner('ESCENA 6: Clientes CRM');
        await page.goto(`${SITE}/app/clients`, { waitUntil: 'networkidle2' });
        await sleep(3000);
        log('🤝', `CRM con ${clients.length} clientes`);
        await smoothScroll(page, 300, 1500);
        await sleep(2000);

        // ═══════════════════════════════════════════════
        // ESCENA 7: POS — VENTA EN VIVO
        // ═══════════════════════════════════════════════
        banner('ESCENA 7: Punto de Venta');
        await page.goto(`${SITE}/app/pos`, { waitUntil: 'networkidle2' });
        await sleep(2000);

        // POS may show "open shift" modal since we closed it. Open a new one via API then refresh.
        log('🔑', 'Abriendo nuevo turno para demo POS...');
        const shift2 = await apiCall(page, 'POST', '/api/shifts/open', {
            initialCash: 5000,
            employeePin: EMPLOYEE_PIN
        });
        if (shift2.ok) {
            log('✅', 'Nuevo turno abierto');
            // Refresh POS to pick up the shift
            await page.goto(`${SITE}/app/pos`, { waitUntil: 'networkidle2' });
            await sleep(2500);
        } else {
            log('⚠️', `No se abrió turno: ${shift2.data?.error}`);
            // Try to fill the UI form manually
            try {
                // Type PIN in the 4 separate inputs
                const pinInputs = await page.$$('input[type="password"]');
                if (pinInputs.length >= 4) {
                    for (let i = 0; i < 4; i++) {
                        await pinInputs[i].type(EMPLOYEE_PIN[i], { delay: 150 });
                        await sleep(200);
                    }
                }
                // Type initial cash
                const cashInput = await page.$('input[type="number"]');
                if (cashInput) {
                    await cashInput.type('5000', { delay: 100 });
                }
                await sleep(500);
                await clickText(page, 'ABRIR TURNO', 'button');
                await sleep(3000);
            } catch (e) {
                log('⚠️', 'POS shift form interaction failed');
            }
        }

        // Click products to add to cart
        log('🛒', 'Agregando productos al carrito...');
        try {
            // Click on product cards in the grid
            const productCards = await page.$$('button, [class*="cursor-pointer"]');
            // Find and click product by looking for product name in the grid
            await page.evaluate(() => {
                const grid = document.querySelector('.grid');
                if (grid) {
                    const cards = grid.querySelectorAll('button, div[class*="cursor"], div[class*="rounded"]');
                    let clicked = 0;
                    cards.forEach(card => {
                        if (clicked < 3 && card.textContent && (
                            card.textContent.includes('Cemento') ||
                            card.textContent.includes('Varilla') ||
                            card.textContent.includes('Pintura')
                        )) {
                            card.click();
                            clicked++;
                        }
                    });
                }
            });
            await sleep(1500);

            // Also try clicking individual product items 
            const prodButtons = await page.$$('[class*="cursor-pointer"]');
            for (let i = 0; i < Math.min(3, prodButtons.length); i++) {
                try {
                    await prodButtons[i].click();
                    await sleep(800);
                } catch (e) { }
            }
        } catch (e) {
            log('⚠️', 'Click productos: ' + e.message);
        }
        await sleep(2000);

        // Try to checkout with CASH
        log('💵', 'Procesando venta...');
        try {
            await clickText(page, 'EFECTIVO', 'button');
            await sleep(3000);
        } catch (e) {
            try {
                await clickText(page, 'Efectivo', 'button');
                await sleep(3000);
            } catch (e2) {
                log('⚠️', 'No se pudo clickear botón de pago');
            }
        }

        // Try to click "Nueva Venta" to reset
        try {
            await clickText(page, 'Nueva Venta', 'button');
            await sleep(1500);
        } catch (e) { }

        // Show the POS for a moment
        await sleep(2000);
        log('✅', 'POS demostrado');

        // ═══════════════════════════════════════════════
        // ESCENA 8: CERRAR CAJA (en vivo)
        // ═══════════════════════════════════════════════
        banner('ESCENA 8: Cierre de Caja');
        // Click "CERRAR CAJA" button
        try {
            await clickText(page, 'CERRAR CAJA', 'button');
            await sleep(1500);

            // Type declared cash
            const cashInputs = await page.$$('input[type="number"]');
            const lastCashInput = cashInputs[cashInputs.length - 1];
            if (lastCashInput) {
                await lastCashInput.type('4800', { delay: 100 });
                await sleep(1000);
            }

            // Click "REALIZAR CORTE Z"
            await clickText(page, 'REALIZAR CORTE Z', 'button');
            await sleep(3000);
            log('📊', 'Corte Z visible — mostrando diferencia');

            // Click "FINALIZAR TURNO"
            await clickText(page, 'FINALIZAR TURNO', 'button');
            await sleep(2000);
            log('✅', 'Turno cerrado en UI');
        } catch (e) {
            log('⚠️', 'Cierre manual: ' + e.message);
            // Close via API as fallback
            if (shift2.data?.id) {
                await apiCall(page, 'POST', '/api/shifts/close', {
                    shiftId: shift2.data.id,
                    declaredCash: 4800
                });
                log('✅', 'Turno cerrado via API');
            }
        }

        // ═══════════════════════════════════════════════
        // ESCENA 9: REPORTES
        // ═══════════════════════════════════════════════
        banner('ESCENA 9: Reportes Financieros');
        await page.goto(`${SITE}/app/reports`, { waitUntil: 'networkidle2' });
        await sleep(3000);
        await smoothScroll(page, 400, 2000);
        log('📊', 'Dashboard de Reportes');
        await sleep(2000);

        // Click "CONTADOR" tab
        try {
            await clickText(page, 'CONTADOR', 'button');
            await sleep(3000);
            await smoothScroll(page, 300, 1500);
            log('📋', 'Reportes Contador DGI');
            await sleep(2000);
        } catch (e) { log('⚠️', 'No se pudo cambiar a Contador'); }

        // Click "CAJAS" tab  
        try {
            await clickText(page, 'CAJAS', 'button');
            await sleep(3000);
            await smoothScroll(page, 300, 1500);
            log('🔐', 'Historial de Cajas (Auditoría)');
            await sleep(3000);
        } catch (e) { log('⚠️', 'No se pudo cambiar a Cajas'); }

        // ═══════════════════════════════════════════════
        // ESCENA 10: TOUR DE MÓDULOS
        // ═══════════════════════════════════════════════
        banner('ESCENA 10: Tour de Módulos');

        const modules = [
            { path: '/app/purchases', name: 'Compras', icon: '🛍️' },
            { path: '/app/suppliers', name: 'Proveedores', icon: '🏭' },
            { path: '/app/quotations', name: 'Cotizaciones', icon: '📝' },
            { path: '/app/receivables', name: 'Cobranza', icon: '💳' },
            { path: '/app/billing', name: 'Facturación', icon: '🧾' },
            { path: '/app/marketplace', name: 'Mercado B2B', icon: '🏪' },
            { path: '/app/team', name: 'Mi Equipo', icon: '👥' },
        ];

        for (const mod of modules) {
            log(mod.icon, `${mod.name}...`);
            await page.goto(`${SITE}${mod.path}`, { waitUntil: 'networkidle2', timeout: 15000 }).catch(() => { });
            await sleep(2500);
            await smoothScroll(page, 200, 800);
            await sleep(1000);
        }
        log('✅', 'Tour completo de 14 módulos');

        // ═══════════════════════════════════════════════
        // ESCENA 11: DASHBOARD FINAL
        // ═══════════════════════════════════════════════
        banner('ESCENA 11: Cierre — Dashboard');
        await page.goto(`${SITE}/app/dashboard`, { waitUntil: 'networkidle2' });
        await sleep(4000);
        await smoothScroll(page, 500, 3000);
        log('🎬', 'Dashboard final con ventas del día');
        await sleep(3000);

        // ═══════════════════════════════════════════════
        // LISTO
        // ═══════════════════════════════════════════════
        banner('✅ DEMO COMPLETA');
        log('📧', `Email demo: ${DEMO_EMAIL}`);
        log('🔑', `Password: ${DEMO_PASS}`);
        log('🎥', 'Detén la grabación de OBS');
        console.log(`\n   (El navegador se cerrará en 15 segundos)\n`);
        await sleep(15000);

    } catch (err) {
        console.error('\n❌ ERROR:', err.message);
        console.error(err.stack);
        await sleep(5000);
    } finally {
        await browser.close();
        log('🏁', 'Navegador cerrado');
    }
})();
