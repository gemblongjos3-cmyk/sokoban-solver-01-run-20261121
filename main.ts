// Push-optimal Sokoban solver.
//
// The levels of this competition are built as a one-square-wide hallway with small rooms off
// it, each room holding as many boxes as goals, and no box can ever leave its room (a box
// pushed out of a door into the hallway can never come back, and reaches no goal there). So a
// level's push optimum is the sum of its rooms' optima, and each room is small enough (at most
// 4 boxes on some thirty squares) to be solved exactly on its own.
//
// Method, per room and as a fallback for the whole level: breadth-first search over pushes.
// A state is the set of box squares plus the player's reachable region (named by its lowest
// square); expanding states in the order they are found makes the first solved state
// push-optimal. Two deadlock prunes keep the search small without ever removing a solvable
// state: a box pushed onto a dead square (one from which no sequence of pushes, ignoring the
// other boxes, can bring it to a goal) and a frozen 2 x 2 block of walls and boxes holding a
// box off its goal. The player's walks between pushes are shortest paths, so the answer's
// pushes are the room's optimum. Everything is deterministic: fixed direction order, no
// clock, no randomness — the same level always yields the same bytes.

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const I = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const O = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

/** Directions in a fixed order: up, down, left, right. */
const DX = [0, 0, -1, 1];
const DY = [-1, 1, 0, 0];
const STEP_LETTER = ['u', 'd', 'l', 'r'];
const PUSH_LETTER = ['U', 'D', 'L', 'R'];

/** How many push states one search may keep before it gives up (work, never the clock). */
const STATE_CAP = 3_000_000;

interface Level {
  w: number;
  h: number;
  wall: Uint8Array;
  goals: number[];
  boxes: number[];
  player: number;
}

/** A level in XSB text, parsed the way the checker parses it; the outer frame is always wall. */
function parseLevel(text: string): Level {
  const rows = text.split('\n').filter((r) => r.length > 0);
  const h = rows.length;
  const w = Math.max(...rows.map((r) => r.length));
  const wall = new Uint8Array(w * h).fill(1);
  const goals: number[] = [];
  const boxes: number[] = [];
  let player = -1;
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      const i = y * w + x;
      if (ch === '#') continue;
      wall[i] = 0;
      if (ch === '.' || ch === '*' || ch === '+') goals.push(i);
      if (ch === '$' || ch === '*') boxes.push(i);
      if (ch === '@' || ch === '+') player = i;
    }
  });
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) wall[y * w + x] = 1;
    }
  }
  boxes.sort((a, b) => a - b);
  goals.sort((a, b) => a - b);
  return { w, h, wall, goals, boxes, player };
}

/**
 * The squares a box can ever be pushed from onto some goal, found by pulling boxes backwards
 * from the goals over open floor (ignoring the other boxes). Any other floor square is dead:
 * a box that lands there can never reach a goal.
 */
function liveSquares(w: number, wall: Uint8Array, goals: number[]): Uint8Array {
  const live = new Uint8Array(wall.length);
  const queue: number[] = [];
  for (const g of goals) {
    live[g] = 1;
    queue.push(g);
  }
  for (let qi = 0; qi < queue.length; qi++) {
    const x = queue[qi];
    for (let d = 0; d < 4; d++) {
      const delta = DY[d] * w + DX[d];
      const y = x - delta;
      if (!wall[y] && !wall[y - delta] && !live[y]) {
        live[y] = 1;
        queue.push(y);
      }
    }
  }
  return live;
}

/**
 * Flood the player's reachable region from `from`, around walls and the boxes in `occupied`,
 * marking `seen` with `stamp`; returns the region's lowest square, its canonical name.
 */
function flood(
  w: number,
  wall: Uint8Array,
  occupied: Uint8Array,
  from: number,
  seen: Int32Array,
  stamp: number,
  stack: Int32Array,
): number {
  let low = from;
  let n = 0;
  stack[n++] = from;
  seen[from] = stamp;
  while (n > 0) {
    const p = stack[--n];
    if (p < low) low = p;
    const up = p - w;
    const down = p + w;
    const left = p - 1;
    const right = p + 1;
    if (!wall[up] && !occupied[up] && seen[up] !== stamp) { seen[up] = stamp; stack[n++] = up; }
    if (!wall[down] && !occupied[down] && seen[down] !== stamp) { seen[down] = stamp; stack[n++] = down; }
    if (!wall[left] && !occupied[left] && seen[left] !== stamp) { seen[left] = stamp; stack[n++] = left; }
    if (!wall[right] && !occupied[right] && seen[right] !== stamp) { seen[right] = stamp; stack[n++] = right; }
  }
  return low;
}

