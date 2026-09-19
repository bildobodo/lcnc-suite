/** Import wording follows each source's offset policy, including mixed files. */
export function summarizeToolImport(tools: { source_format?: unknown; is_example?: unknown }[]) {
  const freecad = tools.filter(t => t.source_format === "freecad").length;
  const fusion = tools.length - freecad;
  const isExample = tools.length > 0 && tools.every(t => t.is_example === true);
  const zeroOffsets = tools.length > 0 && tools.every(t => t.is_example === true || t.source_format === "freecad");
  const sourceLabel = freecad && fusion ? "Fusion 360 + FreeCAD" : freecad ? "FreeCAD" : "Fusion 360";
  return {
    freecad, fusion, isExample, sourceLabel,
    replacementNotice: zeroOffsets
      ? "Z offsets start at zero. Measure tools before use; library dimensions do not describe the installed length."
      : freecad && fusion
        ? "Fusion Z offsets use gauge lengths; FreeCAD Z offsets start at zero. Measure to replace with actual values."
        : "Z offsets will use Fusion gauge lengths (measure to replace with actual values).",
    resultNotice: zeroOffsets
      ? "Z offsets initialized to zero; measure tools before use."
      : freecad && fusion
        ? "Fusion Z offsets initialized from gauge lengths; FreeCAD Z offsets initialized to zero."
        : "Z offsets initialized from Fusion lengths.",
  };
}
