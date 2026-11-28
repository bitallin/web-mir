import { COMMAND_REJECTION_MESSAGES, type CommandRejectionCode } from '@web-legend/contracts';

/**
 * A rejected asset operation with a wire error code. Anything else thrown from
 * the application layer is an infrastructure failure and is reported as
 * SERVICE_UNAVAILABLE without leaking details to the client.
 */
export class AssetError extends Error {
  constructor(
    readonly code: CommandRejectionCode,
    message: string = COMMAND_REJECTION_MESSAGES[code],
  ) {
    super(message);
    this.name = 'AssetError';
  }
}

/**
 * A rejected social (non-asset) operation. Kept separate from AssetError so a
 * failure in the friend graph is never mistaken for an inventory change.
 */
export class SocialError extends Error {
  constructor(
    readonly code: CommandRejectionCode,
    message: string = COMMAND_REJECTION_MESSAGES[code],
  ) {
    super(message);
    this.name = 'SocialError';
  }
}
