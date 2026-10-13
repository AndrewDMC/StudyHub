import {
  AbsoluteFill,
  Img,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import {
  activeState,
  CLICK,
  FlowPlayer,
  TRAVEL,
  type FlowState,
} from "../flow/FlowPlayer";
import manifest from "../../public/flows/manifest.json";
import { colors, fontFamily } from "../theme";
import { Float, PHONE, phoneScale, PhoneScreenshot, PhoneShell } from "./Phone";
import { ReelBackdrop } from "./ReelBackdrop";
import { WordPop } from "./WordPop";

const flows = manifest as unknown as Record<string, FlowState[]>;
const ease = (p: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, p)), 3);
const easeInOut = (p: number) => {
  const q = Math.min(1, Math.max(0, p));
  return q < 0.5 ? 4 * q * q * q : 1 - Math.pow(-2 * q + 2, 3) / 2;
};

// Zona sicura del reel: le didascalie stanno in alto, lontano dai pulsanti della piattaforma in basso.
const Caption: React.FC<{
  readonly text: string;
  readonly size?: number;
  readonly delay?: number;
  readonly top?: number;
}> = ({ text, size = 76, delay = 0, top = 230 }) => (
  <div style={{ position: "absolute", top, left: 70, right: 70 }}>
    <WordPop text={text} size={size} delay={delay} />
  </div>
);

/* ---------- 1. Gancio: esame vicino, appunti ovunque -> logo ---------- */

const chips = [
  { label: "appunti.pdf", from: [-300, 300], to: [260, 470], rot: -8 },
  { label: "lavagna.jpg", from: [1400, 400], to: [820, 560], rot: 7 },
  { label: "esami_2024.pdf", from: [-300, 1500], to: [290, 1320], rot: 5 },
  { label: "schemi.png", from: [1400, 1400], to: [800, 1240], rot: -6 },
  { label: "dispense.pdf", from: [540, 2200], to: [540, 1500], rot: 3 },
];

