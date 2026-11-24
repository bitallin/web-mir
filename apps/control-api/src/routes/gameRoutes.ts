import { API_PREFIX, gameTicketRequestSchema } from '@web-legend/contracts';
import { parseBody, requireSession, type AppServer, type RouteDependencies } from './context';

export function registerGameRoutes(app: AppServer, dependencies: RouteDependencies): void {
  app.post(`${API_PREFIX}/game/ticket`, async (request, reply) => {
    const { account } = await requireSession(dependencies, request);
    const body = parseBody(gameTicketRequestSchema, request.body);
    const ticket = await dependencies.tickets.issue(account.id, body.characterId);
    return reply.send(ticket);
  });
}
