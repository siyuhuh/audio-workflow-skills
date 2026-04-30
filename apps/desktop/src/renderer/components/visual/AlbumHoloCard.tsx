import { Canvas, useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { cn } from "../../lib/cn";

const holoVertexShader = `
varying vec2 vUv;
uniform float uTime;
uniform float uActive;

void main() {
  vUv = uv;
  vec3 pos = position;
  float breath = sin(uTime * 2.0) * 0.015 * uActive;
  float scale = 1.0 + breath;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos * scale, 1.0);
}
`;

const holoFragmentShader = `
uniform sampler2D uTexture;
uniform float uOpacity;
uniform float uActive;
varying vec2 vUv;

void main() {
  vec4 texColor = texture2D(uTexture, vUv);
  vec3 baseColor = texColor.rgb;

  if (uActive < 0.01) {
    gl_FragColor = vec4(baseColor, texColor.a * uOpacity);
    return;
  }

  float diagonal = (vUv.x * 0.8) + vUv.y;
  float sheenPos = uActive * 2.5;
  float sheenWidth = 0.5;
  float dist = abs(diagonal - sheenPos);
  float intensity = 1.0 - smoothstep(0.0, sheenWidth, dist);
  intensity = pow(intensity, 3.0);
  float sheenFade = 1.0 - smoothstep(0.7, 1.0, uActive);
  vec3 sheenColor = vec3(0.85, 0.92, 1.0) * intensity * 0.9 * sheenFade;
  vec3 finalColor = baseColor + sheenColor * texColor.a;

  gl_FragColor = vec4(finalColor, texColor.a * uOpacity);
}
`;

interface AlbumHoloCardProps {
  title: string;
  coverUrl: string | null;
  active?: boolean;
  className?: string;
}

function createFallbackTexture(title: string): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 768;
  canvas.height = 480;
  const context = canvas.getContext("2d");
  if (context) {
    const gradient = context.createLinearGradient(0, 0, canvas.width, canvas.height);
    gradient.addColorStop(0, "#1f2933");
    gradient.addColorStop(0.54, "#10110f");
    gradient.addColorStop(1, "#304638");
    context.fillStyle = gradient;
    context.fillRect(0, 0, canvas.width, canvas.height);

    context.strokeStyle = "rgba(255,255,255,0.11)";
    context.lineWidth = 2;
    for (let index = -canvas.height; index < canvas.width; index += 28) {
      context.beginPath();
      context.moveTo(index, canvas.height);
      context.lineTo(index + canvas.height, 0);
      context.stroke();
    }

    context.fillStyle = "rgba(255,255,255,0.86)";
    context.font = "900 128px Poppins, sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(title.slice(0, 2).toUpperCase(), canvas.width / 2, canvas.height / 2);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function useAlbumTexture(coverUrl: string | null, title: string) {
  const fallbackTexture = useMemo(() => createFallbackTexture(title), [title]);
  const [texture, setTexture] = useState<THREE.Texture>(fallbackTexture);

  useEffect(() => {
    setTexture(fallbackTexture);
    if (!coverUrl) {
      return undefined;
    }

    const video = document.createElement("video");
    video.src = coverUrl;
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.preload = "auto";

    const videoTexture = new THREE.VideoTexture(video);
    videoTexture.colorSpace = THREE.SRGBColorSpace;
    videoTexture.minFilter = THREE.LinearFilter;
    videoTexture.magFilter = THREE.LinearFilter;
    setTexture(videoTexture);
    void video.play().catch(() => undefined);

    return () => {
      video.pause();
      video.removeAttribute("src");
      video.load();
      videoTexture.dispose();
    };
  }, [coverUrl, fallbackTexture]);

  useEffect(() => () => fallbackTexture.dispose(), [fallbackTexture]);

  return texture;
}

interface HoloPlaneProps {
  active: boolean;
  texture: THREE.Texture;
}

function HoloPlane({ active, texture }: HoloPlaneProps) {
  const groupRef = useRef<THREE.Group | null>(null);
  const activeValueRef = useRef(0);
  const edgeMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: "#0b1410",
        roughness: 0.58,
        metalness: 0.18
      }),
    []
  );
  const shadowMaterial = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: "#000000",
        transparent: true,
        opacity: 0.26,
        depthWrite: false
      }),
    []
  );
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uTexture: { value: texture },
          uOpacity: { value: 1 },
          uActive: { value: 0 }
        },
        vertexShader: holoVertexShader,
        fragmentShader: holoFragmentShader,
        transparent: true
      }),
    []
  );

  useEffect(() => {
    material.uniforms.uTexture.value = texture;
  }, [material, texture]);

  useFrame((_, delta) => {
    activeValueRef.current = THREE.MathUtils.damp(activeValueRef.current, active ? 1 : 0, 5.5, delta);
    material.uniforms.uTime.value += delta;
    material.uniforms.uActive.value = activeValueRef.current;

    if (groupRef.current) {
      groupRef.current.rotation.x = THREE.MathUtils.damp(groupRef.current.rotation.x, active ? -0.1 : -0.035, 5, delta);
      groupRef.current.rotation.y = THREE.MathUtils.damp(groupRef.current.rotation.y, active ? 0.2 : 0.04, 5, delta);
      groupRef.current.rotation.z = THREE.MathUtils.damp(groupRef.current.rotation.z, active ? -0.02 : 0, 5, delta);
      groupRef.current.position.z = THREE.MathUtils.damp(groupRef.current.position.z, active ? 0.28 : 0, 5, delta);
    }
  });

  return (
    <group>
      <mesh position={[0.22, -0.2, -0.28]} rotation={[-0.45, 0, 0]} scale={[1.1, 0.42, 1]} material={shadowMaterial}>
        <circleGeometry args={[2.2, 48]} />
      </mesh>
      <group ref={groupRef}>
        <mesh position={[0, 0, -0.085]} material={edgeMaterial}>
          <boxGeometry args={[4.92, 3.12, 0.18]} />
        </mesh>
        <mesh position={[0, 0, 0.02]} material={material}>
          <planeGeometry args={[4.8, 3, 32, 20]} />
        </mesh>
      </group>
    </group>
  );
}

export function AlbumHoloCard({ title, coverUrl, active: controlledActive, className }: AlbumHoloCardProps) {
  const [hovered, setHovered] = useState(false);
  const active = controlledActive ?? hovered;
  const texture = useAlbumTexture(coverUrl, title);

  return (
    <div
      className={cn("albumHoloCard", className)}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
    >
      <Canvas
        camera={{ position: [0, 0, 5.2], fov: 44 }}
        dpr={[1, 1.5]}
        gl={{ alpha: true, antialias: true, powerPreference: "high-performance" }}
      >
        <ambientLight intensity={1.2} />
        <directionalLight position={[3, 4, 4]} intensity={1.6} />
        <HoloPlane active={active} texture={texture} />
      </Canvas>
    </div>
  );
}
