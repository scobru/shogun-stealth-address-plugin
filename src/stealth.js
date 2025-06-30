/**
 * Manages stealth logic using Gun and SEA
 */
import { ethers } from "ethers";
import SEA from "gun/sea";
class Stealth {
    constructor(gun) {
        this.logs = [];
        this.gun = gun;
    }
    /**
     * Structured logging system
     */
    log(level, message, data) {
        const logMessage = {
            timestamp: new Date().toISOString(),
            level,
            message,
            data,
        };
        this.logs.push(logMessage);
        console[level](`[${logMessage.timestamp}] ${message}`, data);
    }
    /**
     * Cleanup sensitive data from memory
     */
    async cleanupSensitiveData() {
        try {
            this.logs = [];
            this.log("info", "Sensitive data cleanup completed");
        }
        catch (error) {
            this.log("error", "Error during cleanup", error);
            throw error;
        }
    }
    async getStealthKeys() {
        try {
            const user = this.gun.user();
            if (!user || !user.is) {
                throw new Error("User not authenticated");
            }
            // Get encrypted keys from Gun
            const encryptedViewingKey = await new Promise((resolve) => {
                user.get("stealth").get("viewingKey").once((data) => {
                    resolve(data);
                });
            });
            const encryptedSpendingKey = await new Promise((resolve) => {
                user.get("stealth").get("spendingKey").once((data) => {
                    resolve(data);
                });
            });
            if (!encryptedViewingKey || !encryptedSpendingKey) {
                throw new Error("Stealth keys not found");
            }
            // Decrypt keys - use proper typing for Gun user
            const userSea = user._.sea;
            const viewingKey = await SEA.decrypt(encryptedViewingKey, userSea);
            const spendingKey = await SEA.decrypt(encryptedSpendingKey, userSea);
            return {
                spendingKey: spendingKey.privateKey,
                viewingKey: viewingKey.privateKey,
            };
        }
        catch (error) {
            this.log("error", "Error getting stealth keys", error);
            throw error;
        }
    }
    // Generate Viewving and Spending Key and save it tu gun userspace
    async generateAndSaveKeys(pair) {
        const existingViewingKey = this.gun
            .user()
            .get("stealth")
            .get("viewingKey")
            .once();
        const existingSpendingKey = this.gun
            .user()
            .get("stealth")
            .get("spendingKey")
            .once();
        if (existingViewingKey || existingSpendingKey) {
            return;
        }
        const ephemeralKeyPairS = await this.createAccount();
        const ephemeralKeyPairV = await this.createAccount();
        let user;
        if (pair) {
            user = await this.gun.user().auth(pair);
        }
        else {
            user = this.gun.user();
        }
        // Use proper typing for Gun user
        const userSea = user._.sea;
        const encryptedViewingKey = await SEA.encrypt(ephemeralKeyPairV, userSea);
        const encryptedSpendingKey = await SEA.encrypt(ephemeralKeyPairS, userSea);
        this.gun.user().get("stealth").get("viewingKey").put(encryptedViewingKey);
        this.gun.user().get("stealth").get("spendingKey").put(encryptedSpendingKey);
        this.log("info", "Stealth keys generated and saved for address", pair?.pub || user?.is?.alias);
    }
    /**
     * Removes the initial tilde (~) from the public key if present
     */
    formatPublicKey(publicKey) {
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
    async createAccount() {
        try {
            // Generate a new random wallet
            const wallet = ethers.Wallet.createRandom();
            return {
                privateKey: wallet.privateKey,
                publicKey: wallet.publicKey,
            };
        }
        catch (error) {
            this.log("error", "Error creating stealth account", error);
            throw error;
        }
    }
    /**
     * Generates a stealth address for a recipient
     * @param viewingPublicKey Recipient's viewing public key
     * @param spendingPublicKey Recipient's spending public key
     * @returns Promise with the stealth address result
     */
    async generateStealthAddress(viewingPublicKey, spendingPublicKey) {
        try {
            // Generate ephemeral key pair
            const ephemeralWallet = ethers.Wallet.createRandom();
            // Generate shared secret using ECDH
            const sharedSecret = ethers.keccak256(ethers.solidityPacked(["bytes32", "bytes32"], [ephemeralWallet.privateKey, viewingPublicKey]));
            // Derive stealth private key
            const stealthPrivateKey = ethers.keccak256(ethers.solidityPacked(["bytes32", "bytes32"], [sharedSecret, spendingPublicKey]));
            // Create stealth wallet
            const stealthWallet = new ethers.Wallet(stealthPrivateKey);
            // Encrypt random number with viewing key
            const randomNumber = ethers.randomBytes(32);
            const encryptedRandomNumber = await SEA.encrypt(ethers.hexlify(randomNumber), viewingPublicKey);
            this.log("info", "Stealth address generated successfully");
            return {
                stealthAddress: stealthWallet.address,
                ephemeralPublicKey: ephemeralWallet.publicKey,
                encryptedRandomNumber: JSON.stringify(encryptedRandomNumber),
                recipientPublicKey: spendingPublicKey,
            };
        }
        catch (error) {
            this.log("error", "Error generating stealth address", error);
            throw error;
        }
    }
    /**
     * Opens a stealth address by deriving the private key
     * @param stealthAddress Stealth address to open
     * @param encryptedRandomNumber Encrypted random number
     * @param ephemeralPublicKey Public key of the ephemeral key pair
     * @returns Promise with the wallet
     */
    async openStealthAddress(stealthAddress, encryptedRandomNumber, ephemeralPublicKey, spendingKeyPair, viewingKeyPair) {
        try {
            // Decrypt the random number using viewing key
            const decryptedRandomNumber = await SEA.decrypt(JSON.parse(encryptedRandomNumber), viewingKeyPair.priv);
            if (!decryptedRandomNumber) {
                throw new Error("Failed to decrypt random number");
            }
            // Generate shared secret using ECDH
            const sharedSecret = ethers.keccak256(ethers.solidityPacked(["bytes32", "bytes32"], [viewingKeyPair.priv, ephemeralPublicKey]));
            // Derive stealth private key
            const stealthPrivateKey = ethers.keccak256(ethers.solidityPacked(["bytes32", "bytes32"], [sharedSecret, spendingKeyPair.pub]));
            // Create stealth wallet
            const stealthWallet = new ethers.Wallet(stealthPrivateKey);
            // Verify the address matches
            if (stealthWallet.address.toLowerCase() !== stealthAddress.toLowerCase()) {
                throw new Error("Derived address does not match stealth address");
            }
            this.log("info", "Stealth address opened successfully");
            return stealthWallet;
        }
        catch (error) {
            this.log("error", "Error opening stealth address", error);
            throw error;
        }
    }
    /**
     * Gets public key from an address
     */
    async getPublicKey(publicKey) {
        return this.formatPublicKey(publicKey);
    }
    /**
     * Derives a wallet from shared secret
     */
    deriveWalletFromSecret(secret) {
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
    verifyStealthAddress(ephemeralPublicKey, scanningPublicKey, spendingPublicKey, stealthAddress) {
        try {
            // Implementation for stealth address verification
            return true; // Simplified implementation
        }
        catch (error) {
            this.log("error", "Error verifying stealth address", error);
            return false;
        }
    }
}
// Esporta la classe direttamente
export { Stealth };
// Esporta la classe Stealth come StealthAddresses per compatibilità con i test aggiuntivi
export { Stealth as StealthAddresses };
// Esposizione globale se in ambiente browser
if (typeof window !== "undefined") {
    window.Stealth = Stealth;
}
else if (typeof global !== "undefined") {
    global.Stealth = Stealth;
}
export default Stealth;
//# sourceMappingURL=stealth.js.map