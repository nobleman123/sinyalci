import { Hono } from 'hono';
import { Env } from '../types';
import { getSupabase } from '../services/supabase';

const notifications = new Hono<{ Bindings: Env }>();

// Register FCM token
notifications.post('/register', async (c) => {
  try {
    const body = await c.req.json();
    const { userId = 'default-user', fcmToken, platform = 'android' } = body;

    if (!fcmToken) return c.json({ error: 'fcmToken required' }, 400);

    const supabase = getSupabase(c.env);

    // Ensure user exists
    await supabase.from('users').upsert({ id: userId, name: 'Default User' }, { onConflict: 'id' });

    // Upsert token
    const { error } = await supabase.from('notification_tokens').upsert(
      { user_id: userId, token: fcmToken, platform, enabled: true, updated_at: new Date().toISOString() },
      { onConflict: 'token' }
    );

    if (error) throw error;
    return c.json({ success: true, message: 'Token registered' });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// Send test notification via FCM
notifications.post('/test', async (c) => {
  try {
    const body = await c.req.json();
    const { userId = 'default-user' } = body;

    if (!c.env.FIREBASE_PROJECT_ID || !c.env.FIREBASE_CLIENT_EMAIL || !c.env.FIREBASE_PRIVATE_KEY) {
      return c.json({ error: 'Firebase credentials not configured in Cloudflare secrets' }, 503);
    }

    const supabase = getSupabase(c.env);
    const { data: tokens, error } = await supabase
      .from('notification_tokens')
      .select('token')
      .eq('user_id', userId)
      .eq('enabled', true)
      .limit(5);

    if (error) throw error;
    if (!tokens || tokens.length === 0) {
      return c.json({ error: 'No registered tokens for this user' }, 404);
    }

    // Get Firebase access token
    const accessToken = await getFirebaseAccessToken(c.env);

    let sent = 0;
    for (const { token } of tokens) {
      const res = await fetch(
        `https://fcm.googleapis.com/v1/projects/${c.env.FIREBASE_PROJECT_ID}/messages:send`,
        {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: {
              token,
              notification: {
                title: '🧪 Sinyalci Test',
                body: 'Backend bağlantısı başarılı! Gerçek sinyaller buraya gelecek.'
              },
              data: { type: 'TEST', timestamp: new Date().toISOString() }
            }
          })
        }
      );

      if (res.ok) sent++;
      else {
        const errBody = await res.json().catch(() => ({}));
        console.error('FCM error:', errBody);
        // Disable invalid token
        if ((errBody as any)?.error?.status === 'UNREGISTERED') {
          await supabase.from('notification_tokens').update({ enabled: false }).eq('token', token);
        }
      }
    }

    return c.json({ success: true, sent, total: tokens.length });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// ─── Firebase JWT Helper ─────────────────────────────────────────────────────

async function getFirebaseAccessToken(env: Env): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + 3600;

  const payload = {
    iss: env.FIREBASE_CLIENT_EMAIL,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp
  };

  // Build JWT
  const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const body = btoa(JSON.stringify(payload)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const sigInput = `${header}.${body}`;

  // Sign with private key (RS256)
  const pemKey = (env.FIREBASE_PRIVATE_KEY ?? '').replace(/\\n/g, '\n');
  const binaryDer = pemToDer(pemKey);
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8', binaryDer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false, ['sign']
  );
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, new TextEncoder().encode(sigInput));
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

  const jwt = `${sigInput}.${sigB64}`;

  // Exchange JWT for access token
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`
  });

  const tokenData: any = await tokenRes.json();
  if (!tokenData.access_token) throw new Error('Failed to get Firebase access token');
  return tokenData.access_token;
}

function pemToDer(pem: string): ArrayBuffer {
  const b64 = pem.replace(/-----[A-Z ]+-----/g, '').replace(/\s/g, '');
  const binary = atob(b64);
  const buf = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) buf[i] = binary.charCodeAt(i);
  return buf.buffer;
}

export default notifications;
