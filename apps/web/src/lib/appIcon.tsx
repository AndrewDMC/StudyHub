import { ImageResponse } from 'next/og';

/**
 * The app mark, drawn at request time so the repo carries no binary icons: two stacked
 * flashcards in the accent blue on the dark base. `safeZone` shrinks the mark into the
 * central 80% that Android's maskable crop keeps.
 */
export function appIconResponse(size: number, { safeZone = false } = {}) {
  const scale = safeZone ? 0.8 : 1;
  const card = { w: size * 0.5 * scale, h: size * 0.36 * scale, r: size * 0.06 * scale };
  const offset = size * 0.09 * scale;

  return new ImageResponse(
    <div
      style={{
        width: size,
        height: size,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#0a0b0f',
        borderRadius: safeZone ? 0 : size * 0.22,
      }}
    >
      <div
        style={{
          position: 'relative',
          display: 'flex',
          width: card.w + offset,
          height: card.h + offset,
        }}
      >
        <div
          style={{
            position: 'absolute',
            left: offset,
            top: 0,
            width: card.w,
            height: card.h,
            borderRadius: card.r,
            border: `${Math.max(2, size * 0.025 * scale)}px solid #2e3441`,
            background: '#171a21',
          }}
        />
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: offset,
            width: card.w,
            height: card.h,
            borderRadius: card.r,
            background: '#5b8cff',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            gap: card.h * 0.14,
            padding: `0 ${card.w * 0.16}px`,
          }}
        >
          <div
            style={{ height: card.h * 0.1, width: '70%', borderRadius: 999, background: '#0a0b0f' }}
          />
          <div
            style={{
              height: card.h * 0.1,
              width: '45%',
              borderRadius: 999,
              background: '#0a0b0f',
              opacity: 0.6,
            }}
          />
        </div>
      </div>
    </div>,
    { width: size, height: size },
  );
}
