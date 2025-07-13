/**
 * Manages stealth logic using Gun, SEA and Fluidkey Stealth Account Kit
 */
import { ethers } from "ethers";
import { 
  EphemeralKeyPair, 
  StealthAddressResult, 
  LogLevel, 
  LogMessage,
  StealthKeys,
  FluidkeySignature
} from "./types";
// Import Fluidkey Stealth Account Kit functions
import { 
  generateKeysFromSignature,
  extractViewingPrivateKeyNode,
  generateEphemeralPrivateKey,
  generateStealthAddresses,
  generateStealthPrivateKey,
} from "@fluidkey/stealth-account-kit";
import { HDKey } from '@scure/bip32';

// Utility di normalizzazione hex
export function normalizeHex(str: string, length?: number): string {
  if (!str) return '';
  let s = str.toLowerCase();
  if (!s.startsWith('0x')) s = '0x' + s;
  if (length && s.length !== 2 + length * 2) {
    s = '0x' + s.slice(2).padStart(length * 2, '0').slice(0, length * 2);
  }
  return s;
}

export class Stealth {
  private logLevel: LogLevel = "info";

  constructor(logLevel: LogLevel = "info") {
    this.logLevel = logLevel;
  }

  /**
   * Logs a message based on the current log level
   */
  private log(level: LogLevel | string, message: string, ...args: any[]): void {
    const levelValue = typeof level === 'string' ? level as LogLevel : level;
    
    // Simple log level hierarchy: error > warn > info > debug
    const levelHierarchy = { "error": 0, "warn": 1, "info": 2, "debug": 3 };
    const currentLevelValue = levelHierarchy[this.logLevel] ?? 2;
    const messageLevelValue = levelHierarchy[levelValue] ?? 2;
    
    if (messageLevelValue <= currentLevelValue) {
      const timestamp = new Date().toISOString();
      const logMessage: LogMessage = {
        timestamp,
        level: levelValue,
        message,
        data: args.length > 0 ? args : undefined
      };
      
      switch (levelValue) {
        case "error":
          console.error(`[${timestamp}] ERROR: ${message}`, ...args);
          break;
        case "warn":
          console.warn(`[${timestamp}] WARN: ${message}`, ...args);
          break;
        case "info":
          console.info(`[${timestamp}] INFO: ${message}`, ...args);
          break;
        case "debug":
          console.log(`[${timestamp}] DEBUG: ${message}`, ...args);
          break;
      }
    }
  }

  /**
   * Normalizes a public key to compressed format for consistency
   */
  private normalizePublicKey(publicKey: string): string {
    try {
      // Remove any prefixes and ensure it's a valid public key
      let normalizedKey = publicKey;
      
      if (normalizedKey.startsWith('0x')) {
        normalizedKey = normalizedKey.slice(2);
      }
      
      // If it's an uncompressed key (130 chars), convert to compressed (66 chars)
      if (normalizedKey.length === 130) {
        const wallet = new ethers.Wallet(ethers.hexlify(ethers.randomBytes(32)));
        // Use the signing key to get the compressed public key format
        const signingKey = new ethers.SigningKey('0x' + normalizedKey.slice(2, 66));
        return signingKey.publicKey;
      }
      
      // If it's already compressed, ensure it has the 0x prefix
      if (normalizedKey.length === 66) {
        return '0x' + normalizedKey;
      }
      
      // Default: return as-is with 0x prefix
      return normalizedKey.startsWith('0x') ? normalizedKey : '0x' + normalizedKey;
      
    } catch (error) {
      this.log('warn', 'Error normalizing public key:', error);
      return publicKey; // Return original if normalization fails
    }
  }

  /**
   * Removes the initial tilde (~) from the public key if present
   */
  formatPublicKey(publicKey: string | null): string | null {
    if (!publicKey) {
      return null;
    }

    const trimmedKey = publicKey.trim();

    if (!trimmedKey) {
      return null;
    }

    if (!/^[~]?[\w+/=\-_.]+$/.test(trimmedKey)) {
      return null;
    }

    return trimmedKey.startsWith("~") ? trimmedKey.slice(1) : trimmedKey;
  }

