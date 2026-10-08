#!/usr/bin/env node
/**
 * NORTEX — Guardián del sistema de diseño.
 *
 * POR QUÉ EXISTE: el rediseño se pierde solo. Alguien agrega un `#8B5CF6` inline
 * "nada más para este badge", otro escribe el símbolo de moneda a mano porque es
 * más rápido que importar formatMoney, y en tres meses vuelve el arcoíris y las
 * dos monedas mezcladas que costaron la credibilidad del producto. Este script
 * hace fallar el CI antes de que eso pase.
 *
 * Corre con: node scripts/check-design-system.cjs
 *
 * DISEÑO DEL GUARDIÁN: un chequeo ruidoso se termina desactivando, así que este
 * distingue dos contextos que un grep pelado confunde:
 *   - `${x}` es interpolación de JavaScript, NO un símbolo de dólar.
 *   - El HTML/CSS dentro de literales de plantilla se imprime en PAPEL BLANCO
 *     (etiquetas, estados de cuenta, tickets): sus colores son tinta, no interfaz.
 * Por eso rastrea el estado de las comillas invertidas en vez de mirar línea suelta.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

/** Exentos, con motivo. Cada entrada es un contexto donde el color NO sale de los tokens. */
const EXENTOS = [
    // Marketing: landing y blog son HTML público con identidad propia, fuera del SPA.
    /^components\/Landing/,
    /^components\/Blog/,
    /^components\/ClusterPage\.tsx$/,
    /^components\/Calculator\.tsx$/,
    /^components\/HelpCenter\.tsx$/,
    // Impresión: ticket térmico y plantillas A4 se imprimen sobre papel BLANCO.
    /^components\/ReceiptTicket\.tsx$/,
    /^components\/ShiftReportTicket\.tsx$/,
    /^components\/InvoiceTemplate\.tsx$/,
    // Visor de planos: SVG con paleta de dibujo técnico.
    /^components\/BlueprintViewer\.tsx$/,
];

const esExento = (rel) => EXENTOS.some((patron) => patron.test(rel));

function listarArchivos(dir, acc = []) {
    for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entrada.name);
        if (entrada.isDirectory()) {
            if (entrada.name === 'node_modules' || entrada.name === 'dist') continue;
            listarArchivos(full, acc);
        } else if (/\.tsx$/.test(entrada.name)) {
            acc.push(full);
        }
    }
    return acc;
}

const archivos = listarArchivos(path.join(ROOT, 'components'))
    .concat([path.join(ROOT, 'App.tsx')].filter(fs.existsSync))
    .map((full) => ({ full, rel: path.relative(ROOT, full) }))
    .filter(({ rel }) => !esExento(rel));

const violaciones = [];
const registrar = (regla, rel, linea, texto) =>
    violaciones.push({ regla, rel, linea, texto: texto.trim().slice(0, 110) });

/**
 * Hex de COLOR, no cualquier `#`. Tiene que estar en contexto de estilo:
 * un valor arbitrario de Tailwind (`bg-[#25D366]`) o un valor CSS (`color: '#fff'`).
 * Sin esto, "Factura #123" en el placeholder de un formulario se reporta como
 * violación de color y el chequeo pierde credibilidad.
 */
