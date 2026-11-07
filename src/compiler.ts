/** The pure v1 Authoring Source compiler. All ranges use offsets in the input source. */
export interface SourceRange {
  from: number;
  to: number;
}

export type SourceSegment =
  | (SourceRange & { kind: "literal"; text: string })
  | (SourceRange & { kind: "interpolation"; expression: string });

export interface Diagnostic extends SourceRange {
  code: string;
  severity: "error" | "warning";
  message: string;
}

export interface SymbolInfo {
  label: string;
  type: string;
  defined: boolean;
}

export interface Reference extends SourceRange {
  label: string;
}

export interface CommandCatalogEntry {
  overloads: readonly {
    arity: number;
    argumentKinds?: readonly (
      "value" | "boolean" | "list" | "text" | "number"
    )[];
    localBindings: readonly number[];
  }[];
  result: "single";
}

const forms = (...arities: number[]): CommandCatalogEntry => ({
  result: "single",
  overloads: arities.map((arity) => ({ arity, localBindings: [] })),
});
const typedForm = (
  ...argumentKinds: ("value" | "boolean" | "list" | "text" | "number")[]
) => ({ arity: argumentKinds.length, argumentKinds, localBindings: [] });

// Intentionally conservative. These are the single-result forms supported in v1.
export const SAFE_COMMANDS: Readonly<Record<string, CommandCatalogEntry>> = {
  FormulaText: {
    result: "single",
    overloads: [
      typedForm("value"),
      typedForm("value", "boolean"),
      typedForm("value", "boolean", "boolean"),
    ],
  },
  FractionText: {
    result: "single",
    overloads: [typedForm("value"), typedForm("value", "boolean")],
  },
  SurdText: {
    result: "single",
    overloads: [typedForm("value"), typedForm("number", "list")],
  },
  ScientificText: {
    result: "single",
    overloads: [typedForm("number"), typedForm("number", "number")],
  },
  TableText: {
    result: "single",
    overloads: [
      typedForm("list"),
      typedForm("list", "list"),
      typedForm("list", "text"),
      typedForm("list", "list", "list"),
      typedForm("list", "list", "text"),
    ],
  },
  VerticalText: forms(1),
  Ordinal: forms(1),
  UnicodeToLetter: forms(1),
  Name: forms(1),
  Text: {
    result: "single",
    overloads: [typedForm("value"), typedForm("value", "boolean")],
  },
  Simplify: forms(1),
  If: {
    result: "single",
    overloads: [
      typedForm("boolean", "value"),
      typedForm("boolean", "value", "value"),
    ],
  },
};

export const PURE_FUNCTIONS = [
  "abs",
  "sgn",
  "sqrt",
  "exp",
  "log",
  "ln",
  "ld",
  "lg",
  "cos",
  "sin",
  "tan",
  "acos",
  "arcos",
  "arccos",
  "asin",
  "arcsin",
  "atan",
  "arctan",
  "atan2",
  "cosh",
  "sinh",
  "tanh",
  "acosh",
  "arcosh",
  "arccosh",
  "asinh",
  "arcsinh",
  "atanh",
  "arctanh",
  "erf",
  "floor",
  "ceil",
  "round",
  "conjugate",
  "arg",
  "gamma",
  "gammaRegularized",
  "beta",
  "betaRegularized",
  "sec",
  "csc",
  "cosec",
  "cot",
  "sech",
  "csch",
  "coth",
] as const;

const UNSAFE_COMMANDS = new Set([
  "Delete",
  "SetValue",
  "Execute",
  "RunClickScript",
  "RunUpdateScript",
  "StartAnimation",
  "SetCoords",
  "Rename",
  "CopyFreeObject",
  "Intersect",
]);
export const VALUE_CONSTANTS = [
  "x",
  "y",
  "z",
  "true",
  "false",
  "π",
  "ℯ",
  "ί",
  "i",
  "e",
] as const;
const CONSTANTS = new Set<string>(VALUE_CONSTANTS);
const FUNCTIONS = new Set<string>(PURE_FUNCTIONS);
const FUNCTION_ARITIES: Readonly<Record<string, readonly number[]>> = {
  atan2: [2],
  gamma: [1, 2],
  gammaRegularized: [2],
  beta: [2, 3],
  betaRegularized: [3],
  log: [1, 2],
  round: [1, 2],
};

