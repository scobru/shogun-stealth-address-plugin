/**
 * Simple logging utility
 */
export function log(message: string, ...args: any[]): void {
  console.log(`[Stealth] ${message}`, ...args);
}

/**
 * Simple error logging utility
 */
export function logError(message: string, error?: any): void {
  console.error(`[Stealth] ${message}`, error);
}

/**
 * Simple warning logging utility
 */
export function logWarn(message: string, ...args: any[]): void {
  console.warn(`[Stealth] ${message}`, ...args);
} 