/**
 * Base class for Shogun plugins
 */
export declare abstract class BasePlugin {
    protected core: any;
    protected initialized: boolean;
    abstract name: string;
    abstract version: string;
    abstract description: string;
    /**
     * Initialize the plugin with the core instance
     */
    initialize(core: any): void;
    /**
     * Destroy the plugin and clean up resources
     */
    destroy(): void;
    /**
     * Check if the plugin is initialized
     */
    isInitialized(): boolean;
    /**
     * Assert that the plugin is initialized
     */
    protected assertInitialized(): void;
}
