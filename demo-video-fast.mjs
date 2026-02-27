/**
 * NORTEX — Video Demo Automatizado (FAST FLOW)
 * 
 * FLUJO SOLICITADO POR USUARIO:
 * 1. Registro Empresa (UI)
 * 2. RRHH: Crear Empleado con PIN 0000 (UI)
 * 3. POS: Abrir Caja (UI)
 * 4. Inventario: Ver Productos (Seeding API)
 * 5. Tour Completo
 * 6. POS: Cerrar Caja (UI)
 */

import puppeteer from 'puppeteer';

const SITE = 'https://somosnortex.com';
const TS = Date.now();
const DEMO_EMAIL = `video${TS}@nortex.com`;
const DEMO_PASS = 'Demo1234!';
const COMPANY = 'Ferretería Demo Express';
const EMPLOYEE_PIN = '0000';

// ─── UTILS ──────────────────────────────────────────────────
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const log = (icon, msg) => console.log(`   ${icon} ${msg}`);
const banner = (title) => {
    console.log(`\n${'═'.repeat(50)}`);
    console.log(`  🎬  ${title}`);
    console.log(`${'═'.repeat(50)}`);
};

async function typeType(page, selector, text) {
    await page.waitForSelector(selector);
    await page.click(selector, { clickCount: 3 });
    await page.type(selector, text, { delay: 60 });
}

async function clickText(page, text, tag = 'button') {
    await page.evaluate((t, tg) => {
        const els = [...document.querySelectorAll(tg)];
        const el = els.find(e => e.textContent.includes(t));
        if (el) el.click();
        else throw new Error(`Texto no encontrado: "${t}"`);
    }, text, tag);
}

// ─── API SEEDER ─────────────────────────────────────────────
async function seedData(page) {
    log('🌱', 'Sembrando productos y clientes via API...');

    await page.evaluate(async () => {
        const token = localStorage.getItem('nortex_token');
        const headers = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        };

        const post = async (url, body) => {
            const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
            return res.ok;
        };

        // Productos
        const products = [
            { name: 'Taladro Percutor 1/2"', sku: 'TAL-001', category: 'Herramientas', price: 1200, cost: 800, stock: 20, minStock: 2, unit: 'unidad' },
            { name: 'Juego de Destornilladores', sku: 'DES-SET', category: 'Herramientas', price: 450, cost: 250, stock: 50, minStock: 5, unit: 'unidad' },
            { name: 'Cinta Métrica 5m', sku: 'MET-005', category: 'Medición', price: 120, cost: 60, stock: 100, minStock: 10, unit: 'unidad' },
            { name: 'Martillo de Uña', sku: 'MAR-001', category: 'Herramientas', price: 180, cost: 90, stock: 30, minStock: 5, unit: 'unidad' },
            { name: 'Sierra Circular 7-1/4"', sku: 'SIE-001', category: 'Herramientas', price: 2500, cost: 1800, stock: 10, minStock: 2, unit: 'unidad' },
        ];

        // Clientes
        const clients = [
            { name: 'Constructora Beta', taxId: 'J001', phone: '2222-2222', email: 'beta@const.com', address: 'Managua', creditLimit: 50000 },
            { name: 'Ferretería El Puente', taxId: 'J002', phone: '8888-8888', email: 'puente@ferr.com', address: 'Tipitapa', creditLimit: 20000 },
        ];

        await Promise.all(products.map(p => post('/api/products', p)));
        await Promise.all(clients.map(c => post('/api/customers', c)));
    });
    log('✅', 'Datos sembrados correctamente');
}

