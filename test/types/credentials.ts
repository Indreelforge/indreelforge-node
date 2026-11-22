// Compile-time checks for connectWithCredentials, platforms and responses (run by `npm run typecheck`).
import PostUploadDefault, { PostUpload, IndReelForge, type Platform, type UploadResponse, type SkippedPlatform } from '../../src';

declare const c: PostUpload;
declare const old: IndReelForge;

void c.connectWithCredentials('p', 'mastodon', { instance_url: 'https://m.social', access_token: 't' });
void c.connectWithCredentials('p', 'telegram', { bot_token: 'b', chat_id: '@c' });
void c.connectWithCredentials('p', 'wordpress', { site_url: 's', username: 'u', app_password: 'a' });
void c.connectWithCredentials('p', 'devto', { api_key: 'k' });
void c.connectWithCredentials('p', 'devto', { api_key: 'k', base_url: 'https://community.example' });
void c.connectWithCredentials('p', 'hashnode', { access_token: 't', publication_id: 'pub' });
void c.connectWithCredentials('p', 'lemmy', { instance_url: 'https://lemmy.world', username: 'u', password: 'p', community: 'tech' });
void c.connectWithCredentials('p', 'nostr', { nsec: 'nsec1...' });
void c.connectWithCredentials('p', 'whop', { api_key: 'k', experience_id: 'exp_1' });
void c.connectWithCredentials('p', 'listmonk', { base_url: 'https://l.example', api_user: 'u', api_token: 't', list_ids: '1, 4' });
void c.connectWithCredentials('p', 'future_platform', { anything: 'x' });
void old.connectWithCredentials('p', 'nostr', { nsec: 'x', relays: 'wss://nos.lol' });

// @ts-expect-error missing chat_id
void c.connectWithCredentials('p', 'telegram', { bot_token: 'b' });
// @ts-expect-error wrong field for slack
void c.connectWithCredentials('p', 'slack', { bot_token: 'b' });
// @ts-expect-error hashnode needs publication_id
void c.connectWithCredentials('p', 'hashnode', { access_token: 't' });
// @ts-expect-error listmonk needs list_ids
void c.connectWithCredentials('p', 'listmonk', { base_url: 'b', api_user: 'u', api_token: 't' });

const platforms: Platform[] = ['devto', 'hashnode', 'lemmy', 'nostr', 'whop', 'listmonk', 'youtube'];

// Both call styles of uploadVideo.
void c.uploadVideo('./v.mp4', { user: 'u', platforms, onProgress: (p) => void p.uploadedBytes });
void c.uploadVideo({ user: 'u', platforms, stagedFileId: 'cus_1' });
void c.uploadVideo({ user: 'u', platforms, videoPath: './v.mp4', chunked: true });
const client2 = new PostUploadDefault('key');
void client2.uploadLargeFile(new Uint8Array(4), { filename: 'a.mp4' }).then((r) => r.staged_file_id.toUpperCase());

declare const res: UploadResponse;
const skipped: SkippedPlatform[] | undefined = res.data.skipped_platforms;
void skipped?.[0].max_size_mb;
