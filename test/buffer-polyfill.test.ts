import { Buffer } from "../src/buffer-polyfill";

describe("Buffer Polyfill", () => {
  test("should create Buffer from hex string", () => {
    const hexString = "0123456789abcdef";
    const buffer = Buffer.from(hexString, "hex");

    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBe(8);
    expect(buffer.toString("hex")).toBe(hexString);
  });

  test("should create Buffer from string", () => {
    const testString = "Hello World";
    const buffer = Buffer.from(testString, "utf8");

    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBe(11);
    expect(buffer.toString("utf8")).toBe(testString);
  });

  test("should be available globally", () => {
    // Verifica che Buffer sia disponibile globalmente
    expect(typeof globalThis.Buffer).toBe("function");
    expect(typeof (globalThis as any).Buffer.from).toBe("function");
  });

  test("should handle Buffer.isBuffer", () => {
    const buffer = Buffer.from("test");
    const notBuffer = "not a buffer";

    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(Buffer.isBuffer(notBuffer)).toBe(false);
  });
});