const HEX = /\[#[0-9a-fA-F]{3,8}\]|:\s*['"]?#[0-9a-fA-F]{3,8}\b/;

/**
 * Moneda hardcodeada. Lo que se busca es el SÍMBOLO escrito a mano pegado a un
 * valor — no la interpolación de JS:
 *   `C$ ${total}`      → violación (símbolo a mano)
 *   `$${total}`        → violación (dólar pelado, además prohibido: va US$)
 *   {'$'}{x.toFixed(2)} → violación
 *   `${fmt(total)}`    → OK (el helper pone el símbolo)
 */
const MONEDA = [
    // Símbolo a mano pegado a un valor DINÁMICO: `C$ ${x}` (plantilla) o
    // `C$ {x}` (JSX). El texto estático de ejemplo ("Ej: cambio de C$500" en un
    // placeholder) no entra: no es un monto calculado y por lo tanto no puede
    // desincronizarse con el resto del sistema, que es el bug que esto persigue.
    /(?:C\$|US\$)\s*\$?\{/,
    /(?<!\$)\$\$\{/,                        // "$${x}" — dólar pelado antes de interpolar
    /['"]\s*\$\s*['"]\s*[+{]/,              // '$' + x   /  {'$'}{x}
    // Símbolo escrito a mano cerca de un toFixed. Solo C$/US$: un "$" pelado acá
    // sería el de `${...}` (interpolación de JS) y marcaría `dias.toFixed(1)`
    // como si fuera dinero. El dólar pelado ya lo cubren las reglas de arriba.
    /(?:C\$|US\$)[^\n]{0,20}\.toFixed\(/,
];

/** Señales de que un literal de plantilla genera un documento para papel. */
const MARCADORES_DOCUMENTO = /<!doctype|<html|<style|<td|<tr\b|<table|@media\s+print|page-break|border-radius:|font-family:|border-bottom:\s*\d/i;

const RADIO_SUELTO = /rounded-\[(\d+)px\]/;
const Z_ARBITRARIO = /z-\[(\d+)\]/;

for (const { full, rel } of archivos) {
    const contenido = fs.readFileSync(full, 'utf8');
    const lineas = contenido.split('\n');

    let enComentarioBloque = false;
    let enPlantilla = false;      // dentro de un literal de plantilla multilínea
    let plantillaEsDocumento = false; // ...y ese literal genera HTML/CSS para papel

    lineas.forEach((linea, i) => {
        const n = i + 1;
        const limpia = linea.trim();

        // Comentarios: documentar "#16C784 es el verde de marca" es legítimo.
        if (enComentarioBloque) {
            if (limpia.includes('*/')) enComentarioBloque = false;
            return;
        }
        if (limpia.startsWith('/*')) {
            if (!limpia.includes('*/')) enComentarioBloque = true;
            return;
        }
        const esComentarioLinea = limpia.startsWith('//') || limpia.startsWith('*');

        // Estado de literal de plantilla: cuenta comillas invertidas no escapadas.
        const backticks = (linea.match(/(?<!\\)`/g) || []).length;
        const abriaPlantilla = enPlantilla;
        if (backticks % 2 === 1) {
            if (!enPlantilla) {
                enPlantilla = true;
                // ¿Este literal es un documento para imprimir/exportar?
                plantillaEsDocumento = MARCADORES_DOCUMENTO.test(linea);
            } else {
                enPlantilla = false;
                plantillaEsDocumento = false;
            }
        } else if (enPlantilla && MARCADORES_DOCUMENTO.test(linea)) {
            // El literal puede abrir en una línea y recién mostrar que es HTML en
            // la siguiente (`const filas = items.map(i => \`` ... `<tr>`). Sin
            // revisar las líneas de adentro, el CSS de un ticket impreso se
            // reporta como si fuera color de la interfaz.
            plantillaEsDocumento = true;
        }

        const dentroDeDocumento = (abriaPlantilla || enPlantilla) && plantillaEsDocumento;

        if (esComentarioLinea) return;

        // 1. Color: solo en JSX/estilos de la app, no en documentos impresos.
        if (!dentroDeDocumento && HEX.test(linea)) registrar('hex-de-color', rel, n, linea);

        // 2. Moneda: aplica SIEMPRE, también en documentos — un estado de cuenta
        //    con el símbolo a mano es exactamente el bug de confianza a matar.
        if (MONEDA.some((patron) => patron.test(linea))) registrar('moneda-hardcodeada', rel, n, linea);

        // 3. Radios: solo los 3 del sistema.
        if (!dentroDeDocumento) {
            const radio = RADIO_SUELTO.exec(linea);
            if (radio && ![8, 12, 999].includes(Number(radio[1]))) {
                registrar('radio-fuera-del-sistema', rel, n, linea);
            }
        }

        // 4. Capas: un fijo con z arbitrario compite con la zona de cobro.
        //    La escala de tokens (z-sticky/z-checkout/z-modal) es la única válida.
        if (!dentroDeDocumento && /\bfixed\b/.test(linea)) {
            const z = Z_ARBITRARIO.exec(linea);
            const esModalBloqueante = /inset-0/.test(linea);
            if (z && Number(z[1]) > 20 && !esModalBloqueante) {
                registrar('capa-fuera-de-escala', rel, n, linea);
            }
        }
    });
}

const porRegla = violaciones.reduce((acc, v) => {
    (acc[v.regla] ||= []).push(v);
    return acc;
}, {});

const REGLAS = [
    ['hex-de-color', 'Color hardcodeado — usá las clases de Tailwind mapeadas a los tokens'],
    ['moneda-hardcodeada', 'Símbolo de moneda escrito a mano — usá formatMoney() de utils/money'],
    ['radio-fuera-del-sistema', 'Radio fuera del sistema — solo 8 (control), 12 (card), 999 (pill)'],
    ['capa-fuera-de-escala', 'z-index arbitrario en un elemento fijo — usá z-sticky / z-checkout / z-modal'],
];

// Cuántas violaciones listar por regla. El default mantiene la salida legible en
// CI; NX_LIMITE=0 imprime todas (útil para armar el plan de corrección).
const LIMITE = process.env.NX_LIMITE === '0' ? Infinity : Number(process.env.NX_LIMITE || 30);

let fallo = false;
for (const [regla, explicacion] of REGLAS) {
    const items = porRegla[regla] || [];
    if (items.length === 0) {
        console.log(`✓ ${regla}: 0`);
        continue;
    }
    fallo = true;
    console.log(`\n✗ ${regla}: ${items.length}`);
    console.log(`  ${explicacion}`);
    for (const v of items.slice(0, LIMITE)) console.log(`    ${v.rel}:${v.linea}  ${v.texto}`);
    if (items.length > LIMITE) console.log(`    … y ${items.length - LIMITE} más`);
}

console.log(`\n${archivos.length} archivos revisados.`);
if (fallo) {
    console.error('\nEl sistema de diseño tiene violaciones. Corregilas antes de pushear.');
    process.exit(1);
}
console.log('Sistema de diseño íntegro.');
