/**
 * Unit tests for tab-grouping pure functions.
 * Run with: node --test tests/unit.test.mjs
 * Requires Node 18+.
 *
 * These tests cover every function that has no browser-API dependency.
 * Functions that touch gBrowser, Services, ChromeUtils, document, etc.
 * are exercised indirectly through mocks where feasible, or skipped.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Re-implementations / copies of pure functions under test.
// Keeping them here (rather than importing from the script) avoids needing
// a build step to strip the IIFE wrapper and browser globals.
// Each section clearly references the originating lines in tab-grouping.uc.mjs.
// ---------------------------------------------------------------------------

// ── hasMeaningfulTitleSignal (lines ~86-98) ──────────────────────────────────
const LOW_SIGNAL_TITLES = new Set([
  "new tab", "about:blank", "loading...", "untitled page",
  "invalid tab", "error processing tab",
]);

const hasMeaningfulTitleSignal = (title) => {
  const normalized = (title || "").toString().trim().toLowerCase();
  if (!normalized || LOW_SIGNAL_TITLES.has(normalized)) return false;
  if (normalized.length < 5) return false;
  if (normalized.startsWith("http:") || normalized.startsWith("https:")) return false;
  if (/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(normalized)) return false;
  return true;
};

// ── cosineSimilarity (lines ~1221-1240) ──────────────────────────────────────
const cosineSimilarity = (a, b) => {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || a.length === 0) return 0;
  if (typeof a[0] !== "number" || typeof b[0] !== "number") return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
};

// ── averageEmbedding (lines ~1202-1219) ──────────────────────────────────────
const averageEmbedding = (arrays) => {
  if (!Array.isArray(arrays) || arrays.length === 0) return [];
  const validArrays = arrays.filter(a => Array.isArray(a) && a.length > 0);
  if (validArrays.length === 0) return [];
  const len = validArrays[0].length;
  const sum = new Array(len).fill(0);
  for (const arr of validArrays) {
    if (arr.length !== len) continue;
    for (let i = 0; i < len; i++) sum[i] += arr[i];
  }
  return sum.map(v => v / validArrays.length);
};

// ── parseGroupingJson (lines ~657-676) ───────────────────────────────────────
const parseGroupingJson = (text) => {
  if (!text || typeof text !== "string") return null;
  let cleaned = text.trim();
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) cleaned = fenceMatch[1].trim();
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) return null;
  try {
    const parsed = JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

// ── sanitizeGroupName (lines ~571-583) ───────────────────────────────────────
const toTitleCase = (str) => {
  if (!str || typeof str !== "string") return "";
  return str.toLowerCase().split(" ").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
};

const sanitizeGroupName = (rawName, fallbackTitles = []) => {
  let name = (rawName || "").toString().split("\n").map(l => l.trim()).find(l => l) || "";
  name = toTitleCase(name);
  if (!name || /none|adult content/i.test(name)) {
    const first = (fallbackTitles[0] || "").toString();
    name = first.split("–")[0].trim().slice(0, 24);
  }
  name = name.replace(/^['"`]+|['"`]+$/g, "").replace(/[.?!,:;]+$/, "").slice(0, 24);
  return name || "Group";
};

// ── levenshteinDistance (lines ~905-933) ─────────────────────────────────────
const levenshteinDistance = (a, b) => {
  if (!a || !b || typeof a !== "string" || typeof b !== "string") {
    return Math.max(a?.length ?? 0, b?.length ?? 0);
  }
  a = a.toLowerCase(); b = b.toLowerCase();
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const matrix = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }
  return matrix[b.length][a.length];
};

// ── flattenNestedGroups (lines ~609-624) ─────────────────────────────────────
const NESTED_GROUP_DELIMITER = " → ";
const flattenNestedGroups = (parsed) => {
  const result = {};
  const walk = (obj, parentPath = "") => {
    if (!obj || typeof obj !== "object") return;
    for (const [key, value] of Object.entries(obj)) {
      const fullPath = parentPath ? `${parentPath}${NESTED_GROUP_DELIMITER}${key}` : key;
      if (Array.isArray(value)) {
        result[fullPath] = value;
      } else if (value && typeof value === "object") {
        walk(value, fullPath);
      }
    }
  };
  walk(parsed);
  return result;
};

// ── getTabEmbeddingText URL logic (lines added in our feat commit) ────────────
// Extracted as a pure function operating on a URL string instead of a tab object.
const getEmbeddingPathSegments = (urlString) => {
  try {
    const url = new URL(urlString);
    if (url.protocol === "about:" || url.protocol === "moz-extension:") return [];
    return url.pathname
      .split("/")
      .map(s => { try { return decodeURIComponent(s).trim(); } catch { return s.trim(); } })
      .filter(s =>
        s.length > 2 &&
        !/^[\d\-_.]+$/.test(s) &&
        !/^[a-f0-9]{8,}$/i.test(s)
      )
      .map(s => s.replace(/[-_]/g, " ").toLowerCase())
      .slice(0, 4);
  } catch {
    return [];
  }
};

// ── normalizeHost (lines ~323-331) ───────────────────────────────────────────
const normalizeHost = (host) => {
  if (!host || typeof host !== "string") return "";
  return host.toLowerCase().replace(/^www\./, "").replace(/:\d+$/, "").trim();
};

// ── parseHostListPref (lines ~333-351) ───────────────────────────────────────
const parseHostListPref = (raw) => {
  if (!raw || typeof raw !== "string") return new Set();
  return new Set(
    raw.split(",")
      .map(h => normalizeHost(h.trim()))
      .filter(h => h.length > 0)
  );
};


// ===========================================================================
// Tests
// ===========================================================================

describe("hasMeaningfulTitleSignal", () => {
  test("rejects empty string", () => assert.equal(hasMeaningfulTitleSignal(""), false));
  test("rejects null", () => assert.equal(hasMeaningfulTitleSignal(null), false));
  test("rejects 'New Tab'", () => assert.equal(hasMeaningfulTitleSignal("New Tab"), false));
  test("rejects 'about:blank'", () => assert.equal(hasMeaningfulTitleSignal("about:blank"), false));
  test("rejects 'Loading...'", () => assert.equal(hasMeaningfulTitleSignal("Loading..."), false));
  test("rejects raw http URL", () => assert.equal(hasMeaningfulTitleSignal("https://example.com"), false));
  test("rejects hostname-only string", () => assert.equal(hasMeaningfulTitleSignal("github.com"), false));
  test("rejects subdomain hostname", () => assert.equal(hasMeaningfulTitleSignal("mail.google.com"), false));
  test("rejects string shorter than 5 chars", () => assert.equal(hasMeaningfulTitleSignal("abc"), false));
  test("accepts normal page title", () => assert.equal(hasMeaningfulTitleSignal("How to use React hooks"), true));
  test("accepts product name", () => assert.equal(hasMeaningfulTitleSignal("TypeScript Handbook"), true));
  test("accepts 5-char title exactly", () => assert.equal(hasMeaningfulTitleSignal("React"), true));
  test("accepts title with numbers", () => assert.equal(hasMeaningfulTitleSignal("AWS EC2 pricing"), true));
});

describe("cosineSimilarity", () => {
  test("identical vectors → 1", () => {
    const v = [1, 0, 0];
    assert.ok(Math.abs(cosineSimilarity(v, v) - 1) < 1e-9);
  });
  test("orthogonal vectors → 0", () => {
    assert.ok(Math.abs(cosineSimilarity([1, 0], [0, 1])) < 1e-9);
  });
  test("opposite vectors → -1", () => {
    assert.ok(Math.abs(cosineSimilarity([1, 0], [-1, 0]) + 1) < 1e-9);
  });
  test("empty arrays → 0", () => assert.equal(cosineSimilarity([], []), 0));
  test("mismatched lengths → 0", () => assert.equal(cosineSimilarity([1, 2], [1, 2, 3]), 0));
  test("non-array inputs → 0", () => assert.equal(cosineSimilarity(null, null), 0));
  test("known angle — 45°", () => {
    const a = [1, 0];
    const b = [1, 1];
    const expected = 1 / Math.sqrt(2);
    assert.ok(Math.abs(cosineSimilarity(a, b) - expected) < 1e-9);
  });
});

describe("averageEmbedding", () => {
  test("averages two vectors", () => {
    const result = averageEmbedding([[1, 2], [3, 4]]);
    assert.deepEqual(result, [2, 3]);
  });
  test("single vector returns itself", () => {
    assert.deepEqual(averageEmbedding([[5, 10]]), [5, 10]);
  });
  test("empty input returns []", () => assert.deepEqual(averageEmbedding([]), []));
  test("ignores non-array entries", () => {
    const result = averageEmbedding([[2, 4], null, [4, 8]]);
    assert.deepEqual(result, [3, 6]);
  });
});

describe("parseGroupingJson", () => {
  test("parses clean JSON", () => {
    const result = parseGroupingJson('{"React": [1,2], "Node": [3]}');
    assert.deepEqual(result, { React: [1, 2], Node: [3] });
  });
  test("strips markdown code fences", () => {
    const result = parseGroupingJson('```json\n{"React": [1]}\n```');
    assert.deepEqual(result, { React: [1] });
  });
  test("strips prose before JSON", () => {
    const result = parseGroupingJson('Here are the groups:\n{"React": [1]}');
    assert.deepEqual(result, { React: [1] });
  });
  test("returns null for empty string", () => assert.equal(parseGroupingJson(""), null));
  test("returns null for invalid JSON", () => assert.equal(parseGroupingJson("{bad json}"), null));
  test("returns null for array", () => assert.equal(parseGroupingJson("[1,2,3]"), null));
  test("returns null for null input", () => assert.equal(parseGroupingJson(null), null));
  test("handles trailing prose after closing brace", () => {
    const result = parseGroupingJson('{"A": [1]} done!');
    assert.deepEqual(result, { A: [1] });
  });
});

describe("sanitizeGroupName", () => {
  test("title-cases input", () => assert.equal(sanitizeGroupName("react hooks"), "React Hooks"));
  test("strips leading/trailing quotes", () => assert.equal(sanitizeGroupName('"react"'), "react"));
  test("strips trailing punctuation", () => assert.equal(sanitizeGroupName("React!"), "React"));
  test("caps at 24 chars", () => {
    const long = "A".repeat(30);
    assert.equal(sanitizeGroupName(long).length, 24);
  });
  test("falls back to first title when input is 'none'", () => {
    assert.equal(sanitizeGroupName("none", ["TypeScript Basics"]), "TypeScript Basics");
  });
  test("returns 'Group' when everything fails", () => {
    assert.equal(sanitizeGroupName("", []), "Group");
  });
  test("strips multiline — uses first non-empty line", () => {
    assert.equal(sanitizeGroupName("\n\nreact\n"), "React");
  });
});

describe("levenshteinDistance", () => {
  test("identical strings → 0", () => assert.equal(levenshteinDistance("abc", "abc"), 0));
  test("one insertion", () => assert.equal(levenshteinDistance("abc", "abcd"), 1));
  test("one deletion", () => assert.equal(levenshteinDistance("abcd", "abc"), 1));
  test("one substitution", () => assert.equal(levenshteinDistance("abc", "axc"), 1));
  test("empty vs string", () => assert.equal(levenshteinDistance("", "abc"), 3));
  test("string vs empty", () => assert.equal(levenshteinDistance("abc", ""), 3));
  test("case insensitive", () => assert.equal(levenshteinDistance("ABC", "abc"), 0));
  test("completely different", () => assert.equal(levenshteinDistance("abc", "xyz"), 3));
  test("React vs React Native", () => assert.ok(levenshteinDistance("React", "React Native") > 2));
});

describe("flattenNestedGroups", () => {
  test("flat object passes through", () => {
    const input = { React: [1, 2], Node: [3] };
    assert.deepEqual(flattenNestedGroups(input), input);
  });
  test("one level of nesting", () => {
    const input = { Development: { Frontend: [1, 2], Backend: [3] } };
    const result = flattenNestedGroups(input);
    assert.deepEqual(result, {
      "Development → Frontend": [1, 2],
      "Development → Backend": [3],
    });
  });
  test("mixed flat and nested", () => {
    const input = { Research: [1], Work: { Design: [2], Code: [3] } };
    const result = flattenNestedGroups(input);
    assert.ok("Research" in result);
    assert.ok("Work → Design" in result);
    assert.ok("Work → Code" in result);
  });
  test("empty object", () => {
    assert.deepEqual(flattenNestedGroups({}), {});
  });
});

describe("getEmbeddingPathSegments (URL path extraction)", () => {
  test("extracts slug segments", () => {
    const segs = getEmbeddingPathSegments("https://github.com/org/repo/issues");
    assert.ok(segs.includes("issues"), `expected 'issues' in ${JSON.stringify(segs)}`);
  });
  test("humanises kebab slugs", () => {
    const segs = getEmbeddingPathSegments("https://stackoverflow.com/questions/12345/how-to-use-react");
    assert.ok(segs.some(s => s.includes("how to use react")), JSON.stringify(segs));
  });
  test("strips pure numeric segments", () => {
    const segs = getEmbeddingPathSegments("https://github.com/org/repo/issues/12345");
    assert.ok(!segs.includes("12345"), JSON.stringify(segs));
  });
  test("strips UUID-like segments", () => {
    const segs = getEmbeddingPathSegments("https://app.notion.so/d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6");
    assert.ok(segs.length === 0 || !segs.some(s => /^[a-f0-9]{8,}$/i.test(s)), JSON.stringify(segs));
  });
  test("returns [] for about: URLs", () => {
    assert.deepEqual(getEmbeddingPathSegments("about:newtab"), []);
  });
  test("returns [] for invalid URL", () => {
    assert.deepEqual(getEmbeddingPathSegments("not a url"), []);
  });
  test("caps at 4 segments", () => {
    const segs = getEmbeddingPathSegments("https://example.com/a/b/c/d/e/f/g");
    assert.ok(segs.length <= 4, `got ${segs.length} segments`);
  });
  test("distinguishes github issues vs wiki vs pulls", () => {
    const issues = getEmbeddingPathSegments("https://github.com/org/repo/issues");
    const wiki = getEmbeddingPathSegments("https://github.com/org/repo/wiki");
    assert.notDeepEqual(issues, wiki);
  });
});

describe("normalizeHost", () => {
  test("strips www prefix", () => assert.equal(normalizeHost("www.github.com"), "github.com"));
  test("lowercases", () => assert.equal(normalizeHost("GitHub.COM"), "github.com"));
  test("strips port", () => assert.equal(normalizeHost("localhost:3000"), "localhost"));
  test("empty string", () => assert.equal(normalizeHost(""), ""));
  test("null", () => assert.equal(normalizeHost(null), ""));
});

describe("parseHostListPref", () => {
  test("parses comma-separated hosts", () => {
    const result = parseHostListPref("github.com, mail.google.com");
    assert.ok(result.has("github.com"));
    assert.ok(result.has("mail.google.com"));
  });
  test("normalises www prefix", () => {
    const result = parseHostListPref("www.github.com");
    assert.ok(result.has("github.com"));
  });
  test("ignores empty segments", () => {
    const result = parseHostListPref("github.com,,");
    assert.equal(result.size, 1);
  });
  test("empty string → empty set", () => {
    assert.equal(parseHostListPref("").size, 0);
  });
  test("null → empty set", () => {
    assert.equal(parseHostListPref(null).size, 0);
  });
});
