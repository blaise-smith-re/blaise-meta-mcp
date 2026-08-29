export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export const expiredTokenError = {
  error: {
    message: "Error validating access token: Session has expired.",
    type: "OAuthException",
    code: 190,
  },
};

export const permissionError = {
  error: { message: "Permissions error", type: "OAuthException", code: 10 },
};

export const rateLimitError = {
  error: { message: "Application request limit reached", type: "OAuthException", code: 4 },
};

export const unsupportedMetricError = {
  error: {
    message: "(#100) profile_activity is not a valid metric for this endpoint",
    type: "OAuthException",
    code: 100,
  },
};

export const notFoundError = { error: { message: "Unsupported get request.", code: 803 } };