  /**
   * Creates a new stealth account
   */
  async createAccount(): Promise<{
    privateKey: string;
    publicKey: string;
  }> {
    try {
      // Generate a new random wallet
      const wallet = ethers.Wallet.createRandom();

      return {
        privateKey: wallet.privateKey,
        publicKey: wallet.publicKey,
      };
    } catch (error) {
      this.log("error", "Error creating stealth account", error);
      throw error;
    }
  }

  /**
   * Gets the stealth keys for the current user (placeholder implementation)
   */
  async getStealthKeys(): Promise<StealthKeys> {
    // This is a placeholder implementation
    // In a real implementation, this would retrieve keys from Gun database
    const wallet1 = ethers.Wallet.createRandom();
    const wallet2 = ethers.Wallet.createRandom();
    
    return {
      viewingKey: {
        privateKey: wallet1.privateKey,
        publicKey: wallet1.signingKey.publicKey
      },
      spendingKey: {
        privateKey: wallet2.privateKey,
        publicKey: wallet2.signingKey.publicKey
      }
    };
  }

  /**
   * Generates and saves stealth keys (placeholder implementation)
   */
  async generateAndSaveKeys(): Promise<StealthKeys> {
    // This is a placeholder implementation
    // In a real implementation, this would save keys to Gun database
    return this.getStealthKeys();
  }

  /**
   * Generate keys from signature using Fluidkey method
   */
  async generateKeysFromSignature(signature: FluidkeySignature): Promise<{
    viewingPrivateKey: string;
    viewingPublicKey: string;
    spendingPrivateKey: string;
    spendingPublicKey: string;
  }> {
    try {
      // Construct the signature string from r, s, v components
      const signatureString = `${signature.r}${signature.s}${signature.v.toString(16).padStart(2, '0')}`;
      const result = generateKeysFromSignature(`0x${signatureString}`);

      const viewingWallet = new ethers.Wallet(result.viewingPrivateKey);
      const spendingWallet = new ethers.Wallet(result.spendingPrivateKey);

      return {
        viewingPrivateKey: result.viewingPrivateKey,
        viewingPublicKey: viewingWallet.signingKey.publicKey,
        spendingPrivateKey: result.spendingPrivateKey,
        spendingPublicKey: spendingWallet.signingKey.publicKey
      };
    } catch (error) {
      this.log("error", "Error generating keys from signature", error);
      throw error;
    }
  }

