import { describe, expect, it, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadConfig } from "../src/config.js";
import { MetaGraphClient } from "../src/meta/client.js";
import { registerAllTools } from "../src/tools/index.js";

const baseEnv = {
  META_IG_ACCESS_TOKEN: "A".repeat(40),
  META_IG_USER_ID: "17841400000000000",
};

function registeredToolNames(config: ReturnType<typeof loadConfig>): string[] {
  const server = new McpServer({ name: "test-server", version: "0.0.0" });
  const spy = vi.spyOn(server, "registerTool");

  const igClient = new MetaGraphClient({
    baseUrl: "https://graph.instagram.com",
    accessToken: config.metaIgAccessToken,
    graphApiVersion: config.graphApiVersion,
  });
  const fbClient = config.facebookPage.enabled
    ? new MetaGraphClient({
        baseUrl: "https://graph.facebook.com",
        accessToken: config.facebookPage.pageAccessToken!,
        graphApiVersion: config.graphApiVersion,
      })
    : undefined;

  registerAllTools(server, { igClient, fbClient, config });
  return spy.mock.calls.map((call) => call[0] as string);
}

describe("registerAllTools", () => {
  it("registers every Instagram tool, but no facebook_* tools, when the Facebook Page module is disabled (the default)", () => {
    const config = loadConfig(baseEnv as NodeJS.ProcessEnv);
    const names = registeredToolNames(config);

    expect(names).toContain("meta_get_account");
    expect(names).toContain("instagram_get_profile");
    expect(names).toContain("instagram_list_media");
    expect(names).toContain("instagram_get_media_insights");
    expect(names).toContain("instagram_get_account_insights");
    expect(names).toContain("instagram_list_comments");
    expect(names).toContain("instagram_get_mentions");

    expect(names).not.toContain("facebook_get_page");
    expect(names).not.toContain("facebook_list_posts");
    expect(names).not.toContain("facebook_get_post_insights");
  });

  it("also registers the facebook_* tools once the Facebook Page module is explicitly enabled and configured", () => {
    const config = loadConfig({
      ...baseEnv,
      ENABLE_FACEBOOK_PAGE_MODULE: "true",
      META_PAGE_ACCESS_TOKEN: "B".repeat(40),
      META_PAGE_ID: "9876543210",
    } as NodeJS.ProcessEnv);
    const names = registeredToolNames(config);

    expect(names).toContain("facebook_get_page");
    expect(names).toContain("facebook_list_posts");
    expect(names).toContain("facebook_get_post_insights");
  });

  it("never registers any write tool (future write layer is not wired in at all)", () => {
    const config = loadConfig(baseEnv as NodeJS.ProcessEnv);
    const names = registeredToolNames(config);
    expect(names).not.toContain("instagram_publish_media");
    expect(names).not.toContain("facebook_publish_post");
    expect(names).not.toContain("instagram_reply_to_comment");
  });
});
