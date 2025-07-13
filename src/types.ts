import { BasePluginInterface } from "./base";
import { Wallet } from "ethers";

/**
 * Types and interfaces for Shogun Stealth Address functionality
 * Now compatible with Fluidkey Stealth Account Kit
 */

/**
 * Fluidkey compatible key pair interface
 */
export interface EphemeralKeyPair {
  pub: string;
  priv: string;
  epub: string;
  epriv: string;
}

/**
 * Enhanced StealthKeys interface compatible with Fluidkey
 */
export interface StealthKeys {
  viewingKey: {
    publicKey: string;
    privateKey: string;
  };
  spendingKey: {
    publicKey: string;
    privateKey: string;
  };
}

/**
 * Fluidkey compatible stealth data structure
 */
export interface StealthData {
  stealthAddress: string;
  ephemeralPublicKey: string;
  recipientViewingKey: string;
  recipientSpendingKey: string;
  ephemeralKeyPair?: EphemeralKeyPair;
}

/**
 * Enhanced result interface compatible with Fluidkey
 */
export interface StealthAddressResult {
  stealthAddress: string;
  ephemeralPublicKey: string;
  recipientViewingPublicKey?: string;
  recipientSpendingPublicKey?: string;
}

/**
 * Fluidkey signature-based key generation
 */
export interface FluidkeySignature {
  r: string;
  s: string;
  v: number;
}

/**
 * Type for log levels in stealth operations
 */
export type LogLevel = "info" | "error" | "debug" | "warn";

/**
 * Interface for structured logging messages
 */
export interface LogMessage {
  timestamp: string;
  level: LogLevel;
  message: string;
  data?: any;
}

/**
 * Enhanced plugin interface with Fluidkey functions
 */
export interface StealthPluginInterface extends BasePluginInterface {
  /**
   * Get or generate stealth keys for the current user
   * @returns Promise<StealthKeys>
   */
  getUserStealthKeys(): Promise<StealthKeys>;

  /**
   * Get public stealth keys for a given Gun public key
   * @param gunPublicKey The Gun public key to look up
   * @returns Promise<{viewingKey: string, spendingKey: string} | null>
   */
  getPublicStealthKeys(gunPublicKey: string): Promise<{viewingKey: string, spendingKey: string} | null>;

  /**
   * Generate a new stealth address for a recipient
   * @param recipientViewingKey Recipient's viewing public key
   * @param recipientSpendingKey Recipient's spending public key
   * @returns Promise<StealthAddressResult>
   */
  generateStealthAddress(
    recipientViewingKey: string,
    recipientSpendingKey: string
  ): Promise<StealthAddressResult>;

  /**
   * Open a stealth address using the recipient's private keys
   * @param stealthAddress The stealth address to open
   * @param ephemeralPublicKey The ephemeral public key used to generate the stealth address
   * @param viewingPrivateKey Recipient's viewing private key
   * @param spendingPrivateKey Recipient's spending private key
   * @returns Promise<Wallet>
   */
  openStealthAddress(
    stealthAddress: string,
    ephemeralPublicKey: string,
    viewingPrivateKey: string,
    spendingPrivateKey: string
  ): Promise<Wallet>;

  /**
   * Get a new pair of stealth keys
   * @returns Promise<StealthKeys>
   */
  getStealthKeys(): Promise<StealthKeys>;
}

/**
 * Interface for mapping Gun public keys to stealth keys
 */
export interface GunStealthKeyMapping {
  viewingKey: string;
  spendingKey: string;
  timestamp: number;
} 