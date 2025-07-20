// Importa il polyfill di Buffer per prima cosa
import "./buffer-polyfill";

export { StealthPlugin } from "./stealthPlugin";
export { Stealth } from "./stealth";
export { BasePlugin } from "./base";
export type {
  StealthAddressResult,
  StealthData,
  StealthPluginInterface,
  StealthKeys,
  FluidkeySignature,
  GunStealthKeyMapping,
  StealthPayment,
  StealthPaymentNotification,
  PaymentForwarderConfig,
} from "./types";
export { log, logError, logWarn } from "./utils";
export { extractViewingPrivateKeyNode } from "@fluidkey/stealth-account-kit";
