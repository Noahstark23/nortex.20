import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

/**
 * Config de Vitest SOLO para la corrida de mutación (`npm run test:mutation`).
 *
 * POR QUÉ EXISTE
 * --------------
 * Los tests de RENDER del POS (jsdom + Testing Library) montan un componente de
 * ~6.900 líneas y tardan ~1 s cada uno. Ese costo es irrelevante en `npm test`
 * (la suite entera corre en ~13 s), pero es catastrófico bajo Stryker: con
 * `coverageAnalysis: perTest`, un test que importa `POS.tsx` queda marcado como
 * cubridor de TODOS los utils puros que el POS importa —`pricing`, `posSearch`,
 * `money`, `stockAlert`, `quantity`, `cartPersistence`—, que son justamente los
 * módulos bajo mutación. Resultado medido: la corrida saltó de ~4 minutos a una
 * estimación de ~6 h 30 m.
 *
 * Y no aportan nada al score: esos mutantes ya los matan los tests unitarios
 * puros de cada util, que corren en milisegundos. El test de render protege otra
 * cosa —que el POS siga vendiendo mientras lo desarmamos— y esa garantía la da
 * `npm test`, que SÍ los corre en cada PR.
 *
 * O sea: dos redes, dos trabajos.
 *   · `npm test`            → conducta del POS (render) + todo lo demás.
 *   · `npm run test:mutation` → que los tests de dinero MATEN bugs.
 *
 * Si algún día un test de render fuera el único que mata cierto mutante, el
 * score bajaría y el umbral (que solo sube) haría fallar el CI. Ahí habría que
 * escribir el test unitario que falta, no volver a meter el render acá.
 */

const RENDER_LENTOS = [
    // Caracterización de la venta del POS: monta el componente entero.
    '**/tests/posVentaCritica.test.tsx',
];

export default defineConfig({
    plugins: [react()],
    resolve: {
        alias: { '@': path.resolve(__dirname, '.') },
    },
    test: {
        exclude: [
            '**/node_modules/**',
            '**/dist/**',
            // Mismo motivo que en vite.config.ts: una corrida interrumpida deja
            // una copia instrumentada de la suite en disco.
            '**/.stryker-tmp/**',
            ...RENDER_LENTOS,
        ],
    },
});