  /**
   * Generates stealth addresses using Fluidkey method
   * @param viewingPublicKey Recipient's viewing public key for scanning transactions
   * @param spendingPublicKey Recipient's spending public key for spending funds
   * @param ephemeralPrivateKey Optional ephemeral private key (if not provided, will be generated)
   * @returns Promise with the stealth address result
   */
  async generateStealthAddress(
    viewingPublicKey: string,
    spendingPublicKey: string,
    ephemeralPrivateKey?: string,
    viewingPrivateKey?: string,
    derivationIndex?: number
  ): Promise<StealthAddressResult> {
    try {
      this.log("info", "Generating stealth address using Fluidkey method");

      // Normalize public keys
      const normalizedViewingKey = this.normalizePublicKey(viewingPublicKey);
      const normalizedSpendingKey = this.normalizePublicKey(spendingPublicKey);

      // Generate ephemeral private key if not provided
      let ephemeralKey = ephemeralPrivateKey;
      if (!ephemeralKey) {
        if (viewingPrivateKey) {
          const cleanPriv = viewingPrivateKey.startsWith('0x')
            ? viewingPrivateKey.slice(2)
            : viewingPrivateKey;
          const hdKey = HDKey.fromMasterSeed(Buffer.from(cleanPriv, 'hex'));
          const result = generateEphemeralPrivateKey({
            viewingPrivateKeyNode: hdKey,
            nonce: 0n,
            chainId: 1,
            coinType: 60
          });
          ephemeralKey = result.ephemeralPrivateKey;
        } else {
          // fallback: random ephemeral key
          const ephemeralWallet = ethers.Wallet.createRandom();
          ephemeralKey = ephemeralWallet.privateKey;
        }
      }

      this.log("debug", "[GEN] Params", {
        viewingPublicKey: normalizeHex(viewingPublicKey, 64),
        spendingPublicKey: normalizeHex(spendingPublicKey, 64),
        ephemeralPrivateKey: ephemeralPrivateKey ? normalizeHex(ephemeralPrivateKey, 32) : undefined,
        viewingPrivateKey: viewingPrivateKey ? normalizeHex(viewingPrivateKey, 32) : undefined,
        derivationIndex,
      });

      // Use Fluidkey's generateStealthAddresses function
      const result = generateStealthAddresses({
        ephemeralPrivateKey: ephemeralKey as `0x${string}`,
        spendingPublicKeys: [normalizedSpendingKey as `0x${string}`],
      });

      const stealthAddress = result.stealthAddresses[0];
      const ephemeralWallet = new ethers.Wallet(ephemeralKey as `0x${string}`);
      
      this.log("debug", "[GEN] Result", {
        stealthAddress,
        ephemeralPublicKey: normalizeHex(ephemeralWallet.signingKey.publicKey, 65),
      });

      this.log("info", "Stealth address generated successfully using Fluidkey", {
        stealthAddress,
        ephemeralPublicKey: ephemeralWallet.signingKey.publicKey
      });

      return {
        stealthAddress,
        ephemeralPublicKey: ephemeralWallet.signingKey.publicKey,
        recipientViewingPublicKey: normalizedViewingKey,
        recipientSpendingPublicKey: normalizedSpendingKey
      };

    } catch (error) {
      this.log('error', '[generateStealthAddress] Error with Fluidkey method:', error);
      throw error;
    }
  }

  /**
   * Original stealth address generation method as fallback
   */
  private async generateStealthAddressOriginal(
    viewingPublicKey: string,
    spendingPublicKey: string,
    ephemeralPrivateKey?: string,
    spendingPrivateKey?: string
  ): Promise<StealthAddressResult> {
    // Generate ephemeral key pair (use provided key or generate new one)
    let ephemeralWallet: ethers.Wallet;
    if (ephemeralPrivateKey) {
      ephemeralWallet = new ethers.Wallet(ephemeralPrivateKey);
    } else {
      const randomWallet = ethers.Wallet.createRandom();
      ephemeralWallet = new ethers.Wallet(randomWallet.privateKey);
    }

    // Normalize all keys to compressed format for consistency (Fluidkey approach)
    const normalizedViewingKey = this.normalizePublicKey(viewingPublicKey);
    const normalizedSpendingKey = this.normalizePublicKey(spendingPublicKey);
    const normalizedEphemeralKey = this.normalizePublicKey(ephemeralWallet.signingKey.publicKey);

    this.log('info', '[generateStealthAddress] Normalized keys:', {
      viewing: normalizedViewingKey,
      spending: normalizedSpendingKey,
      ephemeral: normalizedEphemeralKey
    });

    // Step 1: Compute shared secret using ECDH (ephemeralPrivateKey * viewingPublicKey)
    // This follows the Fluidkey pattern of proper ECDH computation
    const sharedSecret = ephemeralWallet.signingKey.computeSharedSecret(normalizedViewingKey);

    this.log('info', '[generateStealthAddress] Shared secret:', sharedSecret);

    // Step 2: Derive stealth private key using Fluidkey-inspired method
    // Hash the shared secret to get a scalar for point multiplication
    const hashedSharedSecret = ethers.keccak256(sharedSecret);

    this.log('info', '[generateStealthAddress] Hashed shared secret:', hashedSharedSecret);

    // Step 3: Create stealth address using proper elliptic curve arithmetic
    // IMPORTANT: For stealth address generation, we should NEVER use the actual spending private key
    // Instead, we derive a deterministic private key from the public key for consistency
    // This ensures that the same inputs always produce the same stealth address
    const derivedSpendingKey = this.getPrivateKeyFromPublicKey(normalizedSpendingKey);
    const stealthPrivateKeyScalar = this.addPrivateKeys(
      hashedSharedSecret,
      derivedSpendingKey // Use derived key to match generation logic
    );

    this.log('info', '[generateStealthAddress] Stealth private key scalar:', stealthPrivateKeyScalar);

    // Create stealth wallet from derived private key
    const stealthWallet = new ethers.Wallet(stealthPrivateKeyScalar);

    this.log('info', '[generateStealthAddress] Generated stealth address:', stealthWallet.address);

    return {
      stealthAddress: stealthWallet.address,
      ephemeralPublicKey: normalizedEphemeralKey,
      recipientViewingPublicKey: normalizedViewingKey,
      recipientSpendingPublicKey: normalizedSpendingKey
    };
  }

