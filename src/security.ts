import { timingSafeEqual as nodeTimingSafeEqual } from "node:crypto";

/**
 * Constant-time string comparison for secrets (passwords, tokens). A naive
 * `===` leaks timing information proportional to how many leading
 * characters match, which is a real (if narrow) side channel for anything
 * compared against user input over a network.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  // Buffers of different lengths would throw in node:crypto's timingSafeEqual.
  // Padding to a fixed length keeps the comparison itself constant-time;
  // the length check below is on public information (nothing secret leaks
  // by revealing that lengths differ before comparing content).
  if (bufA.length !== bufB.length) {
    nodeTimingSafeEqual(bufA, bufA); // burn equivalent time to a real compare
    return false;
  }
  return nodeTimingSafeEqual(bufA, bufB);
}