export interface CompileOptions {
  simplify: boolean;
  symbols: readonly SymbolInfo[];
  commands?: Readonly<Record<string, CommandCatalogEntry>>;
}

export interface CompileResult {
  normalizedSource: string;
  segments: SourceSegment[];
  references: Reference[];
  diagnostics: Diagnostic[];
  expression: string | null;
  fingerprintInput: string;
}

interface Token extends SourceRange {
  kind: "name" | "number" | "string" | "punctuation";
  text: string;
}

const isNameStart = (char: string) => /[\p{L}_]/u.test(char);
const isNamePart = (char: string) => /[\p{L}\p{M}\p{N}_]/u.test(char);
const normalize = (text: string) => text.replace(/\r\n?/g, "\n");
const asText = (text: string) => text.replace(/\n/g, " ");

function lexExpression(
  expression: string,
  start: number,
  diagnostics: Diagnostic[],
): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < expression.length) {
    const char = String.fromCodePoint(expression.codePointAt(index) ?? 0);
    if (/\s/u.test(char)) {
      index += char.length;
      continue;
    }
    const from = start + index;
    if (char === '"') {
      const begin = index++;
      while (index < expression.length) {
        if (expression[index] === '"') {
          if (expression[index + 1] === '"') {
            index += 2;
            continue;
          }
          index++;
          break;
        }
        index++;
      }
      if (expression[index - 1] !== '"' || index === begin + 1)
        diagnostics.push({
          code: "unclosed-string",
          severity: "error",
          message: "Close the GeoGebra string.",
          from,
          to: start + index,
        });
      tokens.push({
        kind: "string",
        text: expression.slice(begin, index),
        from,
        to: start + index,
      });
      continue;
    }
    if (isNameStart(char)) {
      const begin = index;
      index += char.length;
      while (index < expression.length) {
        const part = String.fromCodePoint(expression.codePointAt(index) ?? 0);
        if (!isNamePart(part)) break;
        index += part.length;
      }
      if (expression[index - 1] === "_") {
        const subscript = /^\{[\p{L}\p{M}\p{N}_]+\}/u.exec(
          expression.slice(index),
        );
        if (subscript) index += subscript[0].length;
      }
      tokens.push({
        kind: "name",
        text: expression.slice(begin, index),
        from,
        to: start + index,
      });
      continue;
    }
    if (/[0-9]/u.test(char)) {
      const begin = index++;
      while (
        index < expression.length &&
        /[0-9.]/u.test(expression[index] ?? "")
      )
        index++;
      const number = expression.slice(begin, index);
      if (!/^\d+(?:\.\d+)?$/u.test(number))
        diagnostics.push({
          code: "invalid-number",
          severity: "error",
          message: "Use one decimal point in a number.",
          from,
          to: start + index,
        });
      tokens.push({
        kind: "number",
        text: number,
        from,
        to: start + index,
      });
      continue;
    }
    if ("()[]{}.,+-*/^=<>!:%|&".includes(char)) {
      const pair = expression.slice(index, index + 2);
      const text = [":=", "==", "<=", ">=", "!=", "&&", "||"].includes(pair)
        ? pair
        : char;
      index += text.length;
      tokens.push({ kind: "punctuation", text, from, to: from + text.length });
      continue;
    }
    diagnostics.push({
      code: "invalid-character",
      severity: "error",
      message: `Unexpected character ${char}.`,
      from,
      to: from + char.length,
    });
    index += char.length;
  }
  return tokens;
}

