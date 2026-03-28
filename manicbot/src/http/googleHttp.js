import {
  handleGoogleConnectRequest,
  handleGoogleCallback,
  handleGoogleSelect,
  handleGoogleWebhook,
} from '../services/google-calendar-oauth.js';
import { envCtx } from './envCtx.js';

/**
 * @param {Request} request
 * @param {any} env
 * @param {URL} url
 * @returns {Promise<Response | null>}
 */
export async function tryGoogle(request, env, url) {
  const base = { ...envCtx(env), ...env, baseUrl: url.origin };
  if (request.method === 'GET' && url.pathname === '/google/connect') {
    return handleGoogleConnectRequest(base, url);
  }
  if (request.method === 'GET' && url.pathname === '/google/callback') {
    return handleGoogleCallback(base, url);
  }
  if (request.method === 'GET' && url.pathname === '/google/select') {
    return handleGoogleSelect(base, url);
  }
  if (request.method === 'POST' && url.pathname === '/google/webhook') {
    return handleGoogleWebhook(base, request);
  }
  return null;
}
