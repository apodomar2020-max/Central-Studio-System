import React from "react";
import Svg, { Circle, Path, Rect } from "react-native-svg";

/**
 * XI — exact replica of the Explore/Classes design's `XI` icon set
 * (home-explore.jsx). Rendered via react-native-svg so the Classes screen
 * uses the design's literal glyphs. `star` and `play` are filled in the design.
 */
export type XiIconName =
  | "search" | "x" | "chevron" | "star" | "cal" | "clock"
  | "check" | "fire" | "users" | "back" | "arrow" | "play";

const FILLED: XiIconName[] = ["star", "play"];

export default function XI({
  name,
  size = 20,
  stroke = 2,
  color = "#FFFFFF",
}: {
  name: XiIconName;
  size?: number;
  stroke?: number;
  color?: string;
}) {
  const filled = FILLED.includes(name);
  const sp = filled
    ? { fill: color, stroke: "none" as const }
    : { fill: "none" as const, stroke: color, strokeWidth: stroke, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {name === "search" && (
        <>
          <Circle cx={11} cy={11} r={7} {...sp} />
          <Path d="m21 21-4.4-4.4" {...sp} />
        </>
      )}
      {name === "x" && <Path d="M18 6 6 18M6 6l12 12" {...sp} />}
      {name === "chevron" && <Path d="M9 6l6 6-6 6" {...sp} />}
      {name === "star" && <Path d="m12 3 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.8 6.8 19.1l1-5.8L3.5 9.2l5.9-.9L12 3Z" {...sp} />}
      {name === "cal" && (
        <>
          <Rect x={3} y={4.5} width={18} height={16} rx={2.5} {...sp} />
          <Path d="M3 9h18M8 2.5v4M16 2.5v4" {...sp} />
        </>
      )}
      {name === "clock" && (
        <>
          <Circle cx={12} cy={12} r={9} {...sp} />
          <Path d="M12 7v5l3.5 2" {...sp} />
        </>
      )}
      {name === "check" && <Path d="M20 6 9 17l-5-5" {...sp} />}
      {name === "fire" && <Path d="M12 3c1 3-2 4-2 7a2 2 0 0 0 4 0c0-1 .5-1.5.5-1.5C16 11 17 13 17 15a5 5 0 0 1-10 0c0-4 3-5 5-12Z" {...sp} />}
      {name === "users" && (
        <>
          <Circle cx={9} cy={8} r={3.4} {...sp} />
          <Path d="M3 20c0-3 2.7-5 6-5s6 2 6 5" {...sp} />
          <Path d="M16 5.2A3.4 3.4 0 0 1 16 12M21 20c0-2.4-1.6-4.2-4-4.8" {...sp} />
        </>
      )}
      {name === "back" && <Path d="M15 18l-6-6 6-6" {...sp} />}
      {name === "arrow" && <Path d="M5 12h14M13 6l6 6-6 6" {...sp} />}
      {name === "play" && <Path d="M7 4.5v15l13-7.5-13-7.5Z" {...sp} />}
    </Svg>
  );
}
