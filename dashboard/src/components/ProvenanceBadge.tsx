import styles from "./ProvenanceBadge.module.css";

export function ProvenanceBadge({
  tag,
  compact = false,
}: {
  tag: "FORGED" | "REAL" | "DERIVED";
  compact?: boolean;
}) {
  return (
    <span
      className={`${styles.badge} ${styles[tag.toLowerCase()]} ${compact ? styles.compact : ""}`}
      title={`${tag} data — visually distinguished from other provenance`}
    >
      {tag}
    </span>
  );
}
