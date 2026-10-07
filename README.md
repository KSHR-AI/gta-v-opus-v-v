# Port Solano

An original open-world crime sandbox that runs in the browser, built with Three.js and Vite. You can drive, shoot, steal cars, run from the police and take jobs in a procedurally laid-out coastal city.

## Run it

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # static build in dist/
```

## Features

- **City.** A 10×10-block grid (~760 m across) with a skyscraper downtown, commercial streets, suburbs, parks, a parking lot with a respray shop, an industrial harbor with piers, and a beach with a boardwalk. It also has stunt ramps, street lights, traffic lights and billboards.
- **Vehicles.** 15 car types with arcade physics: grip and drift with the handbrake, jumps off ramps, damage, smoke, fire and explosions. Cars sink in water. Headlights come on at night and police cars have sirens.
- **Traffic AI.** Cars follow lanes and obey traffic lights. They brake for obstacles, honk, and panic when shot at.
- **Pedestrians.** They walk the sidewalks, dodge cars, run from gunfire, can be knocked down, and drop cash.
- **Police.** A 1–5 star wanted system based on witnesses. Patrol cars route through the street grid to chase you, and cops get out on foot to arrest or shoot. Breaking line of sight long enough loses them. You can be arrested.
- **Combat.** Fists, pistol, SMG, shotgun and rocket launcher, with over-the-shoulder aiming, hit-scan bullets, tracers, headshots and pickups.
- **Missions.** Five jobs from three contacts (Marisol, Dex and Vinnie): car theft, a timed delivery, a checkpoint race, a gang shootout and a demolition job.
- **World.** A full day/night cycle with a sky shader, stars, lit windows and lamp glow. The HUD has a rotating minimap with GPS, a full map, a speedometer, health/armor bars and the wanted stars.
- **Audio.** All sound is synthesized with WebAudio: engine, skids, guns, explosions and sirens. There are three procedurally generated radio stations.

## Controls

| Key | Action |
| --- | --- |
| WASD | Move / drive |
| Mouse | Look |
| Shift | Sprint |
| Space | Jump / handbrake |
| F | Enter, exit or steal a vehicle |
| LMB / RMB | Attack or shoot / aim |
| 1–5, mouse wheel | Switch weapon |
| R | Reload |
| H | Horn / siren |
| Q | Change radio station |
| C | Change camera distance |
| M | Full map |
| E | Start a mission at a contact marker |
| Esc | Pause |

## Credits

3D models: [Kenney](https://kenney.nl) — Car Kit, City Kit (Commercial, Roads, Suburban), Blocky Characters and Nature Kit. All are CC0 (see `public/assets/LICENSE-Kenney-CC0.txt`). Everything else (code, textures, music and sound) is original or procedurally generated. This is an independent project and is not affiliated with any other game franchise.
