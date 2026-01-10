import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { user_id } = await req.json().catch(() => ({}));
    if (!user_id) return Response.json({ error: 'Missing user_id' }, { status: 400 });
    if (user.id !== user_id) return Response.json({ error: 'Forbidden' }, { status: 403 });
    
    const profiles = await base44.entities.UserProfile.filter({ user_id });
    const userEmail = profiles?.[0]?.nome || user.email;

    const DIDIT_API_KEY = Deno.env.get('DIDIT_API_KEY');
    const DIDIT_WORKFLOW_ID = Deno.env.get('DIDIT_WORKFLOW_ID');
    
    if (!DIDIT_API_KEY || !DIDIT_WORKFLOW_ID) {
      console.error('Didit credentials missing:', {
        hasApiKey: !!DIDIT_API_KEY,
        hasWorkflowId: !!DIDIT_WORKFLOW_ID
      });
      return Response.json({ error: 'Didit credentials not configured' }, { status: 500 });
    }

    // Estrutura baseada na demo oficial do GitHub didit-protocol/didit-full-demo
    const body = {
      workflow_id: DIDIT_WORKFLOW_ID,
      vendor_data: user_id
    };

    console.log('Creating Didit session:', {
      workflow_id: DIDIT_WORKFLOW_ID,
      vendor_data: user_id
    });

    const response = await fetch('https://verification.didit.me/v2/session/', {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'content-type': 'application/json',
        'x-api-key': DIDIT_API_KEY
      },
      body: JSON.stringify(body)
    });

    const data = await response.json();
    
    console.log('Didit API response:', {
      status: response.status,
      data: JSON.stringify(data),
      headers: Object.fromEntries(response.headers.entries())
    });

    // Didit retorna 201 em caso de sucesso
    if (response.status === 201 && data) {
      const sessionId = data.session_id || data.id;
      const verificationUrl = data.url || data.verification_url;

      // Salva no UserProfile
      const profiles = await base44.asServiceRole.entities.UserProfile.filter({ user_id });
      if (profiles && profiles.length > 0) {
        await base44.asServiceRole.entities.UserProfile.update(profiles[0].id, {
          verification_status: 'in_progress',
          didit_session_id: sessionId,
          verification_started_at: new Date().toISOString()
        });
      } else {
        await base44.asServiceRole.entities.UserProfile.create({
          user_id,
          verification_status: 'in_progress',
          didit_session_id: sessionId,
          verification_started_at: new Date().toISOString()
        });
      }

      return Response.json({
        url: verificationUrl,
        session_id: sessionId,
        success: true
      });
    } else {
      console.error('Didit API error:', {
        status: response.status,
        data: data,
        url: 'https://verification.didit.me/v2/session/'
      });
      return Response.json({ 
        error: data.message || data.error || 'Didit API error',
        details: data,
        status_code: response.status
      }, { status: response.status });
    }
  } catch (error) {
    console.error('didit_create_session error:', {
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