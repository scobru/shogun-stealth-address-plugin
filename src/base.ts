/**
 * Base interface for Shogun plugins
 */
export interface BasePluginInterface {
  name: string;
  version: string;
  description: string;
  initialize(core: any): void;
  destroy(): void;
  isInitialized(): boolean;
}

/**
 * Base class for Shogun plugins
 */
export abstract class BasePlugin implements BasePluginInterface {
  protected core: any = null;
  protected initialized = false;

  abstract name: string;
  abstract version: string;
  abstract description: string;

  /**
   * Initialize the plugin with the core instance
   */
  initialize(core: any): void {
    this.core = core;
    this.initialized = true;
  }

  /**
   * Destroy the plugin and clean up resources
   */
  destroy(): void {
    this.core = null;
    this.initialized = false;
  }

  /**
   * Check if the plugin is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Assert that the plugin is initialized
   */
  protected assertInitialized(): void {
    if (!this.initialized) {
      throw new Error(`Plugin ${this.name} is not initialized`);
    }
  }
} 