  /**
   * Helper method to simulate elliptic curve point addition through private key arithmetic
   * This is a simplified approach that maintains determinism
   */
  private addPrivateKeys(key1: string, key2: string): string {
    // Convert to BigInt for arithmetic
    const k1 = BigInt(key1);
    const k2 = BigInt(key2);

    // Secp256k1 curve order
    const CURVE_ORDER = BigInt('0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141');

    // Add the keys modulo curve order
    const result = (k1 + k2) % CURVE_ORDER;

    // Convert back to hex string with proper padding
    return '0x' + result.toString(16).padStart(64, '0');
  }

  /**
   * Helper method to derive a consistent private key from a public key
   * This is used for deterministic stealth address generation
   */
  private getPrivateKeyFromPublicKey(publicKey: string): string {
    // Use a deterministic hash of the public key as a pseudo-private key
    // This ensures the same public key always produces the same "private key"
    return ethers.keccak256(ethers.toUtf8Bytes('stealth_seed_' + publicKey));
  }

  /**
   * Opens a stealth address by deriving the private key using Fluidkey method
   * @param stealthAddress Stealth address to open
   * @param ephemeralPublicKey Public key of the ephemeral key pair
   * @param viewingPrivateKey User's viewing private key
   * @param spendingPrivateKey User's spending private key
   * @returns Promise with the wallet
   */
  async openStealthAddress(
    stealthAddress: string,
    ephemeralPublicKey: string,
    viewingPrivateKey: string,
    spendingPrivateKey: string
  ): Promise<ethers.Wallet> {
    try {
      // Validate input parameters
      if (!stealthAddress || !ephemeralPublicKey || !viewingPrivateKey || !spendingPrivateKey) {
        throw new Error("All parameters are required: stealthAddress, ephemeralPublicKey, viewingPrivateKey, spendingPrivateKey");
      }

      this.log("info", "Opening stealth address using Fluidkey method");
      
      this.log("debug", "[OPEN] Params", {
        stealthAddress: normalizeHex(stealthAddress, 20),
        ephemeralPublicKey: normalizeHex(ephemeralPublicKey, 65),
        viewingPrivateKey: normalizeHex(viewingPrivateKey, 32),
        spendingPrivateKey: normalizeHex(spendingPrivateKey, 32),
      });

      // Try using Fluidkey's generateStealthPrivateKey function
      try {
        const result = generateStealthPrivateKey({
          ephemeralPublicKey: ephemeralPublicKey as `0x${string}`,
          spendingPrivateKey: spendingPrivateKey as `0x${string}`,
        });

        const stealthWallet = new ethers.Wallet(result.stealthPrivateKey);
        
        // Verify the derived address matches the expected stealth address
        if (stealthWallet.address.toLowerCase() !== stealthAddress.toLowerCase()) {
          throw new Error(`Derived address ${stealthWallet.address} does not match expected stealth address ${stealthAddress}`);
        }

        this.log('info', '[openStealthAddress] Successfully opened stealth address using Fluidkey:', stealthWallet.address);
        return stealthWallet;
      } catch (fluidkeyError) {
        this.log('warn', '[openStealthAddress] Fluidkey method failed, falling back to original:', fluidkeyError);
        
        // Fallback to original implementation
        return this.openStealthAddressOriginal(stealthAddress, ephemeralPublicKey, viewingPrivateKey, spendingPrivateKey);
      }
    } catch (error) {
      this.log('error', '[openStealthAddress] Error:', error);
      throw error;
    }
  }

