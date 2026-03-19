import { CatalogData } from '../types';

const mockData: CatalogData = {
  settings: {
    coverImageUrl: '_1724031668472_portada.jpg',
    logoUrl: '_1724031668471_neuromoduladores_frente.jpg',
  },
  pages: [
    {
      id: 'page-cover',
      type: 'cover',
      content: {
        title: 'Dra. María Fernanda Ubau',
        tagline: 'Medicina Estética'
      }
    },
    {
      id: 'page-treatments-1',
      type: 'treatments',
      content: {
        title: 'Nuestros Servicios',
        services: [
            { id: 's1', name: 'Neuromoduladores', description: 'Tratamiento para líneas de expresión en tercio superior: frente, entrecejo y patas de gallo.', category: 'facial', imageUrl: '' },
            { id: 's2', name: 'Relleno de Labios', description: 'Aporta volumen y definición a tus labios con un resultado natural y espectacular.', category: 'facial', imageUrl: '' },
            { id: 's3', name: 'Bioestimuladores de Colágeno', description: 'Estimula la producción natural de colágeno para una piel más firme y joven.', category: 'facial', imageUrl: '' },
            { id: 's4', name: 'Armonización Facial', description: 'Realza tu belleza natural mediante un conjunto de procedimientos estéticos personalizados.', category: 'facial', imageUrl: '' },
            { id: 's5', name: 'Rellenos Dérmicos', description: 'Restaura volumen y suaviza surcos para rejuvenecer tu rostro.', category: 'facial', imageUrl: '' },
            { id: 's6', name: 'Consultas Estéticas', description: 'Evaluación personalizada para crear un plan de tratamiento a tu medida.', category: 'facial', imageUrl: '' },
        ]
      }
    },
    {
      id: 'page-gallery-1',
      type: 'gallery',
      content: {
          title: 'Nuestros Resultados',
          images: [
              { id: 'g1', src: '_1724031668471_neuromoduladores_frente.jpg', alt: 'Antes y después tratamiento de frente' },
              { id: 'g2', src: '_1724031668472_relleno_labios_1.jpg', alt: 'Antes y después de relleno de labios' },
              { id: 'g3', src: '_1724031668471_neuromoduladores_patas_de_gallo.jpg', alt: 'Antes y después tratamiento de patas de gallo' },
              { id: 'g4', src: '_1724031668472_relleno_labios_2.jpg', alt: 'Antes y después de relleno de labios' },
          ]
      }
    },
    {
      id: 'page-contact',
      type: 'contact',
      content: {
        title: 'Agenda tu Cita',
        address: 'Chinandega, Nicaragua',
        phone: '+505 8837-4947',
        email: 'agenta@dramariafernandaubau.com',
      }
    }
  ],
};

export const getCatalogData = (): Promise<CatalogData> => {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve(mockData);
    }, 1000);
  });
};