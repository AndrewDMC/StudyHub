import {
  Img,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { colors } from "../theme";
import { BEZEL, PhoneBezel } from "./PhoneBezel";

export type FlowState = {
  readonly img: string;
  readonly x?: number;
  readonly y?: number;
  readonly hold?: number;
};

type Rect = {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
};

export const TRAVEL = 28; // frame di spostamento del cursore verso il bersaglio
export const CLICK = 4; // frame tra il clic e il cambio di stato
const RELEASE = 24; // frame di zoom-out dopo il clic: lungo, così l'uscita è morbida

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const easeInOut = (p: number) =>
  p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;

export const buildTimeline = (states: readonly FlowState[]) => {
  let t = 0;
  return states.map((s, i) => {
    const hasTarget = s.x !== undefined && s.y !== undefined;
    const hold =
      s.hold ??
      (hasTarget ? (i === 0 ? 24 : 12) : i === states.length - 1 ? 60 : 14);
    const start = t;
    const travelStart = start + hold;
    const clickAt = travelStart + TRAVEL;
    t += hold + (hasTarget ? TRAVEL + CLICK : 0);
    return { ...s, hasTarget, start, travelStart, clickAt, end: t };
  });
};

export const flowFrames = (states: readonly FlowState[]) => {
  const tl = buildTimeline(states);
  return tl[tl.length - 1].end;
};

/** Indice dello stato attivo al frame dato (l'ultimo resta attivo fino alla fine della scena). */
export const activeState = (states: readonly FlowState[], frame: number) => {
  const tl = buildTimeline(states);
  const i = tl.findIndex((st) => frame >= st.start && frame < st.end);
  return i === -1 ? tl.length - 1 : i;
};

type Props = {
  readonly states: readonly FlowState[];
  readonly captions?: readonly string[];
  readonly viewport: { readonly w: number; readonly h: number };
  /** porzione del viewport da inquadrare (default: tutto) */
  readonly crop?: Rect;
  readonly frameWidth: number;
  readonly device: "browser" | "phone";
  /** zoom massimo durante il clic: tenerlo basso (1.08–1.15) per un movimento morbido */
  readonly zoom: number;
  /** leggero zoom continuo lungo tutta la scena, per non lasciare mai l'immagine ferma */
  readonly drift?: number;
  readonly showCursor?: boolean;
  readonly left: number;
  readonly top: number;
  readonly captionLeft?: number;
  readonly captionAlign?: "center" | "left";
};

export const FlowPlayer: React.FC<Props> = ({
  states,
  captions = [],
  viewport,
  crop = { x: 0, y: 0, w: viewport.w, h: viewport.h },
  frameWidth,
  device,
  zoom,
  drift = 0,
  showCursor = true,
  left,
  top,
  captionLeft = 0,
  captionAlign = "center",
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const tl = buildTimeline(states);
  const s = frameWidth / crop.w;
  const frameH = crop.h * s;

  const idx = activeState(states, frame);
  const current = tl[idx];

  // cursore: parte da un punto fuori centro e si sposta verso ogni bersaglio
  let cursor = { x: crop.x + crop.w * 0.62, y: crop.y + crop.h * 0.78 };
  let prev = cursor;
  for (const st of tl) {
    if (!st.hasTarget) continue;
    const target = { x: st.x!, y: st.y! };
    if (frame < st.travelStart) {
      cursor = prev;
      break;
    }
    const p = easeInOut(clamp01((frame - st.travelStart) / TRAVEL));
    cursor = {
      x: prev.x + (target.x - prev.x) * p,
      y: prev.y + (target.y - prev.y) * p,
    };
    if (frame <= st.clickAt + CLICK) break;
    prev = target;
    cursor = target;
  }

  // zoom: entra piano verso il bersaglio e rilascia lentamente dopo il clic
  let env = 0;
  let origin = cursor;
  for (const st of tl) {
    if (!st.hasTarget) continue;
    const target = { x: st.x!, y: st.y! };
    if (frame >= st.travelStart && frame < st.end) {
      env = easeInOut(clamp01((frame - st.travelStart) / TRAVEL));
      origin = target;
    } else if (frame >= st.end && frame < st.end + RELEASE) {
      env = 1 - easeInOut((frame - st.end) / RELEASE);
      origin = target;
    }
  }
  const clickZoom = 1 + (zoom - 1) * env;
  const driftZoom = 1 + drift * (frame / durationInFrames);
  const camZoom = clickZoom * driftZoom;
  // Sul telefono lo schermo non si ingrandisce mai dentro la cornice (si romperebbe l'allineamento):
  // si avvicina il telefono intero. Sul browser la camera lavora dentro l'inquadratura.
  const isPhone = device === "phone";
  const zoomNow = isPhone ? 1 : camZoom;
  // la camera centra il bersaglio ma resta dentro l'inquadratura (niente testo tagliato)
  const winW = crop.w / zoomNow;
  const winH = crop.h / zoomNow;
  const camLeft = Math.min(
    crop.x + crop.w - winW,
    Math.max(crop.x, origin.x - winW / 2),
  );
  const camTop = Math.min(
    crop.y + crop.h - winH,
    Math.max(crop.y, origin.y - winH / 2),
  );

  const ripples = tl.filter(
    (st) => st.hasTarget && frame >= st.clickAt && frame < st.clickAt + 18,
  );
  const pressed = tl.some(
    (st) => st.hasTarget && frame >= st.clickAt - 2 && frame < st.clickAt + 4,
  );

  const text = captions.length
    ? captions[Math.min(idx, captions.length - 1)]
    : "";
  let runStart = current.start;
  for (
    let i = idx;
    i > 0 && captions[Math.min(i - 1, captions.length - 1)] === text;
    i--
  )
    runStart = tl[i - 1].start;
  const cap = spring({
    frame: frame - runStart,
    fps,
    config: { damping: 200 },
  });

  const enter = spring({ frame: frame - 4, fps, config: { damping: 200 } });

  const content = (
    <div
      style={{
        position: "relative",
        width: frameWidth,
        height: frameH,
        overflow: "hidden",
        background: colors.bg,
      }}
    >
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          transformOrigin: "0 0",
          transform: `translate(${-camLeft * s * zoomNow}px, ${-camTop * s * zoomNow}px) scale(${zoomNow})`,
        }}
      >
        <div
          style={{
            width: viewport.w,
            height: viewport.h,
            transformOrigin: "0 0",
            transform: `scale(${s})`,
            position: "relative",
          }}
        >
          <Img
            src={staticFile(`flows/${current.img}`)}
            style={{ width: viewport.w, height: viewport.h, display: "block" }}
          />
          {showCursor
            ? ripples.map((st) => {
                const p = (frame - st.clickAt) / 18;
                return (
                  <div
                    key={st.img}
                    style={{
                      position: "absolute",
                      left: st.x! - 40,
                      top: st.y! - 40,
                      width: 80,
                      height: 80,
                      borderRadius: 40,
                      border: `3px solid ${colors.accent}`,
                      background: "rgba(91,140,255,0.22)",
                      opacity: 1 - p,
                      transform: `scale(${0.3 + easeInOut(p) * 1.1})`,
                    }}
                  />
                );
              })
            : null}
          {showCursor ? (
            <svg
              width={44}
              height={44}
              viewBox="0 0 24 24"
              style={{
                position: "absolute",
                left: cursor.x - 3,
                top: cursor.y - 2,
                transform: `scale(${pressed ? 0.85 : 1})`,
                transformOrigin: "3px 2px",
                filter: "drop-shadow(0 3px 5px rgba(0,0,0,0.6))",
              }}
            >
              <path
                d="M3 2 L3 19 L7.5 14.8 L10.4 21.5 L13.2 20.3 L10.3 13.7 L16.5 13.5 Z"
                fill="#fff"
                stroke="#0b0c10"
                strokeWidth={1.4}
                strokeLinejoin="round"
              />
            </svg>
          ) : null}
        </div>
      </div>
    </div>
  );

  return (
    <>
      {text ? (
        <div
          style={{
            position: "absolute",
            top: 70,
            left: captionLeft,
            right: captionAlign === "center" ? 0 : undefined,
            display: "flex",
            justifyContent: captionAlign === "center" ? "center" : "flex-start",
            opacity: cap,
            transform: `translateY(${interpolate(cap, [0, 1], [24, 0])}px)`,
            fontSize: captionAlign === "center" ? 72 : 88,
            fontWeight: 800,
            letterSpacing: -2,
            color: colors.text,
            lineHeight: 1.05,
            maxWidth: captionAlign === "center" ? undefined : 760,
          }}
        >
          {text}
        </div>
      ) : null}
      {isPhone ? (
        // spinta continua attorno al centro del telefono, zoom del clic attorno al bersaglio
        <div
          style={{
            position: "absolute",
            inset: 0,
            transformOrigin: `${left + BEZEL + frameWidth / 2}px ${top + BEZEL + frameH / 2}px`,
            transform: `scale(${driftZoom})`,
          }}
        >
          <PhoneBezel
            width={frameWidth}
            height={frameH}
            style={{
              left,
              top,
              opacity: enter,
              transformOrigin: `${BEZEL + (origin.x - crop.x) * s}px ${BEZEL + (origin.y - crop.y) * s}px`,
              transform: `translateY(${interpolate(enter, [0, 1], [60, 0])}px) scale(${clickZoom})`,
            }}
          >
            {content}
          </PhoneBezel>
        </div>
      ) : (
        <div
          style={{
            position: "absolute",
            left,
            top,
            width: frameWidth,
            borderRadius: 18,
            overflow: "hidden",
            border: `1px solid ${colors.line}`,
            background: colors.panel,
            boxShadow:
              "0 40px 120px rgba(0,0,0,0.6), 0 0 80px rgba(91,140,255,0.15)",
            opacity: enter,
            transform: `translateY(${interpolate(enter, [0, 1], [60, 0])}px)`,
          }}
        >
          <div
            style={{
              height: 36,
              background: "#1b1e27",
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "0 14px",
            }}
          >
            {["#ff5f57", "#febc2e", "#28c840"].map((c) => (
              <div
                key={c}
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: 6,
                  background: c,
                }}
              />
            ))}
          </div>
          {content}
        </div>
      )}
    </>
  );
};
