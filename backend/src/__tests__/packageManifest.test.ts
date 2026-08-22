import fs from "fs";
import path from "path";

// package.json had two top-level "prisma" blocks for several days. JSON
// allows it and every parser silently keeps the last one, so nothing broke
// and nothing complained — but the file was one careless edit away from
// having `npx prisma db seed` read a block that had already been
// overwritten by the one further down. These tests fail on the duplicate
// itself rather than waiting for it to matter.
const manifestPath = path.join(__dirname, "..", "..", "package.json");
const raw = fs.readFileSync(manifestPath, "utf8");
const manifest = JSON.parse(raw) as Record<string, unknown> & {
  scripts: Record<string, string>;
  prisma?: { seed?: string };
};

/**
 * JSON.parse collapses duplicates, so only the raw text can reveal them.
 * Scans for strings used as keys while at brace depth 1 and reports any
 * that appear more than once.
 */
function duplicateTopLevelKeys(json: string): string[] {
  const seen = new Map<string, number>();
  let depth = 0;
  let inString = false;
  let escaped = false;
  let current = "";

  for (let i = 0; i < json.length; i += 1) {
    const char = json[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
        // A string is a key when the next non-space character is a colon.
        if (depth === 1 && json.slice(i + 1).trimStart().startsWith(":")) {
          seen.set(current, (seen.get(current) ?? 0) + 1);
        }
        current = "";
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
    } else if (char === "{" || char === "[") {
      depth += 1;
    } else if (char === "}" || char === "]") {
      depth -= 1;
    }
  }

  return [...seen.entries()].filter(([, count]) => count > 1).map(([key]) => key);
}

describe("backend package.json", () => {
  it("declares every top-level key exactly once", () => {
    expect(duplicateTopLevelKeys(raw)).toEqual([]);
  });

  // `npm run seed` and `npx prisma db seed` are both documented in the
  // README as ways to load the demo org. They read different fields, so
  // they can drift into running different scripts.
  it("runs the same seed script from npm and from prisma", () => {
    expect(manifest.prisma?.seed).toBe(manifest.scripts.seed);
  });

  it("keeps the CI entry points defined", () => {
    for (const script of ["build", "test", "lint", "typecheck"]) {
      expect(typeof manifest.scripts[script]).toBe("string");
    }
  });
});

describe("duplicateTopLevelKeys", () => {
  it("finds a repeated top-level key", () => {
    expect(duplicateTopLevelKeys('{"a": 1, "b": {"a": 2}, "a": 3}')).toEqual(["a"]);
  });

  it("ignores repeats nested inside other objects and arrays", () => {
    expect(duplicateTopLevelKeys('{"a": {"x": 1}, "b": [{"x": 2}, {"x": 3}]}')).toEqual([]);
  });

  it("is not fooled by a colon or a brace inside a string value", () => {
    expect(duplicateTopLevelKeys('{"a": "b: {", "c": "\\" : "}')).toEqual([]);
  });
});
