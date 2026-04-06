export const TOOL_TYPE_LABELS: Record<string, string> = {
  endmill: "End Mill",
  ball: "Ball",
  bullnose: "Bull Nose",
  drill: "Drill",
  centerdrill: "Center Drill",
  chamfer: "Chamfer",
  countersink: "C/Sink",
  dovetail: "Dovetail",
  facemill: "Face Mill",
  lollipop: "Lollipop",
  slotmill: "Slot Mill",
  threadmill: "Thread Mill",
  formmill: "Form Mill",
  radiusmill: "Radius Mill",
  tapered: "Tapered",
  probe: "Probe",
  tap: "Tap",
  engraver: "Engraver",
  other: "Other",
};

export function toolTypeLabel(t: string | undefined | null): string {
  if (!t) return "---";
  return TOOL_TYPE_LABELS[t] || t;
}
