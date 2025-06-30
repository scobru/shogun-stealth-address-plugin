/**
 * Simple logging utility
 */
export function log(message, ...args) {
    console.log(`[Stealth] ${message}`, ...args);
}
/**
 * Simple error logging utility
 */
export function logError(message, error) {
    console.error(`[Stealth] ${message}`, error);
}
/**
 * Simple warning logging utility
 */
export function logWarn(message, ...args) {
    console.warn(`[Stealth] ${message}`, ...args);
}
//# sourceMappingURL=utils.js.map