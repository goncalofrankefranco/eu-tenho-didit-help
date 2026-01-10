import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

async function verifyWebhookSignature(bodyText, signature, secret) {
  const encoder = new TextEncoder();

  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(bodyText));
  const hashArray = Array.from(new Uint8Array(mac));
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');

  return hashHex === signature;
}

Deno.serve(async (req) => {
  try {
    const signature = req.headers.get('X-Signature');
    const timestamp = req.headers.get('X-Timestamp');
    const WEBHOOK_SECRET = Deno.env.get('DIDIT_WEBHOOK_SECRET');

    if (!signature || !timestamp || !WEBHOOK_SECRET) {
      console.error('Didit webhook missing security headers:', {
        hasSignature: !!signature,
        hasTimestamp: !!timestamp,
        hasSecret: !!WEBHOOK_SECRET
      });
      return Response.json({ error: 'Missing security headers' }, { status: 401 });
    }

    // janela de 5 min
    const requestTime = parseInt(timestamp, 10);
    const currentTime = Math.floor(Date.now() / 1000);
    if (Number.isNaN(requestTime) || Math.abs(currentTime - requestTime) > 300) {
      console.error('Didit webhook timestamp expired:', {
        requestTime,
        currentTime,
        diff: Math.abs(currentTime - requestTime)
      });
      return Response.json({ error: 'Timestamp expired' }, { status: 401 });
    }

    const bodyText = await req.text();

    const ok = await verifyWebhookSignature(bodyText, signature, WEBHOOK_SECRET);
    if (!ok) {
      console.error('Didit webhook invalid signature:', {
        receivedSignature: signature,
        bodyLength: bodyText.length
      });
      return Response.json({ error: 'Invalid signature' }, { status: 403 });
    }

    const payload = JSON.parse(bodyText);

    // vendor_data TEM que ser user_id
    const userId = payload.vendor_data;
    if (!userId) {
      console.error('Missing vendor_data in payload:', payload);
      return Response.json({ error: 'Missing vendor_data' }, { status: 400 });
    }

    const payloadStatus = String(payload.status || '').toLowerCase();

    let verificationStatus = 'in_progress';
    if (['approved', 'completed', 'success', 'verified'].includes(payloadStatus)) verificationStatus = 'approved';
    else if (['declined', 'rejected', 'failed', 'denied'].includes(payloadStatus)) verificationStatus = 'rejected';
    else if (['review', 'pending_review', 'manual_review'].includes(payloadStatus)) verificationStatus = 'review';
    else verificationStatus = 'in_progress';

    const base44 = createClientFromRequest(req);

    const profiles = await base44.asServiceRole.entities.UserProfile.filter({ user_id: userId });
    if (!profiles || profiles.length === 0) {
      console.error('Didit webhook user profile not found:', { userId });
      return Response.json({ error: 'User profile not found' }, { status: 404 });
    }
    
    console.log('Didit webhook processing:', {
      userId,
      payloadStatus,
      verificationStatus,
      hasFullName: !!fullName
    });

    const updateData = {
      verification_status: verificationStatus,
      verification_completed_at: new Date().toISOString(),
      verification_data: payload
    };

    const fullName =
      (payload.user && (payload.user.full_name || payload.user.name)) ||
      (payload.data && (payload.data.full_name || payload.data.name)) ||
      (payload.verified_data && (payload.verified_data.full_name || payload.verified_data.name)) ||
      null;

    if (fullName) updateData.nome_completo = fullName;

    await base44.asServiceRole.entities.UserProfile.update(profiles[0].id, updateData);

    return Response.json({ success: true, status: verificationStatus, user_id: userId });
  } catch (error) {
    console.error('diditWebhook error:', {
      message: error.message,
      stack: error.stack,
      name: error.name
    });
    return Response.json({ 
      error: error?.message || String(error),
      stack: error.stack
    }, { status: 500 });
  }
});