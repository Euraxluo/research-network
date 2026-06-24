// Browser entry bundled by esbuild into the static Walrus site.
// Exposes the minimal real zkLogin primitives on window so Account can derive a
// canonical Sui address client-side (no backend needed on a static host).
import { jwtToAddress, generateNonce, generateRandomness } from "@mysten/sui/zklogin";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";

(globalThis as unknown as { RN_ZK: unknown }).RN_ZK = {
  jwtToAddress: (jwt: string, salt: string) => jwtToAddress(jwt, salt, false),
  generateNonce,
  generateRandomness,
  newEphemeralKey: () => Ed25519Keypair.generate(),
  keypairFromSecret: (secret: string) => Ed25519Keypair.fromSecretKey(secret)
};
