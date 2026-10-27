import test from 'node:test';
import assert from 'node:assert/strict';
import { proxyEnvNotice } from './proxy-env.mjs';

test('a proxy without NODE_USE_ENV_PROXY is named at launch', () => {
  const notice = proxyEnvNotice({ https_proxy: 'http://proxy.corp:3128/' });
  assert.match(notice, /^https_proxy is set but NODE_USE_ENV_PROXY is not/);
  assert.match(notice, /NODE_USE_ENV_PROXY=1/);
  assert.match(proxyEnvNotice({ HTTP_PROXY: 'http://p:8080' }), /^HTTP_PROXY is set/, 'either case, any scheme key');
});

test('no proxy, or the opt-in already set: nothing to say', () => {
  assert.equal(proxyEnvNotice({}), null);
  assert.equal(proxyEnvNotice({ https_proxy: '  ' }), null, 'an empty variable is no proxy');
  assert.equal(proxyEnvNotice({ https_proxy: 'http://proxy.corp:3128/', NODE_USE_ENV_PROXY: '1' }), null);
  assert.equal(proxyEnvNotice({ no_proxy: 'localhost' }), null, 'no_proxy alone configures no proxy');
});
