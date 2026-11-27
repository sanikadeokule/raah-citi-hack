"use client";
// Maina, Raah's guide: an original mynah bird (the bird known for talking, common in rural Maharashtra), drawn as inline
// SVG so it costs no download and works offline. Poses change what she holds and how she moves; the motion lives in
// globals.css (.m-*) and stays still when the person has asked for less motion. Tapping her makes her cheer.
import { useEffect, useRef, useState } from "react";
import { SpeakButton } from "@/components/ui";
import { useApp } from "@/lib/store";

/** wave: hello · think: working or unsure · cheer: a win · clipboard: asking a question · happy: a nod for an answer ·
 *  comfort: it is OK · flag: a direction found (she plants a flag on the path) */
export type Pose = "wave" | "think" | "cheer" | "clipboard" | "happy" | "comfort" | "flag";
/** What she carries for a module: a graduation cap on her head, or something held in front of her in both wings. */
export type Item = "compass" | "coins" | "book" | "bag" | "cap";

const BODY = "#8b5a3c", WING = "#5e3a24", BELLY = "#c08d66", HEAD = "#2f2724", PATCH = "#ffc21a", BEAK = "#ffa000", SCARF = "#ff9933", INK = "#1d1d1d", PINK = "#ff6b81";

/** A wing hangs down from its shoulder at (x, y); `angle` swings it (0 = straight down, negative = out to the right). */
function Wing({ x, y, angle, scale = 1, anim = "" }: { x: number; y: number; angle: number; scale?: number; anim?: string }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${angle}) scale(${scale})`}>
      <g className={`m-wing ${anim}`}>
        <ellipse cx="0" cy="17" rx="8.5" ry="18" fill={WING} />
        {/* the white wing patch a real mynah shows in flight */}
        <ellipse cx="0" cy="29" rx="5.5" ry="4.5" fill="#fff" opacity=".92" />
      </g>
    </g>
  );
}

const sparkle = (cx: number, cy: number, r: number) => `M${cx} ${cy - r}Q${cx} ${cy} ${cx + r} ${cy}Q${cx} ${cy} ${cx} ${cy + r}Q${cx} ${cy} ${cx - r} ${cy}Q${cx} ${cy} ${cx} ${cy - r}Z`;
const heart = (x: number, y: number) => `M${x} ${y + 3}C${x - 4} ${y - 1} ${x - 9} ${y + 2} ${x - 6} ${y + 6}L${x} ${y + 12}L${x + 6} ${y + 6}C${x + 9} ${y + 2} ${x + 4} ${y - 1} ${x} ${y + 3}Z`;

// [left wing, right wing]; the right wing of "think" is drawn last, in front of her face
const WINGS: Record<Pose, [React.ReactNode, React.ReactNode]> = {
  wave: [<Wing key="l" x={34} y={64} angle={20} />, <Wing key="r" x={86} y={64} angle={-150} anim="m-wave" />],
  cheer: [<Wing key="l" x={34} y={64} angle={150} anim="m-flap" />, <Wing key="r" x={86} y={64} angle={-150} anim="m-flap" />],
  happy: [<Wing key="l" x={34} y={64} angle={55} anim="m-flap" />, <Wing key="r" x={86} y={64} angle={-55} anim="m-flap" />],
  think: [<Wing key="l" x={34} y={64} angle={20} />, <Wing key="r" x={84} y={70} angle={105} scale={0.72} />],
  clipboard: [<Wing key="l" x={34} y={64} angle={-35} />, <Wing key="r" x={86} y={64} angle={35} />],
  comfort: [<Wing key="l" x={34} y={66} angle={-62} />, <Wing key="r" x={86} y={66} angle={62} />],
  flag: [<Wing key="l" x={34} y={64} angle={20} />, <Wing key="r" x={86} y={64} angle={-140} scale={0.66} />],
};
const BODY_MOTION: Partial<Record<Pose, string>> = { cheer: "m-hop", happy: "m-nod", comfort: "m-sway", flag: "m-nod" };

/** The welcome scene: the raah forks behind her, and a signpost names it. Drawn around the 120×120 bird. */
function Scene() {
  return (
    <g>
      <path d="M-34 84Q4 92 44 104L50 112Q6 100 -34 90Z" fill="var(--m-path)" />
      <path d="M154 80Q116 92 76 104L70 112Q114 100 154 86Z" fill="var(--m-path)" />
      <path d="M36 128L46 106L74 106L84 128Z" fill="var(--m-path)" />
      <path d="M-20 88.5l8 2M2 94l8 2.2M24 100l7 2M140 85l-8 2M118 92l-8 2.2M96 98.5l-7 2M58 112v5M62 121v5" stroke="var(--m-path-line)" strokeWidth="1.6" strokeLinecap="round" />
      <rect x="134" y="38" width="6" height="56" rx="1.5" fill={WING} />
      <ellipse cx="137" cy="94" rx="9" ry="2.5" fill="var(--m-shadow)" />
      <path d="M112 38h40l8 8-8 8h-40Z" fill="#c9792b" />
      <text x="134" y="50.5" textAnchor="middle" fontSize="11" fontWeight="700" fill="#fff" fontFamily="'Noto Sans Devanagari', 'Noto Sans', sans-serif">राह</text>
      <path d="M160 60h-36l-7 6.5 7 6.5h36Z" fill="#a8641f" />
      <path d="M128 66.5h26" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeDasharray="4 3" opacity=".7" />
    </g>
  );
}

/** Her jhola: a cloth shoulder bag in Raah blue, strap across her chest. She is always on the way somewhere. */
function Jhola() {
  return (
    <g>
      <path d="M82 60L38 90" stroke="#1e3a8a" strokeWidth="3.2" strokeLinecap="round" />
      <path d="M24 84h20a2 2 0 0 1 2 2v11a6 6 0 0 1-6 6h-12a6 6 0 0 1-6-6v-11a2 2 0 0 1 2-2Z" fill="#2563eb" />
      <path d="M22.5 85h24v5.5q-12 5-24 0Z" fill="#1e40af" />
      <circle cx="34.5" cy="92" r="1.8" fill={PATCH} />
      <path d="M26.5 97.5h16" stroke="#fff" strokeWidth="1.2" strokeDasharray="2 2" opacity=".6" />
    </g>
  );
}

/** The things she holds in front of her, drawn where the clipboard goes. Each has one small motion of its own. */
function Held({ item }: { item: Exclude<Item, "cap"> }) {
  if (item === "compass") return (
    <g>
      <circle cx="62" cy="88" r="16" fill="#c9792b" />
      <circle cx="62" cy="88" r="12.5" fill="#fff" />
      <path d="M62 77.5v2.5M62 96v2.5M51.5 88h2.5M70 88h2.5" stroke="#9aa5b5" strokeWidth="1.6" strokeLinecap="round" />
      <g className="m-needle">
        <path d="M62 78L65 88H59Z" fill="#e53935" />
        <path d="M62 98L65 88H59Z" fill="#1e40af" />
      </g>
      <circle cx="62" cy="88" r="1.8" fill={INK} />
    </g>
  );
  if (item === "coins") return (
    <g>
      {[99, 94, 89].map((y) => (
        <g key={y}><ellipse cx="62" cy={y + 1.6} rx="13" ry="4.6" fill="#e0a000" /><ellipse cx="62" cy={y} rx="13" ry="4.6" fill={PATCH} /></g>
      ))}
      <g className="m-coin">
        <circle cx="62" cy="74" r="9" fill={PATCH} stroke="#e0a000" strokeWidth="2" />
        <text x="62" y="78" textAnchor="middle" fontSize="11" fontWeight="800" fill="#a86b00" fontFamily="'Noto Sans', sans-serif">₹</text>
      </g>
    </g>
  );
  if (item === "book") return (
    <g>
      <path d="M38 76V102Q50 98 62 104Q74 98 86 102V76Q74 73 62 79Q50 73 38 76Z" fill="#0f766e" />
      <path d="M41 77V99Q52 96 62 101V80Q52 74 41 77Z" fill="#fff" />
      <path d="M83 77V99Q72 96 62 101V80Q72 74 83 77Z" fill="#f4f6fa" />
      <path d="M45 84q7-2 13 1M45 89q7-2 13 1M45 94q7-2 13 1M66 85q6-3 13-1M66 90q6-3 13-1" stroke="#9aa5b5" strokeWidth="1.4" strokeLinecap="round" fill="none" />
      <path className="m-page" d="M62 80Q72 74 83 77V99Q72 96 62 101Z" fill="#fff" opacity=".9" />
    </g>
  );
  return (
    <g>
      <path d="M55 79v-5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v5" stroke="#6b3a1f" strokeWidth="3" fill="none" />
      <rect x="42" y="78" width="40" height="26" rx="4" fill="#a0522d" />
      <path d="M42 89h40" stroke="#6b3a1f" strokeWidth="2" />
      <rect x="58.5" y="86" width="7" height="6" rx="1.5" fill={PATCH} />
    </g>
  );
}

function Mynah({ pose: asked, size, scene = false, item }: { pose: Pose; size: number; scene?: boolean; item?: Item }) {
  // holding something takes both wings, unless she is cheering (then she lets go and throws them up)
  const held = item && item !== "cap" && asked !== "cheer" ? item : null;
  const pose: Pose = held ? "clipboard" : asked;
  const smile = pose === "cheer" || pose === "happy" || pose === "flag"; // eyes closed in a smile
  const open = pose === "wave" || smile;
  const look = pose === "think" ? -3 : 0; // eyes up when thinking
  const [left, right] = WINGS[pose];
  return (
    <svg viewBox={scene ? "-40 0 205 130" : "0 0 120 120"} width={scene ? Math.round((size * 205) / 130) : size} height={size} aria-hidden focusable="false" className="m-in overflow-visible">
      {scene && <Scene />}
      <ellipse cx="60" cy="112" rx="30" ry="5" fill="var(--m-shadow)" />
      {pose === "flag" && (
        <g>
          <path d="M98 110V22" stroke="#6b4129" strokeWidth="3" strokeLinecap="round" />
          <g className="m-flutter">
            <path d="M99.5 23L122 30.5L99.5 38Z" fill={SCARF} />
            <path d="M99.5 30.5L122 30.5L99.5 38Z" fill="#138808" opacity=".9" />
          </g>
          <ellipse cx="98" cy="111" rx="6" ry="1.8" fill="var(--m-shadow)" />
        </g>
      )}
      {pose === "cheer" && ([[16, 30, 6, SCARF, "0s"], [104, 24, 7, PATCH, ".35s"], [20, 74, 5, "var(--brand)", ".7s"], [102, 68, 5, SCARF, "1s"]] as const).map(([x, y, r, c, d]) => (
        <path key={`s${x}`} d={sparkle(x, y, r)} fill={c} className="m-star" style={{ animationDelay: d }} />
      ))}
      {pose === "happy" && ([[18, 40, 5, PATCH, "0s"], [102, 36, 6, SCARF, ".25s"]] as const).map(([x, y, r, c, d]) => (
        <path key={`s${x}`} d={sparkle(x, y, r)} fill={c} className="m-star" style={{ animationDelay: d }} />
      ))}
      {pose === "comfort" && ([[96, 38, "0s"], [22, 46, ".7s"]] as const).map(([x, y, d]) => (
        <path key={`h${x}`} d={heart(x, y)} fill={PINK} className="m-heart" style={{ animationDelay: d }} />
      ))}
      {pose === "think" && ([[92, 22, 2, "0s"], [100, 15, 2.6, ".2s"], [109, 8, 3.2, ".4s"]] as const).map(([x, y, r, d]) => (
        <circle key={x} cx={x} cy={y} r={r} fill="var(--muted)" className="m-dot" style={{ animationDelay: d }} />
      ))}
      <g className={BODY_MOTION[pose] ?? "m-bob"}>
        <path d="M74 94 L94 104 L88 109 L70 101Z" fill={WING} />
        <path d="M52 100v8m-4 0h8M68 100v8m-4 0h8" stroke={PATCH} strokeWidth="3" strokeLinecap="round" />
        {(pose === "cheer" || pose === "happy") && <>{left}{right}</>}
        <ellipse cx="60" cy="76" rx="30" ry="29" fill={BODY} />
        <ellipse cx="60" cy="85" rx="18" ry="17" fill={BELLY} />
        {(pose === "wave" || pose === "think" || pose === "clipboard" || pose === "flag") && left}
        <Jhola />
        {held && <Held item={held} />}
        {pose === "clipboard" && !held && (
          <g transform="rotate(-6 62 86)">
            <rect x="46" y="70" width="32" height="34" rx="3" fill="#c9792b" />
            <rect x="50" y="76" width="24" height="25" rx="1.5" fill="#fff" />
            <rect x="55" y="67" width="14" height="6" rx="2" fill="#9aa5b5" />
            <path d="M53 82h17M53 88h17M53 94h11" stroke="#9aa5b5" strokeWidth="2" strokeLinecap="round" />
          </g>
        )}
        {(pose === "wave" || pose === "clipboard" || pose === "flag") && right}
        {pose === "comfort" && <>{left}{right}</>}
        {pose === "clipboard" && !held && (
          <g className="m-write">
            <path d="M75 98l14-16 4 3.4-14 16-5.4 1.2Z" fill="#ffd54a" />
            <path d="M89 82l4 3.4 2-2.3-4-3.4Z" fill="#ff8fa3" />
          </g>
        )}
        {/* scarf in the saffron of the app bar: Maina is a traveller on the path (raah) */}
        <path d="M37 57Q60 70 83 57L83 64Q60 77 37 64Z" fill={SCARF} />
        <path d="M70 67l7 14-7-1.6-4.2-11Z" fill="#e67e1f" />
        {/* the head turns about her neck: a curious tilt now and then, a held tilt when thinking */}
        <g className={pose === "think" ? "m-tilt" : smile ? "" : "m-headturn"}>
          {item !== "cap" && <path d="M51 20L54 7L59 16L63 6L67 19Z" fill={HEAD} />}
          <circle cx="60" cy="40" r="24" fill={HEAD} />
          {/* the bare yellow skin around a mynah's eye */}
          <ellipse cx="48.5" cy="42" rx="10" ry="11" fill={PATCH} />
          <ellipse cx="71.5" cy="42" rx="10" ry="11" fill={PATCH} />
          <ellipse cx="42" cy="53" rx="4" ry="2.4" fill="#ff8fa3" opacity={pose === "comfort" ? 0.9 : 0.55} />
          <ellipse cx="78" cy="53" rx="4" ry="2.4" fill="#ff8fa3" opacity={pose === "comfort" ? 0.9 : 0.55} />
          {smile ? (
            <path d="M43 42Q49 35 55 42M65 42Q71 35 77 42" stroke={INK} strokeWidth="3" strokeLinecap="round" fill="none" />
          ) : (
            <g className="m-blink">
              <circle cx="49" cy="40" r="7" fill="#fff" />
              <circle cx="71" cy="40" r="7" fill="#fff" />
              <g className={pose === "think" ? "" : "m-look"}>
                <circle cx="50.5" cy={41 + look} r="4" fill={INK} />
                <circle cx="72.5" cy={41 + look} r="4" fill={INK} />
                <circle cx="52" cy={39.2 + look} r="1.5" fill="#fff" />
                <circle cx="74" cy={39.2 + look} r="1.5" fill="#fff" />
              </g>
              {/* soft upper lids when she is being kind */}
              {pose === "comfort" && <path d="M42 36Q49 31 56 36L56 34Q49 28 42 34ZM64 36Q71 31 78 36L78 34Q71 28 64 34Z" fill={PATCH} />}
            </g>
          )}
          {open ? (
            <>
              <ellipse cx="60" cy="56.5" rx="4" ry="2.6" fill={PINK} />
              <path d="M53 49Q60 45 67 49L60 55.5Z" fill={BEAK} />
              <path d="M55.5 57.5Q60 56 64.5 57.5L60 63Z" fill={BEAK} />
            </>
          ) : (
            <path d="M53 50Q60 46 67 50L60 61Z" fill={BEAK} />
          )}
          {item === "cap" && (
            // a graduation cap, a little crooked, with a swinging tassel
            <g transform="rotate(-8 60 18)">
              <path d="M44 20v7q16 7 32 0v-7Z" fill="#1d2540" />
              <path d="M34 18L60 8L86 18L60 28Z" fill="#26304f" />
              <circle cx="60" cy="18" r="2" fill={PATCH} />
              <g className="m-tassel"><path d="M60 18L80 21V33" stroke={PATCH} strokeWidth="2" fill="none" strokeLinecap="round" /><path d="M78 32h4l-.6 6h-2.8Z" fill={PATCH} /></g>
            </g>
          )}
        </g>
        {pose === "think" && right}
      </g>
    </svg>
  );
}

/** Tapping Maina makes her cheer for a moment, so she answers being poked like a toy would. */
function Bird({ pose, size, scene, item }: { pose: Pose; size: number; scene?: boolean; item?: Item }) {
  const { t } = useApp();
  const [poked, setPoked] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const poke = () => { setPoked(true); window.clearTimeout(timer.current); timer.current = window.setTimeout(() => setPoked(false), 1100); };
  return (
    <button type="button" onClick={poke} aria-label={t("mascot_alt")} className="shrink-0 rounded-full outline-offset-4">
      <Mynah pose={poked ? "cheer" : pose} size={size} scene={scene} item={item} />
    </button>
  );
}

/**
 * Maina with an optional speech bubble. `children` is what she says (a heading, a line of text); `speak` adds the
 * read-aloud button for that text. `stack` puts the bubble above her (for centred screens) instead of beside her.
 * The bubble pops in again whenever `say` (a key for what she is saying) changes. `scene` stands her on the forked raah by a signpost.
 */
export function Mascot({ pose = "wave", size = 88, speak, say, stack = false, scene = false, item, children, className = "" }: {
  pose?: Pose; size?: number; speak?: string; say?: string; stack?: boolean; scene?: boolean; item?: Item; children?: React.ReactNode; className?: string;
}) {
  if (!children) return <div className={`inline-block ${className}`}><Bird pose={pose} size={size} scene={scene} item={item} /></div>;
  const tail = stack
    ? "left-1/2 -bottom-[7px] -translate-x-1/2 border-b-2 border-r-2"
    : "-left-[7px] top-1/2 -translate-y-1/2 border-b-2 border-l-2";
  return (
    <div className={`flex ${stack ? "flex-col items-center gap-3" : "items-center gap-2"} ${className}`}>
      <div key={say} className={`m-bubble relative min-w-0 rounded-2xl bg-[var(--card)] px-3.5 py-2.5 ring-2 ring-black/10 ${stack ? "max-w-xs" : "order-2 flex-1"}`}>
        <span aria-hidden className={`absolute h-3 w-3 rotate-45 border-black/10 bg-[var(--card)] ${tail}`} />
        <div className="relative flex items-start gap-2">
          <div className="min-w-0 flex-1">{children}</div>
          {speak && <SpeakButton text={speak} label="" />}
        </div>
      </div>
      <Bird pose={pose} size={size} scene={scene} item={item} />
    </div>
  );
}
