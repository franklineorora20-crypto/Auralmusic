const SOFTWARE_RENDERER_RE = /SwiftShader|llvmpipe|Software|Mesa|Microsoft Basic Render/i;

export interface FerrofluidBudgetInput {
  requestedDpr?: number;
  devicePixelRatio?: number;
  requestedFps?: number;
  isSoftware: boolean;
}

export interface FerrofluidBudget {
  dpr: number;
  fps: number;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

export function detectSoftwareRenderer(renderer: string | null | undefined): boolean {
  if (!renderer) return false;
  return SOFTWARE_RENDERER_RE.test(renderer);
}

export function computeFerrofluidBudget({
  requestedDpr,
  devicePixelRatio = 1,
  requestedFps = 36,
  isSoftware,
}: FerrofluidBudgetInput): FerrofluidBudget {
  const rawDpr = requestedDpr && requestedDpr > 0 ? requestedDpr : devicePixelRatio || 1;
  const clampedDpr = clamp(rawDpr, 0.2, 2);
  const clampedFps = Math.round(clamp(requestedFps, 1, 60));

  if (isSoftware) {
    return {
      dpr: Math.min(clampedDpr, 0.25),
      fps: Math.min(clampedFps, 8),
    };
  }

  return {
    dpr: clampedDpr,
    fps: clampedFps,
  };
}
