// Copyright 2026 FiveNodes
// SPDX-License-Identifier: Apache-2.0

import crypto from 'node:crypto';

const SESSION_COOKIE_NAME = 'cc-token-meter-session';

export function createSessionToken() {
  return crypto.randomBytes(32).toString('hex');
}

export function isLoopbackHost(hostHeader) {
  if (typeof hostHeader !== 'string' || hostHeader.length === 0) return false;

  try {
    const hostname = new URL(`http://${hostHeader}`).hostname.toLowerCase();
    return hostname === '127.0.0.1' || hostname === 'localhost';
  } catch {
    return false;
  }
}

export function isAuthorizedRequest(req, sessionToken) {
  if (typeof sessionToken !== 'string' || sessionToken.length === 0) return false;
  const cookieHeader = req?.headers?.cookie;
  if (typeof cookieHeader !== 'string' || cookieHeader.length === 0) return false;

  const prefix = `${SESSION_COOKIE_NAME}=`;
  const cookie = cookieHeader
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix));

  if (!cookie) return false;

  const suppliedToken = cookie.slice(prefix.length);
  const expected = Buffer.from(sessionToken, 'utf8');
  const supplied = Buffer.from(suppliedToken, 'utf8');

  return expected.length === supplied.length && crypto.timingSafeEqual(expected, supplied);
}

export function sessionCookieHeader(sessionToken) {
  return `${SESSION_COOKIE_NAME}=${sessionToken}; HttpOnly; SameSite=Strict; Path=/`;
}
