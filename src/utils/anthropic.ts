import Anthropic from "@anthropic-ai/sdk";

const clientCache = new Map<string, Anthropic>();

export function getClient(apiKey: string): Anthropic {
  let client = clientCache.get(apiKey);
  if (!client) {
    client = new Anthropic({ apiKey });
    clientCache.set(apiKey, client);
  }
  return client;
}
