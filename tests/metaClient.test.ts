import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MetaGraphClient, type MetaGraphClientOptions } from "../src/meta/client.js";
import { GraphApiError } from "../src/meta/errors.js";
import {
  expiredTokenError,
  jsonResponse,
  notFoundError,
  permissionError,
  rateLimitError,
  unsupportedMetricError,
} from "./mocks/graphApiFixtures.js";

const clientOptions: MetaGraphClientOptions = {
  baseUrl: "https://graph.instagram.com",
  accessToken: "A".repeat(40),
  graphApiVersion: "v26.0",
};

describe("MetaGraphClient error handling", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("throws GraphApiError categorized as token_expired for code 190", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(expiredTokenError, 401));
    const client = new MetaGraphClient(clientOptions);
    await expect(client.get("me")).rejects.toMatchObject({ category: "token_expired" });
  });

  it("throws GraphApiError categorized as permission_denied for code 10", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(permissionError, 403));
    const client = new MetaGraphClient(clientOptions);
    await expect(client.get("me")).rejects.toMatchObject({ category: "permission_denied" });
  });

  it("throws GraphApiError categorized as rate_limited for code 4", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(rateLimitError, 400));
    const client = new MetaGraphClient(clientOptions);
    await expect(client.get("me")).rejects.toMatchObject({ category: "rate_limited" });
  });

  it("throws GraphApiError categorized as not_found for HTTP 404", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(notFoundError, 404));
    const client = new MetaGraphClient(clientOptions);
    await expect(client.get("me")).rejects.toMatchObject({ category: "not_found" });
  });

  it("agent-facing messages never include the raw access token", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(expiredTokenError, 401));
    const client = new MetaGraphClient(clientOptions);
    try {
      await client.get("me");
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(GraphApiError);
      const message = (error as GraphApiError).toAgentMessage();
      expect(message).not.toContain(clientOptions.accessToken);
    }
  });

  it("sends the access token as a Bearer header, never as a URL query param", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: "1" }));
    const client = new MetaGraphClient(clientOptions);
    await client.get("me");
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).not.toContain(clientOptions.accessToken);
    expect((init.headers as Record<string, string>).Authorization).toBe(
      `Bearer ${clientOptions.accessToken}`,
    );
  });

  it("wraps a network failure in a plain Error instead of leaking the raw fetch error", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    const client = new MetaGraphClient(clientOptions);
    await expect(client.get("me")).rejects.toThrow(/Network error calling Meta Graph API/);
  });
});

describe("MetaGraphClient.getInsightsWithFallback", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns all metrics directly when the full candidate list succeeds", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        data: [
          { name: "reach", values: [{ value: 100 }] },
          { name: "likes", values: [{ value: 5 }] },
        ],
      }),
    );
    const client = new MetaGraphClient(clientOptions);
    const result = await client.getInsightsWithFallback("media123/insights", ["reach", "likes"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.data).toHaveLength(2);
    expect(result.unavailableMetrics).toHaveLength(0);
  });

  it("falls back to per-metric requests when Meta rejects an unsupported metric", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(unsupportedMetricError, 400)) // combined attempt fails
      .mockResolvedValueOnce(jsonResponse({ data: [{ name: "reach", values: [{ value: 100 }] }] })) // reach ok
      .mockResolvedValueOnce(jsonResponse(unsupportedMetricError, 400)); // profile_activity rejected

    const client = new MetaGraphClient(clientOptions);
    const result = await client.getInsightsWithFallback("media123/insights", [
      "reach",
      "profile_activity",
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result.data).toEqual([{ name: "reach", values: [{ value: 100 }] }]);
    expect(result.unavailableMetrics).toEqual([
      { metric: "profile_activity", reason: expect.stringContaining("not a valid metric") },
    ]);
  });

  it("propagates a non-metric error (e.g. expired token) without falling back", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(expiredTokenError, 401));
    const client = new MetaGraphClient(clientOptions);
    await expect(
      client.getInsightsWithFallback("media123/insights", ["reach", "likes"]),
    ).rejects.toMatchObject({ category: "token_expired" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