export const ReelHook: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const converge = easeInOut((frame - 70) / 22);
  const textOut = interpolate(frame, [66, 78], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const logo = spring({
    frame: frame - 92,
    fps,
    config: { damping: 11, stiffness: 160 },
  });
  const flash = interpolate(frame, [91, 93, 104], [0, 0.22, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <ReelBackdrop>
      {chips.map((c, i) => {
        const inP = ease((frame - 18 - i * 4) / 22);
        const x = interpolate(inP, [0, 1], [c.from[0], c.to[0]]);
        const y =
          interpolate(inP, [0, 1], [c.from[1], c.to[1]]) +
          Math.sin((frame + i * 20) / 12) * 8 * (1 - converge);
        return (
          <div
            key={c.label}
            style={{
              position: "absolute",
              left: x + (540 - x) * converge,
              top: y + (900 - y) * converge,
              transform: `translate(-50%, -50%) rotate(${c.rot * (1 - converge)}deg) scale(${1 - converge * 0.85})`,
              opacity: 1 - converge,
              fontSize: 40,
              fontWeight: 600,
              color: colors.text,
              padding: "18px 30px",
              borderRadius: 16,
              border: `1px solid ${colors.line}`,
              background: "rgba(20,22,29,0.92)",
              boxShadow: "0 20px 50px rgba(0,0,0,0.5)",
              whiteSpace: "nowrap",
            }}
          >
            {c.label}
          </div>
        );
      })}
      <AbsoluteFill
        style={{
          justifyContent: "center",
          alignItems: "center",
          gap: 40,
          padding: "0 70px",
          opacity: textOut,
          flexDirection: "column",
        }}
      >
        <WordPop text="Esame tra *10 giorni.*" size={124} />
        <WordPop
          text="E gli appunti sono ovunque."
          size={64}
          delay={30}
          color={colors.muted}
        />
      </AbsoluteFill>
      <AbsoluteFill
        style={{
          justifyContent: "center",
          alignItems: "center",
          flexDirection: "column",
          gap: 40,
        }}
      >
        <div
          style={{
            fontSize: 190,
            fontWeight: 800,
            letterSpacing: -7,
            color: colors.text,
            opacity: logo,
            transform: `scale(${interpolate(logo, [0, 1], [1.7, 1])})`,
          }}
        >
          Study<span style={{ color: colors.accent }}>Hub</span>
        </div>
        <div style={{ padding: "0 70px" }}>
          <WordPop
            text="Carichi gli appunti. *L'AI fa il resto.*"
            size={66}
            delay={104}
            stagger={2}
          />
        </div>
      </AbsoluteFill>
      <AbsoluteFill style={{ background: "#fff", opacity: flash }} />
    </ReelBackdrop>
  );
};

/* ---------- 1b. AI: un PDF entra, l'AI lo legge e genera tutto il materiale ---------- */

const AI_SCAN = 26; // inizio scansione
const AI_BURST = 70; // le card generate esplodono fuori dal PDF
const outputs = [
  { label: "Flashcard", sub: "20 generate", x: 270, y: 690 },
  { label: "Riassunti", sub: "per argomento", x: 810, y: 690 },
  { label: "Schemi", sub: "mappe visive", x: 265, y: 1010 },
  { label: "Piano di studio", sub: "fino all'esame", x: 815, y: 1010 },
  { label: "Simulazioni", sub: "come all'esame", x: 270, y: 1330 },
  { label: "Correzione", sub: "delle risposte", x: 810, y: 1330 },
];

const Sparkle: React.FC<{ readonly size: number; readonly color?: string }> = ({
  size,
  color = "#fff",
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    style={{ display: "block" }}
  >
    <path
      d="M12 0c.6 6.2 5.8 11.4 12 12-6.2.6-11.4 5.8-12 12-.6-6.2-5.8-11.4-12-12C6.2 11.4 11.4 6.2 12 0z"
      fill={color}
    />
  </svg>
);

export const ReelAI: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const drop = spring({
    frame: frame - 2,
    fps,
    config: { damping: 13, stiffness: 140 },
  });
  const scan = (frame - AI_SCAN) / 34; // 0..1 durante la lettura
  const scanning = scan > 0 && scan < 1;
  const burst = frame >= AI_BURST;
  // il PDF si rimpicciolisce al centro quando parte la generazione
  const shrink = easeInOut((frame - AI_BURST + 6) / 16);
  const pulse = 1 + Math.sin(frame / 4) * 0.06;
  const counter = Math.round(
    interpolate(frame, [AI_BURST + 6, AI_BURST + 40], [0, 20], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }),
  );
  return (
    <ReelBackdrop>
      {burst ? (
        <Caption
          key="b"
          text="L'AI genera *tutto il resto*"
          delay={AI_BURST}
          top={250}
        />
      ) : (
        <Caption key="a" text="Carichi i tuoi *appunti*" delay={4} top={250} />
      )}

      {/* raggi di collegamento PDF -> card */}
      <svg
        width={1080}
        height={1920}
        style={{ position: "absolute", inset: 0 }}
      >
        {outputs.map((o, i) => {
          const p = ease((frame - AI_BURST - i * 3) / 14);
          return (
            <line
              key={o.label}
              x1={540}
              y1={1010}
              x2={540 + (o.x - 540) * p}
              y2={1010 + (o.y - 1010) * p}
              stroke="rgba(91,140,255,0.35)"
              strokeWidth={3}
              strokeDasharray="10 12"
              strokeDashoffset={-frame * 2}
            />
          );
        })}
      </svg>

      {/* il documento */}
      <div
        style={{
          position: "absolute",
          left: 540,
          top: 1010,
          width: 380,
          height: 500,
          borderRadius: 26,
          background: "#f4f5f7",
          overflow: "hidden",
          boxShadow: `0 40px 120px rgba(0,0,0,0.6), 0 0 ${scanning || burst ? 120 : 0}px rgba(91,140,255,0.55)`,
          opacity: interpolate(drop, [0, 0.3], [0, 1], {
            extrapolateRight: "clamp",
          }),
          transform: `translate(-50%, -50%) translateY(${interpolate(drop, [0, 1], [-500, 0])}px) rotate(${interpolate(drop, [0, 1], [-14, 0])}deg) scale(${1 - shrink * 0.55})`,
        }}
      >
        <div
          style={{
            height: 70,
            background: "#e2524a",
            color: "#fff",
            fontSize: 30,
            fontWeight: 800,
            display: "flex",
            alignItems: "center",
            padding: "0 28px",
          }}
        >
          appunti.pdf
        </div>
        <div
          style={{
            padding: "30px 28px",
            display: "flex",
            flexDirection: "column",
            gap: 20,
          }}
        >
          {[0.9, 0.75, 0.95, 0.6, 0.85, 0.7, 0.92, 0.5, 0.8, 0.66].map(
            (w, i) => {
              const read = scan * 11 > i + 1;
              return (
                <div
                  key={i}
                  style={{
                    height: 14,
                    width: `${w * 100}%`,
                    borderRadius: 7,
                    background: read ? colors.accent : "#c9ccd4",
                    opacity: read ? 0.85 : 1,
                  }}
                />
              );
            },
          )}
        </div>
        {scanning ? (
          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: 70 + scan * 430 - 60,
              height: 60,
              background:
                "linear-gradient(180deg, rgba(91,140,255,0) 0%, rgba(91,140,255,0.55) 100%)",
              borderBottom: `4px solid ${colors.accent}`,
            }}
          />
        ) : null}
      </div>

      {/* badge AI che pulsa durante la lettura */}
      <div
        style={{
          position: "absolute",
          left: 540,
          top: burst ? 1010 : 1330,
          transform: `translate(-50%, -50%) scale(${(burst ? shrink : interpolate(frame, [AI_SCAN - 6, AI_SCAN], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })) * pulse})`,
          display: "flex",
          alignItems: "center",
          gap: 14,
          padding: "20px 34px",
          borderRadius: 999,
          background: colors.accent,
          color: "#fff",
          fontSize: 46,
          fontWeight: 800,
          boxShadow: "0 0 60px rgba(91,140,255,0.8)",
          opacity: scanning || burst ? 1 : 0,
        }}
      >
        <Sparkle size={40} /> AI
      </div>

      {/* card generate */}
      {outputs.map((o, i) => {
        const p = spring({
          frame: frame - AI_BURST - i * 3,
          fps,
          config: { damping: 12, stiffness: 150, mass: 0.7 },
        });
        return (
          <div
            key={o.label}
            style={{
              position: "absolute",
              left: 540 + (o.x - 540) * p,
              top: 1010 + (o.y - 1010) * p,
              transform: `translate(-50%, -50%) scale(${p}) rotate(${(i % 2 ? 1 : -1) * 3 * p}deg)`,
              opacity: interpolate(p, [0, 0.2], [0, 1], {
                extrapolateRight: "clamp",
              }),
              width: 380,
              padding: "28px 30px",
              borderRadius: 26,
              background: "rgba(20,22,29,0.95)",
              border: `2px solid ${i === 0 ? colors.accent : colors.line}`,
              boxShadow: "0 24px 60px rgba(0,0,0,0.55)",
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                fontSize: 44,
                fontWeight: 800,
                color: colors.text,
                letterSpacing: -1,
              }}
            >
              <Sparkle size={28} color={colors.accent} />
              {o.label}
            </div>
            <div style={{ fontSize: 30, fontWeight: 600, color: colors.muted }}>
              {i === 0 ? `${counter} generate` : o.sub}
            </div>
          </div>
        );
      })}
    </ReelBackdrop>
  );
};

