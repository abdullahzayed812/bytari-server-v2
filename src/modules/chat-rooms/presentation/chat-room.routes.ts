import { Router } from 'express';
import { asyncHandler } from '../../../shared/http/async-handler.js';
import { validate } from '../../../shared/http/validate.js';
import type { Container } from '../../../container.js';
import { createOrganizationMiddleware } from '../../organizations/presentation/organization.middleware.js';
import { AdminChatRoomController, ChatRoomController } from './chat-room.controller.js';
import {
  createChatRoomBodySchema,
  listChatRoomMembersQuerySchema,
  listChatRoomsQuerySchema,
  organizationAndMessageIdParamSchema,
  organizationIdParamSchema,
  setMutedBodySchema,
  updateChatRoomRulesBodySchema,
} from './chat-room.schemas.js';

/**
 * `/chat-rooms/*` — Global Chat public discussion rooms. Browse/join/leave/
 * mute are open to any authenticated user (public rooms, no permission
 * needed — mirrors the farm join-code flow). Sending/listing/reading/
 * deleting-your-own messages reuse the EXISTING generic chat endpoints
 * unchanged (`/conversations/:conversationId/messages` etc., via the
 * `conversationId` this module's `GET /chat-rooms/:id` response includes) —
 * `ChatService.resolveSide` already recognizes a `ROOM_MEMBER` participant.
 * Only rules/pin/moderator-message-delete are `chat_room.*`-permission-gated.
 */
export function createChatRoomRouter(c: Container): Router {
  const ctrl = new ChatRoomController(c.chatRoomService);
  const { withOrganization, authorizeOrg } = createOrganizationMiddleware({
    organizations: c.organizationRepository,
    authz: c.authorizationService,
  });

  const r = Router();
  r.use(c.authenticate);

  r.get('/', validate({ query: listChatRoomsQuerySchema }), asyncHandler(ctrl.list));
  r.get(
    '/:organizationId',
    validate({ params: organizationIdParamSchema }),
    asyncHandler(ctrl.getOne),
  );
  r.get(
    '/:organizationId/members',
    validate({ params: organizationIdParamSchema, query: listChatRoomMembersQuerySchema }),
    asyncHandler(ctrl.listMembers),
  );
  r.post(
    '/:organizationId/join',
    validate({ params: organizationIdParamSchema }),
    asyncHandler(ctrl.join),
  );
  r.post(
    '/:organizationId/leave',
    validate({ params: organizationIdParamSchema }),
    asyncHandler(ctrl.leave),
  );
  r.post(
    '/:organizationId/mute',
    validate({ params: organizationIdParamSchema, body: setMutedBodySchema }),
    asyncHandler(ctrl.setMuted),
  );

  // --- moderation (chat_room.rules.manage / chat_room.message.delete) ---
  r.patch(
    '/:organizationId/rules',
    validate({ params: organizationIdParamSchema, body: updateChatRoomRulesBodySchema }),
    withOrganization,
    authorizeOrg('chat_room.rules.manage'),
    asyncHandler(ctrl.updateRules),
  );
  r.post(
    '/:organizationId/messages/:messageId/pin',
    validate({ params: organizationAndMessageIdParamSchema }),
    withOrganization,
    authorizeOrg('chat_room.rules.manage'),
    asyncHandler(ctrl.pinMessage),
  );
  r.delete(
    '/:organizationId/pinned-message',
    validate({ params: organizationIdParamSchema }),
    withOrganization,
    authorizeOrg('chat_room.rules.manage'),
    asyncHandler(ctrl.unpinMessage),
  );
  r.delete(
    '/:organizationId/messages/:messageId',
    validate({ params: organizationAndMessageIdParamSchema }),
    withOrganization,
    authorizeOrg('chat_room.message.delete'),
    asyncHandler(ctrl.deleteMessage),
  );

  return r;
}

/** `/admin/chat-rooms` — create a room (`chat_room.admin.create`). */
export function createAdminChatRoomRouter(c: Container): Router {
  const ctrl = new AdminChatRoomController(c.chatRoomService);
  const r = Router();
  r.use(c.authenticate);
  r.post(
    '/chat-rooms',
    c.authorization.authorize('chat_room.admin.create'),
    validate({ body: createChatRoomBodySchema }),
    asyncHandler(ctrl.create),
  );
  return r;
}
