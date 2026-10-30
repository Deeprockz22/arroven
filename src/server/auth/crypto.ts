import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";

export const sha256 = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");
export const newToken = () => randomBytes(32).toString("base64url");
export const hashPassword = (pw: string) => bcrypt.hash(pw, 12);
export const verifyPassword = (pw: string, hash: string) => bcrypt.compare(pw, hash);

let dummy: Promise<string> | undefined;
/** A real hash to compare against when an account does not exist, so timing does not reveal accounts. */
export const dummyHash = () => (dummy ??= bcrypt.hash("not-a-real-password", 12));
