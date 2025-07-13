import { ethers } from "ethers";
/**
 * Interface for ephemeral key pairs used in stealth transactions
 */
export interface EphemeralKeyPair {
    pub: string;
    priv: string;
    epub: string;
    epriv: string;
}
/**
 * Interface for stealth transaction data
 */
export interface StealthData {
    recipientPublicKey: string;
    ephemeralKeyPair: EphemeralKeyPair;
    timestamp: number;
    encryptedRandomNumber?: string;
    stealthAddress: string;
}
/**
 * Interface for stealth address generation result
 */
export interface StealthAddressResult {
    stealthAddress: string;
    ephemeralPublicKey: string;
    encryptedRandomNumber: string;
    recipientPublicKey: string;
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
 * Interfaccia per il plugin Stealth
 */
export interface StealthPluginInterface {
    /**
     * Genera una coppia di chiavi effimere per comunicazioni stealth
     * @returns Promise con la coppia di chiavi generata
     */
    generateEphemeralKeyPair(): Promise<{
        privateKey: string;
        publicKey: string;
    }>;
    /**
     * Genera un indirizzo stealth utilizzando chiavi separate per viewing e spending
     * @param viewingPublicKey Chiave pubblica per scansionare transazioni
     * @param spendingPublicKey Chiave pubblica per spendere fondi
     * @param ephemeralPrivateKey Chiave privata effimera per la generazione (opzionale)
     * @returns Promise con il risultato dell'indirizzo stealth
     */
    generateStealthAddress(
        viewingPublicKey: string,
        spendingPublicKey: string,
        ephemeralPrivateKey?: string,
    ): Promise<StealthAddressResult>;
    /**
     * Scandisce gli indirizzi stealth per verificare se sono indirizzati all'utente
     * @param addresses Array di dati stealth da scansionare
     * @param viewingPrivateKey Chiave privata di viewing dell'utente
     * @returns Promise con gli indirizzi che appartengono all'utente
     */
    scanStealthAddresses(addresses: StealthData[], viewingPrivateKey: string): Promise<StealthData[]>;
    /**
     * Verifica la proprietà di un indirizzo stealth
     * @param stealthData Dati dell'indirizzo stealth
     * @param viewingPrivateKey Chiave privata di viewing dell'utente
     * @returns Promise che indica se l'indirizzo appartiene all'utente
     */
    isStealthAddressMine(stealthData: StealthData, viewingPrivateKey: string): Promise<boolean>;
    /**
     * Recupera la chiave privata di un indirizzo stealth
     * @param stealthData Dati dell'indirizzo stealth
     * @param viewingPrivateKey Chiave privata di viewing dell'utente
     * @returns Promise con la chiave privata recuperata
     */
    getStealthPrivateKey(stealthData: StealthData, viewingPrivateKey: string): Promise<string>;
    /**
     * Apre un indirizzo stealth derivando la chiave privata
     * @param stealthAddress Indirizzo stealth da aprire
     * @param ephemeralPublicKey Chiave pubblica effimera
     * @param viewingPrivateKey Chiave privata di viewing dell'utente
     * @param spendingPrivateKey Chiave privata di spending dell'utente
     * @returns Promise con il wallet
     */
    openStealthAddress(
        stealthAddress: string,
        ephemeralPublicKey: string,
        viewingPrivateKey: string,
        spendingPrivateKey: string,
    ): Promise<ethers.Wallet>;
    /**
     * Ottiene le chiavi stealth dell'utente
     * @returns Promise con le chiavi stealth
     */
    getStealthKeys(): Promise<{
        spendingKey: string;
        viewingKey: string;
    }>;
}
