import { logger } from "../logger.js";
import { GraphApiError, type GraphApiErrorPayload } from "./errors.js";

export interface MetaGraphClientOptions {
  /** e.g. https://graph.instagram.com or https://graph.facebook.com */
  baseUrl: string;
  accessToken: string;
  graphApiVersion: string;
}

export interface GraphRequestOptions {
  method?: "GET" | "POST" | "DELETE";
  query?: Record<string, string | number | boolean | undefined>;
  /** Overrides the configured access token for this single call (rarely needed). */
  accessToken?: string;
}

/**
 * Thin, centralized wrapper around every Meta Graph API call this server
 * makes. Nothing outside this file constructs a Graph API URL or reads the
 * access token — that keeps auth, versioning, and error handling in one
 * place instead of duplicated per tool.
 *
 * A single instance is bound to one base URL and one token, since this
 * server talks to two genuinely different Graph API surfaces depending on
 * account architecture: graph.instagram.com with an Instagram User Access
 * Token for Blaise's Instagram Professional account (the default, no
 * Facebook Page involved), and — only if the optional Facebook Page module
 * is enabled — graph.facebook.com with a Page Access Token. See
 * docs/META_SETUP.md for why these are different flows with different
 * hosts and tokens, not just a parameter.
 */
export class MetaGraphClient {
  constructor(private readonly options: MetaGraphClientOptions) {}

  private buildUrl(path: string, query: GraphRequestOptions["query"]): URL {
    const normalizedPath = path.startsWith("/") ? path.slice(1) : path;
    const url = new URL(
      `${this.options.baseUrl}/${this.options.graphApiVersion}/${normalizedPath}`,
    );
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    return url;
  }

  async request<T>(path: string, options: GraphRequestOptions = {}): Promise<T> {
    const { method = "GET", query } = options;
    const accessToken = options.accessToken ?? this.options.accessToken;
    const url = this.buildUrl(path, query);

    logger.debug(`Graph API ${method} ${url.pathname}`, { query });

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
        },
      });
    } catch (cause) {
      throw new Error(
        `Network error calling Meta Graph API: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }

    const json = (await response.json().catch(() => ({}))) as {
      error?: GraphApiErrorPayload;
    } & T;

    if (!response.ok || json.error) {
      const payload: GraphApiErrorPayload = json.error ?? {
        message: `HTTP ${response.status} ${response.statusText}`,
      };
      throw new GraphApiError(response.status, payload);
    }

    return json as T;
  }

  async get<T>(path: string, query?: GraphRequestOptions["query"]): Promise<T> {
    return this.request<T>(path, { method: "GET", query });
  }

  /**
   * Fetches an /insights edge for a candidate list of metrics, dynamically
   * dropping metrics Meta reports as unsupported for this object instead of
   * failing the whole call. Meta does not expose a "list supported metrics
   * for this object" endpoint, so the only reliable way to discover
   * availability is to ask and react to what comes back.
   *
   * Strategy:
   *  1. Try the full candidate list in one call (cheap — 1 request).
   *  2. If Meta rejects it as an unsupported-metric error, fall back to
   *     requesting metrics individually so partial data still comes back,
   *     and report which metrics were unavailable and why.
   */
  async getInsightsWithFallback(
    path: string,
    candidateMetrics: string[],
    extraQuery: Record<string, string | number | boolean | undefined> = {},
  ): Promise<{
    data: InsightMetricResult[];
    unavailableMetrics: { metric: string; reason: string }[];
  }> {
    try {
      const result = await this.get<{ data: InsightMetricResult[] }>(path, {
        ...extraQuery,
        metric: candidateMetrics.join(","),
      });
      return { data: result.data ?? [], unavailableMetrics: [] };
    } catch (error) {
      if (!(error instanceof GraphApiError) || error.category !== "unsupported_metric") {
        throw error;
      }

      logger.warn(
        `Some requested metrics are unsupported for ${path}; retrying metric-by-metric.`,
        { candidateMetrics },
      );

      const data: InsightMetricResult[] = [];
      const unavailableMetrics: { metric: string; reason: string }[] = [];

      for (const metric of candidateMetrics) {
        try {
          const result = await this.get<{ data: InsightMetricResult[] }>(path, {
            ...extraQuery,
            metric,
          });
          data.push(...(result.data ?? []));
        } catch (metricError) {
          const reason =
            metricError instanceof GraphApiError
              ? metricError.graphMessage
              : metricError instanceof Error
                ? metricError.message
                : String(metricError);
          unavailableMetrics.push({ metric, reason });
        }
      }

      return { data, unavailableMetrics };
    }
  }
}

export interface InsightMetricResult {
  name: string;
  period?: string;
  title?: string;
  description?: string;
  values?: { value: unknown; end_time?: string }[];
  total_value?: { value: unknown; breakdowns?: unknown[] };
}