/** Whether the box just pushed to `t` sits in a frozen 2 x 2 block with a box off its goal. */
function frozenBlock(
  w: number,
  wall: Uint8Array,
  occupied: Uint8Array,
  goal: Uint8Array,
  t: number,
): boolean {
  for (const a of [t, t - 1, t - w, t - w - 1]) {
    const b = a + 1;
    const c = a + w;
    const d = c + 1;
    if (!(wall[a] || occupied[a]) || !(wall[b] || occupied[b])) continue;
    if (!(wall[c] || occupied[c]) || !(wall[d] || occupied[d])) continue;
    if ((occupied[a] && !goal[a]) || (occupied[b] && !goal[b]) ||
        (occupied[c] && !goal[c]) || (occupied[d] && !goal[d])) return true;
  }
  return false;
}

/** The shortest walk from `from` to `to` around walls and boxes, in lower-case step letters. */
function walkPath(
  w: number,
  wall: Uint8Array,
  occupied: Uint8Array,
  from: number,
  to: number,
): string {
  if (from === to) return '';
  const prev = new Int32Array(wall.length).fill(-1);
  const how = new Int8Array(wall.length).fill(-1);
  const queue = [from];
  prev[from] = from;
  for (let qi = 0; qi < queue.length; qi++) {
    const p = queue[qi];
    if (p === to) break;
    for (let d = 0; d < 4; d++) {
      const q = p + DY[d] * w + DX[d];
      if (wall[q] || occupied[q] || prev[q] !== -1) continue;
      prev[q] = p;
      how[q] = d;
      queue.push(q);
    }
  }
  if (prev[to] === -1) return '';
  let s = '';
  for (let p = to; p !== from; p = prev[p]) s = STEP_LETTER[how[p]] + s;
  return s;
}

interface Solved {
  pushes: number;
  moves: string;
}

/**
 * The push-optimal solution of a (sub-)level by breadth-first search over pushes, or null
 * when the search gives up at `cap` states or the level cannot be solved.
 */
function solvePushes(level: Level, cap: number): Solved | null {
  const { w, wall, goals } = level;
  const size = wall.length;
  const goal = new Uint8Array(size);
  for (const g of goals) goal[g] = 1;
  const live = liveSquares(w, wall, goals);
  if (level.boxes.some((b) => !live[b])) return null;
  const solved = (bs: number[]): boolean => bs.every((b) => goal[b] === 1);

  const occupied = new Uint8Array(size);
  const seen = new Int32Array(size);
  const mark = new Int32Array(size);
  const stack = new Int32Array(size);
  let stamp = 0;

  const keyOf = (bs: number[], low: number): string => low + '|' + bs.join(',');

  // States in the order found: their boxes, the square the player stands on, their parent.
  const statesBoxes: number[][] = [level.boxes.slice()];
  const statesPlayer: number[] = [level.player];
  const parent: number[] = [-1];
  const index = new Map<string, number>();
  for (const b of level.boxes) occupied[b] = 1;
  const startLow = flood(w, wall, occupied, level.player, seen, ++stamp, stack);
  for (const b of level.boxes) occupied[b] = 0;
  index.set(keyOf(level.boxes, startLow), 0);
  let found = solved(level.boxes) ? 0 : -1;

  for (let head = 0; found < 0 && head < statesBoxes.length; head++) {
    const boxes = statesBoxes[head];
    for (const b of boxes) occupied[b] = 1;
    flood(w, wall, occupied, statesPlayer[head], seen, ++stamp, stack);
    const here = stamp;
    for (let bi = 0; bi < boxes.length && found < 0; bi++) {
      const b = boxes[bi];
      for (let d = 0; d < 4; d++) {
        const delta = DY[d] * w + DX[d];
        const t = b + delta;
        // The player must be able to stand behind the box, and the target must be a live,
        // empty, open square.
        if (seen[b - delta] !== here || wall[t] || occupied[t] || !live[t]) continue;
        occupied[b] = 0;
        occupied[t] = 1;
        const frozen = frozenBlock(w, wall, occupied, goal, t);
        let key = '';
        let next: number[] | null = null;
        if (!frozen) {
          next = boxes.slice();
          next[bi] = t;
          next.sort((x, y) => x - y);
          // After the push the player stands where the box was.
          key = keyOf(next, flood(w, wall, occupied, b, mark, ++stamp, stack));
        }
        occupied[t] = 0;
        occupied[b] = 1;
        if (frozen || next === null || index.has(key)) continue;
        if (statesBoxes.length >= cap) {
          for (const x of boxes) occupied[x] = 0;
          return null;
        }
        index.set(key, statesBoxes.length);
        statesBoxes.push(next);
        statesPlayer.push(b);
        parent.push(head);
        if (solved(next)) found = statesBoxes.length - 1;
      }
    }
    for (const b of boxes) occupied[b] = 0;
  }
  if (found < 0) return null;

  // Rebuild the moves: walk to each push's standing square, then push.
  const path: number[] = [];
  for (let s = found; s > 0; s = parent[s]) path.push(s);
  path.reverse();
  let moves = '';
  let player = level.player;
  let boxes = level.boxes;
  for (const s of path) {
    const nextBoxes = statesBoxes[s];
    const from = boxes.find((b) => !nextBoxes.includes(b))!;
    const to = nextBoxes.find((b) => !boxes.includes(b))!;
    const delta = to - from;
    const d = delta === -w ? 0 : delta === w ? 1 : delta === -1 ? 2 : 3;
    for (const b of boxes) occupied[b] = 1;
    moves += walkPath(w, wall, occupied, player, from - delta);
    for (const b of boxes) occupied[b] = 0;
    moves += PUSH_LETTER[d];
    player = from;
    boxes = nextBoxes;
  }
  return { pushes: path.length, moves };
}

