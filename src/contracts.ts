// ABI per PaymentForwarder
export const PAYMENT_FORWARDER_ABI = [
  // Events
  "event Announcement(address indexed receiver, uint256 amount, address indexed token, bytes32 pkx, bytes32 ciphertext)",
  "event TokenWithdrawal(address indexed receiver, address indexed acceptor, uint256 amount, address indexed token)",

  // State variables
  "function toll() view returns (uint256)",
  "function tollCollector() view returns (address)",
  "function tollReceiver() view returns (address)",
  "function tokenPayments(address, address) view returns (uint256)",

  // Send functions
  "function sendEth(address payable _receiver, uint256 _tollCommitment, bytes32 _pkx, bytes32 _ciphertext) payable",
  "function sendToken(address _receiver, address _tokenAddr, uint256 _amount, bytes32 _pkx, bytes32 _ciphertext) payable",

  // Withdraw functions
  "function withdrawToken(address _acceptor, address _tokenAddr)",
  "function withdrawTokenAndCall(address _acceptor, address _tokenAddr, address _hook, bytes calldata _data)",
  "function withdrawTokenOnBehalf(address _stealthAddr, address _acceptor, address _tokenAddr, address _sponsor, uint256 _sponsorFee, uint8 _v, bytes32 _r, bytes32 _s)",
  "function withdrawTokenAndCallOnBehalf(address _stealthAddr, address _acceptor, address _tokenAddr, address _sponsor, uint256 _sponsorFee, address _hook, bytes calldata _data, uint8 _v, bytes32 _r, bytes32 _s)",

  // Admin functions
  "function setToll(uint256 _newToll)",
  "function setTollCollector(address _newTollCollector)",
  "function setTollReceiver(address payable _newTollReceiver)",
  "function collectTolls()",
];

// ABI per StealthKeyRegistry
export const STEALTH_KEY_REGISTRY_ABI = [
  // Events
  "event StealthKeysRegistered(address indexed registrant, string viewingPublicKey, string spendingPublicKey)",
  "event StealthMetadataRegistered(address indexed stealthAddress, address indexed sender, string ephemeralPublicKey, string encryptedRandomNumber, string recipientPublicKey)",

  // State variables
  "function DOMAIN_SEPARATOR() view returns (bytes32)",
  "function STEALTHKEYS_TYPEHASH() view returns (bytes32)",

  // Register functions
  "function registerStealthKeys(string calldata _viewingPublicKey, string calldata _spendingPublicKey)",
  "function registerStealthKeysOnBehalf(address _registrant, string calldata _viewingPublicKey, string calldata _spendingPublicKey, uint8 _v, bytes32 _r, bytes32 _s)",

  // Get functions
  "function getStealthKeys(address _registrant) view returns (string memory viewingPublicKey, string memory spendingPublicKey)",

  // Metadata functions
  "function registerStealthMetadata(address _stealthAddress, string calldata _ephemeralPublicKey, string calldata _encryptedRandomNumber, string calldata _recipientPublicKey)",
];

// Interfacce per la configurazione
export interface NetworkConfig {
  paymentForwarder: string;
  stealthKeyRegistry: string;
  rpcUrl?: string;
}

export interface ContractConfig {
  networks: {
    [networkName: string]: NetworkConfig;
  };
  defaultNetwork?: string;
}

// Configurazione di default (può essere sovrascritta)
export const DEFAULT_CONTRACT_CONFIG: ContractConfig = {
  networks: {
    SEPOLIA: {
      paymentForwarder: "0x885CD20Bb6C084808004449bC78392450fe11f98",
      stealthKeyRegistry: "", // Da aggiungere quando deployato
      rpcUrl: "https://eth-sepolia.g.alchemy.com/v2/",
    },
    MAINNET: {
      paymentForwarder: "",
      stealthKeyRegistry: "",
      rpcUrl: "https://eth-mainnet.g.alchemy.com/v2/",
    },
    LOCALHOST: {
      paymentForwarder: "",
      stealthKeyRegistry: "",
      rpcUrl: "http://localhost:8545",
    },
  },
  defaultNetwork: "SEPOLIA",
};

// Classe per gestire la configurazione dei contratti
export class ContractManager {
  private config: ContractConfig;
  private currentNetwork: string;

  constructor(config?: Partial<ContractConfig>) {
    this.config = { ...DEFAULT_CONTRACT_CONFIG, ...config };
    this.currentNetwork = this.config.defaultNetwork || "SEPOLIA";
  }

  /**
   * Imposta la rete corrente
   */
  setNetwork(networkName: string): void {
    if (!this.config.networks[networkName]) {
      throw new Error(`Rete non supportata: ${networkName}`);
    }
    this.currentNetwork = networkName;
  }

  /**
   * Ottiene la configurazione della rete corrente
   */
  getCurrentNetworkConfig(): NetworkConfig {
    const config = this.config.networks[this.currentNetwork];
    if (!config) {
      throw new Error(
        `Configurazione non trovata per la rete: ${this.currentNetwork}`
      );
    }
    return config;
  }

  /**
   * Ottiene l'indirizzo del PaymentForwarder per la rete corrente
   */
  getPaymentForwarderAddress(): string {
    const config = this.getCurrentNetworkConfig();
    if (!config.paymentForwarder) {
      throw new Error(
        `Indirizzo PaymentForwarder non configurato per la rete: ${this.currentNetwork}`
      );
    }
    return config.paymentForwarder;
  }

  /**
   * Ottiene l'indirizzo del StealthKeyRegistry per la rete corrente
   */
  getStealthKeyRegistryAddress(): string | null {
    const config = this.getCurrentNetworkConfig();
    return config.stealthKeyRegistry || null;
  }

  /**
   * Ottiene l'URL RPC per la rete corrente
   */
  getRpcUrl(): string | null {
    const config = this.getCurrentNetworkConfig();
    return config.rpcUrl || null;
  }

  /**
   * Aggiunge o aggiorna la configurazione di una rete
   */
  setNetworkConfig(networkName: string, config: NetworkConfig): void {
    this.config.networks[networkName] = config;
  }

  /**
   * Ottiene tutte le reti disponibili
   */
  getAvailableNetworks(): string[] {
    return Object.keys(this.config.networks);
  }

  /**
   * Ottiene la rete corrente
   */
  getCurrentNetwork(): string {
    return this.currentNetwork;
  }
}

// Costanti
export const ETH_TOKEN_PLACEHOLDER =
  "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";

// Esporta anche la configurazione legacy per compatibilità
export const CONTRACT_ADDRESSES = {
  SEPOLIA: {
    PAYMENT_FORWARDER: "0x885CD20Bb6C084808004449bC78392450fe11f98",
    STEALTH_KEY_REGISTRY: "", // Da aggiungere quando deployato
  },
};
