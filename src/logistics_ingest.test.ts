import assert from "node:assert/strict";
import { decideState } from "./logistics_ingest.ts";

assert.equal(decideState({ shipmentId: "S-1", document: "pod.pdf", event: "delivered" }), "accepted");
assert.equal(decideState({ shipmentId: "S-2", document: "pod.pdf", event: "exception", exceptionReason: "damaged seal" }), "exception");
console.log("shipment state decisions: ok");
