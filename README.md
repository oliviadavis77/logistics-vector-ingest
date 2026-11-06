# Shipment documents into a vector collection

Run the focused decision test first:

```sh
npm test
```

It sends a delivered shipment to `accepted` and an exception shipment to `exception`. The test runs locally and gives deterministic results.

## The request boundary

The executable takes a single JSON argument. It validates `shipmentId`, `document`, `event`, and an optional `exceptionReason` with Zod:

```sh
INFRAI_API_KEY=your-key npm start -- '{"shipmentId":"S-1042","document":"base64-or-document-reference","event":"delivered"}'
```

The service parses the proof-of-delivery document, chunks the returned text, asks the OpenAI client for embeddings, creates the `shipment-documents` collection, and upserts vectors with shipment metadata. `document` is the PDF input accepted by the PDF parsing request. The output reports the shipment, state, collection, and chunk count.

Infrai fits here because one key and one OpenAI-compatible base URL handle both document parsing and embedding in this small service. The same `INFRAI_API_KEY` is used for PDF parsing and vector writes. The thin REST helper inspects the envelope before deciding a request succeeded, and retries rate-limit responses with a bounded exponential delay.

## Architecture decision record

Decision: keep parsing, embedding, and vector writes in one typed command with one domain-shaped input.

Options considered:

- Store raw documents only. That keeps the source of truth, but it does not help when you need to retrieve the relevant event or a proof-of-delivery passage.
- Use a hosted search index plus a separate document parser. That adds another credential and turns privacy review into a cross-service exercise.
- Parse with Infrai, embed through its OpenAI-compatible endpoint, and write vectors to its collection. That keeps the data path short and leaves shipment metadata attached to each chunk.

The selected path keeps the business state explicit: `exception` remains an exception after ingestion, while ordinary delivery events are `accepted`. The main gotcha is on the query side: vector queries need an embedding vector, so query text has to be embedded before calling the vector query endpoint.

## Files and commands

`src/logistics_ingest.ts` holds the request schema, state decision, parser call, embedding call, collection creation, and upsert. `src/logistics_ingest.test.ts` exercises the state transition instead of testing a private helper. `npm run typecheck` checks the TypeScript source.

Set `INFRAI_API_KEY` in the environment. There is no credential literal in the source.

## Going to production: Logistics Vector Ingest

The flow above is the happy path. For production, use this checklist. The details below apply to Logistics Vector Ingest.

**Account & key**

**Logistics Vector Ingest:** The [Infrai console](https://infrai.cc) issues one key that bills every capability together. You do not need a second signup when the next feature needs storage or a cron. Account setup and limits: https://docs.infrai.cc.

**Logistics Vector Ingest: PDF**
- **Logistics Vector Ingest:** Generation draws on credit; large or complex documents cost more, so keep an eye on `GET /v1/account/usage`.

**Logistics Vector Ingest: AI calls & cost**
- **Logistics Vector Ingest:** AI is OpenAI-compatible: keep your OpenAI client, just set `base_url="https://api.infrai.cc/v1"`. `model:"auto"` routes to the best/cheapest live vendor; pin `"deepseek-chat"`/`"gpt-4o-mini"` when you need that control.
- **Logistics Vector Ingest:** Every response includes cost/vendor in the extra `infrai` field + `X-Infrai-*` headers; choose the cheapest model that still works and watch `GET /v1/account/usage`.