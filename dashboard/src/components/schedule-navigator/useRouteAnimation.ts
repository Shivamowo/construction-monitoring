"use client";

import { useLayoutEffect, useRef } from "react";
import gsap from "gsap";

interface RouteAnimationOptions {
  ready: boolean;
  plannedSelector: string;
  projectedSelector: string;
  markerSelector: string;
  axisSelector: string;
  onComplete?: () => void;
}

/**
 * One-shot GSAP line draw-in + staggered markers (does not re-run on zoom redraws).
 */
export function useRouteAnimation({
  ready,
  plannedSelector,
  projectedSelector,
  markerSelector,
  axisSelector,
  onComplete,
}: RouteAnimationOptions) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const playedRef = useRef(false);

  useLayoutEffect(() => {
    if (!ready || !rootRef.current || playedRef.current) return;

    const root = rootRef.current;
    const ctx = gsap.context(() => {
      const planned = root.querySelectorAll<SVGPathElement>(plannedSelector);
      const projected = root.querySelectorAll<SVGPathElement>(projectedSelector);
      const markers = root.querySelectorAll<SVGElement>(markerSelector);
      const axis = root.querySelectorAll<SVGElement>(axisSelector);

      if (planned.length === 0 && projected.length === 0) return;

      playedRef.current = true;

      const prepStroke = (el: SVGPathElement) => {
        const length = el.getTotalLength();
        gsap.set(el, {
          strokeDasharray: length,
          strokeDashoffset: length,
          opacity: 1,
        });
      };

      planned.forEach(prepStroke);
      projected.forEach(prepStroke);
      gsap.set(markers, { scale: 0, transformOrigin: "50% 50%", opacity: 0 });
      gsap.set(axis, { opacity: 0, y: 6 });

      const tl = gsap.timeline({
        defaults: { ease: "power3.out" },
        onComplete: () => onComplete?.(),
      });
      tl.to(axis, { opacity: 1, y: 0, duration: 0.55, stagger: 0.04 }, 0);
      tl.to(
        planned,
        {
          strokeDashoffset: 0,
          duration: 1.45,
          stagger: 0.04,
          ease: "power2.inOut",
        },
        0.15
      );
      tl.to(
        projected,
        {
          strokeDashoffset: 0,
          duration: 1.65,
          stagger: 0.035,
          ease: "power2.inOut",
        },
        0.45
      );
      tl.to(
        markers,
        {
          scale: 1,
          opacity: 1,
          duration: 0.45,
          stagger: 0.03,
          ease: "back.out(1.6)",
        },
        1.1
      );
    }, root);

    return () => ctx.revert();
  }, [
    ready,
    plannedSelector,
    projectedSelector,
    markerSelector,
    axisSelector,
    onComplete,
  ]);

  return rootRef;
}