function checkExpressionSyntax(
  tokens: Token[],
  diagnostics: Diagnostic[],
): void {
  const frames: Array<{
    opener?: Token;
    expectValue: boolean;
    argumentStart: number;
  }> = [{ expectValue: true, argumentStart: 0 }];
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    const frame = frames[frames.length - 1];
    if (!token || !frame) continue;
    if (token.kind !== "punctuation") {
      frame.expectValue = false;
      continue;
    }
    if (["(", "[", "{"].includes(token.text)) {
      frames.push({
        opener: token,
        expectValue: true,
        argumentStart: index + 1,
      });
      continue;
    }
    if ([")", "]", "}"].includes(token.text)) {
      if (
        frame.expectValue &&
        index === frame.argumentStart &&
        frame.opener?.text !== "{"
      )
        diagnostics.push({
          code: "empty-expression",
          severity: "error",
          message: "Empty parentheses are not a Value Expression.",
          from: frame.opener?.from ?? token.from,
          to: token.to,
        });
      if (
        frame.expectValue &&
        (index > frame.argumentStart || tokens[index - 1]?.text === ",")
      )
        diagnostics.push({
          code: "incomplete-expression",
          severity: "error",
          message: "An expression is missing before the closing delimiter.",
          from: token.from,
          to: token.to,
        });
      if (frames.length > 1) frames.pop();
      const parent = frames[frames.length - 1];
      if (parent) parent.expectValue = false;
      continue;
    }
    if (token.text === ",") {
      if (frame.expectValue)
        diagnostics.push({
          code: "empty-argument",
          severity: "error",
          message: "Enter an expression between commas.",
          from: token.from,
          to: token.to,
        });
      frame.expectValue = true;
      frame.argumentStart = index + 1;
      continue;
    }
    if (token.text === ":" || token.text === ":=") {
      diagnostics.push({
        code: "assignment",
        severity: "error",
        message: "Assignments are not Value Expressions.",
        from: token.from,
        to: token.to,
      });
      frame.expectValue = true;
      continue;
    }
    if (
      token.text === "=" &&
      index === frame.argumentStart + 1 &&
      tokens[frame.argumentStart]?.kind === "name"
    )
      diagnostics.push({
        code: "assignment",
        severity: "error",
        message: "Assignments are not Value Expressions.",
        from: tokens[frame.argumentStart]?.from ?? token.from,
        to: token.to,
      });
    if (token.text === "!" && !frame.expectValue) continue;
    if (frame.expectValue && !["+", "-", "!"].includes(token.text))
      diagnostics.push({
        code: "missing-operand",
        severity: "error",
        message: "An operator needs a value before it.",
        from: token.from,
        to: token.to,
      });
    if ([".", "%", "|", "&"].includes(token.text))
      diagnostics.push({
        code: "invalid-operator",
        severity: "error",
        message: "This operator is not supported in a Value Expression.",
        from: token.from,
        to: token.to,
      });
    frame.expectValue = true;
  }
  const root = frames[0];
  const last = tokens[tokens.length - 1];
  if (root?.expectValue && last)
    diagnostics.push({
      code: "incomplete-expression",
      severity: "error",
      message: "Expression ends before a value is complete.",
      from: last.from,
      to: last.to,
    });
}

function splitArguments(tokens: readonly Token[]): Token[][] {
  const arguments_: Token[][] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < tokens.length; index++) {
    const text = tokens[index]?.text;
    if (text === "(" || text === "[" || text === "{") depth++;
    else if (text === ")" || text === "]" || text === "}") depth--;
    else if (text === "," && depth === 0) {
      arguments_.push(tokens.slice(start, index));
      start = index + 1;
    }
  }
  if (tokens.length) arguments_.push(tokens.slice(start));
  return arguments_;
}

