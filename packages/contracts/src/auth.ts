import { z } from 'zod';

import { characterViewSchema } from './character';

export const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,24}$/;
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

export const usernameSchema = z
  .string()
  .trim()
  .regex(USERNAME_PATTERN, '账号只能包含 3–24 位字母、数字和下划线');

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `密码至少 ${PASSWORD_MIN_LENGTH} 位`)
  .max(PASSWORD_MAX_LENGTH);

export const registerRequestSchema = z
  .object({ username: usernameSchema, password: passwordSchema })
  .strict();

export type RegisterRequest = z.infer<typeof registerRequestSchema>;

export const loginRequestSchema = z
  .object({ username: usernameSchema, password: passwordSchema })
  .strict();

export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const accountViewSchema = z
  .object({
    id: z.uuid(),
    username: z.string().min(1),
    createdAt: z.iso.datetime(),
  })
  .strict();

export type AccountView = z.infer<typeof accountViewSchema>;

export const authResponseSchema = z
  .object({
    account: accountViewSchema,
    characters: z.array(characterViewSchema).max(16),
  })
  .strict();

export type AuthResponse = z.infer<typeof authResponseSchema>;
