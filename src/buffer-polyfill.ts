// Polyfill per Buffer - compatibilità cross-platform
import { Buffer as BufferPolyfill } from "buffer";

// Funzione per inizializzare il polyfill di Buffer
function initializeBufferPolyfill(): void {
  // Verifica se Buffer è già disponibile (Node.js)
  if (typeof global !== "undefined" && global.Buffer) {
    return; // Buffer già disponibile
  }

  // Verifica se Buffer è già disponibile nel browser
  if (typeof window !== "undefined" && (window as any).Buffer) {
    return; // Buffer già disponibile
  }

  // Imposta Buffer globalmente
  if (typeof global !== "undefined") {
    (global as any).Buffer = BufferPolyfill;
    (global as any).global = global;
    (global as any).process = (global as any).process || { env: {} };
  }

  // Imposta Buffer su window per browser
  if (typeof window !== "undefined") {
    (window as any).Buffer = BufferPolyfill;
  }

  // Imposta Buffer su globalThis per compatibilità moderna
  if (typeof globalThis !== "undefined") {
    (globalThis as any).Buffer = BufferPolyfill;
  }

  // Imposta Buffer su self per Web Workers
  if (typeof self !== "undefined") {
    (self as any).Buffer = BufferPolyfill;
  }

  // Aggiungi metodi di utilità se non esistono
  if (BufferPolyfill && !BufferPolyfill.isBuffer) {
    BufferPolyfill.isBuffer = function (
      obj: any
    ): obj is Buffer<ArrayBufferLike> {
      return obj instanceof BufferPolyfill;
    };
  }
}

// Inizializza automaticamente il polyfill
initializeBufferPolyfill();

// Esporta Buffer per uso esplicito
export { BufferPolyfill as Buffer };

// Esporta anche come default per compatibilità
export default BufferPolyfill;
