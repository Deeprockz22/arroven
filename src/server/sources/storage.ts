import fs from "node:fs/promises";
import path from "node:path";
import { sha256 } from "../auth/crypto";

/**
 * Original records are stored content-addressed and written once with read-only permissions.
 * Swap this module for object storage (S3 with Object Lock, or the customer's own store) in production.
 */
const root = () => path.resolve(/*turbopackIgnore: true*/ process.env.STORAGE_DIR ?? path.join(/*turbopackIgnore: true*/ process.cwd(), "storage"));

export async function putOriginal(orgId: string, bytes: Uint8Array): Promise<{ key: string; sha256: string }> {
  const hash = sha256(bytes);
  const key = `${orgId}/${hash}`;
  const file = path.join(/*turbopackIgnore: true*/ root(), key);
  await fs.mkdir(path.dirname(file), { recursive: true });
  try {
    await fs.writeFile(file, bytes, { flag: "wx", mode: 0o444 });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
  }
  return { key, sha256: hash };
}

export async function readOriginal(key: string): Promise<Buffer> {
  if (!/^[0-9a-f-]{36}\/[0-9a-f]{64}$/.test(key)) throw new Error("Invalid storage key");
  const buf = await fs.readFile(/*turbopackIgnore: true*/ path.join(/*turbopackIgnore: true*/ root(), key));
  if (sha256(buf) !== key.split("/")[1]) throw new Error("Stored original failed its integrity check");
  return buf;
}

/** Remove a stored file, such as a training export at the end of a pilot. Missing files are not an error. */
export async function deleteStored(key: string): Promise<void> {
  if (!/^[0-9a-f-]{36}\/[0-9a-f]{64}$/.test(key)) throw new Error("Invalid storage key");
  await fs.rm(/*turbopackIgnore: true*/ path.join(/*turbopackIgnore: true*/ root(), key), { force: true });
}
