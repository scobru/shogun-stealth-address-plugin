import { BasePlugin } from "./base";
import { Stealth } from "./stealth";
import {
  StealthAddressResult,
  StealthData,
  StealthPluginInterface,
  StealthKeys,
  FluidkeySignature,
  GunStealthKeyMapping,
} from "./types";
import { ethers } from "ethers";
import { log } from "./utils";

// Import Fluidkey functions directly for plugin use
import { 
  generateStealthAddresses,
  generateStealthPrivateKey
} from '@fluidkey/stealth-account-kit';

/**
 * Plugin per la gestione delle funzionalità Stealth in ShogunCore
 * Enhanced with Fluidkey Stealth Account Kit integration
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

  constructor() {
    super();
    this.stealth = new Stealth("info");
  }

  initialize(core: any): void {
    super.initialize(core);
    this.gun = core.gun;

    if (!core.gun) {
      throw new Error("Gun instance required for stealth plugin");
    }

    this.log("info", "Stealth plugin initialized with Fluidkey integration");
  }

  destroy(): void {
    super.destroy();
    this.gun = null;
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
      gunUser.get('stealth_keys').put({
        viewingKey: keys.viewingKey.privateKey,
        spendingKey: keys.spendingKey.privateKey,
        timestamp: Date.now()
      }, (ack: any) => {
        if (ack.err) reject(new Error(ack.err));
        else resolve();
      });
    });

    // Save public keys in public space
    await new Promise<void>((resolve, reject) => {
      this.core.gun.get('stealth_public_keys').get(userPub).put({
        viewingKey: keys.viewingKey.publicKey,
        spendingKey: keys.spendingKey.publicKey,
        timestamp: Date.now()
      }, (ack: any) => {
        if (ack.err) reject(new Error(ack.err));
        else resolve();
      });
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
      gunUser.get('stealth_keys').once(resolve);
    });

    if (!privateKeys) return null;

    // Get public keys from public space
    const publicKeys = await new Promise<any>((resolve) => {
      this.core.gun.get('stealth_public_keys').get(gunUser.is.pub).once(resolve);
    });

    if (!publicKeys) return null;

    return {
      viewingKey: {
        privateKey: privateKeys.viewingKey,
        publicKey: publicKeys.viewingKey
      },
      spendingKey: {
        privateKey: privateKeys.spendingKey,
        publicKey: publicKeys.spendingKey
      }
    };
  }

  /**
   * Gets public stealth keys for a given Gun public key
   * @param gunPublicKey The Gun public key to look up
   * @returns Promise<{viewingKey: string, spendingKey: string} | null>
   */
  async getPublicStealthKeys(gunPublicKey: string): Promise<{viewingKey: string, spendingKey: string} | null> {
    this.assertInitialized();
    if (!this.core.gun) throw new Error("Gun not available");

    const publicKeys = await new Promise<any>((resolve) => {
      this.core.gun.get('stealth_public_keys').get(gunPublicKey).once(resolve);
    });

    if (!publicKeys) return null;

    return {
      viewingKey: publicKeys.viewingKey,
      spendingKey: publicKeys.spendingKey
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
    recipientSpendingKey: string
  ): Promise<StealthAddressResult> {
    try {
      return await this.stealth.generateStealthAddress(
        recipientViewingKey,
        recipientSpendingKey
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
    ephemeralPrivateKey: string,
  ): Promise<string[]> {
    this.assertInitialized();
    
    try {
      this.assertInitialized();
      
      this.log('info', '[generateFluidkeyStealthAddresses] Generating Fluidkey stealth addresses');
      
      // Use Fluidkey's generateStealthAddresses function
      const result = generateStealthAddresses({
        ephemeralPrivateKey: ephemeralPrivateKey as `0x${string}`,
        spendingPublicKeys: spendingPublicKeys as `0x${string}`[],
      });
      
      this.log('info', '[generateFluidkeyStealthAddresses] Generated stealth addresses:', {
        count: result.stealthAddresses.length,
        addresses: result.stealthAddresses
      });
      
      return result.stealthAddresses;
    } catch (error) {
      this.log('error', '[generateFluidkeyStealthAddresses] Error:', error);
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
    spendingPrivateKey: string,
  ): Promise<string> {
    this.assertInitialized();
    
    try {
      this.assertInitialized();
      
      this.log('info', '[generateFluidkeyStealthPrivateKey] Generating Fluidkey stealth private key');
      
      // Use Fluidkey's generateStealthPrivateKey function
      const result = generateStealthPrivateKey({
        ephemeralPublicKey: ephemeralPublicKey as `0x${string}`,
        spendingPrivateKey: spendingPrivateKey as `0x${string}`,
      });
      
      this.log('info', '[generateFluidkeyStealthPrivateKey] Generated stealth private key successfully');
      
      return result.stealthPrivateKey;
    } catch (error) {
      this.log('error', '[generateFluidkeyStealthPrivateKey] Error:', error);
      throw error;
    }
  }

  private async processStealthData(stealthData: StealthData): Promise<void> {
    try {
      // If we have an ephemeral key pair, use it
      if (stealthData.ephemeralKeyPair?.pub) {
        await this.gun.get('ephemeralKeys').put({
          pub: stealthData.ephemeralKeyPair.pub,
          priv: stealthData.ephemeralKeyPair.priv,
          epub: stealthData.ephemeralKeyPair.epub,
          epriv: stealthData.ephemeralKeyPair.epriv
        });
      }

      // Store the stealth data
      await this.gun.get('stealthData').put({
        stealthAddress: stealthData.stealthAddress,
        ephemeralPublicKey: stealthData.ephemeralPublicKey,
        recipientViewingKey: stealthData.recipientViewingKey,
        recipientSpendingKey: stealthData.recipientSpendingKey
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
} 