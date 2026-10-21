// Compile-time checks for connectWithCredentials (run by `npm run typecheck`).
import { IndReelForge } from '../../src';

declare const c: IndReelForge;

void c.connectWithCredentials('p', 'mastodon', { instance_url: 'https://m.social', access_token: 't' });
void c.connectWithCredentials('p', 'telegram', { bot_token: 'b', chat_id: '@c' });
void c.connectWithCredentials('p', 'wordpress', { site_url: 's', username: 'u', app_password: 'a' });
void c.connectWithCredentials('p', 'future_platform', { anything: 'x' });

// @ts-expect-error missing chat_id
void c.connectWithCredentials('p', 'telegram', { bot_token: 'b' });
// @ts-expect-error wrong field for slack
void c.connectWithCredentials('p', 'slack', { bot_token: 'b' });
