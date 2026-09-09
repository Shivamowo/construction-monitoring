import type { DelaySeverity } from "@/lib/schedule-navigator/aggregate";

export function severityColor(severity: DelaySeverity): string {
  switch (severity) {
    case "mild":
      return "var(--route-mild)";
    case "severe":
      return "var(--route-severe)";
    default:
      return "var(--route-on-time)";
  }
}

export function severityLabel(severity: DelaySeverity): string {
  switch (severity) {
    case "mild":
      return "Mild delay";
    case "severe":
      return "Severe delay";
    default:
      return "On track";
  }
}
