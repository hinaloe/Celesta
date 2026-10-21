/**
 * `value` as the `T` it stands in for in a test: a double of a browser
 * object (a canvas, a font face, an `AudioContext`, ...) with only the
 * members the code under test uses, or such a double read back as itself.
 * The one place the tests cast a stand-in to its browser type.
 */
export const standIn = <T,>(value: unknown): T => value as T;

/**
 * The global scope, with the global of a worker that Node has not: its
 * font set (`document.fonts` in a window).
 */
export const scope = standIn<typeof globalThis & { fonts?: Set<object> }>(globalThis);

/** A `fetch` answering `respond`: the code under test fetches by URL string. */
export const fetchStub = (respond: (url: string) => Response | Promise<Response>) => standIn<typeof fetch>(respond);
