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

  // Payment state management
  private paymentState: Map<
    string,
    StealthPaymentNotification & { status: string; txHash?: string }
  > = new Map();
  private paymentCallbacks: ((payment: StealthPaymentNotification) => void)[] =
    [];
  private isListening = false;

  constructor(config?: Partial<ContractConfig>) {
    super();
    this.stealth = new Stealth("info");
    this.contractManager = new ContractManager(config);
  }

  initialize(core: any): void {
    super.initialize(core);
    this.gun = core.gun;
    this.provider = core.provider;
    this.signer = core.signer;

    if (!this.gun) {
      throw new Error("Gun instance is required");
    }

    if (!this.provider) {
      throw new Error("Provider is required");
    }

    if (!this.signer) {
      throw new Error("Signer is required");
    }

    this.contractManager = new ContractManager();

    // Initialize contracts if config is available
    if (this.contractManager.getAvailableNetworks().length > 0) {
      this.initializeContracts();
    }

    // Load payment state and sync notifications
    this.loadPaymentState().then(() => {
      this.syncNotificationsWithState().then(() => {
        // Start payment listener after sync
        this.startPaymentListener();
      });
    });

    this.log("info", "Stealth plugin initialized successfully");
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

  protected assertInitialized(): void {
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
    this.log("info", `[saveKeysToGun] Saving keys for user: ${userPub}`);

    // Save private keys in user space
    await new Promise<void>((resolve, reject) => {
      gunUser
        .get("shogun")
        .get("stealth_keys")
        .put(
          {
            viewingKey: keys.viewingKey.privateKey,
            spendingKey: keys.spendingKey.privateKey,
            timestamp: Date.now(),
          },
          (ack: any) => {
            this.log("info", `[saveKeysToGun] Private keys save ack:`, ack);
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
            this.log("info", `[saveKeysToGun] Public keys save ack:`, ack);
            if (ack.err) reject(new Error(ack.err));
            else resolve();
          }
        );
    });
  }

  /**
   * Gets stealth keys from Gun user space
   * @returns Promise<StealthKeys | null>
   */
  private async getKeysFromGun(): Promise<StealthKeys | null> {
    this.assertInitialized();
    if (!this.core.gun) throw new Error("Gun not available");

    const gunUser = this.core.gun.user();
    if (!gunUser.is) throw new Error("User not authenticated");

    // Get private keys from user space
    const privateKeys = await new Promise<any>((resolve) => {
      gunUser.get("shogun").get("stealth_keys").once(resolve);
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

    this.log(
      "info",
      `[getPublicStealthKeys] Looking up keys for: ${gunPublicKey}`
    );

    const publicKeys = await new Promise<any>((resolve) => {
      this.core.gun
        .get("shogun")
        .get("stealth_public_keys")
        .get(gunPublicKey)
        .once(resolve);
    });

    this.log("info", `[getPublicStealthKeys] Retrieved data:`, publicKeys);

    if (!publicKeys) {
      this.log(
        "warn",
        `[getPublicStealthKeys] No public keys found for: ${gunPublicKey}`
      );
      return null;
    }

    if (!publicKeys.viewingKey || !publicKeys.spendingKey) {
      this.log(
        "warn",
        `[getPublicStealthKeys] Incomplete keys found:`,
        publicKeys
      );
      return null;
    }

    this.log("info", `[getPublicStealthKeys] Keys found successfully`);
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
      // Debug: Check contract state
      if (!this.paymentForwarderContract) {
        throw new Error("PaymentForwarder contract not initialized");
      }

      const contractAddress = this.paymentForwarderContract.target;
      this.log(
        "info",
        `[sendStealthPayment] Contract address: ${contractAddress}`
      );

      // Debug: Check current network
      try {
        const network = await this.provider!.getNetwork();
        this.log(
          "info",
          `[sendStealthPayment] Current network: ${network.name} (chainId: ${network.chainId})`
        );
      } catch (error) {
        this.log(
          "warn",
          `[sendStealthPayment] Could not get network info: ${error}`
        );
      }

      // Debug: Check if contract exists at address
      const code = await this.provider!.getCode(contractAddress);
      if (code === "0x") {
        throw new Error(`No contract deployed at address: ${contractAddress}`);
      }
      this.log(
        "info",
        `[sendStealthPayment] Contract code found at: ${contractAddress}`
      );

      // Debug: Check if contract has expected functions
      try {
        const hasToll =
          await this.paymentForwarderContract.hasOwnProperty("toll");
        const hasSendEth =
          await this.paymentForwarderContract.hasOwnProperty("sendEth");
        const hasSendToken =
          await this.paymentForwarderContract.hasOwnProperty("sendToken");
        this.log("info", `[sendStealthPayment] Contract functions check:`, {
          hasToll: !!hasToll,
          hasSendEth: !!hasSendEth,
          hasSendToken: !!hasSendToken,
        });
      } catch (error) {
        this.log(
          "warn",
          `[sendStealthPayment] Could not check contract functions: ${error}`
        );
      }

      // Debug: Check contract name and interface
      try {
        const contractInterface = this.paymentForwarderContract.interface;
        this.log(
          "info",
          `[sendStealthPayment] Contract interface available:`,
          !!contractInterface
        );
      } catch (error) {
        this.log(
          "warn",
          `[sendStealthPayment] Could not get contract interface: ${error}`
        );
      }

      // Debug: Check contract owner
      try {
        const owner = await this.paymentForwarderContract.owner();
        this.log("info", `[sendStealthPayment] Contract owner: ${owner}`);
      } catch (error) {
        this.log(
          "warn",
          `[sendStealthPayment] Could not get contract owner: ${error}`
        );
      }

      // Debug: Check contract initialization
      try {
        const tollCollector =
          await this.paymentForwarderContract.tollCollector();
        const tollReceiver = await this.paymentForwarderContract.tollReceiver();
        this.log("info", `[sendStealthPayment] Contract initialization:`, {
          tollCollector: tollCollector,
          tollReceiver: tollReceiver,
        });
      } catch (error) {
        this.log(
          "warn",
          `[sendStealthPayment] Could not get contract initialization: ${error}`
        );
      }

      // Debug: Check toll with error handling
      let toll: bigint;
      try {
        toll = await this.paymentForwarderContract.toll();
        this.log(
          "info",
          `[sendStealthPayment] Contract toll: ${toll.toString()}`
        );
      } catch (error) {
        this.log(
          "error",
          `[sendStealthPayment] Error calling toll(): ${error}`
        );

        // Try to get more information about the error
        if (error instanceof Error) {
          this.log("error", `[sendStealthPayment] Error details:`, {
            message: error.message,
            name: error.name,
            stack: error.stack,
          });
        }

        // Check if it's a contract call issue
        try {
          const rawCall = await this.provider!.call({
            to: contractAddress,
            data: "0x3d3d3d3d", // Invalid function selector to test if contract responds
          });
          this.log(
            "info",
            `[sendStealthPayment] Contract responds to invalid calls: ${rawCall}`
          );
        } catch (callError) {
          this.log(
            "info",
            `[sendStealthPayment] Contract does not respond to invalid calls: ${callError}`
          );
        }

        throw new Error(`Contract toll() call failed: ${error}`);
      }

      // Debug: Check signer balance
      if (this.signer) {
        try {
          const signerAddress = await this.signer.getAddress();
          const balance = await this.provider!.getBalance(signerAddress);
          this.log(
            "info",
            `[sendStealthPayment] Signer address: ${signerAddress}`
          );
          this.log(
            "info",
            `[sendStealthPayment] Signer balance: ${balance.toString()} wei`
          );

          if (token === ETH_TOKEN_PLACEHOLDER) {
            const requiredAmount = BigInt(amount) + toll;
            if (balance < requiredAmount) {
              throw new Error(
                `Insufficient balance. Required: ${requiredAmount.toString()} wei, Available: ${balance.toString()} wei`
              );
            }
          } else {
            if (balance < toll) {
              throw new Error(
                `Insufficient balance for toll. Required: ${toll.toString()} wei, Available: ${balance.toString()} wei`
              );
            }
          }
        } catch (error) {
          this.log(
            "warn",
            `[sendStealthPayment] Could not check signer balance: ${error}`
          );
        }
      }

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
      const rawPkx = stealthResult.ephemeralPublicKey.slice(2, 66); // Remove 0x and get x coordinate
      const pkx = "0x" + rawPkx; // Add 0x prefix for BytesLike compatibility

      this.log("info", `[sendStealthPayment] PKX formatting:`, {
        ephemeralPublicKey: stealthResult.ephemeralPublicKey,
        rawPkx: rawPkx,
        finalPkx: pkx,
        pkxLength: pkx.length,
        expectedLength: 66, // 0x + 64 hex chars
      });

      // 5. Send payment on-chain
      let txHash: string;

      if (token === ETH_TOKEN_PLACEHOLDER) {
        // Send ETH
        const totalAmount = BigInt(amount) + toll;

        this.log("info", `[sendStealthPayment] Sending ETH payment:`, {
          stealthAddress: stealthResult.stealthAddress,
          amount: amount,
          toll: toll.toString(),
          totalAmount: totalAmount.toString(),
          pkx: pkx,
        });

        const tx = await this.paymentForwarderContract.sendEth(
          stealthResult.stealthAddress,
          toll,
          pkx,
          ciphertext,
          { value: totalAmount.toString() }
        );
        txHash = tx.hash;
      } else {
        // Send token
        this.log("info", `[sendStealthPayment] Sending token payment:`, {
          stealthAddress: stealthResult.stealthAddress,
          token: token,
          amount: amount,
          toll: toll.toString(),
          pkx: pkx,
        });

        const tx = await this.paymentForwarderContract.sendToken(
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
    this.assertInitialized();

    this.log(
      "info",
      `[sendStealthNotification] Sending notification to: ${recipientGunPub}`
    );

    return new Promise((resolve, reject) => {
      this.gun
        .get("shogun")
        .get("stealth_payments")
        .get(recipientGunPub)
        .get(notification.stealthAddress)
        .put(notification, (ack: any) => {
          if (ack.err) {
            this.log(
              "error",
              `[sendStealthNotification] Error sending notification:`,
              ack.err
            );
            reject(new Error(ack.err));
          } else {
            this.log(
              "info",
              `[sendStealthNotification] Notification sent successfully`
            );
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

    // Add callback to list
    this.paymentCallbacks.push(callback);

    // Load existing payment state if not already loaded
    if (this.paymentState.size === 0) {
      this.loadPaymentState();
    }

    // Start listening if not already listening
    if (!this.isListening) {
      this.startPaymentListener();
    }

    this.log(
      "info",
      `[onStealthPayment] Callback registered, total callbacks: ${this.paymentCallbacks.length}`
    );
  }

  /**
   * Load payment state from GunDB
   */
  private async loadPaymentState(): Promise<void> {
    const userPub = this.gun.user().is.pub;
    if (!userPub) return;

    return new Promise((resolve) => {
      try {
        this.gun
          .get("shogun")
          .get("stealth_payment_state")
          .get(userPub)
          .once((data: any) => {
            try {
              if (data && Array.isArray(data)) {
                this.log(
                  "info",
                  `[loadPaymentState] Loading ${data.length} payments`
                );
                data.forEach(
                  (
                    payment: StealthPaymentNotification & {
                      status: string;
                      txHash?: string;
                    }
                  ) => {
                    try {
                      if (
                        payment &&
                        typeof payment === "object" &&
                        payment.stealthAddress
                      ) {
                        const paymentId = this.getPaymentId(payment);
                        this.paymentState.set(paymentId, payment);
                      }
                    } catch (paymentError) {
                      this.log(
                        "warn",
                        `[loadPaymentState] Error processing payment:`,
                        paymentError
                      );
                    }
                  }
                );
              } else if (data && typeof data === "object") {
                // Handle case where data is an object instead of array
                this.log(
                  "info",
                  `[loadPaymentState] Converting object data to array`
                );
                const paymentsArray = Object.values(data).filter(
                  (item: any) =>
                    item && typeof item === "object" && item.stealthAddress
                );
                paymentsArray.forEach((payment: any) => {
                  try {
                    const paymentId = this.getPaymentId(payment);
                    this.paymentState.set(paymentId, payment);
                  } catch (paymentError) {
                    this.log(
                      "warn",
                      `[loadPaymentState] Error processing payment from object:`,
                      paymentError
                    );
                  }
                });
              }
            } catch (dataError) {
              this.log(
                "error",
                `[loadPaymentState] Error processing data:`,
                dataError
              );
            }
            resolve();
          });
      } catch (gunError) {
        this.log("error", `[loadPaymentState] Gun error:`, gunError);
        resolve();
      }
    });
  }

  /**
   * Start listening for new payments
   */
  private startPaymentListener(): void {
    const userPub = this.gun.user().is.pub;
    if (!userPub) return;

    this.isListening = true;
    this.log(
      "info",
      `[startPaymentListener] Starting payment listener for user: ${userPub}`
    );

    try {
      this.gun
        .get("shogun")
        .get("stealth_payments")
        .get(userPub)
        .on((data: any) => {
          try {
            this.log("info", `[startPaymentListener] Received data:`, data);

            // Ignora dati non validi o vuoti
            if (!data || typeof data !== "object") {
              this.log(
                "warn",
                `[startPaymentListener] Invalid data type:`,
                typeof data
              );
              return;
            }

            // Ignora i metadati Gun
            if (data._) {
              this.log("debug", `[startPaymentListener] Ignoring Gun metadata`);
              return;
            }

            // Verifica se è un oggetto con stealthAddress valido
            if (
              data.stealthAddress &&
              typeof data.stealthAddress === "string"
            ) {
              this.log(
                "info",
                `[startPaymentListener] Valid payment notification received`
              );
              this.addPaymentToState(data as StealthPaymentNotification);
            } else {
              this.log(
                "warn",
                `[startPaymentListener] Invalid data structure:`,
                data
              );
            }
          } catch (dataError) {
            this.log(
              "error",
              `[startPaymentListener] Error processing data:`,
              dataError
            );
          }
        });
    } catch (gunError) {
      this.log("error", `[startPaymentListener] Gun error:`, gunError);
      this.isListening = false;
    }
  }

  /**
   * Restart payment listener (useful after page refresh)
   */
  async restartPaymentListener(): Promise<void> {
    this.log("info", `[restartPaymentListener] Restarting payment listener`);

    // Reset listening state
    this.isListening = false;

    // Reload payment state
    await this.loadPaymentState();

    // Sync notifications with state to recover missed payments
    await this.syncNotificationsWithState();

    // Restart listener
    this.startPaymentListener();

    this.log("info", `[restartPaymentListener] Payment listener restarted`);
  }

  /**
   * Sync notifications with payment state to recover missed payments
   */
  async syncNotificationsWithState(): Promise<void> {
    const userPub = this.gun.user().is.pub;
    if (!userPub) return;

    this.log(
      "info",
      `[syncNotificationsWithState] Syncing notifications with state`
    );

    return new Promise((resolve) => {
      try {
        this.gun
          .get("shogun")
          .get("stealth_payments")
          .get(userPub)
          .once((data: any) => {
            try {
              if (data && typeof data === "object") {
                // Filtra i metadati Gun e altri dati non validi
                const validItems = Object.values(data).filter(
                  (item: any) =>
                    item &&
                    typeof item === "object" &&
                    item.stealthAddress &&
                    item.amount &&
                    !item._ // Esclude i metadati Gun
                );

                const notifications: StealthPaymentNotification[] =
                  validItems.map(
                    (item: any) => item as StealthPaymentNotification
                  );

                this.log(
                  "info",
                  `[syncNotificationsWithState] Found ${notifications.length} valid notifications`
                );

                let recoveredCount = 0;
                notifications.forEach((notification) => {
                  try {
                    const paymentId = this.getPaymentId(notification);

                    // Check if this notification is already in our state
                    if (!this.paymentState.has(paymentId)) {
                      this.log(
                        "info",
                        `[syncNotificationsWithState] Recovering missed payment: ${paymentId}`
                      );
                      this.addPaymentToState(notification);
                      recoveredCount++;
                    }
                  } catch (notificationError) {
                    this.log(
                      "warn",
                      `[syncNotificationsWithState] Error processing notification:`,
                      notificationError
                    );
                  }
                });

                this.log(
                  "info",
                  `[syncNotificationsWithState] Recovered ${recoveredCount} missed payments`
                );

                // Save updated state if we recovered payments
                if (recoveredCount > 0) {
                  const allPayments = Array.from(this.paymentState.values());
                  this.savePaymentState(allPayments).catch((error) => {
                    this.log(
                      "error",
                      `[syncNotificationsWithState] Error saving state:`,
                      error
                    );
                  });
                }
              } else {
                this.log(
                  "info",
                  `[syncNotificationsWithState] No valid data found`
                );
              }
            } catch (dataError) {
              this.log(
                "error",
                `[syncNotificationsWithState] Error processing data:`,
                dataError
              );
            }
            resolve();
          });
      } catch (gunError) {
        this.log("error", `[syncNotificationsWithState] Gun error:`, gunError);
        resolve();
      }
    });
  }

  /**
   * Check if payment listener is active
   */
  isPaymentListenerActive(): boolean {
    return this.isListening;
  }

  /**
   * Check if the plugin is properly initialized
   */
  isInitialized(): boolean {
    return !!(this.gun && this.provider && this.signer && this.core);
  }

  /**
   * Get listener status information
   */
  getListenerStatus(): {
    isListening: boolean;
    callbackCount: number;
    paymentCount: number;
  } {
    return {
      isListening: this.isListening,
      callbackCount: this.paymentCallbacks.length,
      paymentCount: this.paymentState.size,
    };
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

    this.log(
      "info",
      `[getStealthPaymentHistory] Getting payments for user: ${userPub}`
    );

    return new Promise((resolve) => {
      this.gun
        .get("shogun")
        .get("stealth_payments")
        .get(userPub)
        .once((data: any) => {
          this.log(
            "info",
            `[getStealthPaymentHistory] Raw data from GunDB:`,
            data
          );

          if (data && typeof data === "object") {
            this.log(
              "info",
              `[getStealthPaymentHistory] Data is object, processing...`
            );

            const payments: StealthPaymentNotification[] = Object.values(data)
              .filter((item: any) => {
                const isValid =
                  item &&
                  typeof item === "object" &&
                  item.stealthAddress &&
                  item.amount;
                this.log(
                  "info",
                  `[getStealthPaymentHistory] Item validation:`,
                  { item, isValid }
                );
                return isValid;
              })
              .map((item: any) => item as StealthPaymentNotification)
              .sort(
                (
                  a: StealthPaymentNotification,
                  b: StealthPaymentNotification
                ) => b.timestamp - a.timestamp
              );

            this.log(
              "info",
              `[getStealthPaymentHistory] Processed payments:`,
              payments
            );
            resolve(payments);
          } else {
            this.log(
              "info",
              `[getStealthPaymentHistory] No data or invalid data:`,
              data
            );
            resolve([]);
          }
        });
    });
  }

  /**
   * Get payment state with status tracking
   * @returns Promise with payment state including status
   */
  async getPaymentState(): Promise<
    Array<StealthPaymentNotification & { status: string; txHash?: string }>
  > {
    this.assertInitialized();

    const userPub = this.gun.user().is.pub;
    if (!userPub) {
      throw new Error("User not authenticated");
    }

    return new Promise((resolve) => {
      this.gun
        .get("stealth_payment_state")
        .get(userPub)
        .once((data: any) => {
          if (data && Array.isArray(data)) {
            this.log("info", `[getPaymentState] Loaded payment state:`, data);
            resolve(data);
          } else {
            this.log("info", `[getPaymentState] No payment state found`);
            resolve([]);
          }
        });
    });
  }

  /**
   * Save payment state to GunDB
   * @param payments Array of payments with status
   */
  private async savePaymentState(
    payments: Array<
      StealthPaymentNotification & { status: string; txHash?: string }
    >
  ): Promise<void> {
    const userPub = this.gun.user().is.pub;
    if (!userPub) return;

    this.log("info", `[savePaymentState] Saving ${payments.length} payments`);

    return new Promise((resolve, reject) => {
      this.gun
        .get("shogun")
        .get("stealth_payment_state")
        .get(userPub)
        .put(payments, (ack: any) => {
          if (ack.err) {
            this.log(
              "error",
              `[savePaymentState] Error saving state:`,
              ack.err
            );
            reject(new Error(ack.err));
          } else {
            this.log("info", `[savePaymentState] State saved successfully`);
            resolve();
          }
        });
    });
  }

  /**
   * Generate unique payment ID
   * @param payment Payment notification
   * @returns Unique ID
   */
  private getPaymentId(payment: StealthPaymentNotification): string {
    return `${payment.stealthAddress}_${payment.timestamp}`;
  }

  /**
   * Check if payment already exists
   * @param payment Payment notification
   * @returns True if payment exists
   */
  private isPaymentDuplicate(payment: StealthPaymentNotification): boolean {
    const paymentId = this.getPaymentId(payment);
    return this.paymentState.has(paymentId);
  }

  /**
   * Add payment to state and notify callbacks
   * @param payment Payment notification
   */
  private addPaymentToState(payment: StealthPaymentNotification): void {
    const paymentId = this.getPaymentId(payment);

    if (this.isPaymentDuplicate(payment)) {
      this.log(
        "info",
        `[addPaymentToState] Payment already exists: ${paymentId}`
      );
      return;
    }

    // Add default status
    const paymentWithStatus = { ...payment, status: "pending" };
    this.paymentState.set(paymentId, paymentWithStatus);
    this.log("info", `[addPaymentToState] Added new payment: ${paymentId}`);

    // Notify all callbacks
    this.paymentCallbacks.forEach((callback) => {
      try {
        callback(payment);
      } catch (error) {
        this.log("error", `[addPaymentToState] Callback error:`, error);
      }
    });
  }

  /**
   * Update payment status
   * @param stealthAddress Stealth address
   * @param timestamp Payment timestamp
   * @param status New status
   * @param txHash Optional transaction hash
   */
  async updatePaymentStatus(
    stealthAddress: string,
    timestamp: number,
    status: string,
    txHash?: string
  ): Promise<void> {
    const paymentId = `${stealthAddress}_${timestamp}`;
    const payment = this.paymentState.get(paymentId);

    if (!payment) {
      this.log("warn", `[updatePaymentStatus] Payment not found: ${paymentId}`);
      return;
    }

    const updatedPayment = { ...payment, status, txHash };
    this.paymentState.set(paymentId, updatedPayment);

    // Save to GunDB
    const allPayments = Array.from(this.paymentState.values());
    await this.savePaymentState(allPayments);

    this.log(
      "info",
      `[updatePaymentStatus] Updated payment ${paymentId} to status: ${status}`
    );
  }

  /**
   * Clear processed payments
   * @returns Number of payments cleared
   */
  async clearProcessedPayments(): Promise<number> {
    const pendingPayments = Array.from(this.paymentState.values()).filter(
      (payment) => payment.status !== "claimed"
    );

    this.paymentState.clear();
    pendingPayments.forEach((payment) => {
      const paymentId = this.getPaymentId(payment);
      this.paymentState.set(paymentId, payment);
    });

    await this.savePaymentState(Array.from(this.paymentState.values()));

    const clearedCount = this.paymentState.size - pendingPayments.length;
    this.log(
      "info",
      `[clearProcessedPayments] Cleared ${clearedCount} processed payments`
    );

    return clearedCount;
  }

  /**
   * Get all payments with their current state
   * @returns Array of payments with status
   */
  async getAllPayments(): Promise<
    Array<StealthPaymentNotification & { status: string; txHash?: string }>
  > {
    // Load state if not loaded
    if (this.paymentState.size === 0) {
      await this.loadPaymentState();
    }

    return Array.from(this.paymentState.values());
  }

  /**
   * Get pending payments only
   * @returns Array of pending payments
   */
  async getPendingPayments(): Promise<
    Array<StealthPaymentNotification & { status: string; txHash?: string }>
  > {
    const allPayments = await this.getAllPayments();
    return allPayments.filter((payment) => payment.status === "pending");
  }

  /**
   * Get claimed payments only
   * @returns Array of claimed payments
   */
  async getClaimedPayments(): Promise<
    Array<StealthPaymentNotification & { status: string; txHash?: string }>
  > {
    const allPayments = await this.getAllPayments();
    return allPayments.filter((payment) => payment.status === "claimed");
  }

  /**
   * Force remove a specific payment (for compatibility issues)
   * @param stealthAddress Stealth address of the payment
   * @param timestamp Timestamp of the payment
   * @returns True if payment was removed
   */
  async forceRemovePayment(
    stealthAddress: string,
    timestamp: number
  ): Promise<boolean> {
    const paymentId = `${stealthAddress}_${timestamp}`;
    const wasRemoved = this.paymentState.delete(paymentId);

    if (wasRemoved) {
      // Save updated state to GunDB
      const allPayments = Array.from(this.paymentState.values());
      await this.savePaymentState(allPayments);

      this.log(
        "info",
        `[forceRemovePayment] Forced removal of payment: ${paymentId}`
      );
    } else {
      this.log("warn", `[forceRemovePayment] Payment not found: ${paymentId}`);
    }

    return wasRemoved;
  }

  /**
   * Force remove multiple payments by stealth address
   * @param stealthAddress Stealth address to remove all payments for
   * @returns Number of payments removed
   */
  async forceRemovePaymentsByAddress(stealthAddress: string): Promise<number> {
    let removedCount = 0;
    const paymentsToRemove: string[] = [];

    // Find all payments for this address
    for (const [paymentId, payment] of this.paymentState.entries()) {
      if (payment.stealthAddress === stealthAddress) {
        paymentsToRemove.push(paymentId);
      }
    }

    // Remove them
    paymentsToRemove.forEach((paymentId) => {
      if (this.paymentState.delete(paymentId)) {
        removedCount++;
      }
    });

    if (removedCount > 0) {
      // Save updated state to GunDB
      const allPayments = Array.from(this.paymentState.values());
      await this.savePaymentState(allPayments);

      this.log(
        "info",
        `[forceRemovePaymentsByAddress] Removed ${removedCount} payments for address: ${stealthAddress}`
      );
    }

    return removedCount;
  }

  /**
   * Get payment by stealth address and timestamp
   * @param stealthAddress Stealth address
   * @param timestamp Payment timestamp
   * @returns Payment if found, null otherwise
   */
  async getPayment(
    stealthAddress: string,
    timestamp: number
  ): Promise<
    (StealthPaymentNotification & { status: string; txHash?: string }) | null
  > {
    const paymentId = `${stealthAddress}_${timestamp}`;
    return this.paymentState.get(paymentId) || null;
  }

  /**
   * Check if a payment exists
   * @param stealthAddress Stealth address
   * @param timestamp Payment timestamp
   * @returns True if payment exists
   */
  async hasPayment(
    stealthAddress: string,
    timestamp: number
  ): Promise<boolean> {
    const paymentId = `${stealthAddress}_${timestamp}`;
    return this.paymentState.has(paymentId);
  }
}
