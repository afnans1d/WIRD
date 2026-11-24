// Zero-dependency RFC 8292 (VAPID ES256) + RFC 8291 (aes128gcm) Web Push implementation
// using standard Web Crypto API (compatible with Cloudflare Workers & Apple APNs iOS 16.4+)

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const ALLOWED_PUSH_HOST_SUFFIXES = [
  '.push.apple.com',
  'push.apple.com',
  '.notify.windows.com',
];

const ALLOWED_PUSH_EXACT_HOSTS = new Set([
  'fcm.googleapis.com',
  'updates.push.services.mozilla.com',
  'updates-autopush.stage.mozaws.net',
  'android.googleapis.com',
]);

export function isAllowedPushEndpoint(endpoint: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch {
    return false;
  }

  if (parsed.protocol !== 'https:') {
    return false;
  }

  if (parsed.username || parsed.password) {
    return false;
  }

  const host = parsed.hostname.toLowerCase();
  if (!host || host === 'localhost' || host.endsWith('.local') || /^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    return false;
  }

  if (ALLOWED_PUSH_EXACT_HOSTS.has(host)) {
    return true;
  }

  return ALLOWED_PUSH_HOST_SUFFIXES.some((suffix) =>
    suffix.startsWith('.') ? host.endsWith(suffix) : host === suffix
  );
}

