import { useTexture } from '@react-three/drei'
import { useThree } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import {
  RepeatWrapping,
  SRGBColorSpace,
  Texture,
  Vector2,
} from 'three'

export type EnvironmentSurface = 'asphalt' | 'grass' | 'concrete'

const SURFACE_MAPS: Record<EnvironmentSurface, [string, string, string]> = {
  asphalt: [
    '/assets/environment/asphalt/diffuse.jpg',
    '/assets/environment/asphalt/normal.jpg',
    '/assets/environment/asphalt/roughness.jpg',
  ],
  grass: [
    '/assets/environment/grass/diffuse.jpg',
    '/assets/environment/grass/normal.jpg',
    '/assets/environment/grass/roughness.jpg',
  ],
  concrete: [
    '/assets/environment/concrete/diffuse.jpg',
    '/assets/environment/concrete/normal.jpg',
    '/assets/environment/concrete/roughness.jpg',
  ],
}

type PbrSurfaceMaterialProps = {
  surface: EnvironmentSurface
  repeat: readonly [number, number]
  color?: string
  roughness?: number
  metalness?: number
  normalScale?: number
  transparent?: boolean
  opacity?: number
}

function cloneTexture(source: Texture, repeat: readonly [number, number], color = false): Texture {
  const texture = source.clone()
  texture.wrapS = RepeatWrapping
  texture.wrapT = RepeatWrapping
  texture.repeat.set(repeat[0], repeat[1])
  texture.colorSpace = color ? SRGBColorSpace : texture.colorSpace
  texture.needsUpdate = true
  return texture
}

export function PbrSurfaceMaterial({ surface, repeat, color = '#ffffff', roughness = 0.92,
  metalness = 0.01, normalScale = 0.32, transparent = false,
  opacity = 1 }: PbrSurfaceMaterialProps) {
  const sources = useTexture(SURFACE_MAPS[surface]) as Texture[]
  const { gl } = useThree()
  const repeatX = repeat[0]
  const repeatY = repeat[1]
  const maps = useMemo(() => [
    cloneTexture(sources[0], [repeatX, repeatY], true),
    cloneTexture(sources[1], [repeatX, repeatY]),
    cloneTexture(sources[2], [repeatX, repeatY]),
  ], [repeatX, repeatY, sources])

  useEffect(() => {
    const anisotropy = Math.min(16, gl.capabilities.getMaxAnisotropy())
    maps.forEach((texture) => {
      texture.anisotropy = anisotropy
      texture.needsUpdate = true
    })
    return () => maps.forEach((texture) => texture.dispose())
  }, [gl, maps])

  return <meshStandardMaterial map={maps[0]} normalMap={maps[1]} roughnessMap={maps[2]}
    normalScale={new Vector2(normalScale, normalScale)} color={color} roughness={roughness}
    metalness={metalness} transparent={transparent} opacity={opacity} />
}

useTexture.preload(SURFACE_MAPS.asphalt)
