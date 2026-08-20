// Client-side Web Crypto helper functions for AES-256-GCM E2EE

export function bufToHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function hexToBuf(hex: string): ArrayBuffer {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes.buffer;
}

/**
 * Derives a 256-bit AES-GCM key from the Room Code and Salt using PBKDF2-SHA-256
 */
export async function deriveRoomKey(roomCode: string, saltHex: string): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const passwordBuffer = encoder.encode(roomCode.trim().toUpperCase());
  const saltBuffer = hexToBuf(saltHex);

  const baseKey = await window.crypto.subtle.importKey(
    "raw",
    passwordBuffer,
    "PBKDF2",
    false,
    ["deriveKey"]
  );

  return await window.crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: saltBuffer,
      iterations: 100000,
      hash: "SHA-256",
    },
    baseKey,
    {
      name: "AES-GCM",
      length: 256,
    },
    false, // key is non-extractable from memory
    ["encrypt", "decrypt"]
  );
}

/**
 * Encrypts plaintext string using AES-256-GCM
 */
export async function encryptText(key: CryptoKey, plaintext: string): Promise<{ ciphertext: string; iv: string }> {
  const encoder = new TextEncoder();
  const iv = window.crypto.getRandomValues(new Uint8Array(12)); // 96-bit IV
  
  const ciphertextBuffer = await window.crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: iv,
    },
    key,
    encoder.encode(plaintext)
  );

  return {
    ciphertext: bufToHex(ciphertextBuffer),
    iv: bufToHex(iv.buffer),
  };
}

/**
 * Decrypts hex ciphertext string using AES-256-GCM
 */
export async function decryptText(key: CryptoKey, ciphertextHex: string, ivHex: string): Promise<string> {
  const decoder = new TextDecoder();
  
  const plaintextBuffer = await window.crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: hexToBuf(ivHex),
    },
    key,
    hexToBuf(ciphertextHex)
  );

  return decoder.decode(plaintextBuffer);
}
