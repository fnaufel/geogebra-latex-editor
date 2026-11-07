import { expect, test } from "@playwright/test";
import { PURE_FUNCTIONS, compileSource } from "../../src/compiler";

interface LiveApplet {
  evalCommand(command: string): boolean;
  getAllObjectNames(): string[];
  getObjectType(label: string): string;
  isDefined(label: string): boolean;
}

test("the pinned applet produces one text value for approved expressions and object types", async ({
  page,
}) => {
  test.slow();
  await page.goto("./");
  await expect(
    page.getByRole("status", { name: "Applet status" }),
  ).toContainText("GeoGebra ready (5.4.920.0)", { timeout: 45_000 });
  const symbols = await page.evaluate(() => {
    const api = (window as typeof window & { ggbApplet: LiveApplet }).ggbApplet;
    for (const command of [
      "a=2",
      "b=3",
      "P=(1,2)",
      "v=Vector((0,0),(1,2))",
      "eq: x+y=3",
      "L={1,2,3}",
      "M={{1,2},{3,4}}",
      "flag=1<2",
      'caption="hello"',
      "f(x)=x^2",
      "u=If(false,1)",
    ])
      api.evalCommand(command);
    return api.getAllObjectNames().map((label) => ({
      label,
      type: api.getObjectType(label),
      defined: api.isDefined(label),
    }));
  });
  for (const label of [
    "a",
    "P",
    "v",
    "eq",
    "L",
    "M",
    "flag",
    "caption",
    "f",
    "u",
  ])
    expect(
      symbols.find((symbol) => symbol.label === label)?.type,
      label,
    ).toBeTruthy();
  expect(symbols.find((symbol) => symbol.label === "u")?.defined).toBe(false);

  const commandExpressions = [
    "FormulaText(a)",
    "FormulaText(a,true)",
    "FormulaText(a,true,true)",
    "FractionText(b/a)",
    "FractionText(b/a,true)",
    "SurdText(a)",
    "SurdText(a,{a})",
    "ScientificText(a)",
    "ScientificText(a,5)",
    "TableText({a,b})",
    "TableText({a},{b})",
    'TableText({a},{b},"v")',
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
  const functionExpressions = PURE_FUNCTIONS.map((name) => {
    const args =
      name === "betaRegularized"
        ? "1,2,0.5"
        : ["atan2", "gammaRegularized", "beta"].includes(name)
          ? "1,2"
          : "1";
    return `${name}(${args})`;
  });
  const expressions = [
    ...["a", "P", "v", "eq", "L", "M", "flag", "caption", "f", "u"],
    ...commandExpressions,
    ...functionExpressions,
    "If(a>0,FractionText(b/a),SurdText(a))",
  ];
  const definitions = expressions.map((expression, index) => {
    const result = compileSource(`@${expression}@`, {
      simplify: false,
      symbols,
    });
    expect(result.expression, expression).not.toBeNull();
    return { label: `valueProbe${index}`, expression: result.expression! };
  });
  const failures = await page.evaluate((items) => {
    const api = (window as typeof window & { ggbApplet: LiveApplet }).ggbApplet;
    const failures: string[] = [];
    for (const item of items) {
      const before = new Set(api.getAllObjectNames());
      api.evalCommand(`${item.label}=${item.expression}`);
      const added = api
        .getAllObjectNames()
        .filter((label) => !before.has(label));
      if (
        api.getObjectType(item.label) !== "text" ||
        added.some((label) => label !== item.label)
      )
        failures.push(
          `${item.label}: type=${api.getObjectType(item.label)} added=${added.join(",")}`,
        );
    }
    return failures;
  }, definitions);
  expect(failures).toEqual([]);
});
