import { randomBytes } from "node:crypto";
import { setKeyProvider, EnvKeyProvider } from "@/server/crypto/keyProvider";

// Unit tests get throwaway keys; they never read .env.
setKeyProvider(
  new EnvKeyProvider({
    PII_KEYRING: JSON.stringify({ test1: randomBytes(32).toString("base64") }),
    PII_ACTIVE_KEY_ID: "test1",
    PII_BLIND_INDEX_KEY: randomBytes(32).toString("base64"),
    TOKEN_KEY: randomBytes(32).toString("base64"),
  }),
);
