import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Camera, Check, AlertCircle, Shield, CheckCircle, Loader2, FileText, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import { createPageUrl } from '@/utils';
import { motion } from 'framer-motion';
import { createWorker } from 'tesseract.js';

export default function IdentityVerification() {
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [processingOcr, setProcessingOcr] = useState(false);
  const [validatingAddress, setValidatingAddress] = useState(false);
  const [startingKyc, setStartingKyc] = useState(false);

  const [kycStarted, setKycStarted] = useState(false);
  const [diditUrl, setDiditUrl] = useState(null);
  const [useExternalLink, setUseExternalLink] = useState(false);

  const [addressValidationResult, setAddressValidationResult] = useState(null);

  const [verificationData, setVerificationData] = useState({
    comprovante_residencia_url: '',
    file: null,
    ocrText: '',
    isPdf: false
  });

  const startedKycRef = useRef(false);
  const pollingRef = useRef(null);

  const performOcr = async (imageFile) => {
    const worker = await createWorker('por');
    const { data } = await worker.recognize(imageFile);
    await worker.terminate();
    return data?.text || '';
  };

  // Check initial status
  useEffect(() => {
    const checkStatusAndRedirect = async () => {
      try {
        const user = await base44.auth.me();
        const profiles = await base44.entities.UserProfile.filter({ user_id: user.id });

        if (profiles && profiles.length > 0) {
          const profile = profiles[0];

          // Se KYC já aprovado, vai para tela de conclusão
          if (profile.verification_status === 'approved' && profile.proof_of_residency_status === 'approved') {
            navigate(createPageUrl('VerificationComplete'));
            return;
          }

          // Se comprovante aprovado, inicia KYC
          if (profile.proof_of_residency_status === 'approved') {
            if (!startedKycRef.current) {
              startedKycRef.current = true;
              setLoading(false);
              await startKyc();
              return;
            }
          }
        }
      } catch (e) {
        console.error('Erro checkStatus:', e);
      } finally {
        setLoading(false);
      }
    };

    checkStatusAndRedirect();

    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, []);

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const isPdf = file.type === 'application/pdf' || file.name?.toLowerCase().endsWith('.pdf');
    const isImage = file.type?.startsWith('image/');

    if (!isPdf && !isImage) {
      toast.error('Apenas imagens ou PDF');
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      toast.error('Arquivo muito grande. Máximo 10MB');
      return;
    }

    setProcessingOcr(true);

    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });

      let ocrText = '';

      if (isPdf) {
        toast.info('PDF carregado. Será processado no backend.');
      } else {
        toast.info('Extraindo texto da imagem...');
        ocrText = await performOcr(file);

        if (!ocrText || ocrText.trim().length < 50) {
          toast.warning('Pouco texto detectado. Continue ou envie imagem mais nítida.');
        }
      }

      setVerificationData({
        comprovante_residencia_url: file_url,
        file,
        ocrText,
        isPdf
      });

      toast.success('Documento carregado!');
    } catch (err) {
      console.error('Erro upload/OCR:', err);
      toast.error(err?.message || 'Erro ao processar arquivo');
    } finally {
      setProcessingOcr(false);
    }
  };

  const handleSubmit = async () => {
    if (!verificationData.comprovante_residencia_url) {
      toast.error('Envie o comprovante de residência');
      return;
    }

    setValidatingAddress(true);

    try {
      const user = await base44.auth.me();

      const checkRecord = await base44.entities.ProofOfAddressCheck.create({
        user_id: user.id,
        status: 'PENDING',
        ocr_text: verificationData.ocrText || ''
      });

      const payload = verificationData.isPdf
        ? { record_id: checkRecord.id, user_id: user.id, file_url: verificationData.comprovante_residencia_url }
        : {
          record_id: checkRecord.id,
          user_id: user.id,
          file_url: verificationData.comprovante_residencia_url, // ✅ add
          ocr_text: verificationData.ocrText
        };

      const validationResult = await base44.functions.invoke('verify_proof_of_address', payload);
      const result = validationResult?.data || validationResult;

      setAddressValidationResult(result);

      if (result?.status === 'APPROVED') {
        const existingProfile = await base44.entities.UserProfile.filter({ user_id: user.id });
        const profileData = {
          proof_of_residency_status: 'approved',
          comprovante_residencia_url: verificationData.comprovante_residencia_url,
          endereco: result.street || null,
          neighborhood_id: result.neighborhood || null,
          city_id: result.city || null,
          state_id: result.state || null
        };

        if (existingProfile && existingProfile.length > 0) {
          await base44.entities.UserProfile.update(existingProfile[0].id, profileData);
        } else {
          await base44.entities.UserProfile.create({ ...profileData, user_id: user.id });
        }

        toast.success('✅ Comprovante aprovado! Iniciando verificação facial...');

        if (!startedKycRef.current) {
          startedKycRef.current = true;
          await startKyc();
        }
      } else {
        toast.error('❌ Comprovante rejeitado: ' + (result?.reason || 'Tente novamente'));
      }
    } catch (error) {
      console.error('Erro validar comprovante:', error);
      toast.error('Erro ao validar comprovante');
    } finally {
      setValidatingAddress(false);
    }
  };

  const startKyc = async () => {
    setStartingKyc(true);
    
    try {
      const user = await base44.auth.me();
      console.log('Starting KYC for user:', user.id);

      // Criar sessão Didit
      const res = await base44.functions.invoke('didit_create_session', {
        user_id: user.id
      });

      console.log('Function response:', res);
      const data = res?.data || res;
      
      console.log('Didit session response data:', data);

      if (data?.error) {
        throw new Error(data.error + (data.details ? ': ' + JSON.stringify(data.details) : ''));
      }

      const url = data?.url || data?.verification_url;

      if (!url) {
        console.error('Sem URL de verificação:', data);
        toast.error('Erro ao criar sessão Didit. Tente abrir em nova aba.');
        setUseExternalLink(true);
        setKycStarted(true);
        setStartingKyc(false);
        return;
      }

      setDiditUrl(url);
      setKycStarted(true);
      setStartingKyc(false);

      // Polling para verificar conclusão
      pollingRef.current = setInterval(async () => {
        try {
          const profiles = await base44.entities.UserProfile.filter({ user_id: user.id });
          const profile = profiles?.[0];

          if (!profile) return;

          const st = (profile.verification_status || '').toLowerCase();

          if (['approved', 'rejected', 'review'].includes(st)) {
            clearInterval(pollingRef.current);
            pollingRef.current = null;
            
            if (st === 'approved') {
              toast.success('✅ Verificação aprovada!');
            } else if (st === 'rejected') {
              toast.error('❌ Verificação rejeitada');
            } else {
              toast.info('📋 Em análise manual');
            }
            
            navigate(createPageUrl('VerificationComplete'));
          }
        } catch (e) {
          console.error('Polling error:', e);
        }
      }, 3000);

    } catch (e) {
      console.error('startKyc error:', e);
      toast.error('Erro ao iniciar verificação: ' + (e?.message || ''));
      setUseExternalLink(true);
      setKycStarted(true);
      setStartingKyc(false);
    }
  };

  const openExternalVerification = async () => {
    try {
      const user = await base44.auth.me();
      
      // Criar nova sessão com callback (para webhook)
      const res = await base44.functions.invoke('didit_create_session', {
        user_id: user.id,
        isIframe: false
      });

      const data = res?.data || res;
      const url = data?.url || data?.verification_url;

      if (url) {
        window.open(url, '_blank');
        toast.info('Complete a verificação na nova aba e volte aqui');
        
        // Inicia polling
        pollingRef.current = setInterval(async () => {
          try {
            const profiles = await base44.entities.UserProfile.filter({ user_id: user.id });
            const profile = profiles?.[0];
            const st = (profile?.verification_status || '').toLowerCase();

            if (['approved', 'rejected', 'review'].includes(st)) {
              clearInterval(pollingRef.current);
              navigate(createPageUrl('VerificationComplete'));
            }
          } catch (e) {
            console.error('Polling error:', e);
          }
        }, 3000);
      } else {
        toast.error('Não foi possível criar sessão');
      }
    } catch (e) {
      toast.error('Erro: ' + (e?.message || ''));
    }
  };

  const checkVerificationStatus = async () => {
    try {
      const res = await base44.functions.invoke('didit_get_decision', {});
      const data = res?.data || res;
      
      if (data?.status === 'approved') {
        toast.success('✅ Verificação aprovada!');
        navigate(createPageUrl('VerificationComplete'));
      } else if (data?.status === 'rejected') {
        toast.error('❌ Verificação rejeitada');
        navigate(createPageUrl('VerificationComplete'));
      } else if (data?.status === 'review') {
        toast.info('📋 Em análise manual');
        navigate(createPageUrl('VerificationComplete'));
      } else {
        toast.info('⏳ Ainda em processamento...');
      }
    } catch (e) {
      toast.error('Erro ao verificar status');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-[#2D7A4F] animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white">
      {!kycStarted ? (
        <>
          <div className="bg-[#2D7A4F] px-4 py-6 text-white">
            <h1 className="text-2xl font-bold mb-2">Verificação de Identidade</h1>
            <p className="text-white/90">Envie seu comprovante de residência</p>
          </div>

          <div className="px-4 py-6 space-y-6">
            <div className="bg-[#E8F5E9] border border-[#2D7A4F]/30 rounded-xl p-4 flex gap-3">
              <AlertCircle className="w-5 h-5 text-[#2D7A4F] flex-shrink-0 mt-0.5" />
              <div className="text-sm text-gray-800">
                <p className="font-semibold mb-1">Atenção</p>
                <p>Aceito: foto ou PDF de conta de luz, água, internet, etc.</p>
                <p className="mt-1">Após aprovação, você fará a validação facial.</p>
              </div>
            </div>

            <div>
              <label className="block">
                <div
                  className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors ${
                    verificationData.comprovante_residencia_url
                      ? 'border-[#2D7A4F] bg-[#2D7A4F]/5'
                      : 'border-gray-300 hover:border-[#2D7A4F]'
                  }`}
                >
                  {processingOcr ? (
                    <div className="flex flex-col items-center gap-3">
                      <Loader2 className="w-8 h-8 text-[#2D7A4F] animate-spin" />
                      <p className="text-sm text-[#2D7A4F] font-medium">Processando documento...</p>
                    </div>
                  ) : verificationData.comprovante_residencia_url ? (
                    <div className="flex flex-col items-center gap-2">
                      <Check className="w-8 h-8 text-[#2D7A4F]" />
                      <p className="text-sm text-[#2D7A4F] font-medium">Documento carregado</p>

                      {verificationData.isPdf ? (
                        <FileText className="w-16 h-16 text-[#2D7A4F] mt-2" />
                      ) : (
                        <img
                          src={verificationData.comprovante_residencia_url}
                          alt="Comprovante"
                          className="mt-2 max-h-40 rounded"
                        />
                      )}
                    </div>
                  ) : (
                    <>
                      <Camera className="w-8 h-8 text-gray-400 mx-auto mb-2" />
                      <p className="text-sm text-gray-600">Foto ou PDF</p>
                      <p className="text-xs text-gray-500 mt-2">Conta de luz, água, internet, etc.</p>
                    </>
                  )}
                </div>

                <input
                  type="file"
                  accept="image/*,application/pdf"
                  onChange={handleFileUpload}
                  className="hidden"
                  disabled={processingOcr}
                />
              </label>
            </div>

            {addressValidationResult && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className={`rounded-xl p-4 ${
                  addressValidationResult.status === 'APPROVED'
                    ? 'bg-[#E8F5E9] border border-[#2D7A4F]/30'
                    : 'bg-red-50 border border-red-200'
                }`}
              >
                <div className="flex items-start gap-3">
                  {addressValidationResult.status === 'APPROVED' ? (
                    <CheckCircle className="w-5 h-5 text-[#2D7A4F] flex-shrink-0 mt-0.5" />
                  ) : (
                    <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                  )}

                  <div className="text-sm">
                    <p
                      className={`font-semibold mb-1 ${
                        addressValidationResult.status === 'APPROVED'
                          ? 'text-gray-900'
                          : 'text-red-900'
                      }`}
                    >
                      {addressValidationResult.status === 'APPROVED'
                        ? '✅ Comprovante Aprovado'
                        : '❌ Comprovante Rejeitado'}
                    </p>

                    <p className={addressValidationResult.status === 'APPROVED' ? 'text-gray-700' : 'text-red-800'}>
                      {addressValidationResult.reason || 'Resultado recebido'}
                    </p>
                  </div>
                </div>
              </motion.div>
            )}

            <Button
              onClick={handleSubmit}
              disabled={validatingAddress || processingOcr || !verificationData.comprovante_residencia_url}
              className="w-full bg-[#2D7A4F] hover:bg-[#1e5438] h-12"
            >
              {validatingAddress ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Validando comprovante...
                </span>
              ) : (
                'Validar Comprovante'
              )}
            </Button>

            <p className="text-xs text-gray-500 text-center mt-3">
              🤖 Uma IA validará seu envio. Seus dados não serão usados para treinar IAs.
            </p>
            </div>
        </>
      ) : (
        <motion.div
          key="kyc"
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="fixed inset-0 z-[100] flex flex-col bg-slate-900"
        >
          <div className="p-4 border-b border-white/10 flex items-center justify-center bg-[#2D7A4F]">
            <div className="flex items-center gap-2">
              <Shield className="w-5 h-5 text-white" />
              <span className="text-white font-bold">Validação Facial - Didit</span>
            </div>
          </div>

          <div className="flex-1 bg-white w-full relative">
            {diditUrl && !useExternalLink ? (
              <iframe
                src={diditUrl}
                className="w-full h-full border-0"
                allow="camera; microphone; geolocation"
                title="Didit Verification"
              />
            ) : (
              <div className="flex flex-col items-center justify-center h-full gap-6 p-6">
                <Shield className="w-16 h-16 text-[#2D7A4F]" />
                <h2 className="text-xl font-bold text-center">Verificação Facial</h2>
                <p className="text-gray-600 text-center">
                  Clique no botão abaixo para abrir a verificação em uma nova aba.
                  Após concluir, volte aqui.
                </p>
                
                <Button
                  onClick={openExternalVerification}
                  className="bg-[#2D7A4F] hover:bg-[#1e5438] gap-2"
                >
                  <ExternalLink className="w-4 h-4" />
                  Abrir Verificação
                </Button>

                <Button
                  onClick={checkVerificationStatus}
                  variant="outline"
                  className="gap-2"
                >
                  <Loader2 className="w-4 h-4" />
                  Já completei - Verificar Status
                </Button>
              </div>
            )}
          </div>

          <div className="p-4 bg-[#2D7A4F] border-t border-white/10">
            <div className="flex flex-col items-center gap-2">
              <div className="flex items-center justify-center gap-2 text-white/80">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="text-sm">Aguardando conclusão da verificação...</span>
              </div>
              
              <Button
                onClick={checkVerificationStatus}
                variant="ghost"
                size="sm"
                className="text-white/80 hover:text-white hover:bg-white/10"
              >
                Verificar status manualmente
              </Button>
            </div>
          </div>
        </motion.div>
      )}
    </div>
  );
}