"use client";

import { useEffect, useMemo, useReducer } from "react";

type Position = { x: number; y: number };
type Direction = "up" | "down" | "left" | "right";
type Phase = "ready" | "playing" | "death" | "won" | "lost";
type GhostMode = "scatter" | "chase" | "frightened" | "eyes";

type Ghost = {
  id: number;
  position: Position;
  direction: Direction;
  mode: GhostMode;
  scatterTarget: Position;
  home: Position;
};

type GameState = {
  player: Position;
  direction: Direction;
  queuedDirection: Direction;
  ghosts: Ghost[];
  walls: Set<string>;
  pellets: Set<string>;
  powerPellets: Set<string>;
  score: number;
  lives: number;
  phase: Phase;
  frightenedTimer: number;
  ghostPatternTimer: number;
  combo: number;
  message: string;
  deathTimer: number;
};

type Action =
  | { type: "SET_DIRECTION"; direction: Direction }
  | { type: "START" }
  | { type: "RESET" }
  | { type: "TICK" }
  | { type: "RESUME_AFTER_DEATH" };

const BOARD_TEMPLATE = [
  "###############",
  "#o...........o#",
  "#.###.#.###.#.#",
  "#.#...#...#...#",
  "#.#.###.#.###.#",
  "#...#...#...#.#",
  "###.#.###.#.#.#",
  "#...#...#...#.#",
  "#.###.###.#.#.#",
  "      P.G      ",
  "#.###.#.###.#.#",
  "#...#...#...#.#",
  "#.#.###.#.###.#",
  "#o...........o#",
  "###############",
];

const boardWidth = BOARD_TEMPLATE[0].length;
const boardHeight = BOARD_TEMPLATE.length;
const DIRECTIONS: Direction[] = ["up", "down", "left", "right"];
const directionVectors: Record<Direction, Position> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

const TICK_MS = 150;
const FRIGHTENED_MS = 7000;
const PATTERN_CYCLE_MS = 14000;
const SCATTER_PHASE_MS = 7000;
const DEATH_MS = 900;

const GHOST_HOMES: Position[] = [
  { x: 2, y: 9 },
  { x: 10, y: 9 },
  { x: 11, y: 9 },
  { x: 12, y: 9 },
];

const GHOST_SCATTER_TARGETS: Position[] = [
  { x: boardWidth - 2, y: 1 },
  { x: 1, y: 1 },
  { x: boardWidth - 2, y: boardHeight - 2 },
  { x: 1, y: boardHeight - 2 },
];

const getKey = ({ x, y }: Position) => `${x},${y}`;

const reverseDirection = (direction: Direction): Direction => {
  if (direction === "up") return "down";
  if (direction === "down") return "up";
  if (direction === "left") return "right";
  return "left";
};

const movePosition = (position: Position, direction: Direction): Position => {
  const next = {
    x: position.x + directionVectors[direction].x,
    y: position.y + directionVectors[direction].y,
  };

  if (next.x < 0) next.x = boardWidth - 1;
  if (next.x >= boardWidth) next.x = 0;
  if (next.y < 0) next.y = boardHeight - 1;
  if (next.y >= boardHeight) next.y = 0;

  return next;
};

const isWallAt = (position: Position, walls: Set<string>) => walls.has(getKey(position));

const canMove = (position: Position, direction: Direction, walls: Set<string>) => {
  const next = movePosition(position, direction);
  return !isWallAt(next, walls);
};

const manhattan = (a: Position, b: Position) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

const getAvailableMoves = (position: Position, walls: Set<string>) =>
  DIRECTIONS.filter((direction) => canMove(position, direction, walls));

const buildWorld = () => {
  const walls = new Set<string>();
  const pellets = new Set<string>();
  const powerPellets = new Set<string>();
  let playerStart = { x: 1, y: 1 };

  BOARD_TEMPLATE.forEach((row, y) => {
    row.split("").forEach((cell, x) => {
      const key = getKey({ x, y });

      if (cell === "#") {
        walls.add(key);
        return;
      }

      if (cell === "." || cell === "o") {
        pellets.add(key);
      }

      if (cell === "o") {
        powerPellets.add(key);
      }

      if (cell === "P") {
        playerStart = { x, y };
      }
    });
  });

  return { playerStart, walls, pellets, powerPellets };
};

const createGhosts = (): Ghost[] =>
  GHOST_HOMES.map((home, index) => ({
    id: index,
    position: { ...home },
    direction: index % 2 === 0 ? "left" : "right",
    mode: "scatter",
    scatterTarget: GHOST_SCATTER_TARGETS[index] ?? { x: 1, y: 1 },
    home: { ...home },
  }));

const getGhostTarget = (ghost: Ghost, player: Position, direction: Direction) => {
  if (ghost.id === 0) return player;
  if (ghost.id === 1) {
    const offset = { x: direction === "left" ? -4 : direction === "right" ? 4 : 0, y: direction === "up" ? -4 : direction === "down" ? 4 : 0 };
    return { x: player.x + offset.x, y: player.y + offset.y };
  }
  if (ghost.id === 2) {
    return { x: player.x + (direction === "left" ? -2 : direction === "right" ? 2 : 0), y: player.y + (direction === "up" ? -2 : direction === "down" ? 2 : 0) };
  }

  const distanceToPlayer = manhattan(ghost.position, player);
  return distanceToPlayer > 6 ? player : ghost.scatterTarget;
};

