// The ONE browser download (operator 2026-10-03): Program, Tools and Macros
// each have "Download" in their More — the loaded program, the tool table
// file, the selected macro, saved as the file they are, bytes unchanged.

/** Hand `data` to the browser as a download named `name`. */
export function saveAsFile(name: string, data: Blob | string): void {
  const blob = typeof data === "string" ? new Blob([data], { type: "text/plain" }) : data;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
