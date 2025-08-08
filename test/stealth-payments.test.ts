import { StealthPlugin } from "../src/stealthPlugin";
import { ethers } from "ethers";

// A fluent mock for GunDB that allows chained calls.
const mockGun = {
  user: () => mockGun,
  get: (path: string) => mockGun,
  put: (data: any, callback?: (ack: { err: Error | null }) => void) => {
    if (callback) {
      callback({ err: null });
    }
    return mockGun;
  },
  once: (callback: (data: any) => void) => {
    // Simulate finding nothing by returning null
    callback(null);
    return mockGun;
  },
  on: (callback: (data: any, key: string) => void) => {
    // Do nothing for 'on' subscriptions in this mock
    return mockGun;
  },
  // Needed for the user() call chain
  is: { pub: "test-user-pub" },
};

// Mock provider and signer
const mockProvider = {
  getNetwork: async () => ({ chainId: 11155111n }), // Sepolia
};

const mockSigner = {
  getAddress: async () => "0x1234567890123456789012345678901234567890",
};

describe("StealthPlugin Payment Tests", () => {
  let plugin: StealthPlugin;

  beforeEach(() => {
    plugin = new StealthPlugin();
    plugin.initialize({
      gun: mockGun,
      provider: mockProvider,
      signer: mockSigner,
    });
  });

  test("should initialize with payment support", () => {
    expect(plugin).toBeDefined();
    expect(plugin.name).toBe("stealth");
  });

  test("should get user stealth keys", async () => {
    const keys = await plugin.getUserStealthKeys();
    expect(keys).toBeDefined();
    expect(keys).not.toBeNull();
    expect(keys!.viewingKey).toBeDefined();
    expect(keys!.spendingKey).toBeDefined();
  });

  test("should generate stealth address", async () => {
    const viewingKey =
      "0x1234567890123456789012345678901234567890123456789012345678901234";
    const spendingKey =
      "0xabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd";

    const result = await plugin.generateStealthAddress(viewingKey, spendingKey);

    expect(result).toBeDefined();
    expect(result.stealthAddress).toBeDefined();
    expect(result.ephemeralPublicKey).toBeDefined();
  });

  test("should get public stealth keys", async () => {
    const keys = await plugin.getPublicStealthKeys("test-recipient-pub");
    expect(keys).toBeNull(); // Should be null for non-existent keys
  });

  test("should get stealth payment history", async () => {
    const history = await plugin.getStealthPaymentHistory();
    expect(Array.isArray(history)).toBe(true);
  });
});

describe("Stealth Payment Flow", () => {
  test("should simulate complete payment flow", async () => {
    // This test simulates the complete flow without actually sending transactions
    const plugin = new StealthPlugin();
    plugin.initialize({
      gun: mockGun,
      provider: mockProvider,
      signer: mockSigner,
    });

    // 1. Generate keys for sender and recipient
    const senderKeys = await plugin.getUserStealthKeys();
    const recipientKeys = await plugin.getUserStealthKeys();

    expect(senderKeys).toBeDefined();
    expect(recipientKeys).toBeDefined();
    expect(recipientKeys).not.toBeNull();


    // 2. Generate stealth address
    const stealthResult = await plugin.generateStealthAddress(
      recipientKeys!.viewingKey.publicKey,
      recipientKeys!.spendingKey.publicKey
    );

    expect(stealthResult.stealthAddress).toBeDefined();
    expect(stealthResult.ephemeralPublicKey).toBeDefined();

    // 3. Open stealth address (simulate recipient)
    const openedWallet = await plugin.openStealthAddress(
      stealthResult.stealthAddress,
      stealthResult.ephemeralPublicKey,
      recipientKeys!.viewingKey.privateKey,
      recipientKeys!.spendingKey.privateKey
    );

    expect(openedWallet).toBeDefined();
    expect(openedWallet.address.toLowerCase()).toBe(
      stealthResult.stealthAddress.toLowerCase()
    );
  });
});
