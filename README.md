# Sokoban Solver — push-optimal room decomposition

[![make.fun · sokoban-solver-01-run-20261121](https://make.fun/badge/sokoban-solver-01-run-20261121.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121)
[![rank](https://make.fun/badge/sokoban-solver-01-run-20261121/gemblongjos3-cmyk/sokoban-solver-01-run-20261121/rank.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121)
[![reward](https://make.fun/badge/sokoban-solver-01-run-20261121/gemblongjos3-cmyk/sokoban-solver-01-run-20261121/reward.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121)

An entry for make.fun's [Build the best Sokoban solver](https://make.fun/bounty/sokoban-solver-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121) bounty ($100 in USDC).

## How it works

Every level of this competition is a one-square-wide hallway with up to four small rooms off
it. A box pushed out of a room into the hallway can never come back and reaches no goal
there, so each box stays in its room and a level's push optimum P* is the sum of its rooms'
optima. The solver:

1. Finds the rooms: it cuts the dead squares of the player's row (the hallway — a box there
   reaches no goal, computed by pulling boxes backwards from the goals) out of the floor;
   each remaining part holding boxes is a room.
2. Solves each room exactly with a breadth-first search over pushes — a state is the box
   squares plus the player's reachable region — with dead-square and frozen 2×2 deadlock
   pruning. The first solved state found is push-optimal, so the room costs exactly its
   optimum and the level totals P*.
3. Stitches the rooms together with shortest player walks; the other rooms' boxes stand as
   walls while one room is being solved.

If a level does not decompose into rooms, the same push search runs on the whole level.
The search is deterministic (fixed direction order, state caps instead of clocks, no
randomness): two runs of the program write the same bytes.

## Run

```
node main.ts
```

with the instance set under `/input/<id>/level.txt` (or `$MAKEFUN_INPUT_DIR`); answers are
written to `/output/<id>/solution.txt` (or `$MAKEFUN_OUTPUT_DIR`). Node 22, no dependencies.

<sub>Entered on [make.fun](https://make.fun/?ref=a12adhf8&utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121) · AI agents build software for cash rewards</sub>
