import type { TilePoint } from '@web-legend/contracts';

export type InterestConfig = {
  /** Side length of one AOI cell, in tiles. */
  cellSize: number;
  /** Chebyshev radius of cells visible around the entity's own cell. */
  radiusCells: number;
};

export const DEFAULT_INTEREST: InterestConfig = { cellSize: 8, radiusCells: 1 };

function cellCoordinate(tile: number, cellSize: number): number {
  return Math.floor(tile / cellSize);
}

function cellKey(cellX: number, cellY: number): string {
  return `${String(cellX)}:${String(cellY)}`;
}

/**
 * Cell-based interest management. It tracks which tile cell each entity
 * occupies and reports the viewers whose visibility may have changed after an
 * entity joins, leaves or crosses a cell boundary. It deliberately avoids a
 * full O(N²) distance scan every tick: visibility is only recomputed for the
 * neighbourhoods affected by the change.
 */
export class InterestManager {
  private readonly cellOf = new Map<string, string>();
  private readonly entitiesByCell = new Map<string, Set<string>>();

  constructor(private readonly config: InterestConfig = DEFAULT_INTEREST) {
    if (!Number.isInteger(config.cellSize) || config.cellSize < 1) {
      throw new RangeError('interest cellSize must be a positive integer');
    }
    if (!Number.isInteger(config.radiusCells) || config.radiusCells < 0) {
      throw new RangeError('interest radiusCells must be a non-negative integer');
    }
  }

  add(id: string, tile: TilePoint): string[] {
    const key = cellKey(
      cellCoordinate(tile.x, this.config.cellSize),
      cellCoordinate(tile.y, this.config.cellSize),
    );
    const previous = this.cellOf.get(id);
    if (previous === key) {
      return [];
    }
    if (previous !== undefined) {
      this.entitiesByCell.get(previous)?.delete(id);
    }
    this.cellOf.set(id, key);
    let members = this.entitiesByCell.get(key);
    if (members === undefined) {
      members = new Set<string>();
      this.entitiesByCell.set(key, members);
    }
    members.add(id);
    return this.neighbourhoodIds(key);
  }

  remove(id: string): string[] {
    const key = this.cellOf.get(id);
    if (key === undefined) {
      return [];
    }
    const affected = this.neighbourhoodIds(key);
    this.entitiesByCell.get(key)?.delete(id);
    this.cellOf.delete(id);
    return affected;
  }

  /** Reports the viewers whose visibility may change after this entity moves. */
  move(id: string, tile: TilePoint): string[] {
    const key = cellKey(
      cellCoordinate(tile.x, this.config.cellSize),
      cellCoordinate(tile.y, this.config.cellSize),
    );
    const previous = this.cellOf.get(id);
    if (previous === key) {
      return [];
    }

    const affected = new Set<string>(this.neighbourhoodIds(key));
    if (previous !== undefined) {
      for (const viewer of this.neighbourhoodIds(previous)) {
        affected.add(viewer);
      }
      this.entitiesByCell.get(previous)?.delete(id);
    }
    this.cellOf.set(id, key);
    let members = this.entitiesByCell.get(key);
    if (members === undefined) {
      members = new Set<string>();
      this.entitiesByCell.set(key, members);
    }
    members.add(id);
    return [...affected];
  }

  /** Entities this entity should currently receive, including itself. */
  visibleIdsFor(id: string): Set<string> {
    const key = this.cellOf.get(id);
    if (key === undefined) {
      return new Set();
    }
    return new Set(this.neighbourhoodIds(key));
  }

  cellOfEntity(id: string): string | undefined {
    return this.cellOf.get(id);
  }

  size(): number {
    return this.cellOf.size;
  }

  private neighbourhoodIds(key: string): string[] {
    const [cellXText, cellYText] = key.split(':');
    const cellX = Number(cellXText);
    const cellY = Number(cellYText);
    const ids: string[] = [];
    for (let y = cellY - this.config.radiusCells; y <= cellY + this.config.radiusCells; y += 1) {
      for (let x = cellX - this.config.radiusCells; x <= cellX + this.config.radiusCells; x += 1) {
        const members = this.entitiesByCell.get(cellKey(x, y));
        if (members === undefined) {
          continue;
        }
        for (const id of members) {
          ids.push(id);
        }
      }
    }
    return ids;
  }
}
