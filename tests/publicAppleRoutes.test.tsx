// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ReactNode } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import LandingFarmacia from '../components/LandingFarmacia';
import LandingFerreteria from '../components/LandingFerreteria';
import LandingNicaragua from '../components/LandingNicaragua';
import LandingPage from '../components/LandingPage';
import LandingPageApple from '../components/LandingPage.apple';
import { WORKSPACE_THEME_KEY } from '../utils/workspaceTheme';

const LocationProbe = () => {
  const location = useLocation();
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>;
};

const renderRoute = (component: ReactNode, path = '/') => render(
  <MemoryRouter initialEntries={[path]}>
    {component}
  </MemoryRouter>,
);

const linkHrefs = () => screen.getAllByRole('link').map(link => link.getAttribute('href'));

const hexTokenFrom = (block: string, name: string) => {
  const match = block.match(new RegExp(`${name}:\\s*(#[0-9a-f]{6})`, 'i'));
  if (!match) throw new Error(`Falta ${name} en el bloque de tokens`);
  return match[1];
};

const luminance = (hex: string) => {
  const channels = hex.match(/[0-9a-f]{2}/gi);
  if (!channels || channels.length !== 3) throw new Error(`Color inválido: ${hex}`);
  const [red, green, blue] = channels.map(channel => {
    const value = Number.parseInt(channel, 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
};

const contrast = (foreground: string, background: string) => {
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
};

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-nx-theme');
  document.body.removeAttribute('data-nx-theme');
});

afterEach(() => cleanup());

describe('rutas públicas SPA con diseño Apple', () => {
  it.each([
    ['inicio SPA', <LandingPage />],
    ['referencia Apple', <LandingPageApple />],
    ['ferreterías', <LandingFerreteria />],
    ['farmacias', <LandingFarmacia />],
    ['Nicaragua', <LandingNicaragua />],
  ])('usa el shell compartido y un solo botón Día/Noche en %s', async (_label, component) => {
    const user = userEvent.setup();
    renderRoute(component);

    const root = screen.getByTestId('public-theme-root');
    const toggles = screen.getAllByRole('button', { name: /cambiar a modo noche/i });
    expect(toggles).toHaveLength(1);
    expect(root).toHaveAttribute('data-nx-theme', 'light');
    expect(document.documentElement).toHaveAttribute('data-nx-theme', 'light');

    await user.click(toggles[0]);
    expect(root).toHaveAttribute('data-nx-theme', 'dark');
    expect(document.documentElement).toHaveAttribute('data-nx-theme', 'dark');
    expect(localStorage.getItem(WORKSPACE_THEME_KEY)).toBe('dark');
    expect(screen.getByRole('button', { name: /cambiar a modo día/i })).toHaveAttribute('aria-pressed', 'true');
  });

  it('usa navegación de documento real para volver a la landing estática', () => {
    renderRoute(<LandingFerreteria />);

    const brand = screen.getByRole('link', { name: 'Nortex, inicio' });
    expect(brand).toHaveAttribute('href', '/');
    expect(brand.outerHTML).toMatch(/^<a\b/);
  });

  it('preserva los parámetros de registro de ferreterías y farmacias', () => {
    const { unmount } = renderRoute(<LandingFerreteria />);
    expect(linkHrefs().filter(href => href === '/register?type=FERRETERIA&source=landing_ferreteria')).toHaveLength(3);
    unmount();

    renderRoute(<LandingFarmacia />);
    expect(linkHrefs().filter(href => href === '/register?type=FARMACIA&source=landing_farmacia')).toHaveLength(3);
  });

  it('preserva los destinos de adquisición del fallback SPA', () => {
    renderRoute(<LandingPage />);
    const hrefs = linkHrefs();

    expect(hrefs).toContain('/demo?source=landing_spa&location=nav');
    expect(hrefs).toContain('/demo?source=landing_spa&location=hero');
    expect(hrefs).toContain('/register?source=landing_spa&location=hero');
    expect(hrefs).toContain('/register?source=landing_spa&location=closing');
    expect(hrefs).toEqual(expect.arrayContaining(['/ferreterias', '/farmacias', '/nicaragua', '/privacy', '/terms']));
  });

  it('conserva el formulario de Nicaragua y lleva el correo normalizado al registro', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/nicaragua']}>
        <Routes>
          <Route path="/nicaragua" element={<LandingNicaragua />} />
          <Route path="*" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    );

    await user.type(screen.getByLabelText(/Correo de trabajo/i), ' ana+qa@example.com ');
    await user.click(screen.getByRole('button', { name: 'Empezá gratis' }));

    expect(screen.getByTestId('location')).toHaveTextContent('/register?source=landing_nicaragua&email=ana%2Bqa%40example.com');
  });

  it('mantiene el registro de Nicaragua sin email cuando el campo queda vacío', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/nicaragua']}>
        <Routes>
          <Route path="/nicaragua" element={<LandingNicaragua />} />
          <Route path="*" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('button', { name: 'Crear mi cuenta gratis' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/register?source=landing_nicaragua');
  });

  it('protege contraste de campos, autofill, foco, 44 px y movimiento reducido', () => {
    const css = readFileSync(resolve(process.cwd(), 'index.css'), 'utf8');
    const tokens = readFileSync(resolve(process.cwd(), 'nortex-tokens.css'), 'utf8');
    const chrome = readFileSync(resolve(process.cwd(), 'components/public/PublicChrome.tsx'), 'utf8');
    const allLandingSource = [
      'components/LandingFerreteria.tsx',
      'components/LandingFarmacia.tsx',
      'components/LandingNicaragua.tsx',
      'components/public/PublicHomePage.tsx',
    ].map(file => readFileSync(resolve(process.cwd(), file), 'utf8')).join('\n');

    expect(css).toMatch(/\.nx-public-theme-toggle\s*\{[\s\S]*?min-height:\s*var\(--nx-tap-min\);[\s\S]*?min-width:\s*var\(--nx-tap-min\);/);
    expect(css).toMatch(/\.nx-public-field\s*\{[\s\S]*?min-height:\s*48px;[\s\S]*?color:\s*var\(--nx-public-text\);[\s\S]*?caret-color:\s*var\(--nx-public-text\);/);
    expect(css).toMatch(/\.nx-public-field:-webkit-autofill[\s\S]*?-webkit-text-fill-color:\s*var\(--nx-public-text\);/);
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toMatch(/\.nx-public-brand:focus-visible,[\s\S]*?outline:\s*3px solid/);
    expect(tokens).toMatch(/--nx-public-primary-fill:\s*#0071E3;[\s\S]*?--nx-public-on-primary:\s*#FFFFFF;/);
    expect(tokens).toMatch(/\[data-nx-theme='dark'\]\s*\{[\s\S]*?--nx-public-canvas:\s*#151B23;[\s\S]*?--nx-public-text:\s*#F5F7FA;[\s\S]*?--nx-public-primary-fill:\s*#2997FF;/);
    expect(chrome).toContain('href="/"');
    expect(chrome).toContain('min-w-[44px]');
    expect(chrome).not.toContain("from '../auth/");
    expect(allLandingSource).not.toMatch(/cientos de|500\+ negocios|calificación promedio|99\.5%|sistema POS #1|único sistema/i);
  });

  it('mantiene contraste AA en texto, acciones azules y límites de campos en ambos modos', () => {
    const tokens = readFileSync(resolve(process.cwd(), 'nortex-tokens.css'), 'utf8');
    const light = tokens.match(/:root\s*\{([\s\S]*?)\n\}/)?.[1];
    const dark = tokens.match(/\[data-nx-theme='dark'\]\s*\{([\s\S]*?)\n\}/)?.[1];
    expect(light).toBeTruthy();
    expect(dark).toBeTruthy();

    for (const block of [light!, dark!]) {
      const backgrounds = [
        '--nx-public-canvas',
        '--nx-public-canvas-alt',
        '--nx-public-surface',
        '--nx-public-surface-raised',
      ];
      for (const background of backgrounds) {
        expect(contrast(
          hexTokenFrom(block, '--nx-public-text-secondary'),
          hexTokenFrom(block, background),
        )).toBeGreaterThanOrEqual(4.5);
        expect(contrast(
          hexTokenFrom(block, '--nx-public-accent-text'),
          hexTokenFrom(block, background),
        )).toBeGreaterThanOrEqual(4.5);
      }

      expect(contrast(
        hexTokenFrom(block, '--nx-public-on-primary'),
        hexTokenFrom(block, '--nx-public-primary-fill'),
      )).toBeGreaterThanOrEqual(4.5);
      expect(contrast(
        hexTokenFrom(block, '--nx-public-border'),
        hexTokenFrom(block, '--nx-public-surface-raised'),
      )).toBeGreaterThanOrEqual(3);
    }
  });
});
