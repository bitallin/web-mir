/**
 * Pure chat moderation rules. The room owns rate limiting and identity; this
 * module only normalizes the text and decides whether it may be broadcast. A
 * future moderation service can replace the filter through the same interface
 * without touching the Room (ADR-021).
 */

export type ChatFilterResult =
  { accepted: true; text: string } | { accepted: false; reason: string };

export type ChatFilter = (text: string) => ChatFilterResult;

type BlockedRule = {
  pattern: RegExp;
  reason: string;
};

export type ChatFilterOptions = {
  /** Replaces the built-in rules; tests use this to isolate one rule. */
  rules?: readonly BlockedRule[];
};

const LINK_PATTERN =
  /(?:https?:\/\/|www\.|[\p{L}\p{N}-]+\.(?:com|cn|net|org|io|gg|top|xyz|vip|cc)\b)/iu;
const SOLICITATION_PATTERN =
  /加(?:微信|威信|v信|vx|qq|扣扣|群)|私聊|扫码|代练|代充|出售(?:金币|元宝|装备|账号)|收(?:金币|元宝)/iu;
const REPEATED_CHARACTER_PATTERN = /(.)\1{7,}/u;

const DEFAULT_RULES: readonly BlockedRule[] = [
  { pattern: LINK_PATTERN, reason: '聊天不能包含链接或网址' },
  { pattern: SOLICITATION_PATTERN, reason: '聊天不能包含交易或引流信息' },
  { pattern: REPEATED_CHARACTER_PATTERN, reason: '请不要刷屏' },
];

export function createChatFilter(options: ChatFilterOptions = {}): ChatFilter {
  const rules = options.rules ?? DEFAULT_RULES;
  return (text) => {
    // Match on NFKC so full-width lookalikes cannot bypass a rule, but keep the
    // player's original punctuation in the broadcast text.
    const normalized = text.normalize('NFKC').replace(/\s+/gu, ' ').trim();
    const display = text.replace(/\s+/gu, ' ').trim();
    if (normalized.length === 0) {
      return { accepted: false, reason: '消息不能为空' };
    }
    for (const rule of rules) {
      if (rule.pattern.test(normalized)) {
        return { accepted: false, reason: rule.reason };
      }
    }
    return { accepted: true, text: display };
  };
}

export const defaultChatFilter: ChatFilter = createChatFilter();
