export function lerp(start: number, end: number, amount: number): number {
  return start + (end - start) * amount
}

export function smoothstepProgress(amount: number): number {
  const clamped = Math.min(1, Math.max(0, amount))
  return clamped * clamped * (3 - 2 * clamped)
}

export function smoothstep(start: number, end: number, amount: number): number {
  return lerp(start, end, smoothstepProgress(amount))
}

export function interpolateHeading(start: number, end: number, amount: number): number {
  const shortestDelta = ((end - start + 540) % 360) - 180
  return (start + shortestDelta * amount + 360) % 360
}
