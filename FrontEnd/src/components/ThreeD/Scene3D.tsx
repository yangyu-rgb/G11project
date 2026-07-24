import { Grid, OrbitControls } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { Suspense } from 'react'

import type {
  SimulationEvent,
  SimulationTransmission,
  SimulationVehicle,
} from '../../types/simulation'
import { Event3D } from './Event3D'
import { Message3D } from './Message3D'
import { Road3D, type SceneLayout } from './Road3D'
import { Vehicle3D } from './Vehicle3D'

type Scene3DProps = {
  vehicles: SimulationVehicle[]
  events: SimulationEvent[]
  messages: SimulationTransmission[]
  layout?: SceneLayout
  headingId?: string
  title?: string
  eyebrow?: string
}

export function Scene3D({
  vehicles,
  events,
  messages,
  layout = 'highway',
  headingId = 'scene-3d-heading',
  title = '3D通信态势',
  eyebrow = 'LIVE 3D OVERVIEW',
}: Scene3DProps) {
  const urban = layout === 'urban'
  return (
    <section className="map-card scene-card" aria-labelledby={headingId}>
      <div className="section-heading">
        <div><p className="eyebrow">{eyebrow}</p><h2 id={headingId}>{title}</h2></div>
        <div className="legend" aria-label="车辆状态图例">
          <span><i className="legend-dot normal" />正常</span>
          <span><i className="legend-dot sending" />发送</span>
          <span><i className="legend-dot receiving" />接收</span>
        </div>
      </div>
      <div className="scene-3d" data-testid="scene-3d">
        <Canvas
          dpr={[1, 1.5]}
          camera={{ position: urban ? [50, 52, 42] : [50, 42, 26], fov: 45, near: 0.1, far: 500 }}
          gl={{ antialias: true, powerPreference: 'high-performance' }}
        >
          <color attach="background" args={['#07111f']} />
          <fog attach="fog" args={['#07111f', 85, 180]} />
          <ambientLight intensity={1.25} />
          <directionalLight position={[35, 55, 20]} intensity={2.2} />
          <Suspense fallback={null}>
            <Grid
              position={[50, -0.14, urban ? 10 : 0]}
              args={[120, urban ? 36 : 22]}
              cellSize={1}
              cellThickness={0.45}
              cellColor="#17324b"
              sectionSize={5}
              sectionThickness={0.8}
              sectionColor="#24506f"
              fadeDistance={100}
              infiniteGrid={false}
            />
            <Road3D layout={layout} />
            {vehicles.map((vehicle) => <Vehicle3D key={vehicle.id} vehicle={vehicle} />)}
            {events.map((event) => <Event3D key={event.id} event={event} />)}
            <Message3D messages={messages} vehicles={vehicles} />
          </Suspense>
          <OrbitControls
            makeDefault
            target={[50, 0, urban ? 10 : 0]}
            minDistance={12}
            maxDistance={150}
            maxPolarAngle={Math.PI / 2.08}
            enableDamping
          />
        </Canvas>
      </div>
    </section>
  )
}
