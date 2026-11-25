import { describe, expect, it } from 'vitest';

import { createChatFilter, defaultChatFilter } from './social';

describe('chat filter', () => {
  it('accepts ordinary Chinese conversation and normalizes whitespace', () => {
    const result = defaultChatFilter('  有人  一起打怪吗？ ');
    expect(result).toEqual({ accepted: true, text: '有人 一起打怪吗？' });
  });

  it('rejects links and advertising without echoing the text', () => {
    for (const message of [
      '请看 https://example.com',
      '访问 www.spam.cn 领取奖励',
      '加微信 abc123 买金币',
      '出售金币，私聊我',
    ]) {
      const result = defaultChatFilter(message);
      expect(result.accepted).toBe(false);
    }
  });

  it('rejects repeated-character spam', () => {
    const result = defaultChatFilter('哈哈哈哈哈哈哈哈哈哈哈哈');
    expect(result.accepted).toBe(false);
    if (!result.accepted) {
      expect(result.reason).toBe('请不要刷屏');
    }
  });

  it('does not treat ordinary punctuation or short repeats as spam', () => {
    expect(defaultChatFilter('真的吗？？？').accepted).toBe(true);
    expect(defaultChatFilter('哈哈，好的').accepted).toBe(true);
  });

  it('accepts an injected rule set for isolated tests', () => {
    const filter = createChatFilter({
      rules: [{ pattern: /秘密/u, reason: '不能发送暗号' }],
    });
    expect(filter('这是秘密').accepted).toBe(false);
    expect(filter('https://example.com').accepted).toBe(true);
  });
});
