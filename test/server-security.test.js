import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createSessionToken,
  isAuthorizedRequest,
  isLoopbackHost,
  sessionCookieHeader,
} from '../src/server/auth.js';
import { staticAssetForPath } from '../src/server/index.js';

test('static file routing never maps request paths to arbitrary filesystem paths', () => {
  assert.equal(staticAssetForPath('/'), 'dashboard.html');
  assert.equal(staticAssetForPath('/dashboard.css'), 'dashboard.css');
  assert.equal(staticAssetForPath('/dashboard.js'), 'dashboard.js');

  for (const untrustedPath of [
    '/../../etc/passwd',
    '/../package.json',
    '/%2e%2e/%2e%2e/etc/passwd',
    '/C:/Windows/win.ini',
    '/some/unknown/route',
  ]) {
    assert.equal(staticAssetForPath(untrustedPath), 'dashboard.html');
  }
});

test('dashboard accepts only loopback Host headers', () => {
  assert.equal(isLoopbackHost('127.0.0.1:4317'), true);
  assert.equal(isLoopbackHost('localhost:4317'), true);
  assert.equal(isLoopbackHost('127.0.0.1'), true);
  assert.equal(isLoopbackHost('evil.example:4317'), false);
  assert.equal(isLoopbackHost('127.0.0.1.evil.example:4317'), false);
  assert.equal(isLoopbackHost(''), false);
  assert.equal(isLoopbackHost(undefined), false);
});

test('API authorization requires the exact in-memory session cookie', () => {
  const token = createSessionToken();
  assert.equal(token.length, 64);

  assert.equal(isAuthorizedRequest({ headers: {} }, token), false);
  assert.equal(
    isAuthorizedRequest({ headers: { cookie: 'cc-token-meter-session=wrong' } }, token),
    false,
  );
  assert.equal(
    isAuthorizedRequest({ headers: { cookie: `other=value; cc-token-meter-session=${token}` } }, token),
    true,
  );
});

test('session cookie is HttpOnly and SameSite Strict', () => {
  const header = sessionCookieHeader('synthetic-token');
  assert.match(header, /^cc-token-meter-session=synthetic-token;/);
  assert.match(header, /HttpOnly/);
  assert.match(header, /SameSite=Strict/);
  assert.match(header, /Path=\//);
});
