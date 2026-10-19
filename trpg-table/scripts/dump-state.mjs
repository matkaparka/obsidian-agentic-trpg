// Print the live table snapshot compactly (positions, HP, combat) for debugging.
import { readFileSync } from 'node:fs';

const path = process.argv[2] ?? 'state/table.json';
const snap = JSON.parse(readFileSync(path, 'utf8'));
const rules = snap.rules ?? {};
console.log(
  JSON.stringify(
    {
      scene: snap.sceneId,
      phase: snap.phase,
      combat: rules.combat,
      actors: (rules.actors ?? []).map((a) => ({
        id: a.id,
        name: a.name,
        kind: a.kind,
        hp: `${a.hp}/${a.maxHp}`,
        pos: a.position,
        moveUsed: a.turn?.movementUsed,
      })),
      visible: snap.visibleActorIds,
    },
    null,
    2
  )
);
