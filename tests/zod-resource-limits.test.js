import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";

test("bounded Zod containers reject oversized input before validating elements", () => {
  for (const kind of ["array", "set", "map"]) {
    let visited = 0;
    const element = z.preprocess((value) => { visited++; return value; }, z.string());
    const schema = kind === "array" ? z.array(element).max(2)
      : kind === "set" ? z.set(element).max(2) : z.map(element, element).max(2);
    const values = Array.from({ length: 10_000 }, (_,index) => index);
    const input = kind === "array" ? values : kind === "set" ? new Set(values)
      : new Map(values.map(value => [value, value]));
    const parsed = schema.safeParse(input);
    assert.equal(parsed.success, false, kind);
    assert.equal(parsed.error.issues.length, 1, kind);
    assert.equal(parsed.error.issues[0].code, "too_big", kind);
    assert.equal(visited, 0, kind);
  }
});

test("bounded Zod array still validates in-bound elements", () => {
  const schema = z.array(z.string()).max(2);
  assert.deepEqual(schema.parse(["one", "two"]), ["one", "two"]);
  assert.equal(schema.safeParse([0]).success, false);
});