function isBooleanExpression(
  tokens: readonly Token[],
  symbols: ReadonlyMap<string, SymbolInfo>,
): boolean {
  const first = tokens[0];
  if (tokens.length === 1)
    return (
      first?.text === "true" ||
      first?.text === "false" ||
      symbols.get(first?.text ?? "")?.type === "boolean"
    );
  if (first?.text === "!" && tokens.length > 1)
    return isBooleanExpression(tokens.slice(1), symbols);
  if (first?.text === "(" && tokens.at(-1)?.text === ")")
    return isBooleanExpression(tokens.slice(1, -1), symbols);
  if (
    first?.text === "If" &&
    tokens[1]?.text === "(" &&
    tokens.at(-1)?.text === ")"
  ) {
    const arguments_ = splitArguments(tokens.slice(2, -1));
    return (
      arguments_.length >= 2 &&
      arguments_.every(
        (argument, index) =>
          index === 0 || isBooleanExpression(argument, symbols),
      )
    );
  }
  let depth = 0;
  for (const token of tokens) {
    if (["(", "[", "{"].includes(token.text)) depth++;
    else if ([")", "]", "}"].includes(token.text)) depth--;
    else if (
      depth === 0 &&
      ["==", "=", "!=", "<", ">", "<=", ">=", "&&", "||"].includes(token.text)
    )
      return true;
  }
  return false;
}

function matchesArgumentKind(
  kind: "value" | "boolean" | "list" | "text" | "number",
  tokens: readonly Token[],
  symbols: ReadonlyMap<string, SymbolInfo>,
): boolean {
  if (kind === "value") return tokens.length > 0;
  if (kind === "boolean") return isBooleanExpression(tokens, symbols);
  const first = tokens[0];
  if (kind === "list")
    return (
      (first?.text === "{" && tokens.at(-1)?.text === "}") ||
      (tokens.length === 1 &&
        ["list", "matrix"].includes(symbols.get(first?.text ?? "")?.type ?? ""))
    );
  if (kind === "text")
    return (
      (tokens.length === 1 && first?.kind === "string") ||
      (tokens.length === 1 && symbols.get(first?.text ?? "")?.type === "text")
    );
  if (tokens.length === 1)
    return (
      first?.kind === "number" ||
      CONSTANTS.has(first?.text ?? "") ||
      ["number", "numeric"].includes(symbols.get(first?.text ?? "")?.type ?? "")
    );
  return !tokens.some(
    (token) =>
      token.kind === "string" ||
      token.text === "{" ||
      token.text === "}" ||
      token.text === "true" ||
      token.text === "false" ||
      (token.kind === "name" &&
        ["text", "point", "vector", "boolean", "list", "matrix"].includes(
          symbols.get(token.text)?.type ?? "",
        )),
  );
}