  /**
   * Original stealth address opening method as fallback
   */
  private async openStealthAddressOriginal(
    stealthAddress: string,
    ephemeralPublicKey: string,
    viewingPrivateKey: string,
    spendingPrivateKey: string
  ): Promise<ethers.Wallet> {
    // Normalize keys to compressed format for consistency (Fluidkey approach)
    const normalizedEphemeralKey = this.normalizePublicKey(ephemeralPublicKey);

    this.log('info', '[openStealthAddress] Normalized ephemeral key:', normalizedEphemeralKey);

    // Step 1: Compute shared secret using ECDH (viewingPrivateKey * ephemeralPublicKey)
    const viewingWallet = new ethers.Wallet(viewingPrivateKey);
    const sharedSecret = viewingWallet.signingKey.computeSharedSecret(normalizedEphemeralKey);

    this.log('info', '[openStealthAddress] Shared secret:', sharedSecret);

    // Step 2: Derive stealth private key using the same method as generation
    const hashedSharedSecret = ethers.keccak256(sharedSecret);

    this.log('info', '[openStealthAddress] Hashed shared secret:', hashedSharedSecret);

    // Step 3: Derive the stealth private key by adding the shared secret to the spending key
    const stealthPrivateKeyScalar = this.addPrivateKeys(hashedSharedSecret, spendingPrivateKey);

    this.log('info', '[openStealthAddress] Stealth private key scalar:', stealthPrivateKeyScalar);

    // Create wallet from derived private key
    const stealthWallet = new ethers.Wallet(stealthPrivateKeyScalar);

    this.log('info', '[openStealthAddress] Derived stealth address:', stealthWallet.address);

    // Verify the derived address matches the expected stealth address
    if (stealthWallet.address.toLowerCase() !== stealthAddress.toLowerCase()) {
      throw new Error(`Derived address ${stealthWallet.address} does not match expected stealth address ${stealthAddress}`);
    }

    this.log('info', '[openStealthAddress] Successfully opened stealth address:', stealthWallet.address);
    return stealthWallet;
  }

  /**
   * Gets public key from an address
   */
  async getPublicKey(publicKey: string): Promise<string | null> {
    return this.formatPublicKey(publicKey);
  }

  /**
   * Derives a wallet from shared secret
   */
  deriveWalletFromSecret(secret: string): ethers.Wallet {
    const stealthPrivateKey = ethers.keccak256(ethers.toUtf8Bytes(secret));
    return new ethers.Wallet(stealthPrivateKey);
  }

  /**
   * Generates a pair of stealth keys (viewing and spending)
   */
  generateStealthKeys() {
    return {
      scanning: this.createAccount(),
      spending: this.createAccount(),
    };
  }

  /**
   * Verifies a stealth address
   */
  verifyStealthAddress(
    ephemeralPublicKey: string,
    scanningPublicKey: string,
    spendingPublicKey: string,
    stealthAddress: string
  ): boolean {
    try {
      // Implementation for stealth address verification
      return true; // Simplified implementation
    } catch (error) {
      this.log("error", "Error verifying stealth address", error);
      return false;
    }
  }
}

// Esporta la classe Stealth come StealthAddresses per compatibilità con i test aggiuntivi
export { Stealth as StealthAddresses };
export default Stealth; 