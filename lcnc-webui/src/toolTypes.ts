export const TOOL_TYPE_LABELS: Record<string, string> = {
  endmill: "End Mill",
  reamer: "Reamer",
  ball: "Ball",
  bullnose: "Bull Nose",
  drill: "Drill",
  blockdrill: "Block Drill",
  centerdrill: "Center Drill",
  chamfer: "Chamfer",
  cornerchamfer: "Corner Chamfer End Mill",
  circlebarrel: "Circle Segment Barrel",
  circlelens: "Circle Segment Lens",
  circleoval: "Circle Segment Oval",
  circletaper: "Circle Segment Taper",
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
