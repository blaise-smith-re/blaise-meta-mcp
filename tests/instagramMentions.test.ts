import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadConfig } from "../src/config.js";
import { MetaGraphClient } from "../src/meta/client.js";
import { registerInstagramGetMentions } from "../src/tools/instagramMentions.js";
import { jsonResponse } from "./mocks/graphApiFixtures.js";

/**
 * Verifies the capability narrowing from the account-architecture QC pass:
 * this tool must never call GET /{ig-user-id}/tags (tagged-media listing),
 * since that edge is not supported under "Instagram API with Instagram
 * Login" — see src/tools/instagramMentions.ts and docs/TOOLS.md.
 */
async function invokeTool(
  args: Record<string, unknown>,
): Promise<{ content: { type: "text"; text: string }[]; structuredContent?: unknown }> {
  const config = loadConfig({
    META_IG_ACCESS_TOKEN: "A".repeat(40),
    META_IG_USER_ID: "17841400000000000",
  } as NodeJS.ProcessEnv);
  const igClient = new MetaGraphClient({
    baseUrl: "https://graph.instagram.com",
    accessToken: config.metaIgAccessToken,
    graphApiVersion: config.graphApiVersion,
  });

  const server = new McpServer({ name: "test-server", version: "0.0.0" });
  const spy = vi.spyOn(server, "registerTool");
  registerInstagramGetMentions(server, { igClient, config });

  const handler = spy.mock.calls[0]![2] as (
    args: Record<string, unknown>,
  ) => Promise<{ content: { type: "text"; text: string }[]; structuredContent?: unknown }>;
  return handler(args);
}

describe("instagram_get_mentions never calls the unsupported /tags edge", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("makes no network call at all when neither ID is provided, and explains why", async () => {
    const result = await invokeTool({ response_format: "markdown" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.content[0]!.text).toContain("no endpoint that lists all @mentions");
  });

  it("resolves a caption mention without ever requesting /tags", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        id: "17841400000000000",
        mentioned_media: { id: "media1", caption: "hi @you" },
      }),
    );
    const result = await invokeTool({ mentioned_media_id: "media1", response_format: "json" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const requestedUrl = fetchMock.mock.calls[0]![0] as URL;
    expect(requestedUrl.pathname).not.toContain("tags");
    expect(requestedUrl.searchParams.get("fields")).toContain("mentioned_media.media_id(media1)");
    const structured = JSON.parse(result.content[0]!.text);
    expect(structured.resolved_media_mention).toBeTruthy();
  });

  it("resolves a comment mention without ever requesting /tags", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        id: "17841400000000000",
        mentioned_comment: { id: "comment1", text: "@you nice!" },
      }),
    );
    const result = await invokeTool({ mentioned_comment_id: "comment1", response_format: "json" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const requestedUrl = fetchMock.mock.calls[0]![0] as URL;
    expect(requestedUrl.pathname).not.toContain("tags");
    expect(requestedUrl.searchParams.get("fields")).toContain(
      "mentioned_comment.comment_id(comment1)",
    );
    const structured = JSON.parse(result.content[0]!.text);
    expect(structured.resolved_comment_mention).toBeTruthy();
  });
});
