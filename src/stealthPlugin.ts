import { BasePlugin } from "./base";
import { Stealth } from "./stealth";
import {
  StealthAddressResult,
  StealthData,
  StealthPluginInterface,
  StealthKeys,
  FluidkeySignature,
  GunStealthKeyMapping,
  StealthPayment,
  StealthPaymentNotification,
  PaymentForwarderConfig,
} from "./types";
import { ethers } from "ethers";
import { log } from "./utils";
import {
  PAYMENT_FORWARDER_ABI,
  STEALTH_KEY_REGISTRY_ABI,
  CONTRACT_ADDRESSES,
  ETH_TOKEN_PLACEHOLDER,
  ContractManager,
  ContractConfig,
  NetworkConfig,
} from "./contracts";

// Import Fluidkey functions directly for plugin use
import {
  generateStealthAddresses,
  generateStealthPrivateKey,
} from "@fluidkey/stealth-account-kit";

import { normalizeHex } from "./stealth";

/**
 * Plugin per la gestione delle funzionalità Stealth in ShogunCore
 * Enhanced with Fluidkey Stealth Account Kit integration and stealth payments
 */
export class StealthPlugin
  extends BasePlugin
  implements StealthPluginInterface
{
  name = "stealth";
  version = "1.0.0";
  description = "Stealth address plugin for Shogun";

  protected core: any = null;
  private stealth: Stealth;
  private gun: any = null;
  private paymentForwarderContract: ethers.Contract | null = null;
  private stealthKeyRegistryContract: ethers.Contract | null = null;
  private provider: ethers.Provider | null = null;
  private signer: ethers.Signer | null = null;
  private contractManager: ContractManager;

  constructor(config?: Partial<ContractConfig>) {
    super();
    this.stealth = new Stealth("info");
    this.contractManager = new ContractManager(config);
  }

  initialize(core: any): void {
    super.initialize(core);
    this.gun = core.gun;

    if (!core.gun) {
      throw new Error("Gun instance required for stealth plugin");
    }

    // Initialize provider and contracts if available
    if (core.provider) {
      this.provider = core.provider;
      this.signer = core.signer;
      this.initializeContracts();
    }

    this.log(
      "info",
      "Stealth plugin initialized with Fluidkey integration and payment support"
    );
  }

  /**
   * Imposta la configurazione dei contratti
   */
  setContractConfig(config: Partial<ContractConfig>): void {
    this.contractManager = new ContractManager(config);
    this.initializeContracts();
  }

  /**
   * Imposta la rete corrente
   */
  setNetwork(networkName: string): void {
    this.contractManager.setNetwork(networkName);
    this.initializeContracts();
  }

  /**
   * Ottiene la rete corrente
   */
  getCurrentNetwork(): string {
    return this.contractManager.getCurrentNetwork();
  }

  /**
   * Ottiene tutte le reti disponibili
   */
  getAvailableNetworks(): string[] {
    return this.contractManager.getAvailableNetworks();
  }

  /**
   * Aggiunge o aggiorna la configurazione di una rete
   */
  setNetworkConfig(networkName: string, config: NetworkConfig): void {
    this.contractManager.setNetworkConfig(networkName, config);
  }

  private initializeContracts(): void {
    if (!this.provider || !this.signer) return;

    try {
      // Initialize PaymentForwarder contract
      const paymentForwarderAddress =
        this.contractManager.getPaymentForwarderAddress();
      this.paymentForwarderContract = new ethers.Contract(
        paymentForwarderAddress,
        PAYMENT_FORWARDER_ABI,
        this.signer
      );

      // Initialize StealthKeyRegistry contract if address is available
      const stealthKeyRegistryAddress =
        this.contractManager.getStealthKeyRegistryAddress();
      if (stealthKeyRegistryAddress) {
        this.stealthKeyRegistryContract = new ethers.Contract(
          stealthKeyRegistryAddress,
          STEALTH_KEY_REGISTRY_ABI,
          this.signer
        );
      }

      this.log(
        "info",
        `Contracts initialized for network: ${this.contractManager.getCurrentNetwork()}`
      );
    } catch (error) {
      this.log("error", `Failed to initialize contracts: ${error}`);
    }
  }

  destroy(): void {
    super.destroy();
    this.gun = null;
    this.paymentForwarderContract = null;
    this.stealthKeyRegistryContract = null;
    this.provider = null;
    this.signer = null;
  }

  protected override assertInitialized(): void {
    super.assertInitialized();
    if (!this.gun) {
      throw new Error("Gun instance not available");
    }
  }

  /**
   * Saves stealth keys to Gun user space
   * @param keys StealthKeys object containing the keys to save
   * @returns Promise<void>
   */
  private async saveKeysToGun(keys: StealthKeys): Promise<void> {
    this.assertInitialized();
    if (!this.core.gun) throw new Error("Gun not available");

    const gunUser = this.core.gun.user();
    if (!gunUser.is) throw new Error("User not authenticated");

    const userPub = gunUser.is.pub;

    // Save private keys in user space
    await new Promise<void>((resolve, reject) => {
      gunUser.get("stealth_keys").put(
        {
          viewingKey: keys.viewingKey.privateKey,
          spendingKey: keys.spendingKey.privateKey,
          timestamp: Date.now(),
        },
        (ack: any) => {
          if (ack.err) reject(new Error(ack.err));
          else resolve();
        }
      );
    });

    // Save public keys in public space
    await new Promise<void>((resolve, reject) => {
      this.core.gun
        .get("shogun")
        .get("stealth_public_keys")
        .get(userPub)
        .put(
          {
            viewingKey: keys.viewingKey.publicKey,
            spendingKey: keys.spendingKey.publicKey,
            timestamp: Date.now(),
          },
          (ack: any) => {
            if (ack.err) reject(new Error(ack.err));
            else resolve();
          }
        );
    });
  }

  /**
   * Retrieves stealth keys from Gun user space
   * @returns Promise<StealthKeys | null>
   */
  private async getKeysFromGun(): Promise<StealthKeys | null> {
    this.assertInitialized();
    if (!this.core.gun) throw new Error("Gun not available");

    const gunUser = this.core.gun.user();
    if (!gunUser.is) throw new Error("User not authenticated");

    // Get private keys from user space
    const privateKeys = await new Promise<any>((resolve) => {
      gunUser.get("stealth_keys").once(resolve);
    });

    if (!privateKeys) return null;

    // Get public keys from public space
    const publicKeys = await new Promise<any>((resolve) => {
      this.core.gun
        .get("shogun")
        .get("stealth_public_keys")
        .get(gunUser.is.pub)
        .once(resolve);
    });

    if (!publicKeys) return null;

    return {
      viewingKey: {
        privateKey: privateKeys.viewingKey,
        publicKey: publicKeys.viewingKey,
      },
      spendingKey: {
        privateKey: privateKeys.spendingKey,
        publicKey: publicKeys.spendingKey,
      },
    };
  }

  /**
   * Gets public stealth keys for a given Gun public key
   * @param gunPublicKey The Gun public key to look up
   * @returns Promise<{viewingKey: string, spendingKey: string} | null>
   */
  async getPublicStealthKeys(
    gunPublicKey: string
  ): Promise<{ viewingKey: string; spendingKey: string } | null> {
    this.assertInitialized();
    if (!this.core.gun) throw new Error("Gun not available");

    const publicKeys = await new Promise<any>((resolve) => {
      this.core.gun
        .get("shogun")
        .get("stealth_public_keys")
        .get(gunPublicKey)
        .once(resolve);
    });

    if (!publicKeys) return null;

    return {
      viewingKey: publicKeys.viewingKey,
      spendingKey: publicKeys.spendingKey,
    };
  }

  /**
   * Gets or generates stealth keys for the current user
   * @returns Promise<StealthKeys>
   */
  async getUserStealthKeys(): Promise<StealthKeys> {
    this.assertInitialized();

    try {
      // Try to get existing keys first
      const existingKeys = await this.getKeysFromGun();
      if (existingKeys) {
        this.log("info", "Retrieved existing stealth keys");
        return existingKeys;
      }

      // If no keys exist, generate new ones
      this.log("info", "No existing keys found, generating new ones");
      const newKeys = await this.stealth.getStealthKeys();
      await this.saveKeysToGun(newKeys);
      this.log("info", "Generated and saved new stealth keys");
      return newKeys;
    } catch (error) {
      this.log("error", "Error getting user stealth keys", error);
      throw error;
    }
  }

  /**
   * @inheritdoc
   */
  async generateEphemeralKeyPair(): Promise<{
    privateKey: string;
    publicKey: string;
  }> {
    return this.stealth.createAccount();
  }

  /**
   * @inheritdoc
   */
  async generateStealthAddress(
    recipientViewingKey: string,
    recipientSpendingKey: string,
    ephemeralPrivateKey?: string
  ): Promise<StealthAddressResult> {
    try {
      // Passa sempre la ephemeralPrivateKey se fornita
      this.log("debug", "[PLUGIN][GEN] Params", {
        recipientViewingKey: normalizeHex(recipientViewingKey, 64),
        recipientSpendingKey: normalizeHex(recipientSpendingKey, 64),
        ephemeralPrivateKey: ephemeralPrivateKey
          ? normalizeHex(ephemeralPrivateKey, 32)
          : undefined,
      });
      return await this.stealth.generateStealthAddress(
        recipientViewingKey,
        recipientSpendingKey,
        ephemeralPrivateKey
      );
    } catch (error) {
      console.error("Error generating stealth address:", error);
      throw error;
    }
  }

  /**
   * @inheritdoc
   */
  async scanStealthAddresses(
    addresses: StealthData[],
    viewingPrivateKey: string
  ): Promise<StealthData[]> {
    // Implementazione per compatibilità - da implementare completamente
    console.warn("scanStealthAddresses non ancora completamente implementato");
    return Promise.resolve([]);
  }

  /**
   * @inheritdoc
   */
  async isStealthAddressMine(
    stealthData: StealthData,
    viewingPrivateKey: string
  ): Promise<boolean> {
    // Implementazione per compatibilità - da implementare completamente
    console.warn("isStealthAddressMine non ancora completamente implementato");
    return Promise.resolve(false);
  }

  /**
   * @inheritdoc
   */
  async getStealthPrivateKey(
    stealthData: StealthData,
    viewingPrivateKey: string,
    spendingPrivateKey: string
  ): Promise<string> {
    // Usa openStealthAddress per derivare la chiave privata
    const wallet = await this.openStealthAddress(
      stealthData.stealthAddress,
      stealthData.ephemeralKeyPair?.pub,
      viewingPrivateKey,
      spendingPrivateKey
    );
    return wallet.privateKey;
  }

  /**
   * @inheritdoc
   */
  async openStealthAddress(
    stealthAddress: string,
    ephemeralPublicKey: string | undefined,
    viewingPrivateKey: string,
    spendingPrivateKey: string
  ): Promise<ethers.Wallet> {
    if (!ephemeralPublicKey) {
      throw new Error("Missing ephemeral public key");
    }
    this.log("debug", "[PLUGIN][OPEN] Params", {
      stealthAddress: normalizeHex(stealthAddress, 20),
      ephemeralPublicKey: normalizeHex(ephemeralPublicKey, 33), // Changed from 65 to 33
      viewingPrivateKey: normalizeHex(viewingPrivateKey, 32),
      spendingPrivateKey: normalizeHex(spendingPrivateKey, 32),
    });
    return await this.stealth.openStealthAddress(
      stealthAddress,
      ephemeralPublicKey,
      viewingPrivateKey,
      spendingPrivateKey
    );
  }

  /**
   * Gets a new pair of stealth keys
   * @returns Promise<StealthKeys>
   */
  async getStealthKeys(): Promise<StealthKeys> {
    try {
      return await this.stealth.getStealthKeys();
    } catch (error) {
      this.log("error", "Error getting stealth keys", error);
      throw error;
    }
  }

  /**
   * Generates and saves stealth keys for the authenticated user
   * @returns Promise with the generated stealth keys
   */
  async generateAndSaveStealthKeys(): Promise<StealthKeys> {
    const stealth = this.stealth;

    // Generate and save the keys
    await stealth.generateAndSaveKeys();

    // Return the generated keys
    return stealth.getStealthKeys();
  }

  /**
   * @inheritdoc
   * Generate keys from signature using Fluidkey method
   */
  async generateKeysFromSignature(signature: FluidkeySignature): Promise<{
    viewingPrivateKey: string;
    viewingPublicKey: string;
    spendingPrivateKey: string;
    spendingPublicKey: string;
  }> {
    return this.stealth.generateKeysFromSignature(signature);
  }

  /**
   * @inheritdoc
   * Generate stealth addresses using Fluidkey method
   */
  async generateFluidkeyStealthAddresses(
    viewingPublicKeys: string[],
    spendingPublicKeys: string[],
    ephemeralPrivateKey: string
  ): Promise<string[]> {
    this.assertInitialized();

    try {
      this.assertInitialized();

      this.log(
        "info",
        "[generateFluidkeyStealthAddresses] Generating Fluidkey stealth addresses"
      );

      // Use Fluidkey's generateStealthAddresses function
      const result = generateStealthAddresses({
        ephemeralPrivateKey: ephemeralPrivateKey as `0x${string}`,
        spendingPublicKeys: spendingPublicKeys as `0x${string}`[],
      });

      this.log(
        "info",
        "[generateFluidkeyStealthAddresses] Generated stealth addresses:",
        {
          count: result.stealthAddresses.length,
          addresses: result.stealthAddresses,
        }
      );

      return result.stealthAddresses;
    } catch (error) {
      this.log("error", "[generateFluidkeyStealthAddresses] Error:", error);
      throw error;
    }
  }

  /**
   * @inheritdoc
   * Generate stealth private key using Fluidkey method
   */
  async generateFluidkeyStealthPrivateKey(
    ephemeralPublicKey: string,
    viewingPrivateKey: string,
    spendingPrivateKey: string
  ): Promise<string> {
    this.assertInitialized();

    try {
      this.assertInitialized();

      this.log(
        "info",
        "[generateFluidkeyStealthPrivateKey] Generating Fluidkey stealth private key"
      );

      // Use Fluidkey's generateStealthPrivateKey function
      const result = generateStealthPrivateKey({
        ephemeralPublicKey: ephemeralPublicKey as `0x${string}`,
        spendingPrivateKey: spendingPrivateKey as `0x${string}`,
      });

      this.log(
        "info",
        "[generateFluidkeyStealthPrivateKey] Generated stealth private key successfully"
      );

      return result.stealthPrivateKey;
    } catch (error) {
      this.log("error", "[generateFluidkeyStealthPrivateKey] Error:", error);
      throw error;
    }
  }

  private async processStealthData(stealthData: StealthData): Promise<void> {
    try {
      // If we have an ephemeral key pair, use it
      if (stealthData.ephemeralKeyPair?.pub) {
        await this.gun.get("ephemeralKeys").put({
          pub: stealthData.ephemeralKeyPair.pub,
          priv: stealthData.ephemeralKeyPair.priv,
          epub: stealthData.ephemeralKeyPair.epub,
          epriv: stealthData.ephemeralKeyPair.epriv,
        });
      }

      // Store the stealth data
      await this.gun.get("stealthData").put({
        stealthAddress: stealthData.stealthAddress,
        ephemeralPublicKey: stealthData.ephemeralPublicKey,
        recipientViewingKey: stealthData.recipientViewingKey,
        recipientSpendingKey: stealthData.recipientSpendingKey,
      });
    } catch (error) {
      console.error("Error processing stealth data:", error);
      throw error;
    }
  }

  private async openStealthAddressWithData(
    stealthData: StealthData,
    viewingPrivateKey: string,
    spendingPrivateKey: string
  ): Promise<ethers.Wallet> {
    if (!stealthData.ephemeralPublicKey) {
      throw new Error("Missing ephemeral public key");
    }
    return await this.stealth.openStealthAddress(
      stealthData.stealthAddress,
      stealthData.ephemeralPublicKey,
      viewingPrivateKey,
      spendingPrivateKey
    );
  }

  private log(level: string, message: string, error?: any): void {
    const prefix = "[Stealth]";
    if (error) {
      console.error(`${prefix} ${message}:`, error);
    } else {
      console.log(`${prefix} ${message}`);
    }
  }

  /**
   * Send a stealth payment using GunDB for notification and contract for custody
   * @param recipientGunPub Recipient's Gun public key
   * @param amount Amount to send (in wei for ETH, in token units for tokens)
   * @param token Token address (use ETH_TOKEN_PLACEHOLDER for ETH)
   * @param message Optional message to include
   * @returns Promise with transaction hash
   */
  async sendStealthPayment(
    recipientGunPub: string,
    amount: string,
    token: string = ETH_TOKEN_PLACEHOLDER,
    message?: string
  ): Promise<{
    txHash: string;
    stealthAddress: string;
    ephemeralPublicKey: string;
  }> {
    this.assertInitialized();

    try {
      // 1. Get recipient's stealth keys from GunDB
      const recipientKeys = await this.getPublicStealthKeys(recipientGunPub);
      if (!recipientKeys) {
        throw new Error("Recipient's stealth keys not found");
      }

      // 2. Generate stealth address
      const stealthResult = await this.generateStealthAddress(
        recipientKeys.viewingKey,
        recipientKeys.spendingKey
      );

      // 3. Prepare ciphertext (for now, we'll use a simple hash)
      // In a real implementation, this would be encrypted with the recipient's viewing key
      const ciphertext = ethers.keccak256(
        ethers.toUtf8Bytes(`stealth_payment_${Date.now()}_${Math.random()}`)
      );

      // 4. Extract pkx from ephemeral public key
      const pkx = stealthResult.ephemeralPublicKey.slice(2, 66); // Remove 0x and get x coordinate

      // 5. Send payment on-chain
      let txHash: string;

      if (token === ETH_TOKEN_PLACEHOLDER) {
        // Send ETH
        const toll = await this.paymentForwarderContract!.toll();
        const totalAmount = BigInt(amount) + BigInt(toll);

        const tx = await this.paymentForwarderContract!.sendEth(
          stealthResult.stealthAddress,
          toll,
          pkx,
          ciphertext,
          { value: totalAmount.toString() }
        );
        txHash = tx.hash;
      } else {
        // Send token
        const toll = await this.paymentForwarderContract!.toll();

        const tx = await this.paymentForwarderContract!.sendToken(
          stealthResult.stealthAddress,
          token,
          amount,
          pkx,
          ciphertext,
          { value: toll }
        );
        txHash = tx.hash;
      }

      // 6. Send notification via GunDB
      const notification: StealthPaymentNotification = {
        stealthAddress: stealthResult.stealthAddress,
        ephemeralPublicKey: stealthResult.ephemeralPublicKey,
        amount,
        token,
        sender: this.core.gun.user().is.pub,
        timestamp: Date.now(),
        message,
      };

      await this.sendStealthNotification(recipientGunPub, notification);

      this.log("info", "Stealth payment sent successfully", {
        recipient: recipientGunPub,
        amount,
        token,
        txHash,
        stealthAddress: stealthResult.stealthAddress,
      });

      return {
        txHash,
        stealthAddress: stealthResult.stealthAddress,
        ephemeralPublicKey: stealthResult.ephemeralPublicKey,
      };
    } catch (error) {
      this.log("error", "Error sending stealth payment", error);
      throw error;
    }
  }

  /**
   * Send stealth payment notification via GunDB
   */
  private async sendStealthNotification(
    recipientGunPub: string,
    notification: StealthPaymentNotification
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      this.gun
        .get("stealth_payments")
        .get(recipientGunPub)
        .put(notification, (ack: any) => {
          if (ack.err) {
            reject(new Error(ack.err));
          } else {
            resolve();
          }
        });
    });
  }

  /**
   * Listen for incoming stealth payments
   * @param callback Function to call when a new payment is received
   */
  onStealthPayment(
    callback: (payment: StealthPaymentNotification) => void
  ): void {
    this.assertInitialized();

    const userPub = this.gun.user().is.pub;
    if (!userPub) {
      throw new Error("User not authenticated");
    }

    this.gun
      .get("stealth_payments")
      .get(userPub)
      .on((data: any) => {
        if (data && typeof data === "object" && data.stealthAddress) {
          callback(data as StealthPaymentNotification);
        }
      });
  }

  /**
   * Check if a stealth address has pending payments
   * @param stealthAddress The stealth address to check
   * @param token Token address to check
   * @returns Promise with the pending amount
   */
  async checkPendingPayment(
    stealthAddress: string,
    token: string
  ): Promise<string> {
    if (!this.paymentForwarderContract) {
      throw new Error("PaymentForwarder contract not initialized");
    }

    try {
      const amount = await this.paymentForwarderContract.tokenPayments(
        stealthAddress,
        token
      );
      return amount.toString();
    } catch (error) {
      this.log("error", "Error checking pending payment", error);
      throw error;
    }
  }

  /**
   * Withdraw a stealth payment
   * @param stealthAddress The stealth address to withdraw from
   * @param acceptor The address to receive the funds
   * @param token The token address
   * @returns Promise with transaction hash
   */
  async withdrawStealthPayment(
    stealthAddress: string,
    acceptor: string,
    token: string
  ): Promise<{ txHash: string }> {
    if (!this.paymentForwarderContract) {
      throw new Error("PaymentForwarder contract not initialized");
    }

    try {
      const tx = await this.paymentForwarderContract.withdrawToken(
        acceptor,
        token
      );

      this.log("info", "Stealth payment withdrawn successfully", {
        stealthAddress,
        acceptor,
        token,
        txHash: tx.hash,
      });

      return { txHash: tx.hash };
    } catch (error) {
      this.log("error", "Error withdrawing stealth payment", error);
      throw error;
    }
  }

  /**
   * Get stealth payment history from GunDB
   * @returns Promise with payment history
   */
  async getStealthPaymentHistory(): Promise<StealthPaymentNotification[]> {
    this.assertInitialized();

    const userPub = this.gun.user().is.pub;
    if (!userPub) {
      throw new Error("User not authenticated");
    }

    return new Promise((resolve) => {
      this.gun
        .get("stealth_payments")
        .get(userPub)
        .once((data: any) => {
          if (data && typeof data === "object") {
            const payments: StealthPaymentNotification[] = Object.values(data)
              .filter(
                (item: any) =>
                  item &&
                  typeof item === "object" &&
                  item.stealthAddress &&
                  item.amount
              )
              .map((item: any) => item as StealthPaymentNotification)
              .sort(
                (
                  a: StealthPaymentNotification,
                  b: StealthPaymentNotification
                ) => b.timestamp - a.timestamp
              );
            resolve(payments);
          } else {
            resolve([]);
          }
        });
    });
  }
}