// ════════════════════════════════════════════════════════════
// MAIN SCRIPT
// ════════════════════════════════════════════════════════════
(async () => {
    const browser = await puppeteer.launch({
        headless: false,
        defaultViewport: null,
        args: ['--start-maximized']
    });

    const page = await browser.newPage();
    // Allow notifications/location to avoid popups
    const context = browser.defaultBrowserContext();
    await context.overridePermissions(SITE, ['notifications']);

    try {
        // 1. REGISTRO
        banner('1. REGISTRO DE EMPRESA');
        await page.goto(`${SITE}/register`);

        // Formulario
        const inputs = await page.$$('input');
        await inputs[0].type(COMPANY);
        await inputs[1].type(DEMO_EMAIL);
        await inputs[2].type(DEMO_PASS);
        if (inputs.length > 3) await inputs[3].type(DEMO_PASS); // Confirm pass if exists

        // Tipo de negocio
        const select = await page.$('select');
        if (select) await select.select('Retail / Tienda');

        await clickText(page, 'Registrar');
        log('🚀', 'Registrando...');

        // Esperar al Dashboard
        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 });
        log('🏠', 'Dashboard cargado');

        // SEEDING (Background)
        await seedData(page);

        // 2. RECURSOS HUMANOS (Crear Empleado UI)
        banner('2. RECURSOS HUMANOS (CREAR EMPLEADO)');
        await page.goto(`${SITE}/app/hr`, { waitUntil: 'networkidle2' });

        await clickText(page, 'Nuevo Colaborador');
        await sleep(1000); // Animation

        // Fill Modal
        await typeType(page, 'input[placeholder="Nombre"]', 'Juan');
        await typeType(page, 'input[placeholder="Apellido"]', 'Perez');
        // PIN 0000
        await typeType(page, 'input[placeholder="0000"]', EMPLOYEE_PIN);
        // Cedula & INSS (Optional generally but good for demo)
        await typeType(page, 'input[placeholder="001-010190-0001A"]', '001-010101-0000X');
        await typeType(page, 'input[placeholder="123456789"]', '1234567');
        // Money
        await typeType(page, 'input[placeholder="0.00"]', '6000'); // Salario
        await typeType(page, 'input[placeholder="Ej: 5"]', '5'); // Comision

        await clickText(page, 'Guardar');
        log('✅', 'Empleado "Juan Perez" creado con PIN 0000');
        await sleep(2000); // Show result in list

        // 3. ABRIR CAJA (POS)
        banner('3. POS: ABRIR CAJA');
        await page.goto(`${SITE}/app/pos`, { waitUntil: 'networkidle2' });

        // Wait for Modal "Apertura de Caja"
        // Enter PIN 0 0 0 0 in the 4 inputs
        const pinInputs = await page.$$('input[type="password"]');
        if (pinInputs.length >= 4) {
            for (let i = 0; i < 4; i++) {
                await pinInputs[i].type(EMPLOYEE_PIN[i], { delay: 100 });
            }
        }

        // Initial Cash
        const cashInput = await page.$('input[placeholder="0.00"]');
        if (cashInput) await cashInput.type('1000');

        await clickText(page, 'ABRIR TURNO');
        log('🔓', 'Caja abierta exitosamente');
        await sleep(2000);

        // 4. INVENTARIO (Ver productos)
        banner('4. INVENTARIO');
        await page.goto(`${SITE}/app/inventory`, { waitUntil: 'networkidle2' });
        await sleep(2000);
        await page.evaluate(() => window.scrollBy(0, 300));
        await sleep(2000);
        log('📦', 'Mostrando inventario sembrado');

        // 5. REALIZAR VENTA (FACTURAR)
        banner('5. POS: REALIZAR VENTA');
        await page.goto(`${SITE}/app/pos`, { waitUntil: 'networkidle2' });
        await sleep(1500);

        // Click on 3 products to add to cart
        log('🛒', 'Agregando productos al carrito...');
        const products = await page.$$('button.rounded-xl.bg-white'); // Product cards usually
        if (products.length > 0) {
            for (let i = 0; i < Math.min(3, products.length); i++) {
                await products[i].click();
                await sleep(500);
            }
        } else {
            // Fallback: click by text
            try { await clickText(page, 'Taladro', 'div'); } catch (e) { }
            await sleep(500);
            try { await clickText(page, 'Martillo', 'div'); } catch (e) { }
        }

        // Checkout
        // Direct payment buttons are visible
        await clickText(page, 'EFECTIVO');
        log('💵', 'Venta procesada con Éxito');
        await sleep(3000); // Show success modal

        // Close success modal/Prepare new sale
        // Close success modal/Prepare new sale
        try { await clickText(page, 'Nueva Venta'); } catch (e) { log('⚠️', 'Botón Nueva Venta no encontrado (o no necesario)'); }
        await sleep(1000);

        // 6. TOUR RAPIDO
        banner('6. TOUR RAPIDO');
        const modules = [
            '/app/clients',
            '/app/quotations',
            '/app/reports'
        ];

        for (const path of modules) {
            await page.goto(`${SITE}${path}`, { waitUntil: 'networkidle2' });
            await sleep(1500);
        }

        // 7. CERRAR CAJA
        banner('7. POS: CERRAR CAJA');
        await page.goto(`${SITE}/app/pos`, { waitUntil: 'networkidle2' });
        await sleep(1500);

        await clickText(page, 'CERRAR CAJA');
        await sleep(1000);

        // Fill Close Form (Declared Cash)
        // Find input focused or by type number
        await page.evaluate(() => {
            const input = document.querySelector('input[type="number"]');
            if (input) {
                input.value = '';
                input.click();
            }
        });
        await page.type('input[type="number"]', '2000'); // 1000 initial + sales

        await clickText(page, 'REALIZAR CORTE Z');
        await sleep(2000); // Show "Resumen de Cierre"

        await clickText(page, 'FINALIZAR TURNO');
        log('🔒', 'Caja cerrada. Video completado.');

        banner('FIN DEL VIDEO');
        await sleep(5000);

    } catch (e) {
        console.error('❌ Error:', e);
    } finally {
        await browser.close();
    }
})();
