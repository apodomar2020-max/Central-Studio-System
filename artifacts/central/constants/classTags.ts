import colors from "./colors";

// The deep teal is already the Class Details / Package Center card surface.
// Mix existing cyan into it for a visibly elevated, still restrained tag surface.
const deepTeal = "#012329";
function mix(a: string, b: string, weight: number) {
  return "#" + [1, 3, 5].map(i => Math.round(parseInt(a.slice(i, i + 2), 16) * weight + parseInt(b.slice(i, i + 2), 16) * (1 - weight)).toString(16).padStart(2, "0")).join("");
}
export const classTagColors = {
  danceBackground: mix(colors.cyan, deepTeal, 0.22),
  danceText: colors.cyan,
  danceBorder: "rgba(0,182,215,0.55)",
  text: colors.dark.foreground,
  beginner: deepTeal,
  intermediate: mix(colors.cyan, colors.ink[700], 0.12),
  advanced: colors.ink[600],
  allLevels: colors.ink[700],
  adults: colors.ink[600],
  teens: mix(colors.violet, colors.ink[700], 0.22),
  kids: mix(colors.info, colors.ink[700], 0.22),
  allAges: colors.ink[700],
};
export function levelTagColor(level: string) {
  if (/beginner/i.test(level)) return classTagColors.beginner;
  if (/intermediate/i.test(level)) return classTagColors.intermediate;
  if (/advanced/i.test(level)) return classTagColors.advanced;
  return classTagColors.allLevels;
}
export function ageTagColor(age: string) {
  if (/kid/i.test(age)) return classTagColors.kids;
  if (/teen/i.test(age)) return classTagColors.teens;
  if (/adult/i.test(age)) return classTagColors.adults;
  return classTagColors.allAges;
}
// Inset overlay: adds separation without changing tag geometry or padding.
export const classTagStyles = {
  danceOutline: { position: "absolute" as const, top: 0, bottom: 0, left: 0, right: 0, borderRadius: 999, borderWidth: 1, borderColor: classTagColors.danceBorder },
};