export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function base64UrlDecode(input: string): Uint8Array<ArrayBuffer> {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const pad = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  const binary = atob(normalized + pad);
  const buffer = new ArrayBuffer(binary.length);
  const out = new Uint8Array(buffer);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

function concatBytes(...chunks: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const buffer = new ArrayBuffer(total);
  const out = new Uint8Array(buffer);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function toArrayBufferView(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const buffer = new ArrayBuffer(bytes.byteLength);
  const view = new Uint8Array(buffer);
  view.set(bytes);
  return view;
}

async function hmacSha256(
  keyBytes: Uint8Array<ArrayBuffer>,
  data: Uint8Array<ArrayBuffer>
): Promise<Uint8Array<ArrayBuffer>> {
  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, data);
  return toArrayBufferView(new Uint8Array(sig));
}

async function hkdfExpandSingleBlock(
  prk: Uint8Array<ArrayBuffer>,
  info: Uint8Array<ArrayBuffer>,
  length: number
): Promise<Uint8Array<ArrayBuffer>> {
  const full = await hmacSha256(prk, concatBytes(info, new Uint8Array([0x01])));
  return toArrayBufferView(full.subarray(0, length));
}

export interface VapidJwtOptions {
  endpoint: string;
  vapidSubject: string;
  vapidPublicKey: string;
  vapidPrivateKey: string;
  nowSeconds?: number;
  expirationSeconds?: number;
}

export async function createVapidJwt(opts: VapidJwtOptions): Promise<string> {
  const pubBytes = base64UrlDecode(opts.vapidPublicKey.trim());
  const privBytes = base64UrlDecode(opts.vapidPrivateKey.trim());

  if (pubBytes.length !== 65 || pubBytes[0] !== 0x04) {
    throw new Error('Invalid VAPID_PUBLIC_KEY format (expected 65-byte uncompressed P-256 point).');
  }
  if (privBytes.length !== 32) {
    throw new Error('Invalid VAPID_PRIVATE_KEY format (expected 32-byte raw P-256 scalar).');
  }

  const endpointUrl = new URL(opts.endpoint);
  const audience = endpointUrl.origin;
  const nowSec = opts.nowSeconds ?? Math.floor(Date.now() / 1000);
  const exp = nowSec + (opts.expirationSeconds ?? 12 * 3600);

  const headerB64 = base64UrlEncode(encoder.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const payloadB64 = base64UrlEncode(
    encoder.encode(
      JSON.stringify({
        aud: audience,
        exp,
        sub: opts.vapidSubject,
      })
    )
  );

  const signingInput = `${headerB64}.${payloadB64}`;

  const privateKey = await crypto.subtle.importKey(
    'jwk',
    {
      kty: 'EC',
      crv: 'P-256',
      x: base64UrlEncode(pubBytes.slice(1, 33)),
      y: base64UrlEncode(pubBytes.slice(33, 65)),
      d: base64UrlEncode(privBytes),
      ext: true,
    },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );

  const sigBuffer = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    privateKey,
    encoder.encode(signingInput)
  );

  const sigB64 = base64UrlEncode(new Uint8Array(sigBuffer));
  return `${signingInput}.${sigB64}`;
}

/**
 * Encrypts a UTF-8 Web Push payload according to RFC 8291 (aes128gcm).
 */
export async function encryptWebPushPayload(
  payloadText: string,
  p256dhBase64Url: string,
  authBase64Url: string
): Promise<Uint8Array<ArrayBuffer>> {
  const uaPublicBytes = base64UrlDecode(p256dhBase64Url.trim());
  const authSecret = base64UrlDecode(authBase64Url.trim());

  if (uaPublicBytes.length !== 65 || uaPublicBytes[0] !== 0x04) {
    throw new Error('Invalid subscription p256dh public key.');
  }
  if (authSecret.length !== 16) {
    throw new Error('Invalid subscription auth secret.');
  }

  const uaPublicKey = await crypto.subtle.importKey(
    'raw',
    uaPublicBytes,
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    []
  );

  const asKeyPair = (await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits']
  )) as CryptoKeyPair;

  const asPublicBytes = toArrayBufferView(
    new Uint8Array(await crypto.subtle.exportKey('raw', asKeyPair.publicKey))
  );

  const sharedSecret = toArrayBufferView(
    new Uint8Array(
      await crypto.subtle.deriveBits(
        { name: 'ECDH', public: uaPublicKey },
        asKeyPair.privateKey,
        256
      )
    )
  );

  const salt = toArrayBufferView(crypto.getRandomValues(new Uint8Array(16)));

  // RFC 8291 Section 3.3: IKM = HKDF(authSecret, sharedSecret, "WebPush: info\0" || ua_public || as_public, 32)
  const prkKey = await hmacSha256(authSecret, sharedSecret);
  const keyInfo = concatBytes(
    encoder.encode('WebPush: info\0'),
    uaPublicBytes,
    asPublicBytes
  );
  const ikm = await hkdfExpandSingleBlock(prkKey, keyInfo, 32);

  // RFC 8188: CEK & NONCE
  const prk = await hmacSha256(salt, ikm);
  const cek = await hkdfExpandSingleBlock(
    prk,
    toArrayBufferView(encoder.encode('Content-Encoding: aes128gcm\0')),
    16
  );
  const nonce = await hkdfExpandSingleBlock(
    prk,
    toArrayBufferView(encoder.encode('Content-Encoding: nonce\0')),
    12
  );

  const plaintext = encoder.encode(payloadText);
  const paddedPlaintext = concatBytes(plaintext, new Uint8Array([0x02]));

  const aesKey = await crypto.subtle.importKey(
    'raw',
    cek,
    { name: 'AES-GCM' },
    false,
    ['encrypt']
  );

  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: nonce, tagLength: 128 },
      aesKey,
      paddedPlaintext
    )
  );

  // RFC 8188 Header: salt (16) || rs (4, 4096) || idlen (1, 65) || keyid (65)
  const header = new Uint8Array(new ArrayBuffer(16 + 4 + 1 + asPublicBytes.length));
  header.set(salt, 0);
  const view = new DataView(header.buffer);
  view.setUint32(16, 4096, false);
  header[20] = asPublicBytes.length;
  header.set(asPublicBytes, 21);

  return concatBytes(header, ciphertext);
}

/**
 * Decrypts RFC 8291 aes128gcm payload (used in automated unit tests to verify real round-trip compatibility).
 */
