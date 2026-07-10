import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SignJWT } from 'jose';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

import { createApp } from '../../src/app.factory.js';
import { ForbiddenException } from '@nestjs/common';
import { ChatService } from '../../src/modules/chat/chat.service.js';
import type { ChatMessage, ChatParticipant } from '../../src/modules/chat/chat.types.js';
import { ErrorCodes } from '../../src/common/errors/error-codes.js';

const secret = new TextEncoder().encode('test-jwt-secret-at-least-32-characters-long');
const userId = '11111111-1111-4111-8111-111111111111';
const batchId = '44444444-4444-4444-8444-444444444444';

async function signToken(role: string): Promise<string> {
  return new SignJWT({
    email: `${role}@example.com`,
    app_metadata: { meal_direct_role: role }
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(userId)
    .setIssuer('http://127.0.0.1:54321/auth/v1')
    .setAudience('authenticated')
    .setIssuedAt()
    .setExpirationTime('15m')
    .sign(secret);
}

const message: ChatMessage = {
  id: '99999999-9999-4999-8999-999999999999',
  batchId,
  senderUserId: userId,
  senderLabel: 'Ada Rider',
  senderRole: 'rider',
  body: 'On my way',
  createdAt: '2026-07-10T12:00:00.000Z',
  mine: true
};

const participant: ChatParticipant = {
  userId,
  role: 'rider',
  label: 'Ada Rider',
  joinedAt: '2026-07-10T11:00:00.000Z'
};

describe('batch chat API', () => {
  let app: NestFastifyApplication;
  let service: ChatService;

  beforeEach(async () => {
    app = await createApp();
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    service = app.get(ChatService);
  });

  afterEach(async () => {
    await app.close();
  });

  it('requires a JWT for chat endpoints', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/v1/batches/${batchId}/chat/messages`
    });
    expect(response.statusCode).toBe(401);
  });

  it('validates the batch id and message body before invoking the service', async () => {
    const token = await signToken('customer');

    const badBatchId = await app.inject({
      method: 'GET',
      url: '/v1/batches/not-a-uuid/chat/messages',
      headers: { authorization: `Bearer ${token}` }
    });
    expect(badBatchId.statusCode).toBe(400);

    const emptyBody = await app.inject({
      method: 'POST',
      url: `/v1/batches/${batchId}/chat/messages`,
      headers: { authorization: `Bearer ${token}` },
      payload: { body: '' }
    });
    expect(emptyBody.statusCode).toBe(400);
  });

  it('rejects a non-participant with 403', async () => {
    const token = await signToken('customer');
    vi.spyOn(service, 'listMessages').mockRejectedValue(
      new ForbiddenException({
        code: ErrorCodes.FORBIDDEN,
        message: 'You are not a participant of this batch chat.'
      })
    );

    const response = await app.inject({
      method: 'GET',
      url: `/v1/batches/${batchId}/chat/messages`,
      headers: { authorization: `Bearer ${token}` }
    });

    expect(response.statusCode).toBe(403);
  });

  it('lets a participant post, list, and view participants', async () => {
    const token = await signToken('rider');
    vi.spyOn(service, 'postMessage').mockResolvedValue(message);
    vi.spyOn(service, 'listMessages').mockResolvedValue({
      items: [message],
      pagination: { hasMore: false, limit: 20 }
    });
    vi.spyOn(service, 'listParticipants').mockResolvedValue([participant]);

    const posted = await app.inject({
      method: 'POST',
      url: `/v1/batches/${batchId}/chat/messages`,
      headers: { authorization: `Bearer ${token}` },
      payload: { body: 'On my way' }
    });
    expect(posted.statusCode).toBe(201);
    expect(posted.json()).toMatchObject({ data: { id: message.id, body: 'On my way' } });

    const listed = await app.inject({
      method: 'GET',
      url: `/v1/batches/${batchId}/chat/messages`,
      headers: { authorization: `Bearer ${token}` }
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toMatchObject({ data: [{ id: message.id }] });

    const roster = await app.inject({
      method: 'GET',
      url: `/v1/batches/${batchId}/chat/participants`,
      headers: { authorization: `Bearer ${token}` }
    });
    expect(roster.statusCode).toBe(200);
    expect(roster.json()).toMatchObject({ data: [{ label: 'Ada Rider' }] });
  });
});