function validateExpression(
  expression: string,
  start: number,
  options: CompileOptions,
  diagnostics: Diagnostic[],
  references: Reference[],
): void {
  const tokens = lexExpression(expression, start, diagnostics);
  checkExpressionSyntax(tokens, diagnostics);
  const symbols = new Map(
    options.symbols.map((symbol) => [symbol.label, symbol]),
  );
  const commands = options.commands ?? SAFE_COMMANDS;
  const stack: Array<{ token: Token; index: number; separators: number[] }> =
    [];

  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (!token) continue;
    const next = tokens[index + 1];
    if (token.kind === "name") {
      if (next?.text === "(" || next?.text === "[") {
        if (UNSAFE_COMMANDS.has(token.text))
          diagnostics.push({
            code: "unsafe-command",
            severity: "error",
            message: `${token.text} is not a safe single-result command.`,
            from: token.from,
            to: token.to,
          });
        else if (
          !Object.hasOwn(commands, token.text) &&
          !FUNCTIONS.has(token.text) &&
          symbols.get(token.text)?.type !== "function"
        )
          diagnostics.push({
            code: "unknown-command",
            severity: "error",
            message: `${token.text} is not in the safe command catalog.`,
            from: token.from,
            to: token.to,
          });
        else if (
          symbols.get(token.text)?.type === "function" &&
          !Object.hasOwn(commands, token.text) &&
          !FUNCTIONS.has(token.text)
        ) {
          references.push({
            label: token.text,
            from: token.from,
            to: token.to,
          });
          if (!symbols.get(token.text)?.defined)
            diagnostics.push({
              code: "undefined-value",
              severity: "warning",
              message: `${token.text} is currently undefined.`,
              from: token.from,
              to: token.to,
            });
        }
      } else if (!CONSTANTS.has(token.text)) {
        const symbol = symbols.get(token.text);
        if (!symbol)
          diagnostics.push({
            code: "unresolved-reference",
            severity: "error",
            message: `${token.text} is not in this construction.`,
            from: token.from,
            to: token.to,
          });
        else {
          references.push({
            label: token.text,
            from: token.from,
            to: token.to,
          });
          if (!symbol.defined)
            diagnostics.push({
              code: "undefined-value",
              severity: "warning",
              message: `${token.text} is currently undefined.`,
              from: token.from,
              to: token.to,
            });
        }
      }
    }
    if (["(", "[", "{"].includes(token.text)) {
      stack.push({ token, index, separators: [] });
    } else if (token.text === ",") {
      const frame = stack[stack.length - 1];
      if (frame) frame.separators.push(index);
      else
        diagnostics.push({
          code: "unexpected-comma",
          severity: "error",
          message: "Comma must be inside a call or list.",
          from: token.from,
          to: token.to,
        });
    } else if (")]}".includes(token.text)) {
      const frame = stack.pop();
      const expected =
        token.text === ")" ? "(" : token.text === "]" ? "[" : "{";
      if (!frame || frame.token.text !== expected) {
        diagnostics.push({
          code: "unbalanced-delimiter",
          severity: "error",
          message: "Unbalanced expression delimiter.",
          from: token.from,
          to: token.to,
        });
      } else {
        const previous = tokens[frame.index - 1];
        if (
          previous?.kind === "name" &&
          (Object.hasOwn(commands, previous.text) ||
            FUNCTIONS.has(previous.text))
        ) {
          const arity =
            index === frame.index + 1 ? 0 : frame.separators.length + 1;
          const cuts = [frame.index, ...frame.separators, index];
          const arguments_ = cuts
            .slice(0, -1)
            .map((cut, offset) => tokens.slice(cut + 1, cuts[offset + 1]));
          const supported = Object.hasOwn(commands, previous.text)
            ? commands[previous.text]?.overloads.some(
                (form) =>
                  form.arity === arity &&
                  (!form.argumentKinds ||
                    form.argumentKinds.every((kind, argumentIndex) =>
                      matchesArgumentKind(
                        kind,
                        arguments_[argumentIndex] ?? [],
                        symbols,
                      ),
                    )),
              )
            : (FUNCTION_ARITIES[previous.text] ?? [1]).includes(arity);
          if (!supported)
            diagnostics.push({
              code: "unsupported-overload",
              severity: "error",
              message: `${previous.text} does not support ${arity} argument(s) here.`,
              from: previous.from,
              to: token.to,
            });
        }
      }
    }
  }
  for (const frame of stack)
    diagnostics.push({
      code: "unbalanced-delimiter",
      severity: "error",
      message: "Unclosed expression delimiter.",
      from: frame.token.from,
      to: frame.token.to,
    });
}

function literalTerms(text: string): string[] {
  const pieces = text.split('"');
  const terms: string[] = [];
  pieces.forEach((piece, index) => {
    if (piece) terms.push(`"${asText(piece)}"`);
    if (index < pieces.length - 1) terms.push("UnicodeToLetter(34)");
  });
  return terms;
}

function runtimeExpression(expression: string): string {
  const tokens = lexExpression(expression, 0, []);
  let compiled = expression;
  for (let index = tokens.length - 2; index >= 0; index--) {
    const token = tokens[index];
    if (
      token?.kind === "name" &&
      token.text === "arcos" &&
      ["(", "["].includes(tokens[index + 1]?.text ?? "")
    )
      compiled =
        compiled.slice(0, token.from) + "acos" + compiled.slice(token.to);
  }
  return compiled;
}

export interface SourceScan {
  segments: SourceSegment[];
  diagnostics: Diagnostic[];
  openInterpolationFrom: number | null;
}

