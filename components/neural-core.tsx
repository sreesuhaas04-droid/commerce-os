"use client";

/**
 * The neural commerce core — the 3D scene from the design brief, rebuilt as a
 * React component for this console.
 *
 * Two lime glass toruses (the bounded rails) with a cluster of transaction
 * nodes orbiting between them, linked by live protocol lines. It follows the
 * pointer, breathes, and is torn down properly on unmount — the original
 * single-file version leaked its render loop and its listeners.
 *
 * Three.js is loaded from the CDN exactly once per page, on the client only.
 */

import { useEffect, useRef } from "react";

const THREE_URL = "https://ajax.googleapis.com/ajax/libs/threejs/r125/three.min.js";

declare global {
  interface Window {
    THREE?: unknown;
  }
}

/** Loads the global THREE build once; concurrent callers share one promise. */
function loadThree(): Promise<unknown> {
  if (window.THREE) return Promise.resolve(window.THREE);
  if (!(loadThree as unknown as { promise?: Promise<unknown> }).promise) {
    (loadThree as unknown as { promise?: Promise<unknown> }).promise = new Promise(
      (resolve, reject) => {
        const script = document.createElement("script");
        script.src = THREE_URL;
        script.onload = () => resolve(window.THREE);
        script.onerror = () => reject(new Error("three.js failed to load"));
        document.head.appendChild(script);
      },
    );
  }
  return (loadThree as unknown as { promise: Promise<unknown> }).promise;
}

