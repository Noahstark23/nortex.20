import { learningGuides, guideAt } from './learningGuides';

/** Compatibilidad con los enlaces existentes. La guía vive en Layout y permite trabajar. */
function start(id: string) {
  window.dispatchEvent(new CustomEvent('nortex:learning-guide', { detail: id }));
}
export const startInventoryTour = () => start('inv');
export const startPosTour = () => start('pos');
export const startFiadoTour = () => start('fiado');
export const startComprasTour = () => start('compras');
export function maybeAutostartTour() {
  const url = new URL(window.location.href);
  const id = guideAt(url.searchParams.get('tour'), url.pathname);
  if (!id || !learningGuides[id]) return;
  start(id);
  url.searchParams.delete('tour');
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
}
