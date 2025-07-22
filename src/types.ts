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
   * Get existing stealth keys for the current user (does not generate new ones)
   * @returns Promise<StealthKeys | null> - null if no keys exist
   */
  getUserStealthKeys(): Promise<StealthKeys | null>;

  /**
   * Create and save new stealth keys for the current user
   * @returns Promise<StealthKeys>
   */
  createUserStealthKeys(): Promise<StealthKeys>;

  /**
   * Get public stealth keys for a given Gun public key
   * @param gunPublicKey The Gun public key to look up
   * @returns Promise<{viewingKey: string, spendingKey: string} | null>
   */
  getPublicStealthKeys(
    gunPublicKey: string
  ): Promise<{ viewingKey: string; spendingKey: string } | null>;

  /**
   * Generate a new stealth address for a recipient
   * @param recipientViewingKey Recipient's viewing public key
   * @param recipientSpendingKey Recipient's spending public key
   * @param ephemeralPrivateKey Optional ephemeral private key
   * @param spendingPrivateKey Optional spending private key for deterministic generation
   * @returns Promise<StealthAddressResult>
   */
  generateStealthAddress(
    recipientViewingKey: string,
    recipientSpendingKey: string,
    ephemeralPrivateKey?: string,
    spendingPrivateKey?: string
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

  /**
   * Imposta la configurazione dei contratti
   */
  setContractConfig(config: Partial<ContractConfig>): void;

  /**
   * Imposta la rete corrente
   */
  setNetwork(networkName: string): void;

  /**
   * Ottiene la rete corrente
   */
  getCurrentNetwork(): string;

  /**
   * Ottiene tutte le reti disponibili
   */
  getAvailableNetworks(): string[];

  /**
   * Aggiunge o aggiorna la configurazione di una rete
   */
  setNetworkConfig(networkName: string, config: NetworkConfig): void;

  /**
   * Send a stealth payment
   */
  sendStealthPayment(
    recipientGunPub: string,
    amount: string,
    token?: string,
    message?: string
  ): Promise<{
    txHash: string;
    stealthAddress: string;
    ephemeralPublicKey: string;
  }>;

  /**
   * Listen for stealth payment notifications
   */
  onStealthPayment(
    callback: (payment: StealthPaymentNotification) => void
  ): void;

  /**
   * Get all payments with their current state
   */
  getAllPayments(): Promise<
    Array<StealthPaymentNotification & { status: string; txHash?: string }>
  >;

  /**
   * Get pending payments only
   */
  getPendingPayments(): Promise<
    Array<StealthPaymentNotification & { status: string; txHash?: string }>
  >;

  /**
   * Get claimed payments only
   */
  getClaimedPayments(): Promise<
    Array<StealthPaymentNotification & { status: string; txHash?: string }>
  >;

  /**
   * Update payment status
   */
  updatePaymentStatus(
    stealthAddress: string,
    timestamp: number,
    status: string,
    txHash?: string
  ): Promise<void>;

  /**
   * Clear processed payments
   */
  clearProcessedPayments(): Promise<number>;

  /**
   * Force remove a specific payment (for compatibility issues)
   */
  forceRemovePayment(
    stealthAddress: string,
    timestamp: number
  ): Promise<boolean>;

  /**
   * Force remove multiple payments by stealth address
   */
  forceRemovePaymentsByAddress(stealthAddress: string): Promise<number>;

  /**
   * Get payment by stealth address and timestamp
   */
  getPayment(
    stealthAddress: string,
    timestamp: number
  ): Promise<
    (StealthPaymentNotification & { status: string; txHash?: string }) | null
  >;

  /**
   * Check if a payment exists
   */
  hasPayment(stealthAddress: string, timestamp: number): Promise<boolean>;

  /**
   * Restart payment listener (useful after page refresh)
   */
  restartPaymentListener(): Promise<void>;

  /**
   * Check if payment listener is active
   */
  isPaymentListenerActive(): boolean;

  /**
   * Get listener status information
   */
  getListenerStatus(): {
    isListening: boolean;
    callbackCount: number;
    paymentCount: number;
  };

  /**
   * Check if the plugin is properly initialized
   */
  isInitialized(): boolean;

  /**
   * Sync notifications with payment state to recover missed payments
   */
  syncNotificationsWithState(): Promise<void>;

  /**
   * Withdraw a stealth payment
   * @param stealthAddress The stealth address containing the payment
   * @param acceptor The address to receive the withdrawn funds
   * @param token The token address (use ETH_TOKEN_PLACEHOLDER for ETH)
   * @param ephemeralPublicKey Optional ephemeral public key for ETH withdrawals
   * @returns Promise<{txHash: string}>
   */
  withdrawStealthPayment(
    stealthAddress: string,
    acceptor: string,
    token: string,
    ephemeralPublicKey?: string
  ): Promise<{ txHash: string }>;

  /**
   * Scan on-chain per ripopolare il database GunDB con pagamenti stealth da un blocco specifico
   * @param fromBlock Blocco iniziale per lo scan (es. 8796157)
   * @param toBlock Blocco finale per lo scan (opzionale, se non specificato usa l'ultimo blocco)
   * @param stealthAddresses Array di indirizzi stealth da monitorare (opzionale, se non specificato usa le chiavi dell'utente)
   * @returns Promise con statistiche dello scan
   */
  scanOnChainPayments(
    fromBlock: number,
    toBlock?: number,
    stealthAddresses?: string[]
  ): Promise<{
    scannedBlocks: number;
    foundPayments: number;
    savedPayments: number;
    errors: string[];
  }>;

  /**
   * Forza la sincronizzazione anche dopo una eliminazione definitiva
   * @param force Se true, ignora il timestamp dell'ultima eliminazione
   */
  forceSyncNotifications(force?: boolean): Promise<void>;

  /**
   * Get existing stealth keys for the current user using SEA signature as seed
   * @returns Promise<StealthKeys | null> - null if no keys exist
   */
  getUserStealthKeysWithSEA(): Promise<StealthKeys | null>;

  /**
   * Create and save new stealth keys using SEA signature as seed
   * @returns Promise<StealthKeys>
   */
  createUserStealthKeysWithSEA(): Promise<StealthKeys>;

  /**
   * Generate and save stealth keys using SEA signature as seed
   * @returns Promise<StealthKeys>
   */
  generateAndSaveStealthKeysWithSEA(): Promise<StealthKeys>;
}

