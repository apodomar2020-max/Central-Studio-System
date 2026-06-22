import React from "react";
import Svg, { Circle, Path, Rect } from "react-native-svg";

/**
 * CsIcon — exact replica of the Home design's shared `Icon` set
 * (home-lib.jsx, Lucide-style 2px stroke). Rendered via react-native-svg so
 * the Home screen and tab bar use the design's literal glyphs (no substitutes).
 * `play` and `star` are filled in the design; everything else is stroked.
 */
export type CsIconName =
  | "bell" | "home" | "compass" | "classes" | "calendar" | "user" | "play"
  | "clock" | "arrow" | "chevron" | "check" | "star" | "heart" | "spark"
  | "instagram" | "users" | "infinity" | "ticket";

const FILLED: CsIconName[] = ["play", "star"];

export default function CsIcon({
  name,
  size = 22,
  stroke = 2,
  color = "#FFFFFF",
  fill,
}: {
  name: CsIconName;
  size?: number;
  stroke?: number;
  color?: string;
  /** override container fill (design uses this for active tab icons) */
  fill?: string;
}) {
  const isFilled = FILLED.includes(name);
  const sp = isFilled
    ? { fill: color, stroke: "none" as const }
    : { fill: fill ?? "none", stroke: color, strokeWidth: stroke, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {name === "bell" && (
        <>
          <Path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" {...sp} />
          <Path d="M13.7 21a2 2 0 0 1-3.4 0" {...sp} />
        </>
      )}
      {name === "home" && (
        <>
          <Path d="M3 10.5 12 3l9 7.5" {...sp} />
          <Path d="M5 9.5V21h5v-6h4v6h5V9.5" {...sp} />
        </>
      )}
      {name === "compass" && (
        <>
          <Circle cx={12} cy={12} r={9} {...sp} />
          <Path d="m15.5 8.5-2 5-5 2 2-5 5-2Z" {...sp} />
        </>
      )}
      {name === "classes" && (
        <>
          <Circle cx={13} cy={4} r={1.8} {...sp} />
          <Path d="M8 21l3.5-7L9 11l3-4.5" {...sp} />
          <Path d="M9 6.5l4 2 3-1.5" {...sp} />
          <Path d="M13 8.5l2 4-2.5 2.5M15.5 19l-2-4.5" {...sp} />
        </>
      )}
      {name === "calendar" && (
        <>
          <Rect x={3} y={4.5} width={18} height={16} rx={2.5} {...sp} />
          <Path d="M3 9h18M8 2.5v4M16 2.5v4" {...sp} />
        </>
      )}
      {name === "user" && (
        <>
          <Circle cx={12} cy={8} r={4} {...sp} />
          <Path d="M4 20c0-3.6 3.6-6 8-6s8 2.4 8 6" {...sp} />
        </>
      )}
      {name === "play" && <Path d="M7 4.5v15l13-7.5-13-7.5Z" {...sp} />}
      {name === "clock" && (
        <>
          <Circle cx={12} cy={12} r={9} {...sp} />
          <Path d="M12 7v5l3.5 2" {...sp} />
        </>
      )}
      {name === "arrow" && <Path d="M5 12h14M13 6l6 6-6 6" {...sp} />}
      {name === "chevron" && <Path d="M9 6l6 6-6 6" {...sp} />}
      {name === "check" && <Path d="M20 6 9 17l-5-5" {...sp} />}
      {name === "star" && <Path d="m12 3 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.8 6.8 19.1l1-5.8L3.5 9.2l5.9-.9L12 3Z" {...sp} />}
      {name === "heart" && <Path d="M12 20s-7-4.3-7-9.4A3.6 3.6 0 0 1 12 7a3.6 3.6 0 0 1 7 3.6C19 15.7 12 20 12 20Z" {...sp} />}
      {name === "spark" && <Path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18" {...sp} />}
      {name === "instagram" && (
        <>
          <Rect x={3} y={3} width={18} height={18} rx={5} {...sp} />
          <Circle cx={12} cy={12} r={4} {...sp} />
          <Circle cx={17.2} cy={6.8} r={1} fill={color} stroke="none" />
        </>
      )}
      {name === "users" && (
        <>
          <Circle cx={9} cy={8} r={3.4} {...sp} />
          <Path d="M3 20c0-3 2.7-5 6-5s6 2 6 5" {...sp} />
          <Path d="M16 5.2A3.4 3.4 0 0 1 16 12M21 20c0-2.4-1.6-4.2-4-4.8" {...sp} />
        </>
      )}
      {name === "infinity" && <Path d="M7 9a3 3 0 1 0 0 6c2 0 3-1.5 5-3s3-3 5-3a3 3 0 1 1 0 6c-2 0-3-1.5-5-3S9 9 7 9Z" {...sp} />}
      {name === "ticket" && (
        <>
          <Path d="M3 8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4V8Z" {...sp} />
          <Path d="M15 6v12" stroke={color} strokeWidth={stroke} strokeDasharray="2 2" fill="none" />
        </>
      )}
    </Svg>
  );
}
