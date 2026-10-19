// Zero-padded counters such as chapter numbers ("03") and frame readouts ("frame 042").
export const pad = (n: number, width = 2) => String(Math.max(0, Math.floor(n))).padStart(width, '0');
