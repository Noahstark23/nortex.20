// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {render,screen,fireEvent,cleanup} from '@testing-library/react';
import {afterEach,describe,it,expect,vi} from 'vitest';
import CommerceOperations from '../components/whatsapp/CommerceOperations';
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
describe('estado atención: incertidumbre visible',()=>{
 it('fallo de consulta no informa cero pendientes ni atención disponible',async()=>{vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:false}));render(<CommerceOperations/>);fireEvent.click(screen.getByText('Estado de atención'));fireEvent.click(screen.getByText('Comprobar atención'));expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo comprobar');expect(screen.queryByText('Consultas pendientes: 0')).not.toBeInTheDocument();});
 it('muestra UNKNOWN sin convertirlo en entregado',async()=>{vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:async()=>({checkedAt:'2026-09-29T18:00:00Z',worker:{state:'STALE'},inbox:{counts:{PENDING:2}},outbox:{counts:{UNKNOWN:1}}})}));render(<CommerceOperations/>);fireEvent.click(screen.getByText('Estado de atención'));fireEvent.click(screen.getByText('Comprobar atención'));expect(await screen.findByText('Envíos inciertos: 1')).toBeInTheDocument();expect(screen.getByText('Atención automática: Sin señal reciente')).toBeInTheDocument();expect(screen.queryByText('Entregado')).not.toBeInTheDocument();});
});
