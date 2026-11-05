import { expect, it } from "vitest";
import {
  decodeMetadata,
  emptyMetadata,
  encodeMetadata,
} from "../../src/metadata";

it("round-trips Unicode Authoring Source and simplification in deterministic schema-v1 metadata", () => {
  const envelope = emptyMetadata();
  envelope.documents["b"] = {
    targetLabel: "text1",
    source: 'λ✓漢字 "quoted" \\alpha\n@a@',
    simplify: false,
    compiledFingerprint: "sha256:abc",
  };
  const encoded = encodeMetadata(envelope);
  expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
  expect(decodeMetadata(encoded)).toEqual(envelope);
  expect(encodeMetadata(decodeMetadata(encoded)!)).toBe(encoded);
  expect(decodeMetadata("!!!")).toBeNull();
});
