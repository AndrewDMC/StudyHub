import { appIconResponse } from '@/lib/appIcon';

export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

/** iOS home-screen icon. iOS rounds the corners itself, so it is drawn full-bleed. */
export default function AppleIcon() {
  return appIconResponse(180, { safeZone: true });
}
