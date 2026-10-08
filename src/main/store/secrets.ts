import { safeStorage } from "electron";

/**
 * Secrets are stored encrypted with the OS keychain-backed key (safeStorage).
 * The encrypted blob is base64 in the JSON files; it is useless off this Mac.
 */
export function seal(plain: string): string {
  if (!plain) return "";
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("OS encryption is unavailable, so secrets can't be stored safely.");
  }
  return safeStorage.encryptString(plain).toString("base64");
}

export function unseal(sealed: string | undefined): string {
  if (!sealed) return "";
  try {
    return safeStorage.decryptString(Buffer.from(sealed, "base64"));
  } catch {
    return "";
  }
}
