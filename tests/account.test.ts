import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { getIgUserId } from "../src/meta/account.js";

describe("getIgUserId", () => {
  it("returns the configured Instagram Business Account ID directly, with no network call", () => {
    const config = loadConfig({
      META_IG_ACCESS_TOKEN: "A".repeat(40),
      META_IG_USER_ID: "17841400000000000",
    } as NodeJS.ProcessEnv);

    expect(getIgUserId(config)).toBe("17841400000000000");
  });
});
