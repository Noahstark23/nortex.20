/** Preferencias de captura; ninguna exige capacidades que el teléfono no tenga. */
export async function openBarcodeCamera(mediaDevices: Pick<MediaDevices, 'getUserMedia'> = navigator.mediaDevices): Promise<MediaStream> {
    const stream = await mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
    });
    return stream;
}

export async function focusBarcodeCamera(stream: MediaStream): Promise<void> {
    const track = stream.getVideoTracks?.()[0];
    if (!track || track.readyState === 'ended') return;
    try {
        const capabilities = track.getCapabilities?.() as (MediaTrackCapabilities & { focusMode?: string[] }) | undefined;
        if (!capabilities?.focusMode?.includes('continuous')) return;
        // Preservar resolución/lente. Safari puede no exponer este control.
        const constraints = { ...track.getConstraints(), advanced: [{ focusMode: 'continuous' }] };
        await track.applyConstraints(constraints as MediaTrackConstraints);
    } catch { /* El enfoque opcional no debe impedir leer con la cámara disponible. */ }
}
