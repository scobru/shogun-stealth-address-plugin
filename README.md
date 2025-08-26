# Shogun Stealth Address Plugin

Plugin per la gestione delle funzionalità Stealth in ShogunCore con generazione deterministica delle chiavi.

## 🔐 Generazione Deterministica delle Stealth Keys

### **Problema Risolto**

- ❌ **Prima**: Le stealth keys erano generate casualmente con `ethers.Wallet.createRandom()`
- ❌ **Prima**: Non deterministiche → chiavi diverse ogni volta
- ❌ **Prima**: Usava l'indirizzo del wallet come seed (pubblico, non sicuro)

### **Soluzione Implementata**

- ✅ **Ora**: Le stealth keys sono generate dalla **firma del messaggio "I Love Shogun!"**
- ✅ **Ora**: Completamente deterministiche → stesse chiavi sempre per lo stesso wallet
- ✅ **Ora**: Sicuro perché la firma è privata e unica per ogni wallet
- ✅ **Ora**: **Codice ottimizzato** - usa `generateKeysFromSignature` come base unificata

## 🚀 Architettura Ottimizzata

### **Metodo Unificato**

Tutti i metodi di generazione delle chiavi utilizzano ora `generateKeysFromSignature` come base:

```typescript
// Metodo unificato che converte qualsiasi signature in FluidkeySignature
async generateStealthKeysFromStringSignature(signature: string): Promise<StealthKeys>
```

### **Flusso Ottimizzato**

1. **Input**: Signature string (wallet o SEA)
2. **Conversione**: String → FluidkeySignature format
3. **Generazione**: Usa `generateKeysFromSignature` (Fluidkey method)
4. **Fallback**: Se Fluidkey fallisce, usa metodo hash-based
5. **Output**: StealthKeys consistenti

## 💰 Sistema di Calcolo Fee Avanzato (Ispirato a Umbra Protocol)

### **Caratteristiche Principali**

- ✅ **Calcolo Fee Precise**: Stima accurata di gas e toll
- ✅ **Retry Logic Intelligente**: Sistema di retry ispirato a Umbra per L2 networks
- ✅ **Ottimizzazione L2**: Margini di sicurezza per costi L1 variabili
- ✅ **Breakdown Dettagliato**: Analisi completa dei costi

### **Nuove Funzioni**

#### **1. Calcolo Fee Avanzato**

```typescript
// Calcola fee complete per qualsiasi token
const fees = await stealthPlugin.calculateFees(
  ETH_TOKEN_PLACEHOLDER, // o indirizzo token
  ethers.parseEther("0.1").toString()
);

console.log("Fee Breakdown:", {
  baseAmount: ethers.formatEther(fees.breakdown.baseAmount) + " ETH",
  toll: ethers.formatEther(fees.breakdown.toll) + " ETH",
  gasEstimate: fees.breakdown.gasEstimate,
  gasPrice: ethers.formatGwei(fees.breakdown.gasPrice) + " gwei",
  totalGasCost: ethers.formatEther(fees.breakdown.totalGasCost) + " ETH",
  totalCost: ethers.formatEther(fees.totalCost) + " ETH",
});
```

#### **2. Withdrawal ETH Avanzato**

```typescript
// Withdrawal con retry logic ispirato a Umbra
const result = await stealthPlugin.withdrawStealthPaymentEnhanced(
  stealthAddress,
  recipientAddress,
  ephemeralPublicKey // opzionale
);

console.log("Withdrawal successful:", result.txHash);
```

### **Vantaggi del Sistema Avanzato**

1. **🎯 Precisione**: Stima accurata dei costi prima della transazione
2. **🔄 Affidabilità**: Retry automatico per errori di gas insufficiente
3. **⚡ Ottimizzazione L2**: Gestione intelligente dei costi L1 variabili
4. **📊 Trasparenza**: Breakdown completo di tutti i costi
5. **🛡️ Sicurezza**: Margini di sicurezza per evitare fallimenti

## 🚀 Metodi Disponibili

### **1. Metodi con Firma Wallet (Default)**

```typescript
// Genera chiavi usando la firma del messaggio "I Love Shogun!"
await stealthPlugin.getUserStealthKeys();
await stealthPlugin.createUserStealthKeys();
await stealthPlugin.generateAndSaveStealthKeys();
```

### **2. Metodi con Firma SEA (Più Sicuro)**

