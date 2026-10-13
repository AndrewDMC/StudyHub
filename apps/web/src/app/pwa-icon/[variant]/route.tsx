import { appIconResponse } from '@/lib/appIcon';

/** Manifest icons (app/manifest.ts): `/pwa-icon/192`, `/pwa-icon/512`, `/pwa-icon/maskable`. */
const VARIANTS = {
  '192': { size: 192, safeZone: false },
  '512': { size: 512, safeZone: false },
  maskable: { size: 512, safeZone: true },
} as const;

export const dynamic = 'force-static';

export function generateStaticParams() {
  return Object.keys(VARIANTS).map((variant) => ({ variant }));
}

export async function GET(_request: Request, { params }: { params: Promise<{ variant: string }> }) {
  const { variant } = await params;
  const spec = VARIANTS[variant as keyof typeof VARIANTS];
  if (!spec) return new Response('Not found', { status: 404 });
  return appIconResponse(spec.size, { safeZone: spec.safeZone });
}
