import { BasePlugin } from "./base";
import { Stealth } from "./stealth";
import {
  StealthAddressResult,
  StealthData,
  StealthPluginInterface,
  StealthKeys,
  FluidkeySignature,
  StealthPaymentNotification,
} from "./types";
import { ethers } from "ethers";
import {
  PAYMENT_FORWARDER_ABI,
  STEALTH_KEY_REGISTRY_ABI,
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
  private lastClearTimestamp: number = 0; // Traccia quando è stata fatta l'ultima eliminazione definitiva

  constructor(config?: Partial<ContractConfig>) {
    super();
    this.stealth = new Stealth("info");
    this.contractManager = new ContractManager(config);
  }

  initialize(core: any): void {
    super.initialize(core);

    if (this.isFullyInitialized()) {
      return;
    }

    this.gun = core.gun;
    this.provider = core.provider;
    this.signer = core.signer;

    if (!this.gun) {
      throw new Error("Gun instance is required");
    }

    this.contractManager = new ContractManager();

    if (
      this.provider &&
      this.signer &&
      this.contractManager.getAvailableNetworks().length > 0
    ) {
      this.initializeContracts();
    }

    if (this.gun) {
      this.loadPaymentState().then(() => {
        this.syncNotificationsWithState().then(() => {
          this.startPaymentListener();
        });
      });
    }
  }

  /**
   * Set provider and signer after initialization
   * This method is called by registerStealthPlugin
   */
  setProviderAndSigner(provider: ethers.Provider, signer: ethers.Signer): void {
    this.provider = provider;
    this.signer = signer;

    if (this.contractManager.getAvailableNetworks().length > 0) {
      this.initializeContracts();
    }
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
      const paymentForwarderAddress =
        this.contractManager.getPaymentForwarderAddress();
      this.paymentForwarderContract = new ethers.Contract(
        paymentForwarderAddress,
        PAYMENT_FORWARDER_ABI,
        this.signer
      );

      const stealthKeyRegistryAddress =
        this.contractManager.getStealthKeyRegistryAddress();
      if (stealthKeyRegistryAddress) {
        this.stealthKeyRegistryContract = new ethers.Contract(
          stealthKeyRegistryAddress,
          STEALTH_KEY_REGISTRY_ABI,
          this.signer
        );
      }
    } catch (error) {
      console.error("Failed to initialize contracts:", error);
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
   * Check if the plugin is fully initialized with provider and signer
   */
  isFullyInitialized(): boolean {
    return !!(this.gun && this.provider && this.signer && this.core);
  }

  /**
   * Debug method to check internal state
   */
  debugState(): {
    gun: boolean;
    provider: boolean;
    signer: boolean;
    core: boolean;
    initialized: boolean;
    isFullyInitialized: boolean;
  } {
    return {
      gun: !!this.gun,
      provider: !!this.provider,
      signer: !!this.signer,
      core: !!this.core,
      initialized: this.initialized,
      isFullyInitialized: this.isFullyInitialized(),
    };
  }

  /**
   * Assert that the plugin is fully initialized with provider and signer
   */
  protected assertFullyInitialized(): void {
    this.assertInitialized();
    if (!this.provider) {
      throw new Error("Provider not available");
    }
    if (!this.signer) {
      throw new Error("Signer not available");
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
    gunUser.get("shogun").get("stealth_keys").put({
      viewingKey: keys.viewingKey.privateKey,
      spendingKey: keys.spendingKey.privateKey,
      timestamp: Date.now(),
    });

    // Save public keys in public space
    this.core.gun.get("shogun").get("stealth_public_keys").get(userPub).put({
      viewingKey: keys.viewingKey.publicKey,
      spendingKey: keys.spendingKey.publicKey,
      timestamp: Date.now(),
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
      gunUser
        .get("shogun")
        .get("stealth_keys")
        .once((data: any) => {
          resolve(data);
        });
    });

    if (!privateKeys) {
      return null;
    }

    // Get public keys from public space
    const publicKeys = await new Promise<any>((resolve) => {
      this.core.gun
        .get("shogun")
        .get("stealth_public_keys")
        .get(gunUser.is.pub)
        .once((data: any) => {
          resolve(data);
        });
    });

    if (!publicKeys) {
      return null;
    }

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
        .once((data: any) => {
          resolve(data);
        });
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
    ephemeralPrivateKey?: string,
    spendingPrivateKey?: string
  ): Promise<StealthAddressResult> {
    try {
      return await this.stealth.generateStealthAddress(
        recipientViewingKey,
        recipientSpendingKey,
        ephemeralPrivateKey,
        undefined,
        undefined,
        spendingPrivateKey
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
      console.error("Error getting stealth keys:", error);
      throw error;
    }
  }

  /**
   * Generates and saves stealth keys for the authenticated user
   * @returns Promise with the generated stealth keys
   */
  async generateAndSaveStealthKeys(): Promise<StealthKeys> {
    const stealth = this.stealth;

    // Ottieni la firma del messaggio "I Love Shogun!" se disponibile
    let authSignature: string | undefined;
    if (this.signer) {
      try {
        const message = "I Love Shogun!";
        authSignature = await this.signer.signMessage(message);
        this.log(
          "info",
          `[generateAndSaveStealthKeys] Using signature as seed: ${authSignature.substring(0, 20)}...`
        );
      } catch (error) {
        this.log(
          "warn",
          "[generateAndSaveStealthKeys] Could not get signature, using default seed"
        );
      }
    }

    // Generate and save the keys deterministically
    const keys = await stealth.getStealthKeys(authSignature);
    await this.saveKeysToGun(keys);

    // Return the generated keys
    return keys;
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
    this.assertFullyInitialized();

    try {
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
    this.assertFullyInitialized();

    try {
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
    message?: string,
    stealthAddress?: string,
    ephemeralPublicKey?: string
  ): Promise<{
    txHash: string;
    stealthAddress: string;
    ephemeralPublicKey: string;
  }> {
    this.assertFullyInitialized();

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

      // 2. Use provided stealth address or generate new one
      let stealthResult: { stealthAddress: string; ephemeralPublicKey: string };

      if (stealthAddress && ephemeralPublicKey) {
        // Use provided stealth address
        this.log(
          "info",
          `[sendStealthPayment] Using provided stealth address: ${stealthAddress}`
        );
        stealthResult = {
          stealthAddress,
          ephemeralPublicKey,
        };
      } else {
        // Generate new stealth address
        this.log("info", `[sendStealthPayment] Generating new stealth address`);
        stealthResult = await this.generateStealthAddress(
          recipientKeys.viewingKey,
          recipientKeys.spendingKey
        );
      }

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

    return new Promise((resolve) => {
      this.gun
        .get("shogun")
        .get("stealth_payments")
        .get(recipientGunPub)
        .get(notification.stealthAddress)
        .put(notification, (ack: any) => {
          if (ack.err) {
            this.log(
              "error",
              `[sendStealthNotification] Error saving:`,
              ack.err
            );
          } else {
            this.log(
              "info",
              `[sendStealthNotification] Notification saved successfully`
            );
          }
          resolve();
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
   * Remove all payment callbacks
   */
  clearPaymentCallbacks(): void {
    this.paymentCallbacks = [];
  }

  /**
   * Load payment state from GunDB
   */
  private async loadPaymentState(): Promise<void> {
    const userPub = this.gun.user().is.pub;
    if (!userPub) return;

    return new Promise((resolve) => {
      try {
        // Usa un timeout per evitare blocchi infiniti
        const timeout = setTimeout(() => {
          this.log("warn", `[loadPaymentState] Timeout loading payment state`);
          resolve();
        }, 10000);

        this.gun
          .get("shogun")
          .get("stealth_payment_state")
          .get(userPub)
          .once((data: any) => {
            clearTimeout(timeout);
            try {
              // Verifica che i dati siano validi prima di processarli
              if (data && typeof data === "object" && !data._) {
                if (Array.isArray(data)) {
                  this.log(
                    "info",
                    `[loadPaymentState] Loading ${data.length} payments from array`
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
                } else {
                  // Handle case where data is an object instead of array
                  this.log(
                    "info",
                    `[loadPaymentState] Converting object data to array`
                  );
                  const paymentsArray = Object.entries(data)
                    .filter(([key, item]: [string, any]) => {
                      // Ignora chiavi che sono numeri (timestamp) ma NON indirizzi Ethereum
                      if (!isNaN(Number(key)) && !key.startsWith("0x")) {
                        return false;
                      }

                      // Ignora chiavi che iniziano con caratteri speciali
                      if (
                        key.startsWith("_") ||
                        key.startsWith("#") ||
                        key.startsWith(">")
                      ) {
                        return false;
                      }

                      // Accetta indirizzi Ethereum (che iniziano con 0x)
                      if (key.startsWith("0x")) {
                        return (
                          item &&
                          typeof item === "object" &&
                          item.amount &&
                          item.ephemeralPublicKey &&
                          item.sender &&
                          !item._
                        );
                      }

                      return false;
                    })
                    .map(
                      ([key, item]: [string, any]) =>
                        ({
                          stealthAddress: key, // L'indirizzo stealth è la chiave
                          amount: item.amount,
                          ephemeralPublicKey: item.ephemeralPublicKey,
                          sender: item.sender,
                          message: item.message || "",
                          timestamp: item.timestamp || Date.now(),
                          token: item.token || ETH_TOKEN_PLACEHOLDER,
                        }) as StealthPaymentNotification
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
              } else {
                this.log(
                  "info",
                  `[loadPaymentState] No valid data found or Gun metadata`
                );
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
      // Usa il sistema di eventi centralizzato di ShogunCore se disponibile
      if (this.core && this.core.on) {
        this.log(
          "info",
          `[startPaymentListener] Using ShogunCore event system`
        );

        // Ascolta gli eventi Gun attraverso il sistema centralizzato
        this.core.on("gun:put", (data: any) => {
          this.handleGunData(data, "put");
        });

        this.core.on("gun:get", (data: any) => {
          this.handleGunData(data, "get");
        });

        this.core.on("gun:set", (data: any) => {
          this.handleGunData(data, "set");
        });

        this.core.on("gun:remove", (data: any) => {
          this.handleGunData(data, "remove");
        });

        // Ascolta anche gli eventi peer per debugging
        this.core.on("gun:peer:connect", (data: any) => {
          this.log("debug", `[startPaymentListener] Peer connected:`, data);
        });

        this.core.on("gun:peer:disconnect", (data: any) => {
          this.log("debug", `[startPaymentListener] Peer disconnected:`, data);
        });

        // Setup RxJS tracking se disponibile
        this.setupRxJSTracking();
      } else {
        // Fallback al metodo diretto se il core non è disponibile
        this.log(
          "warn",
          `[startPaymentListener] ShogunCore not available, using direct Gun access`
        );
        this.setupDirectGunListener();
      }
    } catch (gunError) {
      this.log("error", `[startPaymentListener] Gun error:`, gunError);
      this.isListening = false;
    }
  }

  private setupDirectGunListener(): void {
    const userPub = this.gun.user().is.pub;
    if (!userPub) return;

    this.gun
      .get("shogun")
      .get("stealth_payments")
      .get(userPub)
      .on((data: any) => {
        this.handleGunData(data, "direct");
      });
  }

  private handleGunData(data: any, source: string): void {
    try {
      this.log("debug", `[handleGunData] Received data from ${source}:`, data);

      // Ignora dati non validi o vuoti
      if (!data || typeof data !== "object") {
        this.log(
          "warn",
          `[handleGunData] Invalid data type from ${source}:`,
          typeof data
        );
        return;
      }

      // Ignora i metadati Gun
      if (data._) {
        this.log(
          "debug",
          `[handleGunData] Ignoring Gun metadata from ${source}`
        );
        return;
      }

      // Filtra le chiavi per escludere timestamp numerici e altri dati non validi
      const validKeys = Object.keys(data).filter((key) => {
        // Ignora chiavi che sono numeri (timestamp)
        if (!isNaN(Number(key))) {
          this.log(
            "debug",
            `[handleGunData] Ignoring numeric key from ${source}: ${key}`
          );
          return false;
        }

        // Ignora chiavi che iniziano con caratteri speciali
        if (key.startsWith("_") || key.startsWith("#") || key.startsWith(">")) {
          this.log(
            "debug",
            `[handleGunData] Ignoring special key from ${source}: ${key}`
          );
          return false;
        }

        // Verifica che il valore sia un oggetto valido
        const value = data[key];
        if (!value || typeof value !== "object" || value._) {
          this.log(
            "debug",
            `[handleGunData] Ignoring invalid value for key from ${source}: ${key}`
          );
          return false;
        }

        return true;
      });

      // Processa solo le chiavi valide
      for (const key of validKeys) {
        const item = data[key];

        // Verifica se è un oggetto con dati validi per un pagamento stealth
        if (
          item &&
          typeof item === "object" &&
          item.amount &&
          item.ephemeralPublicKey &&
          item.sender &&
          !item._ // Esclude i metadati Gun
        ) {
          this.log(
            "info",
            `[handleGunData] Valid payment notification received from ${source} for key: ${key}`
          );

          // Crea l'oggetto StealthPaymentNotification con la struttura corretta
          const paymentNotification: StealthPaymentNotification = {
            stealthAddress: key, // L'indirizzo stealth è la chiave
            amount: item.amount,
            ephemeralPublicKey: item.ephemeralPublicKey,
            sender: item.sender,
            message: item.message || "",
            timestamp: item.timestamp || Date.now(),
            token: item.token || ETH_TOKEN_PLACEHOLDER,
          };

          this.addPaymentToState(paymentNotification);
        } else {
          this.log(
            "warn",
            `[handleGunData] Invalid data structure from ${source} for key ${key}:`,
            item
          );
        }
      }
    } catch (dataError) {
      this.log(
        "error",
        `[handleGunData] Error processing data from ${source}:`,
        dataError
      );
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
   * Get user public key safely
   * @private
   */
  private getUserPub(): string | null {
    try {
      const user = this.gun.user();
      if (!user || !user.is || !user.is.pub) {
        this.log(
          "warn",
          `[getUserPub] User not authenticated or missing pub key`
        );
        return null;
      }
      return user.is.pub;
    } catch (error) {
      this.log("error", `[getUserPub] Error getting user pub:`, error);
      return null;
    }
  }

  /**
   * Sync notifications with payment state to recover missed payments
   */
  async syncNotificationsWithState(): Promise<void> {
    const userPub = this.getUserPub();
    if (!userPub) {
      this.log(
        "warn",
        `[syncNotificationsWithState] User not authenticated or missing pub key`
      );
      return;
    }

    // Verifica se è stata fatta una eliminazione definitiva recente (ultimi 30 secondi)
    const timeSinceLastClear = Date.now() - this.lastClearTimestamp;
    if (timeSinceLastClear < 30000) {
      this.log(
        "info",
        `[syncNotificationsWithState] ⏭️ Saltando sincronizzazione - eliminazione definitiva effettuata ${Math.round(timeSinceLastClear / 1000)}s fa`
      );
      return;
    }

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
                // Filtra le chiavi per escludere timestamp numerici e altri dati non validi
                const validKeys = Object.keys(data).filter((key) => {
                  // Ignora chiavi che sono numeri (timestamp) ma NON indirizzi Ethereum
                  if (!isNaN(Number(key)) && !key.startsWith("0x")) {
                    this.log(
                      "debug",
                      `[syncNotificationsWithState] Ignoring numeric key: ${key}`
                    );
                    return false;
                  }

                  // Ignora chiavi che iniziano con caratteri speciali
                  if (
                    key.startsWith("_") ||
                    key.startsWith("#") ||
                    key.startsWith(">")
                  ) {
                    this.log(
                      "debug",
                      `[syncNotificationsWithState] Ignoring special key: ${key}`
                    );
                    return false;
                  }

                  // Accetta indirizzi Ethereum (che iniziano con 0x)
                  if (key.startsWith("0x")) {
                    this.log(
                      "debug",
                      `[syncNotificationsWithState] Accepting Ethereum address: ${key}`
                    );
                    return true;
                  }

                  return true;
                });

                // Filtra i metadati Gun e altri dati non validi
                const validItems = validKeys
                  .map((key) => ({ key, item: data[key] }))
                  .filter(
                    ({ key, item }: { key: string; item: any }) =>
                      item &&
                      typeof item === "object" &&
                      item.amount &&
                      item.ephemeralPublicKey &&
                      item.sender &&
                      !item._ // Esclude i metadati Gun
                  );

                const notifications: StealthPaymentNotification[] =
                  validItems.map(
                    ({ key, item }: { key: string; item: any }) =>
                      ({
                        stealthAddress: key, // L'indirizzo stealth è la chiave
                        amount: item.amount,
                        ephemeralPublicKey: item.ephemeralPublicKey,
                        sender: item.sender,
                        message: item.message || "",
                        timestamp: item.timestamp || Date.now(),
                        token: item.token || ETH_TOKEN_PLACEHOLDER,
                      }) as StealthPaymentNotification
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
    // Il plugin è considerato inizializzato se ha Gun e core
    // Provider e signer possono essere impostati successivamente
    return !!(this.gun && this.core);
  }

  /**
   * Setup advanced tracking using ShogunCore's RxJS system
   * @private
   */
  private setupRxJSTracking(): void {
    if (!this.core || !this.core.rx || typeof this.core.rx !== "function") {
      this.log("warn", `[setupRxJSTracking] ShogunCore RxJS not available`);
      return;
    }

    try {
      this.log("info", `[setupRxJSTracking] Setting up RxJS tracking`);

      // Usa il sistema RxJS per tracciare i nodi Gun in modo reattivo
      const userPub = this.gun.user().is.pub;
      if (!userPub) return;

      // Crea un observable per i pagamenti stealth - CORREZIONE: chiama rx() come metodo
      const rxInstance = this.core.rx();
      if (!rxInstance || typeof rxInstance.get !== "function") {
        this.log(
          "warn",
          `[setupRxJSTracking] RxJS instance not properly initialized`
        );
        return;
      }

      const stealthPaymentsNode = rxInstance
        .get("shogun")
        .get("stealth_payments")
        .get(userPub);

      // Sottoscrivi ai cambiamenti
      stealthPaymentsNode.subscribe((data: any) => {
        this.log("debug", `[setupRxJSTracking] RxJS data received:`, data);
        this.handleGunData(data, "rxjs");
      });

      this.log("info", `[setupRxJSTracking] RxJS tracking setup complete`);
    } catch (error) {
      this.log(
        "error",
        `[setupRxJSTracking] Error setting up RxJS tracking:`,
        error
      );
    }
  }

  /**
   * Enhanced listener status with RxJS information
   */
  getListenerStatus(): {
    isListening: boolean;
    callbackCount: number;
    paymentCount: number;
    rxjsAvailable: boolean;
    eventSystemAvailable: boolean;
  } {
    return {
      isListening: this.isListening,
      callbackCount: this.paymentCallbacks.length,
      paymentCount: this.paymentState.size,
      rxjsAvailable: !!(this.core && this.core.rx),
      eventSystemAvailable: !!(this.core && this.core.on),
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
    this.assertFullyInitialized();

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
    token: string,
    ephemeralPublicKey?: string
  ): Promise<{ txHash: string }> {
    this.assertFullyInitialized();

    try {
      // Se è ETH, apri lo stealth address e fai un transfer diretto
      if (token === ETH_TOKEN_PLACEHOLDER) {
        this.log("info", "Withdrawing ETH from stealth address", {
          stealthAddress,
          acceptor,
        });

        // Ottieni le chiavi stealth dell'utente
        const stealthKeys = await this.getUserStealthKeys();

        // Se non è fornito l'ephemeral public key, cerca il pagamento
        let ephemeralKey = ephemeralPublicKey;
        if (!ephemeralKey) {
          const payment = await this.getPayment(stealthAddress, Date.now());
          if (!payment) {
            throw new Error(
              "Payment not found for stealth address and ephemeral public key not provided"
            );
          }
          ephemeralKey = payment.ephemeralPublicKey;
        }

        // Apri lo stealth address
        if (!stealthKeys) {
          throw new Error(
            "Stealth keys not found. Cannot open stealth address."
          );
        }

        const stealthWallet = await this.openStealthAddress(
          stealthAddress,
          ephemeralKey,
          stealthKeys.viewingKey.privateKey,
          stealthKeys.spendingKey.privateKey
        );

        // Ottieni il balance dello stealth address
        const balance = await this.provider!.getBalance(stealthAddress);
        if (balance === 0n) {
          throw new Error("No ETH balance in stealth address");
        }

        // Calcola il gas fee per la transazione
        const feeData = await this.provider!.getFeeData();
        const gasPrice = feeData.gasPrice || 20000000000n; // Fallback a 20 gwei
        const gasLimit = 21000n; // Transfer standard

        // Connetti il wallet al provider
        const connectedWallet = stealthWallet.connect(this.provider!);

        // Prova a stimare il gas più accuratamente
        let estimatedGasLimit = gasLimit;
        try {
          const gasEstimate = await this.provider!.estimateGas({
            from: stealthAddress,
            to: acceptor,
            value: balance - 1000000n, // Lascia 1 wei per il gas
          });
          estimatedGasLimit = gasEstimate;
        } catch (error) {
          this.log(
            "warn",
            "Could not estimate gas, using default limit",
            error
          );
        }

        const baseGasFee = estimatedGasLimit * gasPrice;

        // SEMPRE inizia con importi piccoli e sicuri
        const smallAmounts = [
          1000000000000000n, // 0.001 ETH
          500000000000000n, // 0.0005 ETH
          100000000000000n, // 0.0001 ETH
          50000000000000n, // 0.00005 ETH
          10000000000000n, // 0.00001 ETH
          5000000000000n, // 0.000005 ETH
          1000000000000n, // 0.000001 ETH
        ];

        // Prova prima con importi piccoli e sicuri
        for (const smallAmount of smallAmounts) {
          if (smallAmount < balance) {
            try {
              this.log(
                "info",
                `Trying to withdraw ${ethers.formatEther(smallAmount)} ETH (small amount approach)`
              );

              const tx = await connectedWallet.sendTransaction({
                to: acceptor,
                value: smallAmount,
                gasLimit: estimatedGasLimit,
                gasPrice: gasPrice,
              });

              await tx.wait();
              this.log(
                "info",
                `Successfully withdrew ${ethers.formatEther(smallAmount)} ETH with small amount approach`
              );
              return { txHash: tx.hash };
            } catch (txError) {
              this.log(
                "warn",
                `Transaction failed with small amount ${ethers.formatEther(smallAmount)} ETH, trying next`,
                txError
              );
              continue;
            }
          }
        }

        // Se tutti gli importi piccoli falliscono, prova con l'importo massimo calcolato
        const maxTransferAmount = balance - baseGasFee;
        if (maxTransferAmount > 0n) {
          try {
            this.log(
              "info",
              `Trying to withdraw ${ethers.formatEther(maxTransferAmount)} ETH (calculated max amount)`
            );

            const tx = await connectedWallet.sendTransaction({
              to: acceptor,
              value: maxTransferAmount,
              gasLimit: estimatedGasLimit,
              gasPrice: gasPrice,
            });

            await tx.wait();
            this.log("info", "ETH stealth payment withdrawn successfully", {
              stealthAddress,
              acceptor,
              txHash: tx.hash,
              amount: ethers.formatEther(maxTransferAmount),
              gasUsed: estimatedGasLimit.toString(),
              totalBalance: ethers.formatEther(balance),
              gasCost: ethers.formatEther(baseGasFee),
            });

            return { txHash: tx.hash };
          } catch (txError) {
            this.log("warn", "Calculated max amount failed", txError);
          }
        }

        // Se tutti i tentativi falliscono, lancia un errore
        throw new Error(
          `Insufficient balance in stealth address for withdrawal. Current balance: ${ethers.formatEther(balance)} ETH. Estimated gas cost: ${ethers.formatEther(baseGasFee)} ETH. The system tried multiple small amounts but all failed. The stealth address needs more ETH to cover gas costs.`
        );
      } else {
        // Per i token ERC-20, usa il contratto PaymentForwarder
        if (!this.paymentForwarderContract) {
          throw new Error("PaymentForwarder contract not initialized");
        }

        this.log("info", "Withdrawing ERC-20 token from stealth address", {
          stealthAddress,
          acceptor,
          token,
        });

        const tx = await this.paymentForwarderContract.withdrawToken(
          acceptor,
          token
        );

        this.log("info", "ERC-20 stealth payment withdrawn successfully", {
          stealthAddress,
          acceptor,
          token,
          txHash: tx.hash,
        });

        return { txHash: tx.hash };
      }
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

            // Filtra le chiavi per escludere metadati Gun e altri dati non validi
            const validKeys = Object.keys(data).filter((key) => {
              // Ignora chiavi che sono numeri (timestamp) ma NON indirizzi Ethereum
              if (!isNaN(Number(key)) && !key.startsWith("0x")) {
                this.log(
                  "debug",
                  `[getStealthPaymentHistory] Ignoring numeric key: ${key}`
                );
                return false;
              }

              // Ignora chiavi che iniziano con caratteri speciali
              if (
                key.startsWith("_") ||
                key.startsWith("#") ||
                key.startsWith(">")
              ) {
                this.log(
                  "debug",
                  `[getStealthPaymentHistory] Ignoring special key: ${key}`
                );
                return false;
              }

              // Accetta indirizzi Ethereum (che iniziano con 0x)
              if (key.startsWith("0x")) {
                this.log(
                  "debug",
                  `[getStealthPaymentHistory] Accepting Ethereum address: ${key}`
                );
                return true;
              }

              return true;
            });

            this.log(
              "info",
              `[getStealthPaymentHistory] Valid keys found: ${validKeys.length}`
            );

            // Se non ci sono chiavi valide, risolvi con array vuoto
            if (validKeys.length === 0) {
              this.log(
                "info",
                `[getStealthPaymentHistory] No valid keys found, returning empty array`
              );
              resolve([]);
              return;
            }

            // Array per tenere traccia delle promesse per ogni riferimento
            const paymentPromises: Promise<StealthPaymentNotification | null>[] =
              [];

            // Processa ogni chiave valida
            validKeys.forEach((key) => {
              const item = data[key];
              this.log(
                "debug",
                `[getStealthPaymentHistory] Processing key ${key}:`,
                item
              );

              // Debug dettagliato dell'elemento
              this.log(
                "debug",
                `[getStealthPaymentHistory] Item analysis for key ${key}:`,
                {
                  item,
                  itemType: typeof item,
                  hasHashProperty:
                    item && typeof item === "object" && "#" in item,
                  hashValue: item?.["#"],
                  itemKeys:
                    item && typeof item === "object" ? Object.keys(item) : [],
                }
              );

              // Se l'elemento ha un riferimento Gun (#), seguilo
              if (item && typeof item === "object" && item["#"]) {
                this.log(
                  "debug",
                  `[getStealthPaymentHistory] Following Gun reference for key ${key}: ${item["#"]}`
                );

                const promise = new Promise<StealthPaymentNotification | null>(
                  (resolveItem) => {
                    // Usa il riferimento per ottenere i dati reali
                    this.gun.get(item["#"]).once((realData: any) => {
                      this.log(
                        "debug",
                        `[getStealthPaymentHistory] Real data for key ${key}:`,
                        realData
                      );

                      // Controlla se realData esiste e non è undefined
                      if (!realData || realData === undefined) {
                        this.log(
                          "warn",
                          `[getStealthPaymentHistory] No data found for key ${key}`
                        );

                        // Prova a ottenere i dati direttamente senza riferimento
                        this.log(
                          "debug",
                          `[getStealthPaymentHistory] Trying direct access for key ${key}`
                        );

                        // Prova ad accedere direttamente al nodo
                        this.gun
                          .get("shogun")
                          .get("stealth_payments")
                          .get(userPub)
                          .get(key)
                          .once((directData: any) => {
                            this.log(
                              "debug",
                              `[getStealthPaymentHistory] Direct data for key ${key}:`,
                              directData
                            );

                            if (directData && typeof directData === "object") {
                              // Valida i dati diretti
                              const isValid =
                                directData.amount &&
                                directData.ephemeralPublicKey &&
                                directData.sender;

                              if (isValid) {
                                const paymentNotification: StealthPaymentNotification =
                                  {
                                    stealthAddress: key,
                                    amount: directData.amount,
                                    ephemeralPublicKey:
                                      directData.ephemeralPublicKey,
                                    sender: directData.sender,
                                    message: directData.message || "",
                                    timestamp:
                                      directData.timestamp || Date.now(),
                                    token:
                                      directData.token || ETH_TOKEN_PLACEHOLDER,
                                  };
                                resolveItem(paymentNotification);
                              } else {
                                this.log(
                                  "warn",
                                  `[getStealthPaymentHistory] Invalid direct data for key ${key}`
                                );
                                resolveItem(null);
                              }
                            } else {
                              this.log(
                                "warn",
                                `[getStealthPaymentHistory] No direct data found for key ${key}`
                              );
                              resolveItem(null);
                            }
                          });
                        return;
                      }

                      let parsedRealData;
                      try {
                        // Controlla se realData è già un oggetto o una stringa
                        if (typeof realData === "object" && realData !== null) {
                          // È già un oggetto JavaScript, controlla se ha la proprietà 'data'
                          if (
                            realData.data &&
                            typeof realData.data === "string"
                          ) {
                            // Estrai e parsifica la proprietà 'data'
                            parsedRealData = JSON.parse(realData.data);
                          } else {
                            // Usa l'oggetto direttamente se non ha la proprietà 'data'
                            parsedRealData = realData;
                          }
                        } else if (typeof realData === "string") {
                          // È una stringa JSON, parsificarla
                          parsedRealData = JSON.parse(realData);
                        } else {
                          this.log(
                            "warn",
                            `[getStealthPaymentHistory] Unexpected data type for key ${key}: ${typeof realData}`
                          );
                          resolveItem(null);
                          return;
                        }
                      } catch (error) {
                        this.log(
                          "warn",
                          `[getStealthPaymentHistory] Error parsing realData for key ${key}:`,
                          error
                        );
                        resolveItem(null);
                        return;
                      }

                      // Valida i dati reali
                      const isValid =
                        parsedRealData &&
                        typeof parsedRealData === "object" &&
                        parsedRealData.amount &&
                        parsedRealData.ephemeralPublicKey &&
                        parsedRealData.sender;

                      this.log(
                        "info",
                        `[getStealthPaymentHistory] Item validation for key ${key}:`,
                        {
                          realData: parsedRealData,
                          isValid,
                          hasAmount: parsedRealData?.amount,
                          hasEphemeralPublicKey:
                            parsedRealData?.ephemeralPublicKey,
                          hasSender: parsedRealData?.sender,
                          itemType: typeof parsedRealData,
                        }
                      );

                      if (isValid) {
                        // Crea l'oggetto StealthPaymentNotification con la struttura corretta
                        const paymentNotification: StealthPaymentNotification =
                          {
                            stealthAddress: key, // L'indirizzo stealth è la chiave
                            amount: parsedRealData.amount,
                            ephemeralPublicKey:
                              parsedRealData.ephemeralPublicKey,
                            sender: parsedRealData.sender,
                            message: parsedRealData.message || "",
                            timestamp: parsedRealData.timestamp || Date.now(),
                            token:
                              parsedRealData.token || ETH_TOKEN_PLACEHOLDER,
                          };

                        resolveItem(paymentNotification);
                      } else {
                        this.log(
                          "warn",
                          `[getStealthPaymentHistory] Invalid data for key ${key}`
                        );
                        resolveItem(null);
                      }
                    });
                  }
                );

                paymentPromises.push(promise);
              } else {
                this.log(
                  "debug",
                  `[getStealthPaymentHistory] No Gun reference found for key ${key}, validating directly`
                );

                // Se l'elemento non ha un riferimento, valida direttamente
                const isValid =
                  item &&
                  typeof item === "object" &&
                  item.amount &&
                  item.ephemeralPublicKey &&
                  item.sender &&
                  !item._; // Esclude i metadati Gun

                this.log(
                  "info",
                  `[getStealthPaymentHistory] Item validation for key ${key}:`,
                  {
                    item,
                    isValid,
                    hasAmount: item?.amount,
                    hasEphemeralPublicKey: item?.ephemeralPublicKey,
                    hasSender: item?.sender,
                    isNotGunMetadata: !item?._,
                    itemType: typeof item,
                  }
                );

                if (isValid) {
                  // Crea l'oggetto StealthPaymentNotification con la struttura corretta
                  const paymentNotification: StealthPaymentNotification = {
                    stealthAddress: key, // L'indirizzo stealth è la chiave
                    amount: item.amount,
                    ephemeralPublicKey: item.ephemeralPublicKey,
                    sender: item.sender,
                    message: item.message || "",
                    timestamp: item.timestamp || Date.now(),
                    token: item.token || ETH_TOKEN_PLACEHOLDER,
                  };

                  paymentPromises.push(Promise.resolve(paymentNotification));
                } else {
                  paymentPromises.push(Promise.resolve(null));
                }
              }
            });

            // Aspetta che tutte le promesse siano risolte
            Promise.all(paymentPromises).then((results) => {
              // Filtra i risultati null e ordina per timestamp
              const payments: StealthPaymentNotification[] = results
                .filter(
                  (payment): payment is StealthPaymentNotification =>
                    payment !== null
                )
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
            });
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

    return new Promise((resolve) => {
      try {
        // Usa un timeout per evitare blocchi infiniti
        const timeout = setTimeout(() => {
          this.log("warn", `[savePaymentState] Timeout saving payment state`);
          resolve();
        }, 10000);

        // Filtra i pagamenti validi prima di salvare
        const validPayments = payments.filter(
          (payment) =>
            payment &&
            typeof payment === "object" &&
            payment.stealthAddress &&
            payment.amount
        );

        this.log(
          "info",
          `[savePaymentState] Saving ${validPayments.length} valid payments`
        );

        this.gun
          .get("shogun")
          .get("stealth_payment_state")
          .get(userPub)
          .put(validPayments, (ack: any) => {
            clearTimeout(timeout);
            try {
              if (ack && ack.err) {
                this.log("error", `[savePaymentState] Error saving:`, ack.err);
              } else {
                this.log(
                  "info",
                  `[savePaymentState] Payment state saved successfully`
                );
              }
            } catch (ackError) {
              this.log(
                "error",
                `[savePaymentState] Error processing ack:`,
                ackError
              );
            }
            resolve();
          });
      } catch (gunError) {
        this.log("error", `[savePaymentState] Gun error:`, gunError);
        resolve();
      }
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
   * Emit event through ShogunCore's centralized event system
   * @private
   */
  private emitEvent(eventName: string, data: any): void {
    if (this.core && this.core.emit) {
      this.core.emit(eventName, data);
    } else {
      this.log(
        "debug",
        `[emitEvent] ShogunCore not available for event: ${eventName}`
      );
    }
  }

  /**
   * Add payment to state and notify callbacks
   * @param payment Payment notification
   */
  private addPaymentToState(payment: StealthPaymentNotification): void {
    try {
      const paymentId = this.getPaymentId(payment);

      // Check for duplicates
      if (this.isPaymentDuplicate(payment)) {
        this.log(
          "warn",
          `[addPaymentToState] Duplicate payment ignored: ${paymentId}`
        );
        return;
      }

      // Add to state
      const paymentWithStatus = {
        ...payment,
        status: "pending",
      };

      this.paymentState.set(paymentId, paymentWithStatus);

      // Emit event through ShogunCore
      this.emitEvent("stealth:payment:received", {
        paymentId,
        stealthAddress: payment.stealthAddress,
        amount: payment.amount,
        timestamp: payment.timestamp,
      });

      // Notify callbacks
      this.paymentCallbacks.forEach((callback) => {
        try {
          callback(payment);
        } catch (callbackError) {
          this.log(
            "error",
            `[addPaymentToState] Callback error:`,
            callbackError
          );
        }
      });

      this.log(
        "info",
        `[addPaymentToState] Payment added to state: ${paymentId}`
      );

      // Save state to GunDB
      const allPayments = Array.from(this.paymentState.values());
      this.savePaymentState(allPayments).catch((error) => {
        this.log("error", `[addPaymentToState] Error saving state:`, error);
      });
    } catch (error) {
      this.log(
        "error",
        `[addPaymentToState] Error adding payment to state:`,
        error
      );
    }
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
    const totalPayments = this.paymentState.size;

    // Clear all payments from state
    this.paymentState.clear();

    // Remove data from GunDB completely - ELIMINAZIONE DEFINITIVA
    await this.clearPaymentDataFromGunDB();

    // Imposta il timestamp dell'ultima eliminazione definitiva
    this.lastClearTimestamp = Date.now();

    this.log(
      "info",
      `[clearProcessedPayments] ✅ ELIMINATI DEFINITIVAMENTE ${totalPayments} pagamenti da stato e GunDB`
    );

    return totalPayments;
  }

  /**
   * Clear payment data from GunDB completely - ELIMINAZIONE DEFINITIVA
   */
  private async clearPaymentDataFromGunDB(): Promise<void> {
    const userPub = this.gun.user().is.pub;
    if (!userPub) return;

    return new Promise((resolve) => {
      try {
        const timeout = setTimeout(() => {
          this.log("warn", `[clearPaymentDataFromGunDB] Timeout clearing data`);
          resolve();
        }, 15000); // Aumentato timeout per operazioni più lunghe

        this.log(
          "info",
          `[clearPaymentDataFromGunDB] 🗑️ Iniziando eliminazione definitiva dei dati...`
        );

        // 1. Clear payment state
        this.gun
          .get("shogun")
          .get("stealth_payment_state")
          .get(userPub)
          .put(null, (ack: any) => {
            if (ack && ack.err) {
              this.log(
                "error",
                `[clearPaymentDataFromGunDB] ❌ Errore eliminazione payment state:`,
                ack.err
              );
            } else {
              this.log(
                "info",
                `[clearPaymentDataFromGunDB] ✅ Payment state eliminato da GunDB`
              );
            }

            // 2. Clear original notifications - ELIMINAZIONE DEFINITIVA
            this.gun
              .get("shogun")
              .get("stealth_payments")
              .get(userPub)
              .put(null, (ack2: any) => {
                if (ack2 && ack2.err) {
                  this.log(
                    "error",
                    `[clearPaymentDataFromGunDB] ❌ Errore eliminazione notifications:`,
                    ack2.err
                  );
                } else {
                  this.log(
                    "info",
                    `[clearPaymentDataFromGunDB] ✅ Notifications eliminate da GunDB`
                  );
                }

                // 3. Clear anche i dati di backup/history se esistono
                this.gun
                  .get("shogun")
                  .get("stealth_payment_history")
                  .get(userPub)
                  .put(null, (ack3: any) => {
                    clearTimeout(timeout);
                    if (ack3 && ack3.err) {
                      this.log(
                        "warn",
                        `[clearPaymentDataFromGunDB] ⚠️ Errore eliminazione history (opzionale):`,
                        ack3.err
                      );
                    } else {
                      this.log(
                        "info",
                        `[clearPaymentDataFromGunDB] ✅ Payment history eliminata da GunDB`
                      );
                    }

                    this.log(
                      "info",
                      `[clearPaymentDataFromGunDB] 🎉 ELIMINAZIONE DEFINITIVA COMPLETATA`
                    );
                    resolve();
                  });
              });
          });
      } catch (error) {
        this.log(
          "error",
          `[clearPaymentDataFromGunDB] ❌ Errore generale:`,
          error
        );
        resolve();
      }
    });
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
    const payment = await this.getPayment(stealthAddress, timestamp);
    return payment !== null;
  }

  /**
   * Verifica se le chiavi stealth attuali possono aprire uno stealth address specifico
   * @param stealthAddress Lo stealth address da verificare
   * @param ephemeralPublicKey La chiave pubblica ephemeral
   * @returns Promise<boolean>
   */
  async canOpenStealthAddress(
    stealthAddress: string,
    ephemeralPublicKey: string
  ): Promise<boolean> {
    try {
      const stealthKeys = await this.getUserStealthKeys();

      if (!stealthKeys) {
        return false;
      }

      // Tenta di aprire lo stealth address
      await this.openStealthAddress(
        stealthAddress,
        ephemeralPublicKey,
        stealthKeys.viewingKey.privateKey,
        stealthKeys.spendingKey.privateKey
      );

      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Scan on-chain per ripopolare il database GunDB con pagamenti stealth da un blocco specifico
   * @param fromBlock Blocco iniziale per lo scan (es. 8796157)
   * @param toBlock Blocco finale per lo scan (opzionale, se non specificato usa l'ultimo blocco)
   * @param stealthAddresses Array di indirizzi stealth da monitorare (opzionale, se non specificato usa le chiavi dell'utente)
   * @returns Numero di pagamenti trovati e salvati
   */
  async scanOnChainPayments(
    fromBlock: number,
    toBlock?: number,
    stealthAddresses?: string[]
  ): Promise<{
    scannedBlocks: number;
    foundPayments: number;
    savedPayments: number;
    errors: string[];
  }> {
    this.assertFullyInitialized();

    const userPub = this.gun.user().is.pub;
    if (!userPub) {
      throw new Error("User not authenticated");
    }

    if (!this.provider || !this.paymentForwarderContract) {
      throw new Error("Provider or PaymentForwarder contract not available");
    }

    const errors: string[] = [];
    let foundPayments = 0;
    let savedPayments = 0;

    try {
      this.log(
        "info",
        `[scanOnChainPayments] 🔍 Iniziando scan on-chain da blocco ${fromBlock}`
      );

      // Ottieni l'ultimo blocco se toBlock non è specificato
      const latestBlock = await this.provider.getBlockNumber();
      const endBlock = toBlock || latestBlock;

      this.log(
        "info",
        `[scanOnChainPayments] 📊 Scan range: ${fromBlock} -> ${endBlock} (${endBlock - fromBlock + 1} blocchi)`
      );

      // Ottieni le chiavi stealth dell'utente se non sono specificate
      let addressesToScan = stealthAddresses;
      if (!addressesToScan || addressesToScan.length === 0) {
        try {
          const userKeys = await this.getUserStealthKeys();

          // Controllo null per userKeys
          if (!userKeys) {
            this.log(
              "error",
              `[scanOnChainPayments] ❌ Nessuna chiave stealth trovata per l'utente`
            );
            errors.push("Nessuna chiave stealth trovata per l'utente");
            return {
              scannedBlocks: 0,
              foundPayments: 0,
              savedPayments: 0,
              errors,
            };
          }

          // Genera alcuni indirizzi stealth per lo scan
          const ephemeralKey = await this.generateEphemeralKeyPair();
          const stealthAddress = await this.generateStealthAddress(
            userKeys.viewingKey.publicKey,
            userKeys.spendingKey.publicKey,
            ephemeralKey.privateKey
          );
          addressesToScan = [stealthAddress.stealthAddress];
          this.log(
            "info",
            `[scanOnChainPayments] 🔑 Usando indirizzo stealth generato: ${stealthAddress.stealthAddress}`
          );
        } catch (keyError) {
          this.log(
            "error",
            `[scanOnChainPayments] ❌ Errore nel generare indirizzi stealth:`,
            keyError
          );
          errors.push(`Errore chiavi stealth: ${keyError}`);
          return {
            scannedBlocks: 0,
            foundPayments: 0,
            savedPayments: 0,
            errors,
          };
        }
      }

      // Ottieni gli eventi Announcement dal contratto
      const filter = this.paymentForwarderContract.filters.Announcement();

      this.log(
        "info",
        `[scanOnChainPayments] 🔍 Cercando eventi Announcement...`
      );

      const events = await this.paymentForwarderContract.queryFilter(
        filter,
        fromBlock,
        endBlock
      );

      this.log(
        "info",
        `[scanOnChainPayments] 📋 Trovati ${events.length} eventi totali`
      );

      // Debug: mostra gli indirizzi negli eventi trovati
      const eventAddresses = events
        .filter((event) => event && "args" in event && event.args)
        .map((event) => (event as any).args[0]); // receiver address

      this.log(
        "info",
        `[scanOnChainPayments] 🔍 Indirizzi negli eventi trovati: ${eventAddresses.join(", ")}`
      );

      // Filtra gli eventi per gli indirizzi stealth dell'utente
      const relevantEvents = events.filter((event) => {
        // Verifica che l'evento sia un EventLog con args
        if (!event || !("args" in event) || !event.args) return false;

        // Per l'evento Announcement: (address indexed receiver, uint256 amount, address indexed token, bytes32 pkx, bytes32 ciphertext)
        const receiver = event.args[0]; // receiver (stealth address)

        // Verifica se l'utente può aprire questo indirizzo stealth
        // Per ora, accetta tutti gli eventi e poi filtra quelli che può aprire
        return true; // Accetta tutti gli eventi per ora
      });

      this.log(
        "info",
        `[scanOnChainPayments] 🎯 ${relevantEvents.length} eventi rilevanti per gli indirizzi dell'utente`
      );

      // Processa ogni evento rilevante
      for (const event of relevantEvents) {
        try {
          // Verifica che l'evento sia un EventLog con args
          if (!event || !("args" in event) || !event.args) continue;

          // Estrai i parametri dall'evento Announcement
          // event Announcement(address indexed receiver, uint256 amount, address indexed token, bytes32 pkx, bytes32 ciphertext)
          const receiver = event.args[0]; // receiver (stealth address)
          const amount = event.args[1]; // amount
          const token = event.args[2]; // token
          const pkx = event.args[3]; // pkx (ephemeral public key x)
          const ciphertext = event.args[4]; // ciphertext

          this.log(
            "info",
            `[scanOnChainPayments] 🔍 Processando evento per indirizzo: ${receiver}`
          );

          // Verifica se l'utente può aprire questo indirizzo stealth
          // Per ora, accetta tutti gli eventi e li salva
          // TODO: Implementare verifica con le chiavi stealth dell'utente

          // Ottieni il timestamp del blocco
          const block = await this.provider.getBlock(event.blockNumber);
          const timestamp = block?.timestamp || Date.now();

          // Crea la notifica di pagamento
          const paymentNotification: StealthPaymentNotification = {
            stealthAddress: receiver,
            amount: amount.toString(),
            ephemeralPublicKey: pkx, // Usa pkx come ephemeral public key
            sender: event.transactionHash, // Usa il tx hash come sender per ora
            message: "", // L'evento Announcement non ha un campo message
            timestamp: timestamp * 1000, // Converti in millisecondi
            token: token || ETH_TOKEN_PLACEHOLDER,
          };

          // Verifica se il pagamento è già presente
          const paymentId = this.getPaymentId(paymentNotification);
          if (!this.paymentState.has(paymentId)) {
            // Aggiungi il pagamento allo stato
            this.addPaymentToState(paymentNotification);
            foundPayments++;

            // Salva nel database GunDB
            await this.savePaymentNotificationToGunDB(paymentNotification);
            savedPayments++;

            this.log(
              "info",
              `[scanOnChainPayments] ✅ Pagamento salvato: ${paymentNotification.stealthAddress} - ${paymentNotification.amount} ${paymentNotification.token}`
            );
          } else {
            this.log(
              "debug",
              `[scanOnChainPayments] ⏭️ Pagamento già presente: ${paymentId}`
            );
          }
        } catch (eventError) {
          const errorMsg = `Errore processando evento ${event.transactionHash}: ${eventError}`;
          this.log("error", `[scanOnChainPayments] ❌ ${errorMsg}`);
          errors.push(errorMsg);
        }
      }

      // Salva lo stato aggiornato
      if (savedPayments > 0) {
        const allPayments = Array.from(this.paymentState.values());
        await this.savePaymentState(allPayments);
      }

      this.log(
        "info",
        `[scanOnChainPayments] 🎉 Scan completato: ${foundPayments} pagamenti trovati, ${savedPayments} salvati`
      );

      return {
        scannedBlocks: endBlock - fromBlock + 1,
        foundPayments,
        savedPayments,
        errors,
      };
    } catch (error) {
      const errorMsg = `Errore generale durante lo scan: ${error}`;
      this.log("error", `[scanOnChainPayments] ❌ ${errorMsg}`);
      errors.push(errorMsg);
      return {
        scannedBlocks: 0,
        foundPayments: 0,
        savedPayments: 0,
        errors,
      };
    }
  }

  /**
   * Salva una notifica di pagamento nel database GunDB
   * @param notification Notifica di pagamento da salvare
   */
  private async savePaymentNotificationToGunDB(
    notification: StealthPaymentNotification
  ): Promise<void> {
    const userPub = this.gun.user().is.pub;
    if (!userPub) return;

    return new Promise((resolve) => {
      this.gun
        .get("shogun")
        .get("stealth_payments")
        .get(userPub)
        .get(notification.stealthAddress)
        .put(
          {
            amount: notification.amount,
            ephemeralPublicKey: notification.ephemeralPublicKey,
            sender: notification.sender,
            message: notification.message,
            timestamp: notification.timestamp,
            token: notification.token,
          },
          (ack: any) => {
            if (ack && ack.err) {
              this.log(
                "error",
                `[savePaymentNotificationToGunDB] ❌ Errore salvataggio:`,
                ack.err
              );
            } else {
              this.log(
                "info",
                `[savePaymentNotificationToGunDB] ✅ Notifica salvata per ${notification.stealthAddress}`
              );
            }
            resolve();
          }
        );
    });
  }

  /**
   * Forza la sincronizzazione anche dopo una eliminazione definitiva
   * @param force Se true, ignora il timestamp dell'ultima eliminazione
   */
  async forceSyncNotifications(force: boolean = false): Promise<void> {
    if (force) {
      this.lastClearTimestamp = 0; // Reset del timestamp per forzare la sincronizzazione
      this.log(
        "info",
        `[forceSyncNotifications] 🔄 Forzando sincronizzazione...`
      );
    }

    await this.syncNotificationsWithState();
  }

  /**
   * Gets existing stealth keys for the current user (does not generate new ones)
   * @returns Promise<StealthKeys | null> - null if no keys exist
   */
  async getUserStealthKeys(): Promise<StealthKeys | null> {
    try {
      this.log("info", "[getUserStealthKeys] Getting user stealth keys");

      // Prima prova a caricare da GunDB
      const gunKeys = await this.getKeysFromGun();

      if (gunKeys) {
        this.log("info", "[getUserStealthKeys] Found keys in GunDB");
        return gunKeys;
      }

      // Se non ci sono chiavi in GunDB, prova a sincronizzare da on-chain
      this.log(
        "info",
        "[getUserStealthKeys] No keys in GunDB, checking on-chain"
      );
      const onChainKeys = await this.syncKeysFromOnChain();

      if (onChainKeys) {
        this.log("info", "[getUserStealthKeys] Synced keys from on-chain");
        return onChainKeys;
      }

      // Se non ci sono chiavi da nessuna parte, prova a generarle deterministicamente
      this.log(
        "info",
        "[getUserStealthKeys] No keys found, generating deterministic keys"
      );
      const deterministicKeys = await this.createUserStealthKeys();

      this.log("info", "[getUserStealthKeys] Generated deterministic keys");
      return deterministicKeys;
    } catch (error) {
      this.log(
        "error",
        "[getUserStealthKeys] Error getting user stealth keys:",
        error
      );
      return null;
    }
  }

  /**
   * Creates and saves new stealth keys for the current user
   * @returns Promise<StealthKeys>
   */
  async createUserStealthKeys(): Promise<StealthKeys> {
    try {
      this.log("info", "[createUserStealthKeys] Generating new stealth keys");

      // Ottieni la firma del messaggio "I Love Shogun!" se disponibile
      let signature: string | undefined;
      if (this.signer) {
        try {
          const message = "I Love Shogun!";
          signature = await this.signer.signMessage(message);
          this.log(
            "info",
            `[createUserStealthKeys] Using signature as seed: ${signature.substring(0, 20)}...`
          );
        } catch (error) {
          this.log(
            "warn",
            "[createUserStealthKeys] Could not get signature, using default seed"
          );
        }
      }

      // Genera nuove chiavi deterministiche dalla firma
      const newKeys = await this.stealth.getStealthKeys(signature);

      // Salvataggio asincrono per non bloccare il ritorno delle chiavi
      this.saveKeysToGun(newKeys)
        .then(() => {
          this.log(
            "info",
            "[createUserStealthKeys] Keys saved to Gun successfully"
          );
        })
        .catch((error) => {
          this.log(
            "error",
            "[createUserStealthKeys] Error saving keys to Gun (non-blocking):",
            error
          );
        });

      this.log(
        "info",
        "[createUserStealthKeys] Generated new keys successfully"
      );
      return newKeys;
    } catch (error) {
      this.log(
        "error",
        "[createUserStealthKeys] Error creating user stealth keys:",
        error
      );
      throw error;
    }
  }

  /**
   * Syncs stealth keys from on-chain to GunDB if they exist
   * @returns Promise<StealthKeys | null> - null if no keys found on-chain
   */
  async syncKeysFromOnChain(): Promise<StealthKeys | null> {
    try {
      this.log(
        "info",
        "[syncKeysFromOnChain] Checking for on-chain stealth keys"
      );

      if (!this.signer || !this.stealthKeyRegistryContract) {
        this.log(
          "warn",
          "[syncKeysFromOnChain] Signer or contract not available"
        );
        return null;
      }

      const walletAddress = await this.signer.getAddress();

      // Check if keys exist on-chain
      const [viewingKey, spendingKey] =
        await this.stealthKeyRegistryContract.getStealthKeys(walletAddress);

      if (!viewingKey || viewingKey.length === 0) {
        this.log("info", "[syncKeysFromOnChain] No keys found on-chain");
        return null;
      }

      this.log(
        "info",
        "[syncKeysFromOnChain] Found keys on-chain, syncing to GunDB"
      );

      // Create StealthKeys object from on-chain data
      const onChainKeys: StealthKeys = {
        viewingKey: {
          privateKey: "", // Not available on-chain
          publicKey: viewingKey,
        },
        spendingKey: {
          privateKey: "", // Not available on-chain
          publicKey: spendingKey,
        },
      };

      // Save to GunDB
      await this.saveKeysToGun(onChainKeys);

      this.log("info", "[syncKeysFromOnChain] Keys synced successfully");
      return onChainKeys;
    } catch (error) {
      this.log("error", "[syncKeysFromOnChain] Error syncing keys:", error);
      return null;
    }
  }

  /**
   * Helper method to get SEA signature from Gun user
   * @returns Promise<string | null> - SEA signature or null if not available
   */
  private async getSEASignature(): Promise<string | null> {
    if (!this.gun || !this.gun.user || !this.gun.user.is) {
      return null;
    }

    try {
      const pair = this.gun.user._.sea;
      if (pair && pair.priv) {
        this.log(
          "info",
          `[getSEASignature] Found SEA signature: ${pair.priv.substring(0, 20)}...`
        );
        return pair.priv;
      }
      this.log("warn", "[getSEASignature] No SEA pair found");
      return null;
    } catch (error) {
      this.log("warn", "[getSEASignature] Could not get SEA signature:", error);
      return null;
    }
  }

  /**
   * Creates and saves new stealth keys using SEA signature as seed
   * @returns Promise<StealthKeys>
   */
  async createUserStealthKeysWithSEA(): Promise<StealthKeys> {
    try {
      this.log(
        "info",
        "[createUserStealthKeysWithSEA] Generating stealth keys with SEA signature"
      );

      // Ottieni la firma SEA usando il metodo helper
      const seaSignature = await this.getSEASignature();

      if (!seaSignature) {
        this.log(
          "warn",
          "[createUserStealthKeysWithSEA] No SEA signature available, falling back to wallet signature"
        );
        return this.createUserStealthKeys();
      }

      // Usa il metodo unificato che gestisce sia Fluidkey che fallback
      const newKeys = await this.stealth.getStealthKeys(seaSignature);

      // Salvataggio asincrono per non bloccare il ritorno delle chiavi
      this.saveKeysToGun(newKeys)
        .then(() => {
          this.log(
            "info",
            "[createUserStealthKeysWithSEA] Keys saved to Gun successfully"
          );
        })
        .catch((error) => {
          this.log(
            "error",
            "[createUserStealthKeysWithSEA] Error saving keys to Gun (non-blocking):",
            error
          );
        });

      this.log(
        "info",
        "[createUserStealthKeysWithSEA] Generated new keys successfully with SEA signature"
      );
      return newKeys;
    } catch (error) {
      this.log(
        "error",
        "[createUserStealthKeysWithSEA] Error creating user stealth keys with SEA:",
        error
      );
      throw error;
    }
  }

  /**
   * Generates and saves stealth keys using SEA signature as seed
   * @returns Promise with the generated stealth keys
   */
  async generateAndSaveStealthKeysWithSEA(): Promise<StealthKeys> {
    const stealth = this.stealth;

    // Ottieni la firma SEA usando il metodo helper
    const seaSignature = await this.getSEASignature();

    if (!seaSignature) {
      this.log(
        "warn",
        "[generateAndSaveStealthKeysWithSEA] No SEA signature available, falling back to wallet signature"
      );
      return this.generateAndSaveStealthKeys();
    }

    // Usa il metodo unificato che gestisce sia Fluidkey che fallback
    const keys = await stealth.getStealthKeys(seaSignature);
    await this.saveKeysToGun(keys);

    // Return the generated keys
    return keys;
  }

  /**
   * Get existing stealth keys for the current user using SEA signature as seed (does not generate new ones)
   * @returns Promise<StealthKeys | null> - null if no keys exist
   */
  async getUserStealthKeysWithSEA(): Promise<StealthKeys | null> {
    try {
      this.log(
        "info",
        "[getUserStealthKeysWithSEA] Getting user stealth keys with SEA signature"
      );

      // Prima prova a caricare da GunDB
      const gunKeys = await this.getKeysFromGun();

      if (gunKeys) {
        this.log("info", "[getUserStealthKeysWithSEA] Found keys in GunDB");
        return gunKeys;
      }

      // Se non ci sono chiavi in GunDB, prova a sincronizzare da on-chain
      this.log(
        "info",
        "[getUserStealthKeysWithSEA] No keys in GunDB, checking on-chain"
      );
      const onChainKeys = await this.syncKeysFromOnChain();

      if (onChainKeys) {
        this.log(
          "info",
          "[getUserStealthKeysWithSEA] Synced keys from on-chain"
        );
        return onChainKeys;
      }

      // Se non ci sono chiavi da nessuna parte, prova a generarle con SEA
      this.log(
        "info",
        "[getUserStealthKeysWithSEA] No keys found, generating with SEA signature"
      );
      const seaKeys = await this.createUserStealthKeysWithSEA();

      this.log(
        "info",
        "[getUserStealthKeysWithSEA] Generated keys with SEA signature"
      );
      return seaKeys;
    } catch (error) {
      this.log(
        "error",
        "[getUserStealthKeysWithSEA] Error getting user stealth keys with SEA:",
        error
      );
      return null;
    }
  }

  /**
   * Calculate the maximum amount that can be withdrawn from a stealth address
   * @param stealthAddress The stealth address to check
   * @param ephemeralPublicKey The ephemeral public key
   * @returns Promise with the maximum withdrawable amount and gas cost
   */
  async calculateMaxWithdrawableAmount(
    stealthAddress: string,
    ephemeralPublicKey?: string
  ): Promise<{
    maxAmount: string;
    gasCost: string;
    totalBalance: string;
    canWithdraw: boolean;
  }> {
    this.assertFullyInitialized();

    try {
      // Ottieni le chiavi stealth dell'utente
      const stealthKeys = await this.getUserStealthKeys();
      if (!stealthKeys) {
        throw new Error("Stealth keys not found");
      }

      // Se non è fornito l'ephemeral public key, cerca il pagamento
      let ephemeralKey = ephemeralPublicKey;
      if (!ephemeralKey) {
        const payment = await this.getPayment(stealthAddress, Date.now());
        if (!payment) {
          throw new Error("Payment not found for stealth address");
        }
        ephemeralKey = payment.ephemeralPublicKey;
      }

      // Ottieni il balance dello stealth address
      const balance = await this.provider!.getBalance(stealthAddress);
      if (balance === 0n) {
        return {
          maxAmount: "0",
          gasCost: "0",
          totalBalance: "0",
          canWithdraw: false,
        };
      }

      // Calcola il gas fee
      const feeData = await this.provider!.getFeeData();
      const gasPrice = feeData.gasPrice || 20000000000n;
      const gasLimit = 21000n;

      // Prova a stimare il gas più accuratamente
      let estimatedGasLimit = gasLimit;
      try {
        const gasEstimate = await this.provider!.estimateGas({
          from: stealthAddress,
          to: "0x0000000000000000000000000000000000000000", // Dummy address
          value: balance - 1000000n,
        });
        estimatedGasLimit = gasEstimate;
      } catch (error) {
        this.log("warn", "Could not estimate gas, using default limit", error);
      }

      const baseGasFee = estimatedGasLimit * gasPrice;

      // Calcola l'importo massimo che può essere inviato (balance - gas fee)
      const maxTransferAmount = balance - baseGasFee;

      // Se non c'è abbastanza ETH per fare il transfer, prova con margini progressivamente più piccoli
      let actualMaxAmount = maxTransferAmount;
      if (maxTransferAmount <= 0n) {
        // Prova con margini progressivamente più piccoli
        const margins = [110n, 105n, 102n, 101n]; // 10%, 5%, 2%, 1%

        for (const margin of margins) {
          const smallerMargin = (baseGasFee * margin) / 100n;
          const smallerTransferAmount = balance - smallerMargin;

          if (smallerTransferAmount > 0n) {
            actualMaxAmount = smallerTransferAmount;
            break;
          }
        }
      }

      return {
        maxAmount: ethers.formatEther(
          actualMaxAmount > 0n ? actualMaxAmount : 0n
        ),
        gasCost: ethers.formatEther(baseGasFee),
        totalBalance: ethers.formatEther(balance),
        canWithdraw: actualMaxAmount > 0n,
      };
    } catch (error) {
      this.log("error", "Error calculating max withdrawable amount", error);
      throw error;
    }
  }

  /**
   * Enhanced fee calculation system inspired by Umbra protocol
   * @param token Token address or ETH_TOKEN_PLACEHOLDER for ETH
   * @param amount Amount to send
   * @returns Promise with fee breakdown
   */
  async calculateFees(
    token: string,
    amount: string
  ): Promise<{
    toll: string;
    estimatedGas: string;
    totalCost: string;
    breakdown: {
      baseAmount: string;
      toll: string;
      gasEstimate: string;
      gasPrice: string;
      totalGasCost: string;
    };
  }> {
    this.assertFullyInitialized();

    if (!this.paymentForwarderContract) {
      throw new Error("Payment forwarder contract not initialized");
    }

    if (!this.provider) {
      throw new Error("Provider not initialized");
    }

    try {
      // Get toll from contract
      const toll = await this.paymentForwarderContract.toll();

      // Get current gas price
      const feeData = await this.provider.getFeeData();
      const gasPrice = feeData.gasPrice || 20000000000n; // Fallback to 20 gwei

      // Estimate gas for the transaction
      let estimatedGas = 21000n; // Default for ETH transfer

      if (token === ETH_TOKEN_PLACEHOLDER) {
        // For ETH, estimate gas for stealth address withdrawal
        try {
          const gasEstimate = await this.provider.estimateGas({
            to: this.paymentForwarderContract.target,
            value: toll,
          });
          estimatedGas = gasEstimate;
        } catch (error) {
          this.log("warn", "Could not estimate gas, using default", error);
        }
      } else {
        // For ERC-20 tokens, estimate gas for token transfer
        try {
          const gasEstimate =
            await this.paymentForwarderContract.withdrawToken.estimateGas(
              "0x0000000000000000000000000000000000000000", // Dummy address
              token
            );
          estimatedGas = gasEstimate;
        } catch (error) {
          this.log(
            "warn",
            "Could not estimate gas for token, using default",
            error
          );
        }
      }

      // Calculate total gas cost
      const totalGasCost = estimatedGas * gasPrice;

      // Calculate total cost
      const totalCost = BigInt(amount) + toll + totalGasCost;

      return {
        toll: toll.toString(),
        estimatedGas: estimatedGas.toString(),
        totalCost: totalCost.toString(),
        breakdown: {
          baseAmount: amount,
          toll: toll.toString(),
          gasEstimate: estimatedGas.toString(),
          gasPrice: gasPrice.toString(),
          totalGasCost: totalGasCost.toString(),
        },
      };
    } catch (error) {
      this.log("error", "Error calculating fees", error);
      throw new Error(`Failed to calculate fees: ${error}`);
    }
  }

  /**
   * Enhanced ETH withdrawal with Umbra-inspired retry logic
   * @param stealthAddress The stealth address containing the payment
   * @param acceptor The address to receive the withdrawn funds
   * @param ephemeralPublicKey Optional ephemeral public key for ETH withdrawals
   * @returns Promise<{txHash: string}>
   */
  async withdrawStealthPaymentEnhanced(
    stealthAddress: string,
    acceptor: string,
    ephemeralPublicKey?: string
  ): Promise<{ txHash: string }> {
    this.assertFullyInitialized();

    try {
      this.log("info", "Enhanced ETH withdrawal from stealth address", {
        stealthAddress,
        acceptor,
      });

      // Get stealth keys
      const stealthKeys = await this.getUserStealthKeys();
      if (!stealthKeys) {
        throw new Error("Stealth keys not found. Cannot open stealth address.");
      }

      // Get ephemeral key if not provided
      let ephemeralKey = ephemeralPublicKey;
      if (!ephemeralKey) {
        const payment = await this.getPayment(stealthAddress, Date.now());
        if (!payment) {
          throw new Error(
            "Payment not found for stealth address and ephemeral public key not provided"
          );
        }
        ephemeralKey = payment.ephemeralPublicKey;
      }

      // Open stealth address
      const stealthWallet = await this.openStealthAddress(
        stealthAddress,
        ephemeralKey,
        stealthKeys.viewingKey.privateKey,
        stealthKeys.spendingKey.privateKey
      );

      // Get balance
      const balance = await this.provider!.getBalance(stealthAddress);
      if (balance === 0n) {
        throw new Error("No ETH balance in stealth address");
      }

      // Connect wallet to provider
      const connectedWallet = stealthWallet.connect(this.provider!);

      // Enhanced gas estimation with retry logic (inspired by Umbra)
      const maxRetries = 20;
      let lastError: any;

      for (let retryCount = 0; retryCount < maxRetries; retryCount++) {
        try {
          // Get current gas price
          const feeData = await this.provider!.getFeeData();
          const gasPrice = feeData.gasPrice || 20000000000n;

          // Estimate gas with margin for L2 networks
          let estimatedGas = 21000n;
          try {
            const gasEstimate = await this.provider!.estimateGas({
              from: stealthAddress,
              to: acceptor,
              value: balance - 1000000n, // Leave 1 wei for gas
            });
            estimatedGas = gasEstimate;
          } catch (error) {
            this.log("warn", "Could not estimate gas, using default", error);
          }

          // Calculate gas cost
          const gasCost = estimatedGas * gasPrice;

          // For L2 networks (Optimism, Base), add margin for variable L1 gas costs
          let adjustedValue = balance - gasCost;
          const chainId = (await this.provider!.getNetwork()).chainId;

          if (chainId === 10n || chainId === 8453n) {
            // Optimism or Base
            const margin = (gasCost * BigInt(Math.min(retryCount, 20))) / 100n;
            adjustedValue = adjustedValue - margin;
          }

          // Ensure we have enough for gas
          if (adjustedValue <= 0n) {
            throw new Error("Insufficient balance for gas costs");
          }

          // Try the transaction
          const tx = await connectedWallet.sendTransaction({
            to: acceptor,
            value: adjustedValue,
            gasLimit: estimatedGas,
            gasPrice: gasPrice,
          });

          await tx.wait();

          this.log(
            "info",
            "Enhanced ETH stealth payment withdrawn successfully",
            {
              stealthAddress,
              acceptor,
              txHash: tx.hash,
              amount: ethers.formatEther(adjustedValue),
              gasUsed: estimatedGas.toString(),
              totalBalance: ethers.formatEther(balance),
              gasCost: ethers.formatEther(gasCost),
              retryCount,
            }
          );

          return { txHash: tx.hash };
        } catch (error: any) {
          lastError = error;

          // Only retry on insufficient funds errors
          if (!error.message?.includes("insufficient funds")) {
            throw error;
          }

          this.log(
            "warn",
            `Withdrawal attempt ${retryCount + 1} failed, retrying...`,
            error
          );

          // Small delay before retry
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }

      // If we get here, all retries failed
      throw new Error(
        `Failed to withdraw after ${maxRetries} attempts. Last error: ${lastError?.message}`
      );
    } catch (error) {
      this.log("error", "Error in enhanced ETH withdrawal", error);
      throw error;
    }
  }
}
