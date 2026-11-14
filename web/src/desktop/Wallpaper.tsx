import { useAppearance } from '../stores/appearanceStore';
import { useDesktop } from './windowStore';
import { wallpaperById } from './wallpapers';

/**
 * The desktop background. Both the light and the dark variant are always mounted and only their
 * opacity changes, so switching theme crossfades instead of flashing. The layers are oversized and
 * drift slowly (CSS animation, off under prefers-reduced-motion).
 */
export function Wallpaper() {
  const theme = useDesktop((s) => s.theme);
  const wp = wallpaperById(useAppearance((s) => s.wallpaper));
  const layer = 'wallpaper-drift absolute -inset-[8%] transition-opacity duration-700';
  return (
    <div aria-hidden className="absolute inset-0 overflow-hidden" data-wallpaper={wp.id}>
      <div className={layer} style={{ background: wp.light, opacity: theme === 'light' ? 1 : 0 }} />
      <div className={layer} style={{ background: wp.dark, opacity: theme === 'dark' ? 1 : 0 }} />
    </div>
  );
}
