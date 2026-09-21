import type { ReactNode } from "react";
import { PhaseSwitcher } from "./PhaseSwitcher";
import styles from "./AppShell.module.css";

const NAV = [
  { href: "/", label: "Schedule Navigator", primary: true },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <a className={styles.brandBlock} href="/">
          <p className={styles.eyebrow}>Project: 1</p>
          <h1 className={styles.brand}>Construction Monitor</h1>
        </a>
        <div className={styles.headerRight}>
          <PhaseSwitcher />
          <nav className={styles.nav} aria-label="Dashboard views">
          {NAV.map((item) => (
            <a key={item.href} href={item.href} className={styles.navPrimary}>
              {item.label}
            </a>
          ))}
          </nav>
        </div>
      </header>
      <main className={styles.main}>{children}</main>
    </div>
  );
}
