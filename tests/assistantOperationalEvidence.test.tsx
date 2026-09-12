// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { AssistantOperationalEvidence } from '../components/assistant/AssistantOperationalEvidence';
import { retrieveAssistantHelp } from '../backend/services/assistant/knowledge';
import type { AssistantJson, AssistantToolEvidence } from '../shared/assistantOperations';

afterEach(cleanup);
const helpEvidence = (data: AssistantJson): AssistantToolEvidence => ({ id: 'e1', tool: 'search_help', label: 'Ayuda revisada', data });

describe('evidencia de ayuda en una consulta operativa', () => {
    it('muestra el texto real recuperado y su sección y versión, sin inventar enlaces', () => {
        const help = retrieveAssistantHelp('compra con factura', 'OWNER');
        render(<AssistantOperationalEvidence evidence={helpEvidence(JSON.parse(JSON.stringify(help)))} />);
        expect(screen.getByText(/Confirmá por separado si recibiste la mercadería y si pagaste/)).toBeVisible();
        const sources = within(screen.getByRole('list', { name: 'Fuentes de ayuda' }));
        expect(sources.getByText('Ayuda de Nortex · Revisar una factura de compra · Versión 2026-09-05.1')).toBeVisible();
        expect(screen.queryByRole('link')).not.toBeInTheDocument();
    });

    it.each([
        ['recomendame una película', 'OWNER'],
        ['balance contabilidad ganancias', 'BODEGUERO'],
    ])('conserva la abstención real para %s y rol %s', (query, role) => {
        const help = retrieveAssistantHelp(query, role);
        render(<AssistantOperationalEvidence evidence={helpEvidence(JSON.parse(JSON.stringify(help)))} />);
        expect(screen.getByText(/No encontré una respuesta en la ayuda revisada disponible para tu rol/)).toBeVisible();
        expect(screen.queryByRole('list', { name: 'Fuentes de ayuda' })).not.toBeInTheDocument();
    });

    it.each([null, { nested: 'incorrecto' }, ['incorrecto'], '   '])('tolera texto y citas malformados: %j', text => {
        render(<AssistantOperationalEvidence evidence={helpEvidence({ text, citations: [null, 7, [], { id: 'bad', title: {}, section: 'No publicar', version: '1' }] })} />);
        expect(screen.getByText('La ayuda no está disponible en esta consulta.')).toBeVisible();
        expect(screen.queryByRole('list', { name: 'Fuentes de ayuda' })).not.toBeInTheDocument();
        expect(screen.queryByText(/No publicar|\[object Object\]/)).not.toBeInTheDocument();
    });

    it('escapa texto y referencias y descarta entradas inválidas sin convertir paths en enlaces', () => {
        const text = '<img src=x onerror=alert(1)>', title = '<script>alert(1)</script>';
        const { container } = render(<AssistantOperationalEvidence evidence={helpEvidence({ text, citations: [null,
            { id: 'safe', title, section: 'Revisar compra', version: '1', path: 'javascript:alert(1)' },
            { id: 'bad', title: 'Referencia incompleta', section: ' ', version: '1' },
        ] })} />);
        expect(screen.getByText(text)).toBeVisible();
        expect(screen.getByRole('list', { name: 'Fuentes de ayuda' })).toHaveTextContent(`${title} · Revisar compra · Versión 1`);
        expect(screen.queryByText(/Referencia incompleta/)).not.toBeInTheDocument();
        expect(container.querySelector('img, script, a')).toBeNull();
    });

    it('no muestra campos arbitrarios de herramientas distintas como ayuda', () => {
        render(<AssistantOperationalEvidence evidence={{ ...helpEvidence({ text: 'Campo no destinado a la interfaz', citations: [] }), tool: 'other_tool' }} />);
        expect(screen.queryByText('Campo no destinado a la interfaz')).not.toBeInTheDocument();
    });
});
