import { BasePlugin } from "./base";
import { Stealth } from "./stealth";
import { log } from "./utils";
/**
 * Plugin per la gestione delle funzionalità Stealth in ShogunCore
 */
export class StealthPlugin extends BasePlugin {
    constructor() {
        super(...arguments);
        this.name = "stealth";
        this.version = "1.0.0";
        this.description = "Provides stealth address functionality for ShogunCore";
        this.stealth = null;
    }
    /**
     * @inheritdoc
     */
    initialize(core) {
        super.initialize(core);
        if (!core.gun) {
            throw new Error("Gun dependency not available in core");
        }
        // Inizializziamo il modulo Stealth
        this.stealth = new Stealth(core.gun);
        log("Stealth plugin initialized");
    }
    /**
     * @inheritdoc
     */
    destroy() {
        this.stealth = null;
        super.destroy();
        log("Stealth plugin destroyed");
    }
    /**
     * Assicura che il modulo Stealth sia inizializzato
     * @private
     */
    assertStealth() {
        this.assertInitialized();
        if (!this.stealth) {
            throw new Error("Stealth module not initialized");
        }
        return this.stealth;
    }
    /**
     * @inheritdoc
     */
    async generateEphemeralKeyPair() {
        return this.assertStealth().createAccount();
    }
    /**
     * @inheritdoc
     */
    async generateStealthAddress(publicKey, ephemeralPrivateKey) {
        return this.assertStealth().generateStealthAddress(publicKey, ephemeralPrivateKey);
    }
    /**
     * @inheritdoc
     */
    async scanStealthAddresses(addresses, privateKeyOrSpendKey) {
        // Implementazione per compatibilità
        console.warn("scanStealthAddresses è deprecato. Usa openStealthAddress per ogni indirizzo.");
        return Promise.resolve([]);
    }
    /**
     * @inheritdoc
     */
    async isStealthAddressMine(stealthData, privateKeyOrSpendKey) {
        // Implementazione per compatibilità
        console.warn("isStealthAddressMine è deprecato");
        return Promise.resolve(false);
    }
    /**
     * @inheritdoc
     */
    async getStealthPrivateKey(stealthData, privateKeyOrSpendKey) {
        // Implementazione per compatibilità
        console.warn("getStealthPrivateKey è deprecato. Usa openStealthAddress");
        return Promise.resolve("0x" + "0".repeat(64));
    }
    /**
     * @inheritdoc
     */
    async openStealthAddress(stealthAddress, encryptedRandomNumber, ephemeralPublicKey) {
        // Ottieni le chiavi dell'utente
        const keys = await this.getStealthKeys();
        // Converti le chiavi stringhe in oggetti EphemeralKeyPair
        const viewingKeyPair = {
            pub: keys.viewingKey,
            priv: keys.viewingKey,
            epub: keys.viewingKey,
            epriv: keys.viewingKey,
        };
        const spendingKeyPair = {
            pub: keys.spendingKey,
            priv: keys.spendingKey,
            epub: keys.spendingKey,
            epriv: keys.spendingKey,
        };
        return this.assertStealth().openStealthAddress(stealthAddress, encryptedRandomNumber, ephemeralPublicKey, spendingKeyPair, viewingKeyPair);
    }
    /**
     * @inheritdoc
     */
    async getStealthKeys() {
        return this.assertStealth().getStealthKeys();
    }
}
//# sourceMappingURL=stealthPlugin.js.map