const chooseGhostStep = (
  ghost: Ghost,
  player: Position,
  direction: Direction,
  walls: Set<string>,
  patternMode: "scatter" | "chase",
) => {
  const available = getAvailableMoves(ghost.position, walls);

  if (available.length === 0) {
    return { direction: ghost.direction, position: ghost.position };
  }

  const allowed = available.filter((step) => step !== reverseDirection(ghost.direction));
  const options = allowed.length > 0 ? allowed : available;

  if (ghost.mode === "frightened") {
    const nextDirection = options[Math.floor(Math.random() * options.length)];
    return {
      direction: nextDirection,
      position: movePosition(ghost.position, nextDirection),
    };
  }

  const target =
    ghost.mode === "eyes"
      ? ghost.home
      : patternMode === "scatter"
        ? ghost.scatterTarget
        : getGhostTarget(ghost, player, direction);

  let bestDirection = options[0];
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const nextDirection of options) {
    const nextPosition = movePosition(ghost.position, nextDirection);
    const nextDistance = manhattan(nextPosition, target);
    if (nextDistance < bestDistance) {
      bestDistance = nextDistance;
      bestDirection = nextDirection;
    }
  }

  return {
    direction: bestDirection,
    position: movePosition(ghost.position, bestDirection),
  };
};

const buildInitialState = (): GameState => {
  const { playerStart, walls, pellets, powerPellets } = buildWorld();

  return {
    player: playerStart,
    direction: "left",
    queuedDirection: "left",
    ghosts: createGhosts(),
    walls,
    pellets,
    powerPellets,
    score: 0,
    lives: 3,
    phase: "ready",
    frightenedTimer: 0,
    ghostPatternTimer: 0,
    combo: 0,
    message: "Press any arrow key or WASD to start",
    deathTimer: DEATH_MS,
  };
};

function gameReducer(state: GameState, action: Action): GameState {
  switch (action.type) {
    case "SET_DIRECTION": {
      if (state.phase === "won" || state.phase === "lost") {
        return state;
      }

      if (state.phase === "ready") {
        return {
          ...state,
          queuedDirection: action.direction,
          phase: "playing",
          message: "Game on!",
        };
      }

      return {
        ...state,
        queuedDirection: action.direction,
      };
    }
    case "START": {
      if (state.phase !== "ready") {
        return state;
      }

      return {
        ...state,
        phase: "playing",
        message: "Game on!",
      };
    }
    case "RESET": {
      return buildInitialState();
    }
    case "RESUME_AFTER_DEATH": {
      if (state.phase !== "death") {
        return state;
      }

      const { playerStart, walls, pellets, powerPellets } = buildWorld();

      return {
        ...state,
        player: playerStart,
        direction: "left",
        queuedDirection: "left",
        ghosts: createGhosts(),
        walls,
        pellets,
        powerPellets,
        phase: "playing",
        frightenedTimer: 0,
        ghostPatternTimer: 0,
        combo: 0,
        message: "Try again!",
        deathTimer: DEATH_MS,
      };
    }
    case "TICK": {
      if (state.phase !== "playing") {
        return state;
      }

      let nextDirection = state.direction;
      if (canMove(state.player, state.queuedDirection, state.walls)) {
        nextDirection = state.queuedDirection;
      } else if (!canMove(state.player, state.direction, state.walls)) {
        nextDirection = state.direction;
      }

      const nextPlayer = canMove(state.player, nextDirection, state.walls)
        ? movePosition(state.player, nextDirection)
        : state.player;

      const pellets = new Set(state.pellets);
      const powerPellets = new Set(state.powerPellets);
      let score = state.score;
      let combo = state.combo;
      let frightenedTimer = Math.max(0, state.frightenedTimer - TICK_MS);
      const ghostPatternTimer = (state.ghostPatternTimer + TICK_MS) % PATTERN_CYCLE_MS;
      const patternMode: "scatter" | "chase" = ghostPatternTimer < SCATTER_PHASE_MS ? "scatter" : "chase";

      const playerKey = getKey(nextPlayer);
      if (pellets.has(playerKey)) {
        pellets.delete(playerKey);
        score += 10;
      }

      if (powerPellets.has(playerKey)) {
        powerPellets.delete(playerKey);
        score += 50;
        frightenedTimer = FRIGHTENED_MS;
        combo = 0;
      }

      const ghosts = state.ghosts.map((ghost) => {
        const atHome = ghost.position.x === ghost.home.x && ghost.position.y === ghost.home.y;
        let mode: GhostMode;

        if (ghost.mode === "eyes") {
          mode = atHome ? patternMode : "eyes";
        } else if (frightenedTimer > 0) {
          mode = "frightened";
        } else {
          mode = patternMode;
        }

        const step = chooseGhostStep({ ...ghost, mode }, nextPlayer, nextDirection, state.walls, patternMode);

        return {
          ...ghost,
          direction: step.direction,
          position: step.position,
          mode,
        };
      });

      let lives = state.lives;
      let phase: Phase = state.phase;
      let message = state.message;

      for (const ghost of ghosts) {
        if (ghost.mode === "eyes") {
          continue;
        }

        if (ghost.position.x === nextPlayer.x && ghost.position.y === nextPlayer.y) {
          if (ghost.mode === "frightened") {
            score += 200 * (combo + 1);
            combo += 1;
            ghost.mode = "eyes";
            message = "Ghost eaten!";
          } else {
            lives -= 1;
            phase = "death";
            message = "You were caught!";
            break;
          }
        }
      }

      if (frightenedTimer === 0) {
        combo = 0;
      }

      if (phase === "playing" && pellets.size === 0) {
        phase = "won";
        message = "You win!";
      }

      if (lives <= 0 && phase === "death") {
        phase = "lost";
        message = "Game over!";
      }

      return {
        ...state,
        player: nextPlayer,
        direction: nextDirection,
        queuedDirection: nextDirection,
        ghosts,
        pellets,
        powerPellets,
        score,
        lives,
        phase,
        frightenedTimer,
        ghostPatternTimer,
        combo,
        message,
        deathTimer: DEATH_MS,
      };
    }
    default:
      return state;
  }
}