/* ---------- 2. Telefono: dashboard -> materia -> ripasso ---------- */

const navHolds = [30, 26, 30, 34, 56];
const navStates = flows.mnav.map((s, i) => ({ ...s, hold: navHolds[i] }));
const navCaptions = [
  "Apri l'app: sai già cosa fare *oggi*",
  "Scegli la *materia*",
  "Argomenti *estratti dall'AI*",
  "Flashcard *create dall'AI* dai tuoi appunti",
  "Ripassi solo ciò che stai per *dimenticare*",
];
// frame di inizio di ogni stato: la didascalia cambia insieme alla schermata
const navStarts = navStates.reduce<number[]>(
  (acc, s, i) => [
    ...acc,
    i === 0
      ? 0
      : acc[i - 1] +
        navHolds[i - 1] +
        (navStates[i - 1].x !== undefined ? TRAVEL + CLICK : 0),
  ],
  [],
);

export const ReelNav: React.FC = () => {
  const frame = useCurrentFrame();
  const idx = activeState(navStates, frame);
  return (
    <ReelBackdrop>
      <Caption
        key={idx}
        text={navCaptions[idx]}
        delay={navStarts[idx] + (idx === 0 ? 4 : 0)}
      />
      <Float>
        <FlowPlayer
          states={navStates}
          viewport={PHONE.viewport}
          frameWidth={PHONE.screenW}
          device="phone"
          zoom={1.08}
          drift={0.04}
          left={PHONE.left}
          top={PHONE.top}
        />
      </Float>
    </ReelBackdrop>
  );
};