/**
 * Interface for mapping Gun public keys to stealth keys
 */
export interface GunStealthKeyMapping {
  viewingKey: string;
  spendingKey: string;
  timestamp: number;
}

export interface StealthPayment {
  stealthAddress: string;
  ephemeralPublicKey: string;
  amount: string;
  token: string; // ETH_TOKEN_PLACEHOLDER per ETH, o indirizzo token
  sender: string; // Gun public key del mittente
  timestamp: number;
  status: "pending" | "claimed" | "expired";
  txHash?: string; // Hash della transazione on-chain
  toll?: string; // Tassa pagata
}

export interface StealthPaymentNotification {
  stealthAddress: string;
  ephemeralPublicKey: string;
  amount: string;
  token: string;
  sender: string;
  timestamp: number;
  message?: string; // Messaggio opzionale
}

export interface PaymentForwarderConfig {
  address: string;
  toll: string;
  tollCollector: string;
  tollReceiver: string;
}

/**
 * Configurazione per una rete specifica
 */
export interface NetworkConfig {
  paymentForwarder: string;
  stealthKeyRegistry: string;
  rpcUrl?: string;
}

/**
 * Configurazione completa dei contratti
 */
export interface ContractConfig {
  networks: {
    [networkName: string]: NetworkConfig;
  };
  defaultNetwork?: string;
}
