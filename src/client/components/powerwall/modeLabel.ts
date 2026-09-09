export function modeLabel(mode: string): string {
  const map: Record<string, string> = {
    autonomous: "Self-Powered",
    backup: "Backup Only",
    self_consumption: "Self-Consumption",
  };
  return map[mode] ?? mode;
}