/* ---------- 3. Ricerca ⌘K: card desktop ingrandita ---------- */

const searchHolds = [16, 8, 8, 36, 60];
const searchStates = flows.search
  .slice(1)
  .map((s, i) => ({ ...s, hold: searchHolds[i] }));

export const ReelSearch: React.FC = () => {
  const frame = useCurrentFrame();
  const results = activeState(searchStates, frame) === searchStates.length - 1;
  return (
    <ReelBackdrop>
      <div
        style={{
          position: "absolute",
          left: -40,
          right: -40,
          top: 1430,
          textAlign: "center",
          fontSize: 520,
          fontWeight: 800,
          letterSpacing: -20,
          color: "rgba(91,140,255,0.07)",
          transform: `translateY(${interpolate(frame, [0, 140], [40, -40])}px)`,
        }}
      >
        ⌘K
      </div>
      <Caption text="Cerca tutto con *⌘K*" size={88} delay={4} top={330} />
      <FlowPlayer
        states={searchStates}
        viewport={{ w: 1600, h: 900 }}
        crop={{ x: 524, y: 122, w: 552, h: 196 }}
        frameWidth={960}
        device="browser"
        zoom={1}
        drift={0.05}
        showCursor={false}
        left={60}
        top={800}
      />
      {results ? (
        <Caption
          text="Materie, piani e flashcard *in un attimo*"
          size={58}
          top={1340}
          delay={searchHolds.slice(0, -1).reduce((a, b) => a + b, 0)}
        />
      ) : null}
    </ReelBackdrop>
  );
};

/* ---------- 4. Piano che scorre sul telefono ---------- */

const PIANO_END = 2139; // fine della lista nella cattura 390x2600
const HEADER_H = 49;
const TABBAR_Y = 788;

export const ReelPiano: React.FC = () => {
  const frame = useCurrentFrame();
  const pan =
    easeInOut((frame - 20) / 96) * (PIANO_END - PHONE.viewport.h + 76);
  const s = phoneScale;
  return (
    <ReelBackdrop>
      <Caption text="L'AI ti prepara un piano *giorno per giorno*" delay={4} />
      <Float>
        <PhoneShell>
          <Img
            src={staticFile("flows/mpiano-full.png")}
            style={{
              position: "absolute",
              left: 0,
              top: -pan * s,
              width: PHONE.screenW,
            }}
          />
          {/* intestazione e tab bar restano fisse come nell'app vera */}
          <div
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              width: PHONE.screenW,
              height: HEADER_H * s,
              overflow: "hidden",
            }}
          >
            <Img
              src={staticFile("flows/mpiano-full.png")}
              style={{ width: PHONE.screenW, display: "block" }}
            />
          </div>
          <div
            style={{
              position: "absolute",
              left: 0,
              bottom: 0,
              width: PHONE.screenW,
              height: (PHONE.viewport.h - TABBAR_Y) * s,
              overflow: "hidden",
            }}
          >
            <Img
              src={staticFile("flows/mnav-subject.png")}
              style={{
                position: "absolute",
                left: 0,
                top: -TABBAR_Y * s,
                width: PHONE.screenW,
              }}
            />
          </div>
        </PhoneShell>
      </Float>
    </ReelBackdrop>
  );
};

/* ---------- 5. Funzioni a tagli rapidi ---------- */

const features = [
  "Legge PDF e foto",
  "Simula l'esame",
  "Corregge le risposte",
  "Risponde alle domande",
  "Crea drill sui punti deboli",
];
const INTRO = 22;
const CUT = 17;

