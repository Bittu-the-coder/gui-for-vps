import type { LucideIcon } from 'lucide-react';

/** A macOS-style app icon: a rounded tile with a two-stop gradient and a white glyph. */
export interface AppIconSpec {
  icon: LucideIcon;
  /** [top, bottom] gradient colours of the tile. */
  tint: readonly [string, string];
}

export function AppIcon({
  app,
  size = 40,
  className = '',
}: {
  app: AppIconSpec;
  size?: number;
  className?: string;
}) {
  const Glyph = app.icon;
  return (
    <span
      aria-hidden
      className={`inline-grid shrink-0 place-items-center text-white ${className}`}
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.2237, // the macOS "squircle" ratio, approximated with a radius
        background: `linear-gradient(180deg, ${app.tint[0]}, ${app.tint[1]})`,
        // inner top highlight + hairline edge + soft drop shadow
        boxShadow:
          'inset 0 1px 0 rgb(255 255 255 / 0.35), inset 0 0 0 0.5px rgb(0 0 0 / 0.18), 0 1px 2px rgb(0 0 0 / 0.25)',
      }}
    >
      <Glyph
        size={size * 0.56}
        strokeWidth={2}
        style={{ filter: 'drop-shadow(0 1px 1px rgb(0 0 0 / 0.25))' }}
      />
    </span>
  );
}
