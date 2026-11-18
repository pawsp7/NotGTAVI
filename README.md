# Port Solana

An original open-world crime-caper sandbox that runs in the browser. Steal cars, run jobs for Nico at the Moonwake Diner, outrun the police and watch the sun set over the bay.

Everything is made in code: the city, cars, people, textures, sky and radio music are all generated at load time. The only dependency is [three.js](https://threejs.org).

## Play

- **Offline / quickest:** open `dist/index.html` in a desktop browser. It is a single self-contained file.
- **From source:** `npm install`, then `npm run dev` and open http://localhost:5173. The dev page loads three.js from jsDelivr.
- **Rebuild the single file:** `npm run build` writes `dist/index.html`.

## What's in the demo

- An 8×8-block coastal city with five districts (Downtown towers, Surfside Strip hotels, Midtown, Palm Heights houses and the Docks), a beach, a lighthouse, parks and stunt ramps
- Arcade driving with drifting, skid marks, body roll, damage, smoke, fire and explosions; seven vehicle types
- Lane-following traffic that turns at intersections, yields, honks and recovers when stuck
- Pedestrians who walk the sidewalks, cross streets, flee and get knocked over
- Wanted stars: crimes build heat, patrol cars chase and box you in, and you lose them by breaking line of sight or paying a Spray Shack
- Three story missions: a timed delivery, a showroom car theft with a police escape, and a checkpoint street race
- Day/night cycle (a full day takes 12 minutes) with lit windows, neon, street lights and headlights
- Three procedural radio stations, engine/siren/surf sound, all synthesised with Web Audio
- Minimap with GPS route, full map, cash pickups, stunt bonuses and saved progress
- Touch controls for phones and tablets, with automatic low-graphics mode

## Controls

| Action | Keyboard / mouse | Touch |
| --- | --- | --- |
| Move / drive | WASD or arrows | Left thumb |
| Look | Mouse (click to capture) or drag | Drag right side |
| Get in / steal / get out | F | CAR |
| Sprint | Shift | RUN |
| Jump / handbrake | Space | JUMP |
| Punch | Click or Q | HIT |
| Horn, radio | H, R | RADIO |
| Map, camera distance | M, C | MAP |
| Pause | Esc | PAUSE |

## Code layout

| File | What it does |
| --- | --- |
| `src/main.js` | Game setup, main loop, events (crashes, explosions, wasted/busted), respawns, saves |
| `src/world.js` | City generation, building facade shader, collision grid, ramps, landmarks, map image |
| `src/car.js` | Vehicle types, car meshes and arcade physics |
| `src/traffic.js` | Lane-following driver AI, police pursuit routing, traffic spawning, car-vs-car collisions |
| `src/ped.js` | Character model, pedestrians and their behaviour |
| `src/player.js` | On-foot controls, entering/stealing cars, punching |
| `src/wanted.js` | Heat, wanted stars, police spawning, evasion and arrests |
| `src/missions.js` | Mission scripts, markers, dialogue |
| `src/sky.js` | Time of day, sun/moon light, sky dome, clouds |
| `src/hud.js` | HUD, minimap, GPS and full map |
| `src/audio.js` | Synthesised sound effects and radio stations |
| `src/effects.js` | Particles, skid marks, explosion flashes |
| `src/input.js`, `src/camera.js` | Keyboard/mouse/touch input and the chase camera |

Port Solana is an original work. It is not affiliated with, and does not use assets from, any commercial game.
