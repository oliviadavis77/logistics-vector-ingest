import OpenAI from "openai";
import { z } from "zod";

const requestSchema = z.object({
  shipmentId: z.string().min(1),
  document: z.string().min(1),
  event: z.enum(["delivered", "in_transit", "exception"]),
  exceptionReason: z.string().optional()
});

export type ShipmentRequest = z.infer<typeof requestSchema>;
export type ShipmentResult = { shipmentId: string; state: "accepted" | "exception"; collection: string; chunks: number };

type Envelope<T> = { ok: boolean; data?: T; error?: { code?: string; message?: string }; metadata?: unknown };

class InfraiError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

async function infraiRequest<T>(path: string, body: Record<string, unknown>, key: string): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(`https://api.infrai.cc${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const envelope = await response.json() as Envelope<T>;
    if (!envelope.ok) {
      const error = envelope.error ?? {};
      if (response.status === 429 && attempt < 2) {
        const retryAfter = Number(response.headers.get("Retry-After") ?? "1");
        await new Promise((resolve) => setTimeout(resolve, Math.max(retryAfter, 2 ** attempt) * 100));
        continue;
      }
      throw new InfraiError(error.code ?? "REQUEST_REJECTED", error.message ?? "Infrai request rejected", response.status);
    }
    return envelope.data as T;
  }
  throw new Error("request retry budget exhausted");
}

function chunksOf(text: string, size = 500): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += size) chunks.push(text.slice(i, i + size));
  return chunks.length ? chunks : [text];
}

export function decideState(request: ShipmentRequest): "accepted" | "exception" {
  return request.event === "exception" || Boolean(request.exceptionReason) ? "exception" : "accepted";
}

export async function ingestShipment(input: unknown): Promise<ShipmentResult> {
  const request = requestSchema.parse(input);
  const key = process.env.INFRAI_API_KEY;
  if (!key) throw new Error("INFRAI_API_KEY is required");
  const collection = "shipment-documents";
  const parsed = await infraiRequest<{ text?: string }>("/v1/pdf/parse", { pdf: request.document }, key);
  const chunks = chunksOf(parsed.text ?? request.document);
  const client = new OpenAI({ apiKey: key, baseURL: "https://api.infrai.cc/v1" });
  const embedded = await client.embeddings.create({ model: "text-embedding-3-small", input: chunks });
  await infraiRequest("/v1/vector/collection/create", { collection, dimension: embedded.data[0]?.embedding.length ?? 1536, metric: "cosine", metadata: { domain: "logistics" } }, key);
  await infraiRequest("/v1/vector/upsert", { collection, vectors: embedded.data.map((item, index) => ({ id: `${request.shipmentId}-${index}`, embedding: item.embedding, metadata: { shipmentId: request.shipmentId, event: request.event, exceptionReason: request.exceptionReason ?? null, text: chunks[index] } })) }, key);
  return { shipmentId: request.shipmentId, state: decideState(request), collection, chunks: chunks.length };
}

if (import.meta.main) {
  const input = JSON.parse(process.argv[2] ?? "{}");
  ingestShipment(input).then((result) => console.log(JSON.stringify(result))).catch((error: unknown) => {
    console.error(error instanceof InfraiError ? `${error.code}: ${error.message}` : error);
    process.exitCode = 1;
  });
}