```typescript
// Genera chiavi usando la firma SEA del pair Gun connesso
await stealthPlugin.getUserStealthKeysWithSEA();
await stealthPlugin.createUserStealthKeysWithSEA();
await stealthPlugin.generateAndSaveStealthKeysWithSEA();
```

### **3. Nuovi Metodi di Calcolo Fee**

```typescript
// Calcolo fee avanzato
await stealthPlugin.calculateFees(token, amount);

// Withdrawal ETH con retry logic
await stealthPlugin.withdrawStealthPaymentEnhanced(
  stealthAddress,
  recipient,
  ephemeralKey
);
```

## 🔄 Flusso di Sincronizzazione

Il sistema implementa una sincronizzazione automatica intelligente:

1. **Prima**: Controlla GunDB per chiavi esistenti
2. **Se non trova**: Controlla on-chain per chiavi registrate
3. **Se non trova**: Genera nuove chiavi deterministicamente
4. **Sincronizzazione**: Automatica tra tutte le fonti

## 🛡️ Sicurezza

### **Firma Wallet (Default)**

- Usa la firma del messaggio "I Love Shogun!"
- Privata e unica per ogni wallet
- Compatibile con il sistema di autenticazione Shogun

### **Firma SEA (Raccomandato)**

- Usa la chiave privata SEA del pair Gun connesso
- Ancora più sicuro perché usa le credenziali GunDB direttamente
- Non dipende da wallet esterni

## 📝 Esempio di Utilizzo Completo

```typescript
// Inizializza il plugin
const stealthPlugin = new StealthPlugin();
await stealthPlugin.initialize(core);

// 1. Genera chiavi stealth
const keys = await stealthPlugin.getUserStealthKeysWithSEA();

// 2. Calcola fee per un pagamento
const fees = await stealthPlugin.calculateFees(
  ETH_TOKEN_PLACEHOLDER,
  ethers.parseEther("0.1").toString()
);

console.log("Costi stimati:", {
  importo: ethers.formatEther(fees.breakdown.baseAmount) + " ETH",
  toll: ethers.formatEther(fees.breakdown.toll) + " ETH",
  gas: ethers.formatEther(fees.breakdown.totalGasCost) + " ETH",
  totale: ethers.formatEther(fees.totalCost) + " ETH",
});

// 3. Invia pagamento stealth
const payment = await stealthPlugin.sendStealthPayment(
  recipientGunPub,
  ethers.parseEther("0.1").toString(),
  ETH_TOKEN_PLACEHOLDER,
  "Pagamento stealth"
);

// 4. Withdrawal con sistema avanzato
const withdrawal = await stealthPlugin.withdrawStealthPaymentEnhanced(
  payment.stealthAddress,
  recipientAddress
);

console.log("Pagamento completato:", withdrawal.txHash);
```

## 🔧 Configurazione

```typescript
// Configura la rete
stealthPlugin.setNetworkConfig("sepolia", {
  paymentForwarder: "0x...",
  stealthKeyRegistry: "0x...",
  rpcUrl: "https://...",
});

// Imposta provider e signer
stealthPlugin.setProviderAndSigner(provider, signer);
```

## 🎯 Vantaggi

1. **🔒 Sicurezza**: Chiavi private e deterministiche
2. **🔄 Consistenza**: Stesse chiavi sempre per lo stesso utente
3. **⚡ Sincronizzazione**: Automatica tra GunDB e on-chain
4. **🛡️ Compatibilità**: Con il sistema di autenticazione Shogun
5. **🎛️ Flessibilità**: Due metodi di generazione (Wallet e SEA)
6. **🧹 Codice Pulito**: DRY principle - nessuna duplicazione di codice
7. **🔧 Manutenibilità**: Un solo punto di generazione delle chiavi
8. **💰 Fee Avanzate**: Sistema di calcolo fee ispirato a Umbra Protocol
9. **🔄 Retry Logic**: Gestione intelligente degli errori di gas
10. **📊 Trasparenza**: Breakdown completo dei costi

## 🚨 Note Importanti

- Le chiavi sono generate deterministicamente, quindi **non cambiano mai** per lo stesso utente
- La sincronizzazione è automatica e trasparente
- Il fallback è gestito automaticamente se un metodo non è disponibile
- Le chiavi private sono sempre mantenute sicure e non esposte
- **Codice ottimizzato**: Tutti i metodi usano lo stesso algoritmo di base
- **Sistema Fee Avanzato**: Calcolo preciso e retry logic per massima affidabilità
- **Supporto L2**: Ottimizzazioni specifiche per reti Layer 2