export const ReelFeatures: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (frame < INTRO) {
    return (
      <ReelBackdrop>
        <AbsoluteFill
          style={{
            justifyContent: "center",
            alignItems: "center",
            padding: "0 70px",
          }}
        >
          <WordPop text="E l'AI *non si ferma qui.*" size={110} />
        </AbsoluteFill>
      </ReelBackdrop>
    );
  }
  const i = Math.min(features.length - 1, Math.floor((frame - INTRO) / CUT));
  const local = frame - INTRO - i * CUT;
  const p = spring({
    frame: local,
    fps,
    config: { damping: 14, stiffness: 220 },
  });
  const accent = i % 2 === 0;
  return (
    <AbsoluteFill
      style={{
        background: accent ? colors.accent : "#0e1018",
        justifyContent: "center",
        alignItems: "center",
        padding: "0 70px",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 30,
          transform: `scale(${interpolate(p, [0, 1], [1.18, 1])})`,
          opacity: interpolate(p, [0, 0.3], [0, 1], {
            extrapolateRight: "clamp",
          }),
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            fontSize: 44,
            fontWeight: 600,
            color: accent ? "rgba(255,255,255,0.75)" : colors.accent,
            letterSpacing: 2,
          }}
        >
          <Sparkle
            size={34}
            color={accent ? "rgba(255,255,255,0.75)" : colors.accent}
          />
          {String(i + 1).padStart(2, "0")} /{" "}
          {String(features.length).padStart(2, "0")}
        </div>
        <div
          style={{
            fontSize: 116,
            fontWeight: 800,
            letterSpacing: -3,
            lineHeight: 1.05,
            color: "#fff",
            textAlign: "center",
          }}
        >
          {features[i]}
        </div>
      </div>
    </AbsoluteFill>
  );
};

/* ---------- 6. Chiusura ---------- */

// Frase a effetto in due battute, poi il logo "firma" la chiusura.
const OUTRO_LOGO = 52;

export const ReelOutro: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const logo = spring({
    frame: frame - OUTRO_LOGO,
    fps,
    config: { damping: 13, stiffness: 150 },
  });
  const lift = easeInOut((frame - OUTRO_LOGO + 4) / 14);
  return (
    <ReelBackdrop>
      <AbsoluteFill
        style={{
          justifyContent: "center",
          alignItems: "center",
          flexDirection: "column",
          gap: 34,
          padding: "0 70px",
          transform: `translateY(${-lift * 230}px) scale(${1 - lift * 0.25})`,
        }}
      >
        <WordPop text="Tu studi." size={150} delay={2} />
        <WordPop text="Al resto *pensa l'AI.*" size={104} delay={18} />
      </AbsoluteFill>
      <AbsoluteFill
        style={{
          justifyContent: "center",
          alignItems: "center",
          flexDirection: "column",
          gap: 30,
          paddingTop: 420,
        }}
      >
        <div
          style={{
            fontSize: 130,
            fontWeight: 800,
            letterSpacing: -5,
            color: colors.text,
            opacity: logo,
            transform: `scale(${interpolate(logo, [0, 1], [1.4, 1])})`,
          }}
        >
          Study<span style={{ color: colors.accent }}>Hub</span>
        </div>
        <WordPop
          text="Salvalo prima della sessione d'esami"
          size={44}
          delay={OUTRO_LOGO + 16}
          color={colors.muted}
          stagger={2}
        />
      </AbsoluteFill>
    </ReelBackdrop>
  );
};

/* ---------- Copertina ---------- */

export const ReelCover: React.FC = () => (
  <ReelBackdrop>
    <AbsoluteFill style={{ fontFamily }}>
      <div style={{ position: "absolute", top: 200, left: 70, right: 70 }}>
        <WordPop
          text="Carichi gli appunti. *L'AI fa il resto.*"
          size={96}
          animate={false}
        />
      </div>
      <div
        style={{ transform: "rotate(-4deg)", position: "absolute", inset: 0 }}
      >
        <PhoneScreenshot img="mnav-dash.png" />
      </div>
    </AbsoluteFill>
  </ReelBackdrop>
);
