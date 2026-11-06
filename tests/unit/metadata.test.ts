import { expect, it } from "vitest";
import {
  decodeMetadata,
  emptyMetadata,
  encodeMetadata,
  inspectMetadata,
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

it("accepts only canonical unpadded base64url and exact v1 schema fields", () => {
  const encoded = encodeMetadata(emptyMetadata());
  expect(decodeMetadata(`${encoded}=`)).toBeNull();
  expect(decodeMetadata(encoded.slice(0, -1))).toBeNull();
  const extra = { ...emptyMetadata(), unexpected: true };
  const bytes = new TextEncoder().encode(JSON.stringify(extra));
  expect(decodeMetadata(Buffer.from(bytes).toString("base64url"))).toBeNull();
});

it("serializes documents in stable key and field order", () => {
  const first = emptyMetadata();
  first.documents.z = {
    targetLabel: "text2",
    source: "second",
    simplify: false,
    compiledFingerprint: "sha256:z",
  };
  first.documents.a = {
    targetLabel: "text1",
    source: "first",
    simplify: true,
    compiledFingerprint: "sha256:a",
  };
  const second = emptyMetadata();
  second.documents.a = {
    compiledFingerprint: "sha256:a",
    simplify: true,
    source: "first",
    targetLabel: "text1",
  };
  second.documents.z = {
    compiledFingerprint: "sha256:z",
    simplify: false,
    source: "second",
    targetLabel: "text2",
  };
  expect(encodeMetadata(first)).toBe(encodeMetadata(second));
});

it("recognizes and migrates the supported schema zero without losing source", () => {
  const legacy = {
    application: "geogebra-latex-editor",
    schemaVersion: 0,
    documents: {
      one: {
        targetLabel: "text1",
        source: "λ✓漢字 \\alpha",
        compiledFingerprint: "sha256:abc",
      },
    },
  };
  const original = Buffer.from(JSON.stringify(legacy)).toString("base64url");
  expect(inspectMetadata(original)).toEqual({
    kind: "older",
    envelope: {
      ...emptyMetadata(),
      documents: {
        one: { ...legacy.documents.one, simplify: false },
      },
    },
  });
});

it("classifies unknown newer formats without rewriting their bytes", () => {
  const bytes = Buffer.from(
    JSON.stringify({
      application: "geogebra-latex-editor",
      schemaVersion: 2,
      languageVersion: 1,
      documents: {},
      future: "preserve me",
    }),
  ).toString("base64url");
  expect(inspectMetadata(bytes)).toEqual({ kind: "newer" });
  expect(decodeMetadata(bytes)).toBeNull();
  const padded = Buffer.from(bytes, "base64url").toString("base64");
  expect(inspectMetadata(padded)).toEqual({ kind: "newer" });
  expect(decodeMetadata(padded)).toBeNull();
  const standard = Buffer.from(
    JSON.stringify({
      application: "geogebra-latex-editor",
      schemaVersion: 2,
      languageVersion: 1,
      documents: {},
      future: "😀",
    }),
  ).toString("base64");
  expect(standard).toContain("+");
  expect(inspectMetadata(standard)).toEqual({ kind: "newer" });
});

it("round-trips at least 1 MiB of JSON and 100 managed records", () => {
  const envelope = emptyMetadata();
  for (let index = 0; index < 100; index++) {
    envelope.documents[`record-${index}`] = {
      targetLabel: `text${index}`,
      source: index === 0 ? "漢字".repeat(550_000) : `source ${index}`,
      simplify: index % 2 === 0,
      compiledFingerprint: `sha256:${index}`,
    };
  }
  expect(JSON.stringify(envelope).length).toBeGreaterThan(1024 * 1024);
  expect(decodeMetadata(encodeMetadata(envelope))).toEqual(envelope);
});
