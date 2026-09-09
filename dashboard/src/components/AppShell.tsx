import type { ReactNode } from "react";
import styles from "./AppShell.module.css";

const NAV = [
  { href: "/", label: "Schedule Navigator", primary: true },
  { href: "/overview", label: "Project Overview", soon: true },
  { href: "/progress", label: "Progress Summary", soon: true },
  { href: "/deviation", label: "Schedule Deviation", soon: true },
  { href: "/milestones", label: "Milestone Breakdown", soon: true },
  { href: "/safety", label: "Safety Overview", soon: true },
  { href: "/photos", label: "Photo Stream", soon: true },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.brandBlock}>
          <p className={styles.eyebrow}>Construction monitoring</p>
          <h1 className={styles.brand}>Schependomlaan</h1>
        </div>
        <nav className={styles.nav} aria-label="Dashboard views">
          {NAV.map((item) =>
            "soon" in item && item.soon ? (
              <span key={item.href} className={styles.navSoon} title="Coming in a later stage">
                {item.label}
                <em>soon</em>
              </span>
            ) : (
              <a key={item.href} href={item.href} className={styles.navPrimary}>
                {item.label}
              </a>
            )
          )}
        </nav>
      </header>
      <main className={styles.main}>{children}</main>
    </div>
  );
}
