/**
 * Esempio di utilizzo della configurazione dinamica dei contratti
 * Questo file mostra come configurare il plugin Stealth con indirizzi e provider dinamici
 */

import { StealthPlugin } from "../stealthPlugin";
import { ContractConfig, NetworkConfig } from "../types";
import { ethers } from "ethers";

// Esempio 1: Configurazione di base con reti predefinite
async function basicConfigurationExample() {
  console.log("=== Esempio 1: Configurazione di base ===");
  
  // Crea il plugin con configurazione personalizzata
  const plugin = new StealthPlugin({
    networks: {
      SEPOLIA: {
        paymentForwarder: "0x885CD20Bb6C084808004449bC78392450fe11f98",
        stealthKeyRegistry: "0x1234567890123456789012345678901234567890",
        rpcUrl: "https://eth-sepolia.g.alchemy.com/v2/YOUR_API_KEY",
      },
      MAINNET: {
        paymentForwarder: "0xMAINNET_PAYMENT_FORWARDER_ADDRESS",
        stealthKeyRegistry: "0xMAINNET_STEALTH_KEY_REGISTRY_ADDRESS",
        rpcUrl: "https://eth-mainnet.g.alchemy.com/v2/YOUR_API_KEY",
      },
    },
    defaultNetwork: "SEPOLIA",
  });

  console.log("Rete corrente:", plugin.getCurrentNetwork());
  console.log("Reti disponibili:", plugin.getAvailableNetworks());
}

// Esempio 2: Configurazione dinamica con provider personalizzato
async function dynamicConfigurationExample() {
  console.log("\n=== Esempio 2: Configurazione dinamica ===");
  
  const plugin = new StealthPlugin();
  
  // Configura un provider personalizzato
  const provider = new ethers.JsonRpcProvider("https://eth-sepolia.g.alchemy.com/v2/YOUR_API_KEY");
  const signer = new ethers.Wallet("YOUR_PRIVATE_KEY", provider);
  
  // Inizializza il plugin con il core
  const core = {
    gun: {}, // Istanza Gun
    provider: provider,
    signer: signer,
  };
  
  plugin.initialize(core);
  
  // Cambia rete dinamicamente
  plugin.setNetwork("MAINNET");
  console.log("Rete cambiata a:", plugin.getCurrentNetwork());
  
  // Aggiungi una nuova rete
  plugin.setNetworkConfig("LOCALHOST", {
    paymentForwarder: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
    stealthKeyRegistry: "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512",
    rpcUrl: "http://localhost:8545",
  });
  
  console.log("Reti disponibili dopo aggiunta:", plugin.getAvailableNetworks());
}

// Esempio 3: Configurazione da variabili d'ambiente
async function environmentConfigurationExample() {
  console.log("\n=== Esempio 3: Configurazione da variabili d'ambiente ===");
  
  // Simula variabili d'ambiente
  const env = {
    NETWORK: "SEPOLIA",
    PAYMENT_FORWARDER_ADDRESS: "0x885CD20Bb6C084808004449bC78392450fe11f98",
    STEALTH_KEY_REGISTRY_ADDRESS: "0x1234567890123456789012345678901234567890",
    RPC_URL: "https://eth-sepolia.g.alchemy.com/v2/YOUR_API_KEY",
  };
  
  const config: ContractConfig = {
    networks: {
      [env.NETWORK]: {
        paymentForwarder: env.PAYMENT_FORWARDER_ADDRESS,
        stealthKeyRegistry: env.STEALTH_KEY_REGISTRY_ADDRESS,
        rpcUrl: env.RPC_URL,
      },
    },
    defaultNetwork: env.NETWORK,
  };
  
  const plugin = new StealthPlugin(config);
  console.log("Configurazione da env:", plugin.getCurrentNetwork());
}

// Esempio 4: Configurazione per test
async function testConfigurationExample() {
  console.log("\n=== Esempio 4: Configurazione per test ===");
  
  const testConfig: ContractConfig = {
    networks: {
      TESTNET: {
        paymentForwarder: "0x0000000000000000000000000000000000000001",
        stealthKeyRegistry: "0x0000000000000000000000000000000000000002",
        rpcUrl: "http://localhost:8545",
      },
    },
    defaultNetwork: "TESTNET",
  };
  
  const plugin = new StealthPlugin(testConfig);
  console.log("Configurazione test:", plugin.getCurrentNetwork());
}

// Esempio 5: Aggiornamento dinamico della configurazione
async function dynamicUpdateExample() {
  console.log("\n=== Esempio 5: Aggiornamento dinamico ===");
  
  const plugin = new StealthPlugin();
  
  // Aggiorna la configurazione in runtime
  plugin.setContractConfig({
    networks: {
      UPDATED_SEPOLIA: {
        paymentForwarder: "0xNEW_PAYMENT_FORWARDER_ADDRESS",
        stealthKeyRegistry: "0xNEW_STEALTH_KEY_REGISTRY_ADDRESS",
        rpcUrl: "https://new-rpc-url.com",
      },
    },
    defaultNetwork: "UPDATED_SEPOLIA",
  });
  
  console.log("Configurazione aggiornata:", plugin.getCurrentNetwork());
}

// Funzione principale per eseguire tutti gli esempi
async function runExamples() {
  try {
    await basicConfigurationExample();
    await dynamicConfigurationExample();
    await environmentConfigurationExample();
    await testConfigurationExample();
    await dynamicUpdateExample();
    
    console.log("\n=== Tutti gli esempi completati con successo ===");
  } catch (error) {
    console.error("Errore durante l'esecuzione degli esempi:", error);
  }
}

// Esporta la funzione principale
export { runExamples };

// Se eseguito direttamente
if (require.main === module) {
  runExamples();
} 