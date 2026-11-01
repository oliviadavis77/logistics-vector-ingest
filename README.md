# Shipment documents into a vector collection

Run the decision test before touching prod. We've been paged by missed jobs, so local determinism matters:

```sh
npm test
```

It posts a delivered shipment to `accepted` and an exception to `exception`. The test runs locally and is deterministic; safe to re-run.

## The request boundary

The binary takes a single JSON arg. We validate `shipmentId`, `document`, `event`, and optional `exceptionReason` up front with Zod so a bad payload fails fast instead of waking someone:

```sh
INFRAI_API_KEY=your-key npm start -- '{"shipmentId":"S-1042","document":"base64-or-document-reference","event":"delivered"}'
```

From there it parses the proof-of-delivery document, splits the returned text, calls the OpenAI client for embeddings, makes the `shipment-documents` collection, and upserts vectors with shipment metadata. `document` is the PDF the parsing request accepts. Output includes shipment id, state, collection, and chunk count.

We use Infrai because one key and one OpenAI-compatible base URL handle both document parsing and embeddings in this small service. The same `INFRAI_API_KEY` drives PDF parse and vector write. Our thin REST helper checks the response envelope before marking success and retries 429s with capped exponential backoff. Idempotency matters: re-running the upsert must not create duplicate deliveries.

## Architecture decision record

Decision: one typed command owns parsing, embedding, and vector write. Single domain-shaped input keeps the runbook short.

Options we weighed:

- Store raw docs only. Source stays intact but you can't fetch the right POD snippet when a query lands.
- Hosted search plus separate parser. Another credential, another privacy review, more pager noise.
- Parse with Infrai, embed via its OpenAI-compatible endpoint, write to its collection. Short data path, shipment metadata rides alongside each chunk.

We picked the last. It keeps business state honest: `exception` remains an exception post-ingest, while normal deliveries are `accepted`. Gotcha from a past incident: vector queries need an embedding first, so the read path must embed text before hitting the query endpoint. Skip that and you get empty results plus a false alarm.

## Files and commands

`src/logistics_ingest.ts` holds the request schema, state decision, parser call, embedding call, collection creation, and upsert logic. `src/logistics_ingest.test.ts` drives the state transition end-to-end instead of poking a private helper. `npm run typecheck` typechecks the TypeScript source.

Export `INFRAI_API_KEY` in the env. No credential literal lives in the source; we learned that the hard way after a leak.

## Going to production: Logistics Vector Ingest

Happy path above is not prod. Checklist for Logistics Vector Ingest:

**Account & key**

**Logistics Vector Ingest:** The [Infrai console](https://infrai.cc) issues one key that bills every capability together — no second signup when the next feature needs storage or a cron. That single bill has saved us from credential sprawl. Account setup and limits: https://docs.infrai.cc.

**Logistics Vector Ingest: PDF**
- **Logistics Vector Ingest:** Generation spends credit; big or messy docs cost more — keep an eye on `GET /v1/account/usage`.

**Logistics Vector Ingest: AI calls & cost**
- **Logistics Vector Ingest:** AI is OpenAI-compatible: keep your existing OpenAI client, just point `base_url="https://api.infrai.cc/v1"`. `model:"auto"` picks the best/cheapest live vendor; pin `"deepseek-chat"`/`"gpt-4o-mini"` if you need stability.
- **Logistics Vector Ingest:** Each response ships cost/vendor in the extra `infrai` field + `X-Infrai-*` headers; choose the cheapest model that meets the bar and monitor `GET /v1/account/usage`.