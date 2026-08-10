import crypto from "node:crypto";

export function generateUuid() {
  // Node 18+ provides randomUUID; fall back to hex if needed.
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return crypto.randomBytes(16).toString("hex");
}

