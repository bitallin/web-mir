import {
  API_PREFIX,
  charactersResponseSchema,
  characterResponseSchema,
  createCharacterRequestSchema,
} from '@web-legend/contracts';
import { z } from 'zod';

import { toCharacterView } from '../services/views';
import { parseBody, requireSession, type AppServer, type RouteDependencies } from './context';

const characterParamsSchema = z.object({ id: z.uuid() }).strict();

export function registerCharacterRoutes(app: AppServer, dependencies: RouteDependencies): void {
  app.get(`${API_PREFIX}/characters`, async (request, reply) => {
    const { account } = await requireSession(dependencies, request);
    const characters = await dependencies.characters.list(account.id);
    return reply.send(
      charactersResponseSchema.parse({ characters: characters.map(toCharacterView) }),
    );
  });

  app.post(`${API_PREFIX}/characters`, async (request, reply) => {
    const { account } = await requireSession(dependencies, request);
    const body = parseBody(createCharacterRequestSchema, request.body);
    const character = await dependencies.characters.create(account.id, body);
    return reply
      .status(201)
      .send(characterResponseSchema.parse({ character: toCharacterView(character) }));
  });

  app.get(`${API_PREFIX}/characters/:id`, async (request, reply) => {
    const { account } = await requireSession(dependencies, request);
    const { id } = parseBody(characterParamsSchema, request.params);
    const character = await dependencies.characters.get(account.id, id);
    return reply.send(characterResponseSchema.parse({ character: toCharacterView(character) }));
  });
}
