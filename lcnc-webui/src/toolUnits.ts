// Keep this conversion independent of Three.js so tool-table controls do not
// pull the lazily loaded renderer into the initial application bundle.
export function toolUnitsPerMillimeter(unit?: string): number {
  return unit === "in" || unit === "inch" || unit === "inches" ? 1 / 25.4 : 1;
}