export function NeuralCore({ className }: { className?: string }) {
  const holder = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = holder.current;
    if (!container) return;
    let disposed = false;
    let cleanup: (() => void) | undefined;

    loadThree()
      .then((raw) => {
        if (disposed || !container.isConnected) return;
        // The r125 global build is untyped; a local alias keeps the `any` in
        // exactly one place instead of smearing it across the scene code.
        /* eslint-disable @typescript-eslint/no-explicit-any */
        const THREE = raw as any;

        const width = () => container.clientWidth || window.innerWidth;
        const height = () => container.clientHeight || window.innerHeight;

        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(60, width() / height(), 0.1, 1000);
        camera.position.z = 28;

        const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
        renderer.setSize(width(), height());
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        container.appendChild(renderer.domElement);

        const mainGroup = new THREE.Group();
        scene.add(mainGroup);

        // Bounded rails: a lime wireframe core ring inside a faint white shell.
        const innerTorus = new THREE.Mesh(
          new THREE.TorusGeometry(8, 0.25, 24, 100),
          new THREE.MeshStandardMaterial({
            color: 0xa3e635,
            emissive: 0x4d7c0f,
            roughness: 0.2,
            metalness: 0.8,
            wireframe: true,
          }),
        );
        mainGroup.add(innerTorus);

        const outerTorus = new THREE.Mesh(
          new THREE.TorusGeometry(12, 0.15, 16, 120),
          new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 }),
        );
        outerTorus.rotation.x = Math.PI / 3;
        mainGroup.add(outerTorus);

        // Transaction nodes: lime ones are live agents, white ones are orders.
        const nodeCount = 70;
        const nodeGeo = new THREE.SphereGeometry(0.35, 16, 16);
        const limeMat = new THREE.MeshStandardMaterial({
          color: 0xa3e635,
          emissive: 0xa3e635,
          emissiveIntensity: 0.6,
          roughness: 0.1,
        });
        const whiteMat = new THREE.MeshStandardMaterial({
          color: 0xffffff,
          roughness: 0.3,
          metalness: 0.5,
        });
        const nodes: any[] = [];
        for (let i = 0; i < nodeCount; i++) {
          const mesh = new THREE.Mesh(nodeGeo, Math.random() > 0.6 ? limeMat : whiteMat);
          const radius = 9 + Math.random() * 8;
          const theta = Math.random() * Math.PI * 2;
          const phi = Math.acos(Math.random() * 2 - 1);
          mesh.position.set(
            radius * Math.sin(phi) * Math.cos(theta),
            radius * Math.sin(phi) * Math.sin(theta),
            radius * Math.cos(phi),
          );
          mesh.userData = {
            origX: mesh.position.x,
            origY: mesh.position.y,
            origZ: mesh.position.z,
            speed: 0.5 + Math.random() * 1.5,
            phase: Math.random() * Math.PI * 2,
          };
          mainGroup.add(mesh);
          nodes.push(mesh);
        }

        // Protocol lines between moving nodes.
        const lineCount = 35;
        const lineGeo = new THREE.BufferGeometry();
        lineGeo.setAttribute(
          "position",
          new THREE.BufferAttribute(new Float32Array(lineCount * 6), 3),
        );
        const lineSegments = new THREE.LineSegments(
          lineGeo,
          new THREE.LineBasicMaterial({ color: 0xa3e635, transparent: true, opacity: 0.25 }),
        );
        mainGroup.add(lineSegments);

        scene.add(new THREE.AmbientLight(0xffffff, 0.8));
        const limeLight = new THREE.PointLight(0xa3e635, 3, 50);
        limeLight.position.set(10, 10, 15);
        scene.add(limeLight);
        const whiteLight = new THREE.PointLight(0xffffff, 2, 60);
        whiteLight.position.set(-15, -10, 10);
        scene.add(whiteLight);

        // Pointer parallax.
        let mouseX = 0;
        let mouseY = 0;
        let targetRotX = 0;
        let targetRotY = 0;
        const onPointer = (e: PointerEvent) => {
          mouseX = (e.clientX / window.innerWidth - 0.5) * 2;
          mouseY = (e.clientY / window.innerHeight - 0.5) * 2;
        };
        window.addEventListener("pointermove", onPointer);

        const onResize = () => {
          camera.aspect = width() / height();
          camera.updateProjectionMatrix();
          renderer.setSize(width(), height());
        };
        window.addEventListener("resize", onResize);

        let raf = 0;
        const clock = new THREE.Clock();
        const animate = () => {
          raf = requestAnimationFrame(animate);
          const time = clock.getElapsedTime();

          targetRotY += (mouseX * 0.4 - targetRotY) * 0.05;
          targetRotX += (-mouseY * 0.4 - targetRotX) * 0.05;
          mainGroup.rotation.y = time * 0.15 + targetRotY;
          mainGroup.rotation.x = time * 0.08 + targetRotX;
          innerTorus.rotation.z = time * 0.35;
          outerTorus.rotation.y = -time * 0.25;

          for (const node of nodes) {
            const d = Math.sin(time * node.userData.speed + node.userData.phase) * 0.32;
            node.position.set(
              node.userData.origX + d,
              node.userData.origY + d,
              node.userData.origZ + d,
            );
          }

          const pos = lineSegments.geometry.attributes.position.array;
          for (let i = 0; i < lineCount; i++) {
            const n1 = nodes[i];
            const n2 = nodes[(i * 3 + 7) % nodes.length];
            const base = i * 6;
            pos[base] = n1.position.x;
            pos[base + 1] = n1.position.y;
            pos[base + 2] = n1.position.z;
            pos[base + 3] = n2.position.x;
            pos[base + 4] = n2.position.y;
            pos[base + 5] = n2.position.z;
          }
          lineSegments.geometry.attributes.position.needsUpdate = true;

          renderer.render(scene, camera);
        };
        animate();
        /* eslint-enable @typescript-eslint/no-explicit-any */

        cleanup = () => {
          cancelAnimationFrame(raf);
          window.removeEventListener("pointermove", onPointer);
          window.removeEventListener("resize", onResize);
          renderer.dispose();
          container.removeChild(renderer.domElement);
        };
      })
      .catch(() => {
        // The scene is decoration; a failed CDN load leaves the page intact.
      });

    return () => {
      disposed = true;
      cleanup?.();
    };
  }, []);

  return <div ref={holder} className={className} aria-hidden="true" />;
}
