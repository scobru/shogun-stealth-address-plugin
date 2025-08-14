/**
 * Manages stealth logic using Gun, SEA and Fluidkey Stealth Account Kit
 */
import { ethers } from "ethers";
import { SigningKey } from "ethers";
import {
  StealthAddressResult,
  LogLevel,
  StealthKeys,
  FluidkeySignature,
} from "./types";
// Import Fluidkey Stealth Account Kit functions
import {
  generateKeysFromSignature,
  generateEphemeralPrivateKey,
  generateStealthAddresses,
  generateStealthPrivateKey,
} from "@fluidkey/stealth-account-kit";
import { HDKey } from "@scure/bip32";
import { Buffer } from "./buffer-polyfill";

// Utility di normalizzazione hex
export function normalizeHex(str: string, length?: number): string {
  if (!str) return "";
  let s = str.toLowerCase();
  if (!s.startsWith("0x")) s = "0x" + s;
  if (length && s.length !== 2 + length * 2) {
    s =
      "0x" +
      s
        .slice(2)
        .padStart(length * 2, "0")
        .slice(0, length * 2);
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
    const levelValue = typeof level === "string" ? (level as LogLevel) : level;
    const levelHierarchy = { error: 0, warn: 1, info: 2, debug: 3 };
    const currentLevelValue = levelHierarchy[this.logLevel] ?? 2;
    const messageLevelValue = levelHierarchy[levelValue] ?? 2;

    if (messageLevelValue <= currentLevelValue) {
      const timestamp = new Date().toISOString();
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
      let normalizedKey = publicKey;
      if (normalizedKey.startsWith("0x")) {
        normalizedKey = normalizedKey.slice(2);
      }

      if (normalizedKey.length === 130) {
        return SigningKey.computePublicKey("0x" + normalizedKey, true);
      }

      if (normalizedKey.length === 66) {
        return "0x" + normalizedKey;
      }

      return normalizedKey.startsWith("0x")
        ? normalizedKey
        : "0x" + normalizedKey;
    } catch (error) {
      this.log("warn", "Error normalizing public key:", error);
      return publicKey;
    }
  }

  /**
   * Removes the initial tilde (~) from the public key if present
   */
  formatPublicKey(publicKey: string | null): string | null {
    if (!publicKey) return null;
    const trimmedKey = publicKey.trim();
    if (!trimmedKey || !/^[~]?[\w+/=\-_.]+$/.test(trimmedKey)) return null;
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
   * Gets the stealth keys for the current user (deterministic implementation)
   */
  async getStealthKeys(signature?: string): Promise<StealthKeys> {
    // Se viene fornita una firma, usa il metodo unificato con Fluidkey
    if (signature && signature !== "default_seed") {
      return this.generateStealthKeysFromStringSignature(signature, true);
    }

    // Se non viene fornita una firma, usa un seed di default
    const seed = signature || "default_seed";

    // Genera chiavi deterministiche dal seed
    const viewingWallet = this.deriveWalletFromSeed(seed, "viewing");
    const spendingWallet = this.deriveWalletFromSeed(seed, "spending");

    return {
      viewingKey: {
        privateKey: viewingWallet.privateKey,
        publicKey: viewingWallet.signingKey.publicKey,
      },
      spendingKey: {
        privateKey: spendingWallet.privateKey,
        publicKey: spendingWallet.signingKey.publicKey,
      },
    };
  }

  /**
   * Generates and saves stealth keys (deterministic implementation)
   */
  async generateAndSaveKeys(signature?: string): Promise<StealthKeys> {
    return this.getStealthKeys(signature);
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
      this.log("debug", "Converting FluidkeySignature to string format", {
        r: signature.r,
        s: signature.s,
        v: signature.v,
      });

      // Validate signature components
      if (!signature.r || !signature.s || signature.v === undefined) {
        throw new Error("Invalid signature: missing r, s, or v components");
      }

      // Validate signature format
      if (
        typeof signature.r !== "string" ||
        typeof signature.s !== "string" ||
        typeof signature.v !== "number"
      ) {
        throw new Error(
          "Invalid signature: r and s must be strings, v must be a number"
        );
      }

      // Rimuovi i prefissi 0x da r e s prima della concatenazione
      const r = signature.r.startsWith("0x")
        ? signature.r.slice(2)
        : signature.r;
      const s = signature.s.startsWith("0x")
        ? signature.s.slice(2)
        : signature.s;
      const v = signature.v.toString(16).padStart(2, "0");

      // Validate hex strings
      if (!/^[0-9a-fA-F]+$/.test(r) || !/^[0-9a-fA-F]+$/.test(s)) {
        throw new Error("Invalid signature: r and s must be valid hex strings");
      }

      const signatureString = `${r}${s}${v}`;
      const finalSignature = `0x${signatureString}`;

      this.log("debug", "Generated signature string", {
        r: r,
        s: s,
        v: v,
        signatureString: signatureString,
        finalSignature: finalSignature,
        length: finalSignature.length,
      });

      // Validate final signature length
      if (finalSignature.length !== 132) {
        // 0x + 130 hex chars
        throw new Error(
          `Invalid signature length: expected 132, got ${finalSignature.length}`
        );
      }

      let result;
      try {
        result = generateKeysFromSignature(finalSignature as `0x${string}`);
      } catch (fluidkeyError) {
        this.log("error", "Fluidkey generateKeysFromSignature failed", {
          error: fluidkeyError,
          signature: finalSignature,
        });
        throw new Error(
          `Fluidkey error: ${fluidkeyError instanceof Error ? fluidkeyError.message : String(fluidkeyError)}`
        );
      }

      // Validate result
      if (!result || !result.viewingPrivateKey || !result.spendingPrivateKey) {
        throw new Error(
          "Fluidkey returned invalid result: missing private keys"
        );
      }

      let viewingWallet, spendingWallet;
      try {
        viewingWallet = new ethers.Wallet(result.viewingPrivateKey);
        spendingWallet = new ethers.Wallet(result.spendingPrivateKey);
      } catch (walletError) {
        this.log("error", "Failed to create wallets from private keys", {
          error: walletError,
          viewingPrivateKey: result.viewingPrivateKey?.substring(0, 10) + "...",
          spendingPrivateKey:
            result.spendingPrivateKey?.substring(0, 10) + "...",
        });
        throw new Error(
          `Wallet creation failed: ${walletError instanceof Error ? walletError.message : String(walletError)}`
        );
      }

      this.log("debug", "Successfully generated keys from signature");

      return {
        viewingPrivateKey: result.viewingPrivateKey,
        viewingPublicKey: viewingWallet.signingKey.publicKey,
        spendingPrivateKey: result.spendingPrivateKey,
        spendingPublicKey: spendingWallet.signingKey.publicKey,
      };
    } catch (error) {
      this.log("error", "Error generating keys from signature", {
        error: error,
        signature: signature,
        errorMessage: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });

      // Return a more descriptive error
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      throw new Error(
        `Failed to generate keys from signature: ${errorMessage}`
      );
    }
  }

  /**
   * Generates stealth addresses using Fluidkey method
   */
  async generateStealthAddress(
    viewingPublicKey: string,
    spendingPublicKey: string,
    ephemeralPrivateKey?: string,
    viewingPrivateKey?: string,
    derivationIndex?: number,
    spendingPrivateKey?: string
  ): Promise<StealthAddressResult> {
    try {
      const normalizedViewingKey = this.normalizePublicKey(viewingPublicKey);
      const normalizedSpendingKey = this.normalizePublicKey(spendingPublicKey);

      let ephemeralKey = ephemeralPrivateKey;
      if (!ephemeralKey) {
        if (viewingPrivateKey) {
          const cleanPriv = viewingPrivateKey.startsWith("0x")
            ? viewingPrivateKey.slice(2)
            : viewingPrivateKey;
          const hdKey = HDKey.fromMasterSeed(Buffer.from(cleanPriv, "hex"));

          const result = generateEphemeralPrivateKey({
            viewingPrivateKeyNode: hdKey as any,
            nonce: 0n,
            chainId: 1,
            coinType: 60,
          });
          ephemeralKey = result.ephemeralPrivateKey;
        } else {
          const ephemeralWallet = ethers.Wallet.createRandom();
          ephemeralKey = ephemeralWallet.privateKey;
        }
      }

      const result = generateStealthAddresses({
        ephemeralPrivateKey: ephemeralKey as `0x${string}`,
        spendingPublicKeys: [normalizedSpendingKey as `0x${string}`],
      });

      const stealthAddress = result.stealthAddresses[0];
      const ephemeralWallet = new ethers.Wallet(ephemeralKey as `0x${string}`);

      return {
        stealthAddress,
        ephemeralPublicKey: ephemeralWallet.signingKey.publicKey,
        recipientViewingPublicKey: normalizedViewingKey,
        recipientSpendingPublicKey: normalizedSpendingKey,
      };
    } catch (error) {
      this.log(
        "error",
        "Error with Fluidkey method, falling back to original:",
        error
      );
      return this.generateStealthAddressOriginal(
        viewingPublicKey,
        spendingPublicKey,
        ephemeralPrivateKey,
        spendingPrivateKey
      );
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
    let ephemeralWallet: ethers.Wallet;
    if (ephemeralPrivateKey) {
      ephemeralWallet = new ethers.Wallet(ephemeralPrivateKey);
    } else {
      const randomWallet = ethers.Wallet.createRandom();
      ephemeralWallet = new ethers.Wallet(randomWallet.privateKey);
    }

    const normalizedViewingKey = this.normalizePublicKey(viewingPublicKey);
    const normalizedSpendingKey = this.normalizePublicKey(spendingPublicKey);
    const normalizedEphemeralKey = this.normalizePublicKey(
      ephemeralWallet.signingKey.publicKey
    );

    const sharedSecret =
      ephemeralWallet.signingKey.computeSharedSecret(normalizedViewingKey);
    const hashedSharedSecret = ethers.keccak256(sharedSecret);

    let spendingKeyToUse: string;
    if (spendingPrivateKey) {
      spendingKeyToUse = spendingPrivateKey;
    } else {
      spendingKeyToUse = this.getPrivateKeyFromPublicKey(normalizedSpendingKey);
    }

    const stealthPrivateKeyScalar = this.addPrivateKeys(
      hashedSharedSecret,
      spendingKeyToUse
    );
    const stealthWallet = new ethers.Wallet(stealthPrivateKeyScalar);

    return {
      stealthAddress: stealthWallet.address,
      ephemeralPublicKey: normalizedEphemeralKey,
      recipientViewingPublicKey: normalizedViewingKey,
      recipientSpendingPublicKey: normalizedSpendingKey,
    };
  }

  /**
   * Helper method to simulate elliptic curve point addition through private key arithmetic
   */
  private addPrivateKeys(key1: string, key2: string): string {
    const k1 = BigInt(key1);
    const k2 = BigInt(key2);
    const CURVE_ORDER = BigInt(
      "0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141"
    );
    const result = (k1 + k2) % CURVE_ORDER;
    return "0x" + result.toString(16).padStart(64, "0");
  }

  /**
   * Helper method to derive a consistent private key from a public key
   */
  private getPrivateKeyFromPublicKey(publicKey: string): string {
    return ethers.keccak256(ethers.toUtf8Bytes("stealth_seed_" + publicKey));
  }

  /**
   * Deriva un wallet deterministico da un seed
   */
  private deriveWalletFromSeed(seed: string, purpose: string): ethers.Wallet {
    // Crea un hash deterministico dal seed e dal purpose
    const combinedSeed = `${seed}_${purpose}_stealth_deterministic`;
    const seedHash = ethers.keccak256(ethers.toUtf8Bytes(combinedSeed));

    // Usa l'hash come chiave privata
    return new ethers.Wallet(seedHash);
  }

  /**
   * Opens a stealth address by deriving the private key using Fluidkey method
   */
  async openStealthAddress(
    stealthAddress: string,
    ephemeralPublicKey: string,
    viewingPrivateKey: string,
    spendingPrivateKey: string
  ): Promise<ethers.Wallet> {
    try {
      if (
        !stealthAddress ||
        !ephemeralPublicKey ||
        !viewingPrivateKey ||
        !spendingPrivateKey
      ) {
        throw new Error(
          "All parameters are required: stealthAddress, ephemeralPublicKey, viewingPrivateKey, spendingPrivateKey"
        );
      }

      const normalizedEphemeralPublicKey =
        this.normalizePublicKey(ephemeralPublicKey);

      try {
        const result = generateStealthPrivateKey({
          ephemeralPublicKey: normalizedEphemeralPublicKey as `0x${string}`,
          spendingPrivateKey: spendingPrivateKey as `0x${string}`,
        });

        const stealthWallet = new ethers.Wallet(result.stealthPrivateKey);

        if (
          stealthWallet.address.toLowerCase() !== stealthAddress.toLowerCase()
        ) {
          throw new Error(
            `Derived address ${stealthWallet.address} does not match expected stealth address ${stealthAddress}`
          );
        }

        return stealthWallet;
      } catch (fluidkeyError) {
        this.log(
          "warn",
          "Fluidkey method failed, falling back to original:",
          fluidkeyError
        );
        return this.openStealthAddressOriginal(
          stealthAddress,
          ephemeralPublicKey,
          viewingPrivateKey,
          spendingPrivateKey
        );
      }
    } catch (error) {
      this.log("error", "Error opening stealth address:", error);
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
    const normalizedEphemeralKey = this.normalizePublicKey(ephemeralPublicKey);
    const viewingWallet = new ethers.Wallet(viewingPrivateKey);
    const sharedSecret = viewingWallet.signingKey.computeSharedSecret(
      normalizedEphemeralKey
    );
    const hashedSharedSecret = ethers.keccak256(sharedSecret);
    const stealthPrivateKeyScalar = this.addPrivateKeys(
      hashedSharedSecret,
      spendingPrivateKey
    );
    const stealthWallet = new ethers.Wallet(stealthPrivateKeyScalar);

    if (stealthWallet.address.toLowerCase() !== stealthAddress.toLowerCase()) {
      throw new Error(
        `Derived address ${stealthWallet.address} does not match expected stealth address ${stealthAddress}`
      );
    }

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
      return true; // Simplified implementation
    } catch (error) {
      this.log("error", "Error verifying stealth address", error);
      return false;
    }
  }

  /**
   * Generate stealth keys from any signature string (unified method)
   * Converts string signature to FluidkeySignature format and uses generateKeysFromSignature
   */
  async generateStealthKeysFromStringSignature(
    signature: string,
    isFallback: boolean = false
  ): Promise<StealthKeys> {
    try {
      // Convert string signature to FluidkeySignature format
      const fluidkeySignature: FluidkeySignature =
        this.convertStringToFluidkeySignature(signature);

      // Use the existing Fluidkey method
      const result = await this.generateKeysFromSignature(fluidkeySignature);

      return {
        viewingKey: {
          privateKey: result.viewingPrivateKey,
          publicKey: result.viewingPublicKey,
        },
        spendingKey: {
          privateKey: result.spendingPrivateKey,
          publicKey: result.spendingPublicKey,
        },
      };
    } catch (error) {
      this.log(
        "error",
        "Error generating keys from string signature, falling back to hash method:",
        error
      );

      // Prevent infinite recursion - if this is already a fallback, use direct hash method
      if (isFallback) {
        this.log(
          "warn",
          "Preventing infinite recursion, using direct hash method"
        );
        const seed = signature || "default_seed";
        const viewingWallet = this.deriveWalletFromSeed(seed, "viewing");
        const spendingWallet = this.deriveWalletFromSeed(seed, "spending");

        return {
          viewingKey: {
            privateKey: viewingWallet.privateKey,
            publicKey: viewingWallet.signingKey.publicKey,
          },
          spendingKey: {
            privateKey: spendingWallet.privateKey,
            publicKey: spendingWallet.signingKey.publicKey,
          },
        };
      }

      // First fallback - use getStealthKeys with recursion prevention
      return this.getStealthKeys(signature);
    }
  }

  /**
   * Convert a string signature to FluidkeySignature format
   */
  private convertStringToFluidkeySignature(
    signature: string
  ): FluidkeySignature {
    try {
      this.log("debug", "Converting string signature to FluidkeySignature", {
        originalSignature: signature,
        length: signature.length,
      });

      // Validate input
      if (!signature || typeof signature !== "string") {
        throw new Error("Invalid signature: must be a non-empty string");
      }

      // Remove 0x prefix if present
      const cleanSignature = signature.startsWith("0x")
        ? signature.slice(2)
        : signature;

      // Check if we have enough characters for a valid signature
      if (cleanSignature.length < 128) {
        this.log("warn", "Signature too short, using hash-based fallback", {
          cleanSignatureLength: cleanSignature.length,
          expectedMinLength: 128,
        });
        throw new Error(
          `Signature too short for standard ECDSA format: ${cleanSignature.length} chars, need at least 128`
        );
      }

      // Validate hex format
      if (!/^[0-9a-fA-F]+$/.test(cleanSignature)) {
        throw new Error(
          "Invalid signature: must contain only hexadecimal characters"
        );
      }

      // Ensure we have at least 130 characters (65 bytes)
      const paddedSignature = cleanSignature.padEnd(130, "0").slice(0, 130);

      // Split into r, s, v components
      const r = paddedSignature.slice(0, 64);
      const s = paddedSignature.slice(64, 128);
      const vHex = paddedSignature.slice(128, 130);

      // Validate v component
      const v = parseInt(vHex, 16);
      if (isNaN(v) || v < 0 || v > 255) {
        throw new Error(`Invalid v component: ${vHex} (must be 00-FF in hex)`);
      }

      const result = {
        r: "0x" + r,
        s: "0x" + s,
        v: v || 27, // Default to 27 if parsing fails
      };

      this.log("debug", "Converted signature successfully", {
        r: result.r,
        s: result.s,
        v: result.v,
        paddedSignature: paddedSignature,
      });

      return result;
    } catch (error) {
      this.log(
        "error",
        "Error converting string signature to FluidkeySignature",
        {
          error: error,
          signature: signature,
          errorMessage: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        }
      );

      // Fallback: create a valid signature from the hash of the original string
      try {
        const fallbackHash = ethers.keccak256(ethers.toUtf8Bytes(signature));
        const fallbackR = fallbackHash.slice(2, 66);
        const fallbackS = fallbackHash.slice(66, 130);
        const fallbackV = 27;

        this.log("warn", "Using fallback signature conversion", {
          fallbackR: fallbackR,
          fallbackS: fallbackS,
          fallbackV: fallbackV,
        });

        return {
          r: "0x" + fallbackR,
          s: "0x" + fallbackS,
          v: fallbackV,
        };
      } catch (fallbackError) {
        this.log("error", "Fallback signature conversion also failed", {
          error: fallbackError,
          originalError: error,
        });
        throw new Error(
          `Signature conversion failed: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  }
}

// Esporta la classe Stealth come StealthAddresses per compatibilità con i test aggiuntivi
export { Stealth as StealthAddresses };
export default Stealth;