/** Shared delimiter scan for compilation and editor affordances. */
export function scanSource(source: string): SourceScan {
  const segments: SourceSegment[] = [];
  const diagnostics: Diagnostic[] = [];
  let openInterpolationFrom: number | null = null;
  let literal = "";
  let literalFrom = 0;
  let index = 0;
  const flushLiteral = () => {
    if (literal)
      segments.push({
        kind: "literal",
        text: normalize(literal),
        from: literalFrom,
        to: index,
      });
    literal = "";
  };
  while (index < source.length) {
    if (source[index] !== "@") {
      if (!literal) literalFrom = index;
      literal += source[index];
      index++;
      continue;
    }
    if (source[index + 1] === "@") {
      if (!literal) literalFrom = index;
      literal += "@";
      index += 2;
      continue;
    }
    flushLiteral();
    const opening = index++;
    const closing = source.indexOf("@", index);
    if (closing === -1) {
      openInterpolationFrom = opening;
      diagnostics.push({
        code: "unmatched-interpolation",
        severity: "error",
        message: "Close the interpolation with @.",
        from: opening,
        to: opening + 1,
      });
      break;
    }
    const rawExpression = source.slice(index, closing);
    const expression = normalize(rawExpression);
    if (!expression.trim())
      diagnostics.push({
        code: "empty-interpolation",
        severity: "error",
        message: "Enter a Value Expression between @ signs.",
        from: opening,
        to: closing + 1,
      });
    segments.push({
      kind: "interpolation",
      expression: asText(expression),
      from: opening,
      to: closing + 1,
    });
    index = closing + 1;
  }
  flushLiteral();
  return { segments, diagnostics, openInterpolationFrom };
}

export function compileSource(
  source: string,
  options: CompileOptions,
): CompileResult {
  const { segments, diagnostics } = scanSource(source);
  const references: Reference[] = [];
  for (const segment of segments) {
    if (segment.kind === "interpolation" && segment.expression.trim())
      validateExpression(
        source.slice(segment.from + 1, segment.to - 1),
        segment.from + 1,
        options,
        diagnostics,
        references,
      );
  }
  const normalizedSource = normalize(source);
  const terms = segments.flatMap((segment) =>
    segment.kind === "literal"
      ? literalTerms(segment.text)
      : [`FormulaText((${runtimeExpression(segment.expression)}))`],
  );
  const concatenation = terms.join("+") || '""';
  return {
    normalizedSource,
    segments,
    references,
    diagnostics,
    expression: diagnostics.some(
      (diagnostic) => diagnostic.severity === "error",
    )
      ? null
      : `FormulaText(${options.simplify ? `Simplify(${concatenation})` : concatenation})`,
    fingerprintInput: JSON.stringify([1, normalizedSource, options.simplify]),
  };
}

/** Rewrite only names the compiler proved to be construction objects. */
export function rewriteGlobalReferences(
  source: string,
  oldLabel: string,
  newLabel: string,
  symbols: readonly SymbolInfo[],
): { source: string; ambiguous: SourceRange[] } {
  const compiled = compileSource(source, { simplify: false, symbols });
  const proven = compiled.references.filter(
    (reference) => reference.label === oldLabel,
  );
  const positions = new Set(proven.map((reference) => reference.from));
  const ambiguous: SourceRange[] = [];
  for (const segment of compiled.segments) {
    if (segment.kind !== "interpolation") continue;
    const tokens = lexExpression(
      source.slice(segment.from + 1, segment.to - 1),
      segment.from + 1,
      [],
    );
    for (let index = 0; index < tokens.length; index++) {
      const token = tokens[index];
      if (
        token?.kind === "name" &&
        token.text === oldLabel &&
        !positions.has(token.from) &&
        tokens[index + 1]?.text !== "(" &&
        tokens[index + 1]?.text !== "["
      )
        ambiguous.push({ from: token.from, to: token.to });
    }
  }
  if (
    compiled.diagnostics.some((diagnostic) => diagnostic.severity === "error")
  )
    return {
      source,
      ambiguous: [
        ...ambiguous,
        ...proven.map(({ from, to }) => ({ from, to })),
      ],
    };
  let rewritten = source;
  for (const reference of proven.reverse())
    rewritten =
      rewritten.slice(0, reference.from) +
      newLabel +
      rewritten.slice(reference.to);
  return { source: rewritten, ambiguous };
}
