export type PostSalePrintOption =
  | { id: 'ticket80'; label: 'Ticket 80 mm'; primary: true }
  | { id: 'thermal'; label: 'Enviar a tiquetera'; primary: false };

export const buildPostSalePrintOptions = (thermalConnected: boolean): PostSalePrintOption[] => {
    const options: PostSalePrintOption[] = [
        { id: 'ticket80', label: 'Ticket 80 mm', primary: true },
    ];
    if (thermalConnected) options.push({ id: 'thermal', label: 'Enviar a tiquetera', primary: false });
    return options;
};
