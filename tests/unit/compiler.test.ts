import { describe, expect, it } from "vitest";
import {
  PURE_FUNCTIONS,
  SAFE_COMMANDS,
  compileSource,
  rewriteGlobalReferences,
} from "../../src/compiler";

const symbols = [
  { label: "a", type: "number", defined: true },
  { label: "b", type: "number", defined: true },
  { label: "λ_1", type: "number", defined: true },
];

const compile = (source: string, simplify = true) =>
  compileSource(source, { simplify, symbols });

describe("v1 Authoring Source", () => {
  it("rewrites only proven global references during a rename", () => {
    const source = 'literal a @a+Text("a")@ @Name(a)@ @x@ @a_1@';
    const result = rewriteGlobalReferences(source, "a", "renamed", [
      ...symbols,
      { label: "a_1", type: "number", defined: true },
    ]);
    expect(result.source).toBe(
      'literal a @renamed+Text("a")@ @Name(renamed)@ @x@ @a_1@',
    );
    expect(result.ambiguous).toEqual([]);
  });

  it("leaves ambiguous coordinate names unchanged and asks for manual resolution", () => {
    const result = rewriteGlobalReferences("@x+a@", "x", "u", [
      ...symbols,
      { label: "x", type: "number", defined: true },
    ]);
    expect(result.source).toBe("@x+a@");
    expect(result.ambiguous).toEqual([{ from: 1, to: 2 }]);
  });

  it("keeps pure function names and invalid expressions unchanged during rename", () => {
    const functionName = rewriteGlobalReferences("@sin(a)@", "sin", "wave", [
      ...symbols,
      { label: "sin", type: "function", defined: true },
    ]);
    expect(functionName).toEqual({ source: "@sin(a)@", ambiguous: [] });
    const invalid = rewriteGlobalReferences("@a+unknown@", "a", "b", symbols);
    expect(invalid.source).toBe("@a+unknown@");
    expect(invalid.ambiguous).toEqual([{ from: 1, to: 2 }]);
  });

  it("does not guess at local variables in an unsupported binding command", () => {
    const result = rewriteGlobalReferences("@Sequence(a+n,n,1,3)@", "n", "m", [
      ...symbols,
      { label: "n", type: "number", defined: true },
    ]);
    expect(result.source).toBe("@Sequence(a+n,n,1,3)@");
    expect(result.ambiguous).toEqual([
      { from: 12, to: 13 },
      { from: 14, to: 15 },
    ]);
  });
  it("compiles empty and literal-only source without evaluating it", () => {
    expect(compile("").expression).toBe('FormulaText(Simplify(""))');
    expect(compile("x^2").expression).toBe('FormulaText(Simplify("x^2"))');
  });

  it("compiles paired and adjacent interpolations with one outer simplification", () => {
    const result = compile("@a@@b@", false);
    expect(result.expression).toBe(
      "FormulaText(FormulaText((a))+FormulaText((b)))",
    );
    expect(result.segments.map(({ kind }) => kind)).toEqual([
      "interpolation",
      "interpolation",
    ]);
    expect(result.references.map(({ label }) => label)).toEqual(["a", "b"]);
  });

  it("treats doubled at signs as literal outside an interpolation", () => {
    expect(compile("a@@b @a@ @@").expression).toBe(
      'FormulaText(Simplify("a@b "+FormulaText((a))+" @"))',
    );
  });

  it("returns exact delimiter and empty-expression ranges", () => {
    expect(compile("abc@").diagnostics).toMatchObject([
      { code: "unmatched-interpolation", from: 3, to: 4 },
    ]);
    expect(compile("@   @").diagnostics).toMatchObject([
      { code: "empty-interpolation", from: 0, to: 5 },
    ]);
    expect(compile("a@b@c@").diagnostics).toMatchObject([
      { code: "unmatched-interpolation", from: 5, to: 6 },
    ]);
    expect(compile("abc@").expression).toBeNull();
  });

  it("normalizes physical newlines but preserves explicit LaTeX breaks and backslashes", () => {
    const result = compile("\\alpha\\\\\r\n@a +\rb@\n\\beta", false);
    expect(result.normalizedSource).toBe("\\alpha\\\\\n@a +\nb@\n\\beta");
    expect(result.expression).toBe(
      'FormulaText("\\alpha\\\\ "+FormulaText((a + b))+" \\beta")',
    );
  });

  it("splits ASCII quotes into UnicodeToLetter terms", () => {
    expect(compile('say "hi"', false).expression).toBe(
      'FormulaText("say "+UnicodeToLetter(34)+"hi"+UnicodeToLetter(34))',
    );
  });

  it("compiles the quadratic example from the accepted specification", () => {
    const source =
      "@a@ x^2 + @b@ x = @a@ \\left( x^2 + @FractionText(b/a)@ x \\right)";
    expect(compile(source).expression).toBe(
      'FormulaText(Simplify(FormulaText((a))+" x^2 + "+FormulaText((b))+" x = "+FormulaText((a))+" \\left( x^2 + "+FormulaText((FractionText(b/a)))+" x \\right)"))',
    );
  });

  it("rejects unknown, action, assignment, and missing references without evaluation", () => {
    expect(compile("@Delete(a)@").diagnostics[0]?.code).toBe("unsafe-command");
    expect(compile("@Mystery(a)@").diagnostics[0]?.code).toBe(
      "unknown-command",
    );
    expect(compile("@a=2@").diagnostics[0]?.code).toBe("assignment");
    expect(compile("@missing@").diagnostics[0]?.code).toBe(
      "unresolved-reference",
    );
    expect(compile("@missing@").expression).toBeNull();
  });

  it("reports undefined references as warnings and ignores names inside strings", () => {
    const result = compileSource('@If(true, "missing", λ_1)@', {
      simplify: false,
      symbols: [...symbols, { label: "λ_1", type: "number", defined: false }],
    });
    expect(result.diagnostics).toMatchObject([
      { code: "undefined-value", severity: "warning" },
    ]);
    expect(result.references.map(({ label }) => label)).toEqual(["λ_1"]);
    expect(result.expression).not.toBeNull();
  });

  it("uses original offsets for references even across CRLF", () => {
    expect(compile("@a +\r\nb@").references).toMatchObject([
      { label: "a", from: 1, to: 2 },
      { label: "b", from: 6, to: 7 },
    ]);
  });

  it("resolves exact Unicode and braced-subscript labels from the symbol snapshot", () => {
    const result = compileSource("@λ_1@ + @A_{AB}@ + @𐐀@", {
      simplify: false,
      symbols: [
        ...symbols,
        { label: "A_{AB}", type: "point", defined: true },
        { label: "𐐀", type: "number", defined: true },
      ],
    });
    expect(result.diagnostics).toEqual([]);
    expect(result.references.map(({ label }) => label)).toEqual([
      "λ_1",
      "A_{AB}",
      "𐐀",
    ]);
  });

  it("validates nested calls and supported overloads recursively", () => {
    expect(
      compile("@If(true, FractionText(a/b), b)@").expression,
    ).not.toBeNull();
    expect(
      compile("@If(true, Delete(a), b)@").diagnostics.map(({ code }) => code),
    ).toContain("unsafe-command");
    expect(
      compile("@FormulaText(a,true,false)@").diagnostics.map(
        ({ code }) => code,
      ),
    ).not.toContain("unsupported-overload");
  });

  it("rejects nested assignments and malformed operator or argument sequences", () => {
    for (const source of [
      "@a:=2@",
      "@If(true,a=2,b)@",
      "@a+*b@",
      "@If(true,,b)@",
      "@If(true,a,)@",
      "@1.2.3@",
      "@()@",
      "@( )@",
      "@[]@",
    ])
      expect(compile(source).expression, source).toBeNull();
  });

  it("reports inherited JavaScript names as unknown commands instead of crashing", () => {
    for (const name of ["constructor", "toString", "__proto__"])
      expect(compile(`@${name}(a)@`).diagnostics[0]?.code).toBe(
        "unknown-command",
      );
  });

  it("supports safe Text boolean overload while rejecting positioned Text", () => {
    expect(compile("@Text(a, true)@").expression).not.toBeNull();
    expect(compile("@Text(a, (1, 2))@").expression).toBeNull();
  });

  it("accepts the curated single-result command forms", () => {
    const forms = [
      "FormulaText(a)",
      "FormulaText(a,true)",
      "FormulaText(a,true,true)",
      "FractionText(a)",
      "FractionText(a,true)",
      "SurdText(a)",
      "SurdText(a,{a})",
      "ScientificText(a)",
      "ScientificText(a,5)",
      "TableText({a})",
      "TableText({a},{b})",
      'TableText({a},{b},"v")',
      'TableText({a},"v")',
      "TableText({a},{b},{a})",
      'VerticalText("a")',
      "Ordinal(a)",
      "UnicodeToLetter(65)",
      "Name(a)",
      "Text(a)",
      "Text(a,true)",
      "Simplify(a)",
      "If(true,a)",
      "If(true,a,b)",
    ];
    for (const expression of forms)
      expect(compile(`@${expression}@`).expression, expression).not.toBeNull();
  });

  it("accepts every v1 pure function and rejects unsupported function arities", () => {
    const binary = new Set(["atan2", "gammaRegularized", "beta"]);
    const ternary = new Set(["betaRegularized"]);
    for (const name of PURE_FUNCTIONS) {
      const args = ternary.has(name) ? "1,2,3" : binary.has(name) ? "1,2" : "1";
      expect(compile(`@${name}(${args})@`).expression, name).not.toBeNull();
      expect(compile(`@${name}()@`).expression, name).toBeNull();
    }
    expect(compile("@log(2,8)@").expression).not.toBeNull();
    expect(compile("@round(1.234,2)@").expression).not.toBeNull();
    expect(compile("@beta(1,2,3)@").expression).not.toBeNull();
    expect(compile("@sin(1,2)@").diagnostics.map((d) => d.code)).toContain(
      "unsupported-overload",
    );
  });

  it("compiles the documented arcos spelling to the pinned runtime's acos spelling", () => {
    expect(compile("@arcos(a)@").expression).toBe(
      "FormulaText(Simplify(FormulaText((acos(a)))))",
    );
    expect(compile('@Text("arcos(a)")@').expression).toContain(
      'Text("arcos(a)")',
    );
  });

  it("checks nested command overloads and boolean arguments at their own depth", () => {
    for (const source of [
      "@FormulaText(a, a)@",
      "@FractionText(a, a)@",
      "@FormulaText(a, true, a)@",
      "@Text(a, If(true, a, b))@",
      "@If(true, FractionText(a, true, false), b)@",
      "@TableText(a,true)@",
      "@ScientificText(FractionText(a))@",
    ])
      expect(compile(source).expression, source).toBeNull();
    expect(
      compile("@FormulaText(a, If(a>0,true,false))@").expression,
    ).not.toBeNull();
  });

  it("rejects every unsupported operation even when deeply nested", () => {
    for (const operation of [
      "Delete(a)",
      "SetValue(a, 2)",
      'Execute({"Delete(a)"})',
      "Intersect(a,b)",
      "Mystery(a)",
      "a:=2",
    ]) {
      const result = compile(`@If(true, FractionText(1), ${operation})@`);
      expect(result.expression, operation).toBeNull();
    }
  });

  it("recognizes different live object types and distinguishes missing from undefined", () => {
    const objects = [
      "number",
      "function",
      "point",
      "vector",
      "equation",
      "list",
      "matrix",
      "boolean",
      "text",
    ].map((type, index) => ({
      label: `object_${index}`,
      type,
      defined: index !== 6,
    }));
    const result = compileSource(
      `@${objects.map((o) => `FormulaText(${o.label})`).join('+" "+')}@`,
      {
        simplify: false,
        symbols: objects,
      },
    );
    expect(result.expression).not.toBeNull();
    expect(result.references.map((r) => r.label)).toEqual(
      objects.map((o) => o.label),
    );
    expect(result.diagnostics).toMatchObject([
      { code: "undefined-value", severity: "warning" },
    ]);
    expect(
      compileSource("@missing@", { simplify: false, symbols: objects })
        .diagnostics[0],
    ).toMatchObject({ code: "unresolved-reference", severity: "error" });
  });

  it("treats a live function object's call as one proven global reference", () => {
    const result = compileSource("@f(a)+sqrt(b)@", {
      simplify: false,
      symbols: [...symbols, { label: "f", type: "function", defined: true }],
    });
    expect(result.expression).not.toBeNull();
    expect(result.references.map((reference) => reference.label)).toEqual([
      "f",
      "a",
      "b",
    ]);
    expect(
      rewriteGlobalReferences("@f(a)@", "f", "g", [
        ...symbols,
        { label: "f", type: "function", defined: true },
      ]).source,
    ).toBe("@g(a)@");
  });

  it("requires one complete root value while allowing a list or point value", () => {
    expect(compile("@{a,b}@").expression).not.toBeNull();
    expect(compile("@(a,b)@").expression).not.toBeNull();
    expect(compile("@a,b@").expression).toBeNull();
    expect(compile("@If(true,{a,b},Intersect(a,b))@").expression).toBeNull();
  });

  it("keeps the documented catalog limited to the twelve approved commands", () => {
    expect(Object.keys(SAFE_COMMANDS)).toEqual([
      "FormulaText",
      "FractionText",
      "SurdText",
      "ScientificText",
      "TableText",
      "VerticalText",
      "Ordinal",
      "UnicodeToLetter",
      "Name",
      "Text",
      "Simplify",
      "If",
    ]);
  });

  it("preserves tabs, combining characters, and long literal lines", () => {
    const source = "e\u0301\t" + "x".repeat(10000) + "\\\\";
    const result = compile(source, false);
    expect(result.segments).toMatchObject([{ kind: "literal", text: source }]);
    expect(result.expression).toBe(`FormulaText("${source}")`);
  });

  it("has stable normalized fingerprint input", () => {
    expect(compile("a\r\nb").fingerprintInput).toBe(
      compile("a\nb").fingerprintInput,
    );
    expect(compile("a\nb", false).fingerprintInput).not.toBe(
      compile("a\nb").fingerprintInput,
    );
  });

  it("terminates and never emits a definition for malformed scanner input", () => {
    for (let length = 1; length < 200; length++) {
      const source = "x".repeat(length) + "@";
      const result = compile(source);
      expect(result.diagnostics[0]?.code).toBe("unmatched-interpolation");
      expect(result.expression).toBeNull();
    }
  });
});
