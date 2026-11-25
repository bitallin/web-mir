import {
  BASE_CONTENT_BUNDLE,
  BASE_CONTENT_VERSION,
  contentChecksum,
  validateContentBundle,
} from '@web-legend/content-schema';
import type { ContentBundle } from '@web-legend/contracts';
import { findRealmActiveContent, findRealmByCode, type Database } from '@web-legend/persistence';
import type { Logger } from 'pino';

export type RoomContent = {
  version: string;
  checksum: string;
  bundle: ContentBundle;
};

/** Storage-agnostic view used by Rooms and test fixtures. */
export type ContentProvider = {
  snapshot: () => RoomContent;
  start: () => Promise<void>;
  stop: () => void;
};

export const BASE_ROOM_CONTENT: RoomContent = {
  version: BASE_CONTENT_VERSION,
  checksum: contentChecksum(BASE_CONTENT_BUNDLE),
  bundle: BASE_CONTENT_BUNDLE,
};

export type ContentStoreOptions = {
  /** Realm code this process serves (ADR-023). */
  realmCode: string;
  /** Production refuses to start when the realm is missing. */
  requireRealm?: boolean;
  refreshMs?: number;
};

/**
 * Polls the bound realm's active content release and exposes the latest
 * snapshot. A Room copies the snapshot only in `onCreate`, so an activation
 * never mutates a running battle (ADR-008 / ADR-022 / ADR-023).
 */
export class ContentStore implements ContentProvider {
  private current: RoomContent = BASE_ROOM_CONTENT;
  private timer: NodeJS.Timeout | null = null;
  private realmId: string | null = null;
  private readonly refreshMs: number;

  constructor(
    private readonly db: Database,
    private readonly logger: Logger,
    private readonly options: ContentStoreOptions,
  ) {
    this.refreshMs = options.refreshMs ?? 5_000;
  }

  snapshot(): RoomContent {
    return this.current;
  }

  private async resolveRealmId(): Promise<string | null> {
    if (this.realmId !== null) {
      return this.realmId;
    }
    const realm = await findRealmByCode(this.db, this.options.realmCode);
    if (realm === undefined || realm.status !== 'active') {
      return null;
    }
    this.realmId = realm.id;
    return this.realmId;
  }

  async refresh(): Promise<void> {
    try {
      const realmId = await this.resolveRealmId();
      if (realmId === null) {
        this.logger.error(
          { realmCode: this.options.realmCode },
          'bound realm is missing or inactive; keeping the previous content snapshot',
        );
        return;
      }
      const active = await findRealmActiveContent(this.db, realmId);
      if (active === undefined) {
        this.current = BASE_ROOM_CONTENT;
        return;
      }
      const validation = validateContentBundle(active.release.payload);
      if (!validation.valid || validation.bundle === null) {
        this.logger.error(
          { releaseId: active.release.id, version: active.release.version },
          'active content release failed validation; keeping the previous snapshot',
        );
        return;
      }
      const checksum = contentChecksum(validation.bundle);
      if (checksum !== active.release.checksum) {
        this.logger.error(
          {
            releaseId: active.release.id,
            version: active.release.version,
            expected: active.release.checksum,
            actual: checksum,
          },
          'active content checksum mismatch; keeping the previous snapshot',
        );
        return;
      }
      if (this.current.version !== active.release.version) {
        this.logger.info(
          { version: active.release.version, checksum },
          'content release refreshed; new rooms will use it',
        );
      }
      this.current = {
        version: active.release.version,
        checksum,
        bundle: validation.bundle,
      };
    } catch (error) {
      this.logger.error({ err: error }, 'failed to refresh active content release');
    }
  }

  async start(): Promise<void> {
    const realmId = await this.resolveRealmId();
    if (realmId === null && this.options.requireRealm === true) {
      throw new Error(`bound realm "${this.options.realmCode}" is missing or inactive`);
    }
    await this.refresh();
    if (this.timer !== null) {
      return;
    }
    this.timer = setInterval(() => {
      void this.refresh();
    }, this.refreshMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
