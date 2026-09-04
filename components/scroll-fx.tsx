"use client";

/**
 * Scroll effects for the showcase.
 *
 * Three primitives, all CSS-transform based (no layout thrash) and all
 * degrading to "visible, untransformed" when JS is absent or IntersectionObserver
 * is missing:
 *
 *   <Reveal>            fades and rises children into view once
 *   <Parallax>          moves children against the scroll position, proportionally
 *   <ScrollProgress>    a reading-position bar pinned under the header
 */

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

/** A class the CSS knows how to animate. Toggled once, never toggled back. */
export function Reveal({
  children,
  delay = 0,
  className = "",
  as: Tag = "div",
}: {
  children: ReactNode;
  /** Milliseconds before the transition starts, once visible. */
  delay?: number;
  className?: string;
  as?: "div" | "section" | "li" | "span";
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node || typeof IntersectionObserver === "undefined") {
      setShown(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setShown(true);
            observer.disconnect();
          }
        }
      },
      // Slightly before the element is fully on screen, so the motion is seen.
      { threshold: 0.15, rootMargin: "0px 0px -8% 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <Tag
      ref={ref as never}
      className={`reveal ${shown ? "reveal-shown" : ""} ${className}`}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {children}
    </Tag>
  );
}

/**
 * Translates children along Y as the page scrolls, at `speed` times the scroll
 * rate. Speed 0 is pinned to the viewport; negative rises as the page falls.
 */
export function Parallax({
  children,
  speed = 0.15,
  className = "",
  style,
}: {
  children: ReactNode;
  speed?: number;
  className?: string;
  style?: CSSProperties;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    let visible = false;
    let raf = 0;

    const measure = () => {
      raf = 0;
      const node = ref.current;
      if (!node) return;
      const rect = node.getBoundingClientRect();
      const centre = rect.top + rect.height / 2;
      // Distance from the viewport's middle, in pixels, positive when below.
      const fromMiddle = centre - window.innerHeight / 2;
      setOffset(-fromMiddle * speed);
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(measure);
    };

    const observer = new IntersectionObserver(
      (entries) => {
        visible = entries.some((e) => e.isIntersecting);
        if (visible) measure();
      },
      { threshold: 0 },
    );
    if (ref.current) observer.observe(ref.current);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);

    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [speed]);

  return (
    <div
      ref={ref}
      className={className}
      style={{ ...style, transform: `translate3d(0, ${offset.toFixed(1)}px, 0)` }}
    >
      {children}
    </div>
  );
}

/** The reading-position bar. Fixed, one per page, updated on scroll. */
export function ScrollProgress() {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    let raf = 0;
    const measure = () => {
      raf = 0;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      setProgress(max > 0 ? Math.min(1, window.scrollY / max) : 0);
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div className="scroll-progress" aria-hidden="true">
      <div
        className="scroll-progress-fill"
        style={{ transform: `scaleX(${progress})` }}
      />
    </div>
  );
}
