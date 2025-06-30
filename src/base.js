/**
 * Base class for Shogun plugins
 */
export class BasePlugin {
    constructor() {
        this.core = null;
        this.initialized = false;
    }
    /**
     * Initialize the plugin with the core instance
     */
    initialize(core) {
        this.core = core;
        this.initialized = true;
    }
    /**
     * Destroy the plugin and clean up resources
     */
    destroy() {
        this.core = null;
        this.initialized = false;
    }
    /**
     * Check if the plugin is initialized
     */
    isInitialized() {
        return this.initialized;
    }
    /**
     * Assert that the plugin is initialized
     */
    assertInitialized() {
        if (!this.initialized) {
            throw new Error(`Plugin ${this.name} is not initialized`);
        }
    }
}
//# sourceMappingURL=base.js.map