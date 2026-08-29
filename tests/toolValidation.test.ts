import { describe, expect, it } from "vitest";
import { InstagramListMediaInputSchema } from "../src/tools/instagramMedia.js";
import { InstagramGetMediaInsightsInputSchema } from "../src/tools/instagramMediaInsights.js";
import { InstagramListCommentsInputSchema } from "../src/tools/instagramComments.js";
import { InstagramGetAccountInsightsInputSchema } from "../src/tools/instagramAccountInsights.js";
import { MetaGetAccountInputSchema } from "../src/tools/metaGetAccount.js";
import { FacebookGetPostInsightsInputSchema } from "../src/tools/facebookPostInsights.js";

describe("instagram_list_media input validation", () => {
  it("accepts no arguments and applies defaults", () => {
    const result = InstagramListMediaInputSchema.parse({});
    expect(result.limit).toBe(25);
    expect(result.response_format).toBe("markdown");
  });

  it("rejects a limit above the maximum page size", () => {
    expect(() => InstagramListMediaInputSchema.parse({ limit: 500 })).toThrow();
  });

  it("rejects a limit of zero or negative", () => {
    expect(() => InstagramListMediaInputSchema.parse({ limit: 0 })).toThrow();
    expect(() => InstagramListMediaInputSchema.parse({ limit: -5 })).toThrow();
  });

  it("rejects a non-integer limit", () => {
    expect(() => InstagramListMediaInputSchema.parse({ limit: 2.5 })).toThrow();
  });

  it("rejects an invalid response_format", () => {
    expect(() => InstagramListMediaInputSchema.parse({ response_format: "yaml" })).toThrow();
  });

  it("rejects unknown extra fields (strict schema)", () => {
    expect(() => InstagramListMediaInputSchema.parse({ unexpected_field: true })).toThrow();
  });
});

describe("instagram_get_media_insights input validation", () => {
  it("requires media_id", () => {
    expect(() => InstagramGetMediaInsightsInputSchema.parse({})).toThrow();
  });

  it("rejects an empty-string media_id", () => {
    expect(() => InstagramGetMediaInsightsInputSchema.parse({ media_id: "" })).toThrow();
  });

  it("accepts a valid media_id", () => {
    const result = InstagramGetMediaInsightsInputSchema.parse({ media_id: "17895695668004550" });
    expect(result.media_id).toBe("17895695668004550");
  });
});

describe("instagram_list_comments input validation", () => {
  it("requires media_id even though pagination fields are optional", () => {
    expect(() => InstagramListCommentsInputSchema.parse({ limit: 10 })).toThrow();
  });

  it("accepts an optional pagination cursor", () => {
    const result = InstagramListCommentsInputSchema.parse({ media_id: "123", after: "cursor-abc" });
    expect(result.after).toBe("cursor-abc");
  });
});

describe("instagram_get_account_insights input validation", () => {
  it("defaults period to 'day'", () => {
    const result = InstagramGetAccountInsightsInputSchema.parse({});
    expect(result.period).toBe("day");
  });

  it("rejects an unsupported period value", () => {
    expect(() => InstagramGetAccountInsightsInputSchema.parse({ period: "month" })).toThrow();
  });

  it("accepts week and days_28", () => {
    expect(InstagramGetAccountInsightsInputSchema.parse({ period: "week" }).period).toBe("week");
    expect(InstagramGetAccountInsightsInputSchema.parse({ period: "days_28" }).period).toBe(
      "days_28",
    );
  });
});

describe("meta_get_account input validation", () => {
  it("accepts an empty object", () => {
    expect(() => MetaGetAccountInputSchema.parse({})).not.toThrow();
  });

  it("rejects extra unknown fields", () => {
    expect(() => MetaGetAccountInputSchema.parse({ foo: "bar" })).toThrow();
  });
});

describe("facebook_get_post_insights input validation", () => {
  it("requires post_id", () => {
    expect(() => FacebookGetPostInsightsInputSchema.parse({})).toThrow();
  });

  it("accepts a valid post_id", () => {
    const result = FacebookGetPostInsightsInputSchema.parse({ post_id: "123_456" });
    expect(result.post_id).toBe("123_456");
  });
});
