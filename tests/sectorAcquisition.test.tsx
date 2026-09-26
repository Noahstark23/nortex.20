// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it } from 'vitest';
import LandingFarmacia from '../components/LandingFarmacia';
import LandingFerreteria from '../components/LandingFerreteria';

afterEach(cleanup);

describe('recorrido público por rubro', () => {
  it.each([
    [LandingFarmacia, 'FARMACIA', 'landing_farmacia', '/blog/como-controlar-vencimientos-farmacia-fefo'],
    [LandingFerreteria, 'FERRETERIA', 'landing_ferreteria', '/blog/como-administrar-una-ferreteria-nicaragua'],
  ] as const)('conserva rubro y fuente hasta registro', (Page, type, source, guide) => {
    render(<MemoryRouter><Page /></MemoryRouter>);
    const href = '/register?type=' + type + '&source=' + source;
    expect(document.querySelectorAll('a[href="' + href + '"]')).toHaveLength(3);
    expect(document.querySelector('a[href="' + guide + '"]')).not.toBeNull();
    expect(screen.getByRole('heading', { level: 2, name: /software para/i })).toBeTruthy();
    expect(document.querySelectorAll('a[data-sector-cta]')).toHaveLength(3);
  });

  it('un clic sectorial emite una sola señal acotada, sin registro genérico duplicado', () => {
    const js = readFileSync(resolve(process.cwd(), 'public/analytics.js'), 'utf8');
    const dom = new JSDOM('<a href="/register?type=FARMACIA&amp;source=landing_farmacia" data-sector-cta="farmacia" data-page-kind="landing" data-cta-location="hero"><span>Crear cuenta</span></a>', {
      url: 'https://somosnortex.com/farmacias', runScripts: 'outside-only',
    });
    dom.window.eval(js);
    dom.window.document.querySelector('span')?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    const events = (dom.window as unknown as { dataLayer: IArguments[] }).dataLayer
      .filter(args => args[0] === 'event')
      .map(args => [args[1], args[2]]);
    expect(events).toEqual([['sector_cta_click', { vertical: 'farmacia', page_kind: 'landing', cta_location: 'hero' }]]);
    dom.window.close();
  });
});