export default function Home() {
  const [game, dispatch] = useReducer(gameReducer, undefined, buildInitialState);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const keyMap: Record<string, Direction> = {
        ArrowUp: "up",
        ArrowDown: "down",
        ArrowLeft: "left",
        ArrowRight: "right",
        w: "up",
        s: "down",
        a: "left",
        d: "right",
      };

      if (event.key === " " || event.key === "Enter") {
        if (game.phase === "ready") {
          event.preventDefault();
          dispatch({ type: "START" });
        }
        return;
      }

      const direction = keyMap[event.key];
      if (!direction) {
        return;
      }

      event.preventDefault();
      dispatch({ type: "SET_DIRECTION", direction });
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [game.phase]);

  useEffect(() => {
    if (game.phase === "playing") {
      const interval = window.setInterval(() => {
        dispatch({ type: "TICK" });
      }, TICK_MS);

      return () => window.clearInterval(interval);
    }

    if (game.phase === "death") {
      const timer = window.setTimeout(() => {
        dispatch({ type: "RESUME_AFTER_DEATH" });
      }, DEATH_MS);

      return () => window.clearTimeout(timer);
    }

    return undefined;
  }, [game.phase]);

  const board = useMemo(() => BOARD_TEMPLATE.map((row) => row.split("")), []);
  const rows = board.length;
  const cols = board[0]?.length ?? 0;

  const handlePrimaryAction = () => {
    if (game.phase === "ready" || game.phase === "won" || game.phase === "lost") {
      dispatch({ type: "RESET" });
      dispatch({ type: "START" });
      return;
    }

    dispatch({ type: "START" });
  };

  return (
    <main className="game-shell">
      <div className="game-panel">
        <div className="hud">
          <div>
            <span className="label">Score</span>
            <strong>{game.score}</strong>
          </div>
          <div>
            <span className="label">Lives</span>
            <strong>{game.lives}</strong>
          </div>
          <div>
            <span className="label">Status</span>
            <strong>{game.phase}</strong>
          </div>
        </div>

        <div className="board-wrap">
          <div
            className="board"
            style={{
              gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
              gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
            }}
          >
            {board.map((row, y) =>
              row.map((cell, x) => {
                const key = getKey({ x, y });
                const isWall = cell === "#" || game.walls.has(key);
                const isPellet = game.pellets.has(key);
                const isPowerPellet = game.powerPellets.has(key);
                const isPlayer = game.player.x === x && game.player.y === y;
                const ghost = game.ghosts.find(
                  (entry) => entry.position.x === x && entry.position.y === y,
                );

                return (
                  <div key={`${x}-${y}`} className={`cell ${isWall ? "wall" : "empty"}`}>
                    {!isWall && isPellet && <span className={isPowerPellet ? "power" : "pellet"} />}
                    {!isWall && isPlayer && <span className={`player ${game.direction}`} />}
                    {!isWall && ghost && (
                      <span className={`ghost ghost-${ghost.id % 4} ${ghost.mode}`} />
                    )}
                  </div>
                );
              }),
            )}
          </div>
        </div>

        <div className="controls">
          {game.phase !== "playing" && (
            <div className="overlay-card">
              <h1>Pac-Man</h1>
              <p>{game.phase === "ready" ? "Press start or any arrow key to begin" : game.message}</p>
            </div>
          )}

          <p className="status-line">{game.message}</p>
          <div className="actions">
            {(game.phase === "ready" || game.phase === "won" || game.phase === "lost") && (
              <button onClick={handlePrimaryAction}>
                {game.phase === "ready" ? "Start" : "Play again"}
              </button>
            )}
            <button className="secondary" onClick={() => dispatch({ type: "RESET" })}>
              Reset
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
