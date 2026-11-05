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
    argumentKinds?: readonly ("value" | "boolean")[];
    localBindings: readonly number[];
  }[];
  result: "single";
}

const forms = (...arities: number[]): CommandCatalogEntry => ({
  result: "single",
  overloads: arities.map((arity) => ({ arity, localBindings: [] })),
});

// Intentionally conservative. These are the single-result forms supported in v1.
export const SAFE_COMMANDS: Readonly<Record<string, CommandCatalogEntry>> = {
  FormulaText: forms(1, 2, 3),
  FractionText: forms(1, 2),
  SurdText: forms(1, 2),
  ScientificText: forms(1, 2),
  TableText: forms(1, 2, 3),
  VerticalText: forms(1),
  Ordinal: forms(1),
  UnicodeToLetter: forms(1),
  Name: forms(1),
  Text: {
    result: "single",
    overloads: [
      { arity: 1, localBindings: [] },
      { arity: 2, argumentKinds: ["value", "boolean"], localBindings: [] },
    ],
  },
  Simplify: forms(1),
  If: forms(2, 3),
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
const CONSTANTS = new Set([
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
]);
const FUNCTIONS = new Set<string>(PURE_FUNCTIONS);

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
  const stack: Array<{ token: Token; index: number; commas: number }> = [];

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
          !FUNCTIONS.has(token.text)
        )
          diagnostics.push({
            code: "unknown-command",
            severity: "error",
            message: `${token.text} is not in the safe command catalog.`,
            from: token.from,
            to: token.to,
          });
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
      stack.push({ token, index, commas: 0 });
    } else if (token.text === ",") {
      const frame = stack[stack.length - 1];
      if (frame) frame.commas++;
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
          Object.hasOwn(commands, previous.text)
        ) {
          const arity = index === frame.index + 1 ? 0 : frame.commas + 1;
          const overload = commands[previous.text]?.overloads.find(
            (form) => form.arity === arity,
          );
          if (!overload)
            diagnostics.push({
              code: "unsupported-overload",
              severity: "error",
              message: `${previous.text} does not support ${arity} argument(s) here.`,
              from: previous.from,
              to: token.to,
            });
          else if (overload.argumentKinds?.includes("boolean")) {
            const separator = tokens.findIndex(
              (part, partIndex) =>
                partIndex > frame.index &&
                partIndex < index &&
                part.text === ",",
            );
            const argument =
              separator < 0 ? [] : tokens.slice(separator + 1, index);
            const boolean =
              argument.length === 1 &&
              (argument[0]?.text === "true" ||
                argument[0]?.text === "false" ||
                symbols.get(argument[0]?.text ?? "")?.type === "boolean");
            if (!boolean)
              diagnostics.push({
                code: "unsupported-overload",
                severity: "error",
                message: `${previous.text} requires a boolean second argument.`,
                from: previous.from,
                to: token.to,
              });
          }
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
      : [`FormulaText((${segment.expression}))`],
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