interface Room {
  squares: number[];
  boxes: number[];
  goals: number[];
}

/**
 * The level's rooms: cut the dead squares of the player's row (the hallway: a box there
 * reaches no goal) out of the floor; each part left that holds a box is a room. Null when
 * the level is no such set of rooms (a part holding more or fewer boxes than goals, a goal
 * in the hallway, or a box starting in the hallway).
 */
function roomsOf(level: Level): Room[] | null {
  const { w, wall, goals, boxes, player } = level;
  const live = liveSquares(w, wall, goals);
  const row = Math.floor(player / w);
  const cut = new Uint8Array(wall.length);
  for (let i = row * w; i < (row + 1) * w; i++) {
    if (!wall[i] && !live[i]) cut[i] = 1;
  }
  if (boxes.some((b) => cut[b] === 1)) return null;
  const part = new Int32Array(wall.length).fill(-1);
  const rooms: Room[] = [];
  for (let s = 0; s < wall.length; s++) {
    if (wall[s] || cut[s] || part[s] >= 0) continue;
    const squares = [s];
    part[s] = rooms.length;
    for (let i = 0; i < squares.length; i++) {
      for (let d = 0; d < 4; d++) {
        const q = squares[i] + DY[d] * w + DX[d];
        if (!wall[q] && !cut[q] && part[q] < 0) {
          part[q] = rooms.length;
          squares.push(q);
        }
      }
    }
    rooms.push({ squares, boxes: [], goals: [] });
  }
  for (const b of boxes) rooms[part[b]].boxes.push(b);
  for (const g of goals) if (part[g] >= 0) rooms[part[g]].goals.push(g);
  if (goals.some((g) => part[g] < 0)) return null;
  if (rooms.some((r) => r.boxes.length !== r.goals.length)) return null;
  return rooms.filter((r) => r.boxes.length > 0);
}

/** The square the player stands on after playing `moves` from `from` on a board `w` wide. */
function endOf(w: number, from: number, moves: string): number {
  let p = from;
  for (const ch of moves.toLowerCase()) {
    p += ch === 'u' ? -w : ch === 'd' ? w : ch === 'l' ? -1 : 1;
  }
  return p;
}

/** Solve one level: room by room when it decomposes, the whole level at once otherwise. */
function solveLevel(level: Level): string {
  const rooms = roomsOf(level);
  if (rooms !== null) {
    let player = level.player;
    let moves = '';
    let ok = true;
    for (const room of rooms) {
      // The other rooms' boxes stand as walls; a finished room's boxes rest on its goals.
      const wall = level.wall.slice();
      for (const other of rooms) {
        if (other === room) continue;
        for (const b of other.boxes) wall[b] = 1;
      }
      const sub: Level = {
        w: level.w,
        h: level.h,
        wall,
        goals: room.goals.slice().sort((a, b) => a - b),
        boxes: room.boxes.slice().sort((a, b) => a - b),
        player,
      };
      const solvedRoom = solvePushes(sub, STATE_CAP);
      if (solvedRoom === null) {
        ok = false;
        break;
      }
      moves += solvedRoom.moves;
      player = endOf(level.w, player, solvedRoom.moves);
      room.boxes = room.goals.slice();
    }
    if (ok) return moves;
  }
  const whole = solvePushes(level, STATE_CAP);
  return whole === null ? '' : whole.moves;
}

for (const id of readdirSync(I).sort()) {
  const level = parseLevel(readFileSync(join(I, id, 'level.txt'), 'utf8'));
  const moves = solveLevel(level);
  mkdirSync(join(O, id), { recursive: true });
  writeFileSync(join(O, id, 'solution.txt'), `${moves}\n`);
}
