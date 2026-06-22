import React from "react";
import Svg, { Circle, Path, Rect } from "react-native-svg";

/**
 * SBI — exact replica of the Schedule design's `SBI` icon set
 * (home-schedule.jsx). Renders the design's literal SVG paths via
 * react-native-svg so the Schedule screen and booking cards use the same
 * glyphs as the design source (no substitute icon packs).
 */
export type SbIconName =
  | "cal" | "clock" | "pin" | "chevron" | "check" | "alert" | "search"
  | "x" | "plus" | "eye" | "edit" | "cancel" | "download" | "phone" | "back";

export default function SBI({
  name,
  size = 18,
  stroke = 2,
  color = "#FFFFFF",
}: {
  name: SbIconName;
  size?: number;
  stroke?: number;
  color?: string;
}) {
  const sp = { stroke: color, strokeWidth: stroke, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, fill: "none" };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
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
      {name === "pin" && (
        <>
          <Path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 1 1 18 0Z" {...sp} />
          <Circle cx={12} cy={10} r={3} {...sp} />
        </>
      )}
      {name === "chevron" && <Path d="M9 6l6 6-6 6" {...sp} />}
      {name === "check" && <Path d="M20 6 9 17l-5-5" {...sp} />}
      {name === "alert" && (
        <>
          <Path d="M12 9v4M12 17h.01" {...sp} />
          <Path d="M10.3 4 2 20h20L13.7 4a2 2 0 0 0-3.4 0Z" {...sp} />
        </>
      )}
      {name === "search" && (
        <>
          <Circle cx={11} cy={11} r={7} {...sp} />
          <Path d="m21 21-4.4-4.4" {...sp} />
        </>
      )}
      {name === "x" && <Path d="M18 6 6 18M6 6l12 12" {...sp} />}
      {name === "plus" && <Path d="M12 5v14M5 12h14" {...sp} />}
      {name === "eye" && (
        <>
          <Path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" {...sp} />
          <Circle cx={12} cy={12} r={3} {...sp} />
        </>
      )}
      {name === "edit" && (
        <>
          <Path d="M12 20h9" {...sp} />
          <Path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" {...sp} />
        </>
      )}
      {name === "cancel" && (
        <>
          <Circle cx={12} cy={12} r={9} {...sp} />
          <Path d="m15 9-6 6M9 9l6 6" {...sp} />
        </>
      )}
      {name === "download" && (
        <>
          <Path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" {...sp} />
          <Path d="m7 10 5 5 5-5M12 15V3" {...sp} />
        </>
      )}
      {name === "phone" && (
        <Path d="M6.6 10.8a14 14 0 0 0 6.6 6.6l2.2-2.2a1.2 1.2 0 0 1 1.2-.3 11 11 0 0 0 3.4.6A1.2 1.2 0 0 1 21 16.7V20a1.2 1.2 0 0 1-1.2 1.2A17 17 0 0 1 3.6 4.2 1.2 1.2 0 0 1 4.8 3H8a1.2 1.2 0 0 1 1.2 1.2 11 11 0 0 0 .6 3.4 1.2 1.2 0 0 1-.3 1.2Z" {...sp} />
      )}
      {name === "back" && <Path d="M15 18l-6-6 6-6" {...sp} />}
    </Svg>
  );
}
