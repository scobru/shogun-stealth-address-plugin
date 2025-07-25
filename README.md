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

## 📝 Esempio di Utilizzo

```typescript
// Inizializza il plugin
const stealthPlugin = new StealthPlugin();
await stealthPlugin.initialize(core);

// Metodo 1: Usa firma wallet (default)
const keys1 = await stealthPlugin.getUserStealthKeys();

// Metodo 2: Usa firma SEA (più sicuro)
const keys2 = await stealthPlugin.getUserStealthKeysWithSEA();

// Entrambi i metodi restituiscono le stesse chiavi per lo stesso utente
console.log(keys1.viewingKey.publicKey === keys2.viewingKey.publicKey); // true
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

## 🚨 Note Importanti

- Le chiavi sono generate deterministicamente, quindi **non cambiano mai** per lo stesso utente
- La sincronizzazione è automatica e trasparente
- Il fallback è gestito automaticamente se un metodo non è disponibile
- Le chiavi private sono sempre mantenute sicure e non esposte
- **Codice ottimizzato**: Tutti i metodi usano lo stesso algoritmo di base
