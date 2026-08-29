import { describe, expect, it } from "vitest";
import { timingSafeEqual } from "../src/security.js";

describe("timingSafeEqual", () => {
  it("returns true for identical strings", () => {
    expect(timingSafeEqual("correct-horse-battery-staple", "correct-horse-battery-staple")).toBe(
      true,
    );
  });

  it("returns false for different strings of the same length", () => {
    expect(timingSafeEqual("correct-horse-battery-staple", "correct-horse-battery-staplf")).toBe(
      false,
    );
  });

  it("returns false for strings of different lengths", () => {
    expect(timingSafeEqual("short", "a-much-longer-string")).toBe(false);
  });

  it("returns false comparing against an empty string", () => {
    expect(timingSafeEqual("something", "")).toBe(false);
  });

  it("returns true for two empty strings", () => {
    expect(timingSafeEqual("", "")).toBe(true);
  });
});