export async function decryptWebPushPayload(
  bodyBytes: Uint8Array<ArrayBuffer>,
  uaPrivateKey: CryptoKey,
  uaPublicBytes: Uint8Array<ArrayBuffer>,
  authSecret: Uint8Array<ArrayBuffer>
): Promise<string> {
  const salt = toArrayBufferView(bodyBytes.subarray(0, 16));
  const idLen = bodyBytes[20];
  const asPublicBytes = toArrayBufferView(bodyBytes.subarray(21, 21 + idLen));
  const ciphertext = toArrayBufferView(bodyBytes.subarray(21 + idLen));

  const asPublicKey = await crypto.subtle.importKey(
    'raw',
    asPublicBytes,
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    []
  );

  const sharedSecret = toArrayBufferView(
    new Uint8Array(
      await crypto.subtle.deriveBits(
        { name: 'ECDH', public: asPublicKey },
        uaPrivateKey,
        256
      )
    )
  );

  const prkKey = await hmacSha256(authSecret, sharedSecret);
  const keyInfo = concatBytes(
    encoder.encode('WebPush: info\0'),
    uaPublicBytes,
    asPublicBytes
  );
  const ikm = await hkdfExpandSingleBlock(prkKey, keyInfo, 32);

  const prk = await hmacSha256(salt, ikm);
  const cek = await hkdfExpandSingleBlock(
    prk,
    toArrayBufferView(encoder.encode('Content-Encoding: aes128gcm\0')),
    16
  );
  const nonce = await hkdfExpandSingleBlock(
    prk,
    toArrayBufferView(encoder.encode('Content-Encoding: nonce\0')),
    12
  );

  const aesKey = await crypto.subtle.importKey(
    'raw',
    cek,
    { name: 'AES-GCM' },
    false,
    ['decrypt']
  );

  const padded = new Uint8Array(
    await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: nonce, tagLength: 128 },
      aesKey,
      ciphertext
    )
  );

  let end = padded.length - 1;
  while (end >= 0 && padded[end] === 0x00) {
    end--;
  }
  if (end < 0 || padded[end] !== 0x02) {
    throw new Error('Invalid RFC 8188 delimiter byte.');
  }

  return decoder.decode(padded.slice(0, end));
}

export interface SendPushParams {
  endpoint: string;
  p256dh: string;
  auth: string;
  payload: Record<string, unknown>;
  vapidSubject: string;
  vapidPublicKey: string;
  vapidPrivateKey: string;
  ttlSeconds?: number;
  urgency?: 'very-low' | 'low' | 'normal' | 'high';
  fetchFn?: typeof fetch;
}

export interface SendPushResult {
  ok: boolean;
  statusCode: number;
  permanentFailure: boolean;
  errorMessage?: string;
}

export async function sendWebPushNotification(params: SendPushParams): Promise<SendPushResult> {
  if (!isAllowedPushEndpoint(params.endpoint)) {
    return {
      ok: false,
      statusCode: 400,
      permanentFailure: true,
      errorMessage: 'Disallowed Web Push endpoint host.',
    };
  }

  const payloadJson = JSON.stringify(params.payload);
  const [jwt, encryptedBody] = await Promise.all([
    createVapidJwt({
      endpoint: params.endpoint,
      vapidSubject: params.vapidSubject,
      vapidPublicKey: params.vapidPublicKey,
      vapidPrivateKey: params.vapidPrivateKey,
    }),
    encryptWebPushPayload(payloadJson, params.p256dh, params.auth),
  ]);

  const fetcher = params.fetchFn ?? fetch;
  const response = await fetcher(params.endpoint, {
    method: 'POST',
    headers: {
      Authorization: `vapid t=${jwt}, k=${params.vapidPublicKey.trim()}`,
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: String(params.ttlSeconds ?? 3600),
      Urgency: params.urgency ?? 'normal',
    },
    body: encryptedBody,
  });

  if (response.status >= 200 && response.status < 300) {
    return {
      ok: true,
      statusCode: response.status,
      permanentFailure: false,
    };
  }

  let bodySnippet = '';
  try {
    bodySnippet = (await response.text()).slice(0, 180);
  } catch {
    bodySnippet = '';
  }

  const permanentFailure =
    response.status === 404 ||
    response.status === 410 ||
    response.status === 400 ||
    response.status === 401 ||
    response.status === 403;

  return {
    ok: false,
    statusCode: response.status,
    permanentFailure,
    errorMessage: bodySnippet ? `HTTP ${response.status}: ${bodySnippet}` : `HTTP ${response.status}`,
  };
}
