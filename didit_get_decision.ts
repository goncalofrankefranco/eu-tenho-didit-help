import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const DIDIT_API_KEY = Deno.env.get('DIDIT_API_KEY');
    if (!DIDIT_API_KEY) {
      return Response.json({ error: 'Didit API key not configured' }, { status: 500 });
    }

    const profiles = await base44.entities.UserProfile.filter({ user_id: user.id });
    if (!profiles || profiles.length === 0) {
      return Response.json({ error: 'User profile not found', status: 'in_progress' }, { status: 404 });
    }

    const profile = profiles[0];
    const sessionId = profile.didit_session_id;

    if (!sessionId) {
      return Response.json({ error: 'No Didit session found', status: 'in_progress' }, { status: 400 });
    }

    const response = await fetch(`https://verification.didit.me/v2/session/${sessionId}/decision/`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'X-API-Key': DIDIT_API_KEY
      }
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      console.error('Didit decision error:', {
        status: response.status,
        errorText: errorText,
        sessionId: sessionId,
        url: `https://verification.didit.me/v2/session/${sessionId}/decision/`
      });
      return Response.json({ 
        status: 'in_progress', 
        error: `Didit decision error ${response.status}`,
        details: errorText
      });
    }

    const decision = await response.json();

    // Didit pode usar "status" OU "decision"
    const raw = String(decision.status || decision.decision || '').toLowerCase();

    let mappedStatus = 'in_progress';
    if (['approved', 'completed', 'success', 'verified'].includes(raw)) mappedStatus = 'approved';
    else if (['declined', 'rejected', 'failed', 'denied'].includes(raw)) mappedStatus = 'rejected';
    else if (['review', 'pending_review', 'manual_review'].includes(raw)) mappedStatus = 'review';
    else mappedStatus = 'in_progress';

    // Se finalizou, salva no UserProfile (service role)
    if (['approved', 'rejected', 'review'].includes(mappedStatus)) {
      const updateData = {
        verification_status: mappedStatus,
        verification_completed_at: new Date().toISOString(),
        verification_data: decision
      };

      const fullName =
        (decision.user && (decision.user.full_name || decision.user.name)) ||
        (decision.data && (decision.data.full_name || decision.data.name)) ||
        (decision.verified_data && (decision.verified_data.full_name || decision.verified_data.name)) ||
        null;

      if (fullName) updateData.nome_completo = fullName;

      await base44.asServiceRole.entities.UserProfile.update(profile.id, updateData);
    }

    return Response.json({ status: mappedStatus, decision_raw: decision });
  } catch (error) {
    console.error('didit_get_decision error:', {
      message: error.message,
      stack: error.stack,
      name: error.name
    });
    return Response.json(
      { 
        error: error?.message || String(error), 
        status: 'in_progress',
        stack: error.stack
      },
      { status: 500 }
    );
  }
});