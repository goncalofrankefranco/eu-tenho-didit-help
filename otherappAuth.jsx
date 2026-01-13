import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Shield, Loader2, Mail, Lock, User, CheckCircle, RefreshCw } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { base44 } from '@/api/base44Client';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

export default function Auth() {
  const [mode, setMode] = useState('login');
  const [step, setStep] = useState('auth'); 
  const [isLoading, setIsLoading] = useState(false);
  const [isVerifyingKyc, setIsVerifyingKyc] = useState(false);
  
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [otpCode, setOtpCode] = useState('');

  const DIDIT_URL = "https://verify.didit.me/verify/w4USzIX_DFre5hCC7ZNvMA";
  const navigate = useNavigate();

  // Se já logado e verificado, vai pra home
  useEffect(() => {
    const initCheck = async () => {
      try {
        const user = await base44.auth.me();
        if (user) {
          // Se já tem KYC, libera. Se não, manda pro passo de KYC
          if (user.kyc_verified) {
            navigate('/home');
          } else {
            // O usuário está logado mas não verificou. Força o KYC.
            setStep('kyc'); 
          }
        }
      } catch(e) {}
    };
    initCheck();
  }, [navigate]);

  // POLLING: Verifica automaticamente o status do KYC a cada 5 segundos quando na tela 'kyc'
  useEffect(() => {
    let interval;
    if (step === 'kyc') {
      interval = setInterval(async () => {
        try {
          // Atualiza os dados do usuário do servidor
          const user = await base44.auth.me(); 
          if (user && user.kyc_verified === true) {
            toast.success("Identidade verificada com sucesso!");
            window.location.href = '/home';
          }
        } catch (e) {
          console.error("Erro ao verificar status KYC", e);
        }
      }, 5000); // Roda a cada 5 segundos
    }
    return () => clearInterval(interval);
  }, [step]);

  const handleAuth = async (e) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      if (mode === 'login') {
        // --- LOGIN ---
        await base44.auth.loginViaEmailPassword(email, password);
        const user = await base44.auth.me();
        
        if (user) {
           if (user.kyc_verified) {
             window.location.href = '/home';
           } else {
             toast.success("Login ok! Agora verifique sua identidade.");
             setStep('kyc');
           }
        }
      } else {
        // --- CADASTRO ---
        await base44.auth.register({
          email,
          password,
          first_name: name,
          full_name: name
        });
        toast.success("Código enviado para seu e-mail!");
        setStep('verify_email'); 
      }
    } catch (error) {
      console.error("Erro Auth:", error);
      toast.error(error.message || "Erro na autenticação");
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyOtp = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      await base44.auth.verifyOtp({ email, otpCode });
      toast.success("E-mail confirmado!");
      
      try {
        await base44.auth.loginViaEmailPassword(email, password);
      } catch (e) {}

      setStep('kyc'); 

    } catch (error) {
      toast.error("Código incorreto.");
    } finally {
      setIsLoading(false);
    }
  };

  // Verificação Manual Rigorosa
  const checkKycStatusManual = async () => {
      setIsVerifyingKyc(true);
      try {
        // Força uma busca nova no servidor (não usa cache)
        const user = await base44.auth.me();
        
        if (user && user.kyc_verified === true) {
            toast.success("Verificação confirmada! Entrando...");
            window.location.href = '/home';
        } else {
            // Se o campo no banco ainda for false/null
            toast.error("Ainda não recebemos a confirmação da Didit.");
            toast.info("Termine o processo na tela acima e aguarde alguns segundos.");
        }
      } catch (e) {
        toast.error("Erro de conexão.");
      } finally {
        setIsVerifyingKyc(false);
      }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 flex items-center justify-center p-4">
      
      {step !== 'kyc' && (
        <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="absolute top-8 left-0 right-0 flex flex-col items-center gap-4">
            <div className="w-16 h-16 rounded-xl bg-gradient-to-br from-[#7de3d3] to-cyan-600 flex items-center justify-center shadow-lg shadow-[#7de3d3]/20">
                <Shield className="w-8 h-8 text-black" />
            </div>
            <h1 className="text-3xl font-bold text-[#7de3d3] text-center">ajuda aqui</h1>
        </motion.div>
      )}

      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }} 
        animate={{ opacity: 1, scale: 1 }} 
        className={`w-full bg-slate-900/60 backdrop-blur-xl rounded-3xl border border-white/10 shadow-2xl overflow-hidden ${step === 'kyc' ? 'max-w-4xl h-[85vh]' : 'max-w-md mt-16'}`}
      >
        
        <AnimatePresence mode="wait">
          
          {/* PASSO 1: LOGIN/CADASTRO */}
          {step === 'auth' && (
            <motion.div key="auth" exit={{ opacity: 0, x: -20 }}>
              <div className="flex border-b border-white/10">
                <button onClick={() => setMode('login')} className={`flex-1 py-4 text-sm font-semibold relative ${mode === 'login' ? 'text-[#7de3d3] bg-white/5' : 'text-white/40'}`}>
                  Entrar {mode === 'login' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#7de3d3]" />}
                </button>
                <button onClick={() => setMode('register')} className={`flex-1 py-4 text-sm font-semibold relative ${mode === 'register' ? 'text-[#7de3d3] bg-white/5' : 'text-white/40'}`}>
                  Criar Conta {mode === 'register' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#7de3d3]" />}
                </button>
              </div>
              <div className="p-8">
                <form onSubmit={handleAuth} className="space-y-4">
                  {mode === 'register' && (
                    <div className="space-y-2">
                        <Label className="text-white/70 text-xs ml-1">Nome</Label>
                        <Input type="text" className="bg-white/5 border-white/10 text-white rounded-xl h-11" value={name} onChange={(e) => setName(e.target.value)} />
                    </div>
                  )}
                  <div className="space-y-2">
                    <Label className="text-white/70 text-xs ml-1">E-mail</Label>
                    <Input type="email" className="bg-white/5 border-white/10 text-white rounded-xl h-11" value={email} onChange={(e) => setEmail(e.target.value)} required />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-white/70 text-xs ml-1">Senha</Label>
                    <Input type="password" className="bg-white/5 border-white/10 text-white rounded-xl h-11" value={password} onChange={(e) => setPassword(e.target.value)} required />
                  </div>
                  <Button type="submit" disabled={isLoading} className="w-full h-12 bg-[#7de3d3] hover:bg-[#6dd3c3] text-slate-950 font-bold rounded-xl mt-4">
                    {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : (mode === 'login' ? 'Acessar' : 'Cadastrar')}
                  </Button>
                </form>
              </div>
            </motion.div>
          )}

          {/* PASSO 2: EMAIL */}
          {step === 'verify_email' && (
            <motion.div key="verify" initial={{ x: 20, opacity: 0 }} animate={{ x: 0, opacity: 1 }} className="p-8">
              <div className="text-center mb-6">
                <h2 className="text-2xl font-bold text-white">Verifique seu e-mail</h2>
                <p className="text-white/60 text-sm mt-2">Código enviado para {email}</p>
              </div>
              <form onSubmit={handleVerifyOtp} className="space-y-6">
                <Input type="text" placeholder="000000" className="bg-white/5 border-white/10 text-white text-center text-3xl tracking-[1em] h-16 rounded-xl" value={otpCode} onChange={(e) => setOtpCode(e.target.value)} maxLength={6} required />
                <Button type="submit" disabled={isLoading} className="w-full h-12 bg-[#7de3d3] hover:bg-[#6dd3c3] text-slate-950 font-bold rounded-xl">
                  {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : "Confirmar"}
                </Button>
              </form>
            </motion.div>
          )}

          {/* PASSO 3: KYC OBRIGATÓRIO */}
          {step === 'kyc' && (
            <motion.div key="kyc" initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="h-full flex flex-col">
              
              <div className="p-4 border-b border-white/10 flex justify-between items-center bg-slate-900">
                 <div className="flex items-center gap-2">
                    <Shield className="w-5 h-5 text-[#7de3d3]" />
                    <span className="text-white font-bold">Verificação Obrigatória</span>
                 </div>
                 {/* BOTÃO DE PULAR REMOVIDO DAQUI */}
              </div>

              <div className="flex-1 bg-white w-full relative">
                 <iframe 
                    src={`${DIDIT_URL}?vendorData=${email}`} 
                    className="w-full h-full border-0"
                    allow="camera; microphone; geolocation"
                    title="Didit Verification"
                 />
              </div>

              <div className="p-4 bg-slate-900 border-t border-white/10 space-y-2">
                 <p className="text-white/40 text-xs text-center">
                    O sistema verifica seu status automaticamente.
                 </p>
                 <Button 
                    onClick={checkKycStatusManual} 
                    disabled={isVerifyingKyc}
                    className="w-full bg-[#7de3d3] hover:bg-[#6dd3c3] text-slate-950 font-bold h-12 rounded-xl"
                 >
                    {isVerifyingKyc ? (
                        <div className="flex items-center gap-2">
                            <Loader2 className="w-5 h-5 animate-spin" />
                            <span>Verificando no sistema...</span>
                        </div>
                    ) : (
                        <div className="flex items-center gap-2">
                            <RefreshCw className="w-5 h-5" />
                            <span>Já terminei, verificar agora</span>
                        </div>
                    )}
                 </Button>
              </div>

            </motion.div>
          )}

        </AnimatePresence>
      </motion.div>
    </div>
  );
}