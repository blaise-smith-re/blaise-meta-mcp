import { afterEach, describe, expect, it } from "vitest";
import { clearRegisteredSecrets, redact, registerSecrets } from "../src/logger.js";

describe("redact", () => {
  afterEach(() => {
    clearRegisteredSecrets();
  });

  it("replaces a registered secret wherever it appears", () => {
    const token = "EAABsbCS1iHgBOtokenvaluehere1234567890";
    registerSecrets([token]);
    const result = redact(`Authorization: Bearer ${token}`);
    expect(result).not.toContain(token);
    expect(result).toContain("[REDACTED]");
  });

  it("redacts a registered secret embedded inside a URL", () => {
    const token = "EAABsbCS1iHgBOtokenvaluehere1234567890";
    registerSecrets([token]);
    const result = redact(`https://graph.facebook.com/v25.0/me?access_token=${token}`);
    expect(result).not.toContain(token);
  });

  it("never leaks the exact token even when logging a structured object", () => {
    const token = "EAABsbCS1iHgBOtokenvaluehere1234567890";
    registerSecrets([token]);
    const result = redact({ config: { metaPageAccessToken: token }, other: "fine" });
    expect(result).not.toContain(token);
  });

  it("redacts token-shaped strings even when not explicitly registered", () => {
    const result = redact("unexpected leaked value: abcdEFGH12345678ijklMNOPqrst");
    expect(result).toContain("[REDACTED]");
  });

  it("does not redact plain numeric IDs", () => {
    const result = redact("Facebook Page ID: 123456789012345");
    expect(result).toContain("123456789012345");
  });

  it("does not redact ISO timestamps", () => {
    const result = redact("posted at 2026-08-29T12:00:00+0000");
    expect(result).toContain("2026-08-29T12:00:00");
  });

  it("clearRegisteredSecrets removes previously registered secrets from redaction", () => {
    const token = "EAABsbCS1iHgBOtokenvaluehere1234567890";
    registerSecrets([token]);
    clearRegisteredSecrets();
    // The generic token-shaped pattern still catches it — clearing only
    // removes the exact-match registration, not the fallback pattern.
    // Re-register a *different* short benign string to prove the specific
    // registration was cleared rather than relying on the generic pattern.
    const short = "abc123";
    registerSecrets([short]);
    clearRegisteredSecrets();
    expect(redact(`value=${short}`)).toContain(short);
  });
});
