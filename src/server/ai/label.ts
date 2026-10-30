import { getProvider } from "./provider";

export function providerLabel() {
  const p = getProvider();
  return p.name === "model-service" ? `ARROVEN model service (${p.model})` : "Offline mock models";
}
