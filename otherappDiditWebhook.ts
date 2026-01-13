import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';
import { createHmac } from 'node:crypto';

Deno.serve(async (req) => {
  try {
    // Verifica se é POST
    if (req.method !== 'POST') {
      return Response.json({ error: 'Method not allowed' }, { status: 405 });
    }

    const base44 = createClientFromRequest(req);
    
    // Lê o body da requisição
    const body = await req.json();
    
    // Pega o signature header para validação
    const signature = req.headers.get('x-didit-signature');
    const secret = Deno.env.get('DIDIT_SECRET_WEBHOOK');
    
    if (!secret) {
      console.error('DIDIT_SECRET_WEBHOOK não configurado');
      return Response.json({ error: 'Server misconfigured' }, { status: 500 });
    }
    
    // Valida a assinatura do webhook
    const payload = JSON.stringify(body);
    const hmac = createHmac('sha256', secret);
    hmac.update(payload);
    const expectedSignature = hmac.digest('hex');
    
    if (signature !== expectedSignature) {
      console.error('Assinatura inválida do webhook');
      return Response.json({ error: 'Invalid signature' }, { status: 403 });
    }
    
    console.log('Webhook Didit recebido:', body);
    
    // Extrai informações do webhook
    const { event, data } = body;
    
    // Verifica se é um evento de verificação completada
    if (event === 'verification.completed' || event === 'verification.success') {
      const { verification_id, status, vendor_data } = data;
      
      // Email vem do vendorData que passamos na URL do iframe
      const email = vendor_data || data.email;
      
      if (!email) {
        console.error('Email não encontrado no webhook data');
        return Response.json({ error: 'Email not found in webhook data' }, { status: 400 });
      }
      
      // Se o status é sucesso, atualiza o usuário
      if (status === 'approved' || status === 'verified') {
        // Busca o usuário pelo email
        const users = await base44.asServiceRole.entities.User.filter({ email });
        
        if (users && users.length > 0) {
          const user = users[0];
          
          // Atualiza o status de verificação
          await base44.asServiceRole.entities.User.update(user.id, {
            kyc_verified: true,
            didit_verification_id: verification_id
          });
          
          console.log(`Usuário ${email} verificado com sucesso!`);
          
          return Response.json({ 
            success: true,
            message: 'User verification updated'
          });
        } else {
          console.error(`Usuário com email ${email} não encontrado`);
          return Response.json({ 
            error: 'User not found',
            email 
          }, { status: 404 });
        }
      }
    }
    
    // Outros tipos de eventos
    return Response.json({ 
      success: true,
      message: 'Event received but not processed'
    });
    
  } catch (error) {
    console.error('Erro no webhook Didit:', error);
    return Response.json({ 
      error: error.message 
    }, { status: 500 });
  }
});