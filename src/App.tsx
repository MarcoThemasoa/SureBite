import React, { useState, useRef, useEffect, useMemo } from 'react';
import Markdown from 'react-markdown';
import { extractSafeBaseIngredients, analyzeFoodImage, analyzeFoodText, chatWithAssistant, AnalysisResult } from './lib/gemini';
import { Camera, ShieldAlert, Check, RefreshCw, Search, ChevronRight, AlertTriangle, LayoutDashboard, List, MessageSquare, Settings, Plus, Send, LogOut, Eye, EyeOff, Lock } from 'lucide-react';
import { supabase } from './lib/supabase';
import type { User } from '@supabase/supabase-js';

type ViewState = 'auth' | 'tos' | 'onboarding_age' | 'onboarding_allergies' | 'onboarding_meals' | 'dashboard' | 'scanner' | 'result' | 'settings' | 'ingredients' | 'chat' | 'safe_plates_edit' | 'allergies_edit' | 'danger_zone' | 'allergy_side_effects' | 'scans_history';

const LOADING_MESSAGES = [
  "Firing neural pathways...",
  "Consulting the knowledge base...",
  "Extracting allergen profiles...",
  "Cross-referencing safety margins...",
  "Almost there..."
];

const RotatingLoadingText = () => {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => {
      setIndex(i => (i + 1) % LOADING_MESSAGES.length);
    }, 6000); // rotate every 6 seconds as requested
    return () => clearInterval(timer);
  }, []);
  return <span className="animate-pulse">{LOADING_MESSAGES[index]}</span>;
};

interface ScanEvent {
  id: string;
  timestamp: Date;
  results: AnalysisResult[];
  imageSrc?: string;
  mood?: 'good' | 'neutral' | 'bad' | 'deferred';
  symptom?: string;
  foodName?: string;
}

interface UserProfile {
  dob: string;
  allergies: string[];
  safeMeals: string[];
  baseIngredients: string[];
  ingredientOverrides: Record<string, 'red' | 'yellow' | 'blue' | 'green'>;
  allergenSideEffects: Record<string, string[]>;
}

const COMMON_ALLERGIES = ['Peanuts', 'Tree Nuts', 'Milk', 'Eggs', 'Wheat', 'Soy', 'Fish', 'Shellfish', 'Sesame'];

export default function App() {
  const [isInitializing, setIsInitializing] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [view, setView] = useState<ViewState>('auth');
  const [profile, setProfile] = useState<UserProfile>({
    dob: '',
    allergies: [],
    safeMeals: ['', '', ''],
    baseIngredients: [],
    ingredientOverrides: {},
    allergenSideEffects: {}
  });

  const [sideEffectInputs, setSideEffectInputs] = useState<Record<string, string>>({});
  
  const [history, setHistory] = useState<ScanEvent[]>([]);
  const [currentScan, setCurrentScan] = useState<ScanEvent | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorObj, setErrorObj] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [authLockedUntil, setAuthLockedUntil] = useState<number>(0);
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [resetEmailSent, setResetEmailSent] = useState(false);
  const [manualInput, setManualInput] = useState('');
  const [safePlateName, setSafePlateName] = useState('');
  const [autoAddedSafePlate, setAutoAddedSafePlate] = useState<{original: string, current: string} | null>(null);
  const [pendingAutoSafePlateDialog, setPendingAutoSafePlateDialog] = useState<{ defaultName: string } | null>(null);
  const [pendingConfirmUnsafe, setPendingConfirmUnsafe] = useState<ScanEvent | null>(null);
  const [pendingConfirmSafe, setPendingConfirmSafe] = useState<ScanEvent | null>(null);
  const [pendingUnsafeIngredientsDialog, setPendingUnsafeIngredientsDialog] = useState<ScanEvent | null>(null);
  const [selectedUnsafeIngredients, setSelectedUnsafeIngredients] = useState<string[]>([]);
  const [tutorialStep, setTutorialStep] = useState<number>(0);
  const [showTutorialConfirm, setShowTutorialConfirm] = useState(false);
  const [showChangePasswordConfirm, setShowChangePasswordConfirm] = useState(false);
  const [showResetPasswordConfirm, setShowResetPasswordConfirm] = useState(false);
  const [changePasswordOld, setChangePasswordOld] = useState('');
  const [changePasswordNew, setChangePasswordNew] = useState('');
  const [changePasswordNewConfirm, setChangePasswordNewConfirm] = useState('');
  const [showChangePasswordOld, setShowChangePasswordOld] = useState(false);
  const [showChangePasswordNew, setShowChangePasswordNew] = useState(false);
  
  const [isSynthesizingBackground, setIsSynthesizingBackground] = useState(false);
  const [ingredientsSearch, setIngredientsSearch] = useState('');
  const [ingredientsCategory, setIngredientsCategory] = useState('All');
  const [scansLogPage, setScansLogPage] = useState(1);
  const [dangerZoneFilter, setDangerZoneFilter] = useState<'all' | 'red' | 'yellow' | 'blue'>('all');
  const [ingredientsPage, setIngredientsPage] = useState(1);
  const [dangerZonePage, setDangerZonePage] = useState(1);

  const BROAD_CATEGORIES: Record<string, string[]> = {
    'All': [],
    'Dairy': ['dairy', 'milk', 'cheese', 'butter', 'cream', 'yogurt', 'whey', 'casein', 'lactose', 'ghee', 'paneer'],
    'Nuts & Seeds': ['nut', 'seed', 'peanut', 'almond', 'cashew', 'walnut', 'pecan', 'macadamia', 'pistachio', 'hazelnut', 'sesame', 'sunflower', 'chia', 'flax', 'pine', 'brazil'],
    'Meat & Poultry': ['meat', 'poultry', 'beef', 'pork', 'chicken', 'turkey', 'lamb', 'duck', 'bacon', 'sausage', 'veal', 'venison', 'ham'],
    'Seafood': ['seafood', 'fish', 'salmon', 'tuna', 'cod', 'shrimp', 'crab', 'lobster', 'shellfish', 'oyster', 'clam', 'scallop', 'mussel', 'anchovy', 'sardine'],
    'Gluten/Wheat': ['gluten', 'wheat', 'flour', 'barley', 'rye', 'oats', 'bread', 'pasta', 'spelt', 'malt', 'seitan'],
    'Produce': ['produce', 'apple', 'banana', 'orange', 'lemon', 'lime', 'berry', 'strawberry', 'blueberry', 'raspberry', 'grape', 'melon', 'watermelon', 'lettuce', 'spinach', 'kale', 'broccoli', 'carrot', 'potato', 'tomato', 'onion', 'garlic', 'pepper', 'mushroom', 'corn', 'pea', 'bean', 'fruit', 'vegetable']
  };
  const [pendingOverride, setPendingOverride] = useState<{ingredient: string, status: 'red'|'yellow'|'blue'|'green'} | null>(null);
  const [customAllergyInput, setCustomAllergyInput] = useState('');
  
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authMode, setAuthMode] = useState<'login' | 'register' | 'mfa' | 'forgot_password'>('login');
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [showDeleteAccountConfirm, setShowDeleteAccountConfirm] = useState(false);
  const [showAllergiesConfirm, setShowAllergiesConfirm] = useState(false);
  const [showSafePlatesConfirm, setShowSafePlatesConfirm] = useState(false);
  const [showRegistrationEmailConfirm, setShowRegistrationEmailConfirm] = useState(false);
  const [nowValue, setNowValue] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNowValue(Date.now()), 60000);
    return () => clearInterval(timer);
  }, []);

  const triggerBackgroundSynthesis = async () => {
    setIsSynthesizingBackground(true);
    try {
      const ingredients = await extractSafeBaseIngredients(profile.safeMeals.filter(m => m.trim() !== ''));
      const updatedProfile = { ...profile, baseIngredients: ingredients };
      setProfile(updatedProfile);
      syncProfileToSupabase(updatedProfile);
    } catch (e) {
      console.error(e);
      syncProfileToSupabase(profile);
    } finally {
      setIsSynthesizingBackground(false);
    }
  };
  const [chatMessages, setChatMessages] = useState<{role: 'user'|'model', parts: [{text: string}] }[]>([]);
  const [chatInput, setChatInput] = useState('');

  const chatEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (view === 'chat') chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages, view]);

  const mainScrollRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Scroll to top when view changes
    if (view === 'chat') {
      setTimeout(() => chatInputRef.current?.focus(), 100);
    } else {
      setTimeout(() => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }, 100);
    }
  }, [view]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        loadUserData(session.user.id);
      } else {
        setIsInitializing(false);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        loadUserData(session.user.id);
      } else {
        setView('auth');
        setIsInitializing(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const loadUserData = async (userId: string) => {
    try {
      const { data: profileData } = await supabase.from('user_profiles').select('*').eq('id', userId).single();
      if (profileData) {
        setProfile({
          dob: profileData.dob || '',
          allergies: profileData.allergies || [],
          safeMeals: profileData.safe_meals || ['', '', ''],
          baseIngredients: profileData.base_ingredients || [],
          ingredientOverrides: profileData.ingredient_overrides || {},
          allergenSideEffects: profileData.allergen_side_effects || {}
        });
        if (profileData.dob) {
          setView('dashboard');
        } else {
          setView('tos');
        }
      } else {
        setView('tos');
      }

      const { data: historyData } = await supabase.from('scan_history').select('*').eq('user_id', userId).order('timestamp', { ascending: false });
      if (historyData) {
        setHistory(historyData.map((row: any) => {
          const isWrapped = row.results && typeof row.results === 'object' && !Array.isArray(row.results);
          return {
            id: row.id,
            timestamp: new Date(row.timestamp),
            results: isWrapped ? row.results.items : row.results,
            foodName: isWrapped ? row.results.foodName : undefined,
            imageSrc: row.image_src,
            mood: row.mood,
            symptom: row.symptom
          };
        }));
      }

      const { data: chatData } = await supabase.from('chat_history').select('*').eq('user_id', userId).order('created_at', { ascending: true });
      if (chatData && chatData.length) {
        setChatMessages(chatData.map(c => ({ role: c.role as 'user' | 'model', parts: c.parts as [{ text: string }] })));
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsInitializing(false);
    }
  };

  const syncProfileToSupabase = async (updatedProfile: UserProfile) => {
    const currentUser = (await supabase.auth.getSession()).data.session?.user;
    if (!currentUser) return;
    try {
      await supabase.from('user_profiles').upsert({
        id: currentUser.id,
        dob: updatedProfile.dob,
        allergies: updatedProfile.allergies,
        safe_meals: updatedProfile.safeMeals,
        base_ingredients: updatedProfile.baseIngredients,
        ingredient_overrides: updatedProfile.ingredientOverrides,
        allergen_side_effects: updatedProfile.allergenSideEffects
      });
    } catch (error) {
      console.error('Error syncing profile:', error);
    }
  };

  const syncHistory = async (newHistory: ScanEvent[]) => {
    setHistory(newHistory);
    const currentUser = (await supabase.auth.getSession()).data.session?.user;
    if (!currentUser) return;
    try {
      const recordsToUpsert = newHistory.map(scan => ({
        id: scan.id,
        user_id: currentUser.id,
        timestamp: scan.timestamp instanceof Date ? scan.timestamp.toISOString() : (scan.timestamp || new Date().toISOString()),
        results: { items: scan.results || [], foodName: scan.foodName },
        image_src: scan.imageSrc || null,
        mood: scan.mood === 'deferred' ? null : (scan.mood || null),
        symptom: scan.symptom || null
      }));
      const { error } = await supabase.from('scan_history').upsert(recordsToUpsert);
      if (error) {
        console.error("Supabase upsert error:", error);
        throw error;
      }
    } catch (error) {
      console.error("Failed to sync history", error);
    }
  }

  const syncChat = async (newChat: {role: 'user'|'model', parts: [{text: string}] }[]) => {
    setChatMessages(newChat);
    const currentUser = (await supabase.auth.getSession()).data.session?.user;
    if (!currentUser) return;
    try {
      if (newChat.length === 0) {
        await supabase.from('chat_history').delete().eq('user_id', currentUser.id);
      } else {
        const lastMsg = newChat[newChat.length - 1];
        await supabase.from('chat_history').insert({
          user_id: currentUser.id,
          role: lastMsg.role,
          parts: lastMsg.parts
        });
      }
    } catch(error) {
      console.error("Failed to sync chat", error);
    }
  }

  const saveProfileAndProceed = async (targetView: ViewState = 'dashboard') => {
    syncProfileToSupabase(profile);
    setView(targetView);
  };

  const saveSettings = async () => {
    setIsProcessing(true);
    try {
      const ingredients = await extractSafeBaseIngredients(profile.safeMeals.filter(m => m.trim() !== ''));
      const updatedProfile = { ...profile, baseIngredients: ingredients };
      setProfile(updatedProfile);
      syncProfileToSupabase(updatedProfile);
      
      if (ingredients.length > 0) {
        const newScan: ScanEvent = {
          id: crypto.randomUUID(),
          timestamp: new Date(),
          results: ingredients.map(ing => ({
            standard_name: ing,
            status: 'green',
            reason: 'Extracted from safe plates log'
          }))
        };
        syncHistory([newScan, ...history]);
      }
      
      setView('dashboard');
    } catch (e) {
      console.error(e);
      syncProfileToSupabase(profile);
      setView('dashboard');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleAutoSaveSafePlate = (analysis: any, defaultInputText?: string) => {
    const reds = analysis.results.filter((r: any) => (profile.ingredientOverrides[r.standard_name] || r.status) === 'red');
    const yellows = analysis.results.filter((r: any) => (profile.ingredientOverrides[r.standard_name] || r.status) === 'yellow');
    
    if (reds.length === 0 && yellows.length === 0 && analysis.results.length > 0) {
      const defaultName = analysis.foodName || defaultInputText || "Scanned Item";
      if (!profile.safeMeals.includes(defaultName)) {
        setPendingAutoSafePlateDialog({ defaultName });
      } else {
        setAutoAddedSafePlate(null);
      }
    } else {
      setAutoAddedSafePlate(null);
    }
  };

  const handleManualSearch = async () => {
    if (!manualInput.trim()) return;
    setIsProcessing(true);
    setErrorObj(null);
    try {
      const analysis = await analyzeFoodText({
        text: manualInput,
        allergies: profile.allergies,
        safeIngredients: profile.baseIngredients
      });
      const newScan: ScanEvent = {
        id: crypto.randomUUID(),
        timestamp: new Date(),
        results: analysis.results,
        foodName: (analysis.results.length > 1 && analysis.foodName) ? analysis.foodName : undefined
      };
      
      handleAutoSaveSafePlate(analysis, manualInput);
      
      setCurrentScan(newScan);
      syncHistory([newScan, ...history]);
      setView('result');
      setManualInput('');
    } catch (err: any) {
      setErrorObj("Failed to analyze text. Ensure API limits aren't exceeded.");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleMealChange = (index: number, value: string) => {
    const newMeals = [...profile.safeMeals];
    newMeals[index] = value;
    setProfile({ ...profile, safeMeals: newMeals });
  };

  const processSafeMeals = async (targetView: ViewState = 'dashboard') => {
    setView(targetView);
    setIsProcessing(true);
    try {
      const ingredients = await extractSafeBaseIngredients(profile.safeMeals.filter(m => m.trim() !== ''));
      const updatedProfile = { ...profile, baseIngredients: ingredients };
      setProfile(updatedProfile);
      syncProfileToSupabase(updatedProfile);
      
      if (ingredients.length > 0) {
        const newScan: ScanEvent = {
          id: crypto.randomUUID(),
          timestamp: new Date(),
          results: ingredients.map(ing => ({
            standard_name: ing,
            status: 'green',
            reason: 'Extracted from safe plates log'
          }))
        };
        syncHistory([newScan, ...history]);
      }
      
      if (targetView === 'dashboard' && !localStorage.getItem('tutorialCompleted')) {
        setTutorialStep(1);
        localStorage.setItem('tutorialCompleted', 'true');
      }
    } catch (e) {
      console.error(e);
      // Proceed anyway with basic fallback
      syncProfileToSupabase(profile);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsProcessing(true);
    setErrorObj(null);
    try {
      const reader = new FileReader();
      reader.onloadend = async () => {
        const base64String = (reader.result as string).split(',')[1];
        const mimeType = file.type;
        const imageSrc = reader.result as string;
        
        try {
          const analysis = await analyzeFoodImage({
            base64Data: base64String,
            mimeType,
            allergies: profile.allergies,
            safeIngredients: profile.baseIngredients
          });
          
          const newScan: ScanEvent = {
            id: crypto.randomUUID(),
            timestamp: new Date(),
            results: analysis.results,
            foodName: (analysis.results.length > 1 && analysis.foodName) ? analysis.foodName : undefined,
            imageSrc
          };
          
          handleAutoSaveSafePlate(analysis, analysis.foodName || "Scan " + new Date().toLocaleTimeString());
          
          setCurrentScan(newScan);
          syncHistory([newScan, ...history]);
          setView('result');
        } catch (err: any) {
          setErrorObj("Failed to analyze image. Ensure API limits aren't exceeded.");
        } finally {
          setIsProcessing(false);
        }
      };
      reader.readAsDataURL(file);
    } catch (err: any) {
      setErrorObj(err.message || 'Error uploading file');
      setIsProcessing(false);
    }
  };

  const isValidEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const isValidPassword = (password: string) => password.length >= 12 && /[!@#$%^&*(),.?":{}|<>]/.test(password);

  const checkAuthLimit = () => {
    try {
      const failures: number[] = JSON.parse(localStorage.getItem('auth_failures') || '[]');
      const oneHourAgo = Date.now() - 3600000;
      const recentFailures = failures.filter(t => t > oneHourAgo);
      if (recentFailures.length >= 5) {
        return false;
      }
      return true;
    } catch {
      return true;
    }
  };

  const recordAuthFailure = () => {
    try {
      const failures: number[] = JSON.parse(localStorage.getItem('auth_failures') || '[]');
      const oneHourAgo = Date.now() - 3600000;
      const recentFailures = failures.filter(t => t > oneHourAgo);
      recentFailures.push(Date.now());
      localStorage.setItem('auth_failures', JSON.stringify(recentFailures));
    } catch {}
  };

  const renderAuth = () => (
    <div className="flex-1 flex items-center justify-center p-6 bg-[#FDFCFB] text-[#1A1A1A]">
      <div className="max-w-md w-full bg-white p-10 border border-[#1A1A1A] shadow-[8px_8px_0px_#1A1A1A]">
        <h2 className="text-4xl font-serif italic tracking-tight mb-2">SureBite</h2>
        <p className="text-[10px] uppercase tracking-[0.2em] opacity-60 mb-8 font-bold">Supabase Secure Auth</p>
        
        <div className="mb-4">
          <label className="block text-[10px] font-bold uppercase tracking-widest mb-2 opacity-50">Email</label>
          <input type="email" value={authEmail} onChange={e => setAuthEmail(e.target.value)} className="w-full border-b border-[#1A1A1A] bg-transparent pb-2 text-sm focus:outline-none focus:border-[#FF5F1F]" />
        </div>
        <div className="mb-8">
           <label className="block text-[10px] font-bold uppercase tracking-widest mb-2 opacity-50">Password</label>
           <div className="relative">
             <input type={showPassword ? "text" : "password"} value={authPassword} onChange={e => setAuthPassword(e.target.value)} className="w-full border-b border-[#1A1A1A] bg-transparent pb-2 pr-8 text-sm focus:outline-none focus:border-[#FF5F1F]" />
             <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-0 bottom-2 opacity-50 hover:opacity-100 flex items-center justify-center">
               {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
             </button>
           </div>
        </div>
        <button 
          onClick={async () => {
            if (!checkAuthLimit()) {
               setErrorObj(`Too many failed login attempts. Please try again later.`);
               return;
            }
            if (Date.now() < authLockedUntil) {
               setErrorObj(`Please wait before trying again.`);
               return;
            }
            setIsProcessing(true);
            setErrorObj(null);

            if (authMode === 'login' && !checkAuthLimit()) {
              setErrorObj("Too many failed attempts. Please try again later or reset your password.");
              setIsProcessing(false);
              return;
            }

            if (!isValidEmail(authEmail)) {
              setErrorObj("Please enter a valid email address.");
              setIsProcessing(false);
              return;
            }

            if (!isValidPassword(authPassword)) {
              setErrorObj("Password must be at least 12 characters and contain a special character.");
              setIsProcessing(false);
              return;
            }

            try {
              if (authMode === 'register') {
                const { error } = await supabase.auth.signUp({ email: authEmail, password: authPassword });
                if (error) throw error;
                setShowRegistrationEmailConfirm(true);
              } else {
                const { error } = await supabase.auth.signInWithPassword({ email: authEmail, password: authPassword });
                if (error) throw error;
              }
            } catch (err: any) {
              if (authMode === 'login') recordAuthFailure();
              if (err.message.includes('Invalid login credentials')) {
                setErrorObj("Incorrect email or password.");
              } else {
                setErrorObj(err.message);
              }
              setAuthLockedUntil(Date.now() + 3000); // 3 second rate limit on fail
            } finally {
              setIsProcessing(false);
            }
          }}
          disabled={!authEmail || !authPassword || isProcessing}
          className="w-full py-4 bg-[#FF5F1F] text-white font-bold text-[12px] uppercase tracking-widest mb-4 hover:bg-[#E04E15] disabled:opacity-50 disabled:bg-[#1A1A1A]"
        >
          {isProcessing ? <RefreshCw className="animate-spin mx-auto" size={16} /> : authMode === 'login' ? 'Authenticate' : 'Register'}
        </button>
        {errorObj && <div className="mb-4 text-xs font-mono text-red-600 bg-red-100 p-2 border border-red-600 flex flex-col justify-center items-center text-center">
            {errorObj}
            {authMode === 'login' && errorObj.includes('Incorrect') && (
              <button 
                onClick={() => setResetEmailSent(false) || setAuthMode('forgot_password')}
                className="mt-2 text-[10px] uppercase tracking-widest font-bold underline"
              >
                 Forgot Password?
              </button>
            )}
        </div>}
        <p className="text-xs text-center">
          {authMode === 'login' ? 'Need an account?' : 'Already have an account?'}
          <button 
            onClick={() => setAuthMode(authMode === 'login' ? 'register' : 'login')}
            className="ml-2 font-bold underline decoration-[#FF5F1F] underline-offset-4"
          >
            {authMode === 'login' ? 'Sign up' : 'Log in'}
          </button>
        </p>
        
        {authMode === 'login' && (
          <div className="mt-4 text-center">
            <button 
              onClick={() => {
                setErrorObj(null);
                setShowForgotPassword(true);
              }}
              className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/60 hover:text-[#FF5F1F]"
            >
              Forgot Password?
            </button>
          </div>
        )}

        {showForgotPassword && (
          <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
            <div className="bg-white p-6 max-w-sm w-full border border-[#1A1A1A] shadow-[8px_8px_0px_#1A1A1A]">
              <h3 className="text-xl font-serif italic mb-2 text-[#1A1A1A]">Reset Password</h3>
              {resetEmailSent ? (
                <>
                  <p className="text-sm opacity-80 mb-6 font-mono text-xs text-[#1A1A1A]">
                     If an account exists for {authEmail}, a password reset email has been sent.
                  </p>
                  <button 
                    onClick={() => {
                      setShowForgotPassword(false);
                      setResetEmailSent(false);
                    }}
                    className="w-full py-3 bg-[#FF5F1F] text-white font-bold text-[10px] uppercase tracking-widest hover:bg-[#E04E15]"
                  >
                    Okay
                  </button>
                </>
              ) : (
                <>
                  <p className="text-sm opacity-80 mb-4 font-mono text-xs text-[#1A1A1A]">
                     Enter your email below to receive a password reset link.
                  </p>
                  <input 
                    type="email" 
                    value={authEmail} 
                    onChange={e => setAuthEmail(e.target.value)} 
                    placeholder="name@domain.com"
                    className="w-full border-b border-[#1A1A1A] bg-transparent pb-2 text-sm focus:outline-none focus:border-[#FF5F1F] mb-6" 
                  />
                  <div className="flex gap-2">
                    <button 
                      onClick={() => setShowForgotPassword(false)}
                      className="flex-1 py-3 bg-transparent border border-[#1A1A1A] text-[#1A1A1A] font-bold text-[10px] uppercase tracking-widest hover:bg-[#1A1A1A] hover:text-white transition-colors"
                    >
                      Cancel
                    </button>
                    <button 
                      onClick={async () => {
                         if (!isValidEmail(authEmail)) {
                            setErrorObj("Please enter a valid email.");
                            return;
                         }
                         try {
                            const { error } = await supabase.auth.resetPasswordForEmail(authEmail, {
                              redirectTo: window.location.origin
                            });
                            if (error) throw error;
                            setResetEmailSent(true);
                         } catch (e: any) {
                            setErrorObj(e.message);
                         }
                      }}
                      className="flex-1 py-3 bg-[#FF5F1F] text-white font-bold text-[10px] uppercase tracking-widest hover:bg-[#E04E15] transition-colors"
                    >
                      Send Reset
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {showRegistrationEmailConfirm && (
          <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
            <div className="bg-white p-6 max-w-sm w-full border border-[#1A1A1A] shadow-[8px_8px_0px_#1A1A1A]">
              <h3 className="text-xl font-serif italic mb-2 text-[#1A1A1A]">Check Your Email</h3>
              <p className="text-sm opacity-80 mb-6 font-mono text-xs text-[#1A1A1A]">Registration successful! Please check your email to verify your account. If you cannot login from the link, please try logging in again manually after verifying.</p>
              <div className="flex flex-col gap-2">
                <button 
                  onClick={() => {
                     setShowRegistrationEmailConfirm(false);
                     setAuthMode('login');
                  }}
                  className="w-full py-3 bg-[#FF5F1F] text-white font-bold text-[10px] uppercase tracking-widest hover:bg-[#E04E15]"
                >
                  Okay
                </button>
                <button 
                  onClick={async () => {
                     try {
                       await supabase.auth.resend({ type: 'signup', email: authEmail });
                       alert('Verification email resent! (Note: Supabase limits this to a few times per hour)');
                     } catch (e: any) {
                       alert('Error resending email: ' + e.message);
                     }
                  }}
                  className="w-full py-3 bg-transparent border border-[#1A1A1A] text-[#1A1A1A] font-bold text-[10px] uppercase tracking-widest hover:bg-[#1A1A1A] hover:text-white transition-colors"
                >
                  Resend Email
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  const renderToS = () => (
    <div className="flex-1 flex items-center justify-center p-6 bg-[#1A1A1A] text-white">
      <div className="max-w-md w-full bg-[#FDFCFB] text-[#1A1A1A] p-10 border border-[#1A1A1A] shadow-[8px_8px_0px_#FF5F1F]">
        <div className="mb-6 flex justify-center">
          <AlertTriangle size={48} className="text-[#FF5F1F]" />
        </div>
        <h2 className="text-3xl font-serif italic tracking-tight mb-4 text-center">Experimental Tool</h2>
        <p className="text-sm opacity-80 leading-relaxed mb-6 font-medium">
          SureBite is an experimental tool, NOT a medical device. It relies on public APIs and AI that can hallucinate. You assume all risks.
        </p>
        <button 
          onClick={() => setView('onboarding_age')}
          className="w-full py-4 bg-[#1A1A1A] text-white font-bold text-[12px] uppercase tracking-widest hover:bg-[#FF5F1F] transition-colors"
        >
          I Understand & Agree
        </button>
      </div>
    </div>
  );

  const renderOnboardingAge = () => (
    <div className="flex-1 p-6 md:p-12 flex flex-col max-w-3xl mx-auto w-full">
      <h3 className="text-[11px] font-bold uppercase tracking-[0.15em] mb-6">01. Baseline Verification</h3>
      <h2 className="text-4xl font-serif italic mb-8">Confirm Eligibility</h2>
      <div className="flex-1">
        <label className="block text-sm font-bold uppercase tracking-widest mb-4">Date of Birth</label>
        <input 
          type="date" 
          value={profile.dob}
          onChange={(e) => setProfile({ ...profile, dob: e.target.value })}
          className="w-full border-b-2 border-[#1A1A1A] bg-transparent pb-2 text-xl focus:outline-none focus:border-[#FF5F1F] transition-colors"
        />
        <p className="mt-4 text-xs opacity-60 font-mono">Ensuring COPPA/GDPR 13+ compliance.</p>
      </div>
      <button 
        disabled={!profile.dob}
        onClick={() => setView('onboarding_allergies')}
        className="w-full py-4 mt-8 bg-[#FF5F1F] text-white font-bold text-[12px] uppercase tracking-widest hover:bg-[#E04E15] disabled:opacity-50 disabled:bg-[#1A1A1A]"
      >
        Continue
      </button>
    </div>
  );

  const renderOnboardingAllergies = () => (
    <div className="flex-1 p-6 md:p-12 flex flex-col max-w-3xl mx-auto w-full">
      <button onClick={() => setView('onboarding_age')} className="flex items-center text-[10px] uppercase font-bold tracking-widest mb-8 hover:text-[#FF5F1F] transition-colors w-fit">
        ← Back to Date of Birth
      </button>
      <h3 className="text-[11px] font-bold uppercase tracking-[0.15em] mb-6">02. Hard Flags</h3>
      <h2 className="text-4xl font-serif italic mb-8">Clinical Allergies</h2>
      <div className="flex-1">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {COMMON_ALLERGIES.map(allergy => {
            const isSelected = profile.allergies.includes(allergy);
            return (
              <button
                key={allergy}
                onClick={() => {
                  if (isSelected) {
                    setProfile({ ...profile, allergies: profile.allergies.filter(a => a !== allergy) });
                  } else {
                    setProfile({ ...profile, allergies: [...profile.allergies, allergy] });
                  }
                }}
                className={`p-4 border ${isSelected ? 'border-[#FF5F1F] bg-[#FF5F1F] text-white' : 'border-[#1A1A1A] bg-transparent'} font-bold text-sm tracking-wide transition-all`}
              >
                {allergy}
              </button>
            )
          })}
        </div>
      </div>
      <button 
        onClick={() => setView('onboarding_meals')}
        className="w-full py-4 mt-8 bg-[#FF5F1F] text-white font-bold text-[12px] uppercase tracking-widest hover:bg-[#E04E15]"
      >
        Continue
      </button>
    </div>
  );

  const renderOnboardingMeals = () => (
    <div className="flex-1 p-6 md:p-12 flex flex-col max-w-3xl mx-auto w-full">
      <button onClick={() => setView('onboarding_allergies')} className="flex items-center text-[10px] uppercase font-bold tracking-widest mb-8 hover:text-[#FF5F1F] transition-colors w-fit">
        ← Back to Allergies
      </button>
      <h3 className="text-[11px] font-bold uppercase tracking-[0.15em] mb-6">03. Safe Plates</h3>
      <h2 className="text-4xl font-serif italic mb-4">Establish Baseline</h2>
      <p className="mb-8 opacity-70 text-sm">Enter 3 complete meals you eat regularly without any negative reactions. This trains the baseline.</p>
      <div className="flex-1 space-y-8">
        {[0, 1, 2].map((index) => (
          <div key={index}>
            <label className="block text-[10px] font-bold uppercase tracking-widest mb-2 opacity-50">Meal 0{index + 1}</label>
            <input 
              type="text" 
              placeholder="e.g. Chicken rice bowl with avocado"
              value={profile.safeMeals[index] || ''}
              onChange={(e) => handleMealChange(index, e.target.value)}
              className="w-full border-b border-[#1A1A1A] bg-transparent pb-2 text-lg focus:outline-none focus:border-[#FF5F1F] transition-colors"
            />
          </div>
        ))}
      </div>
      <button 
        onClick={processSafeMeals}
        disabled={isProcessing || profile.safeMeals.some(m => m.trim() === '')}
        className="w-full py-4 mt-8 bg-[#1A1A1A] text-white font-bold text-[12px] uppercase tracking-widest flex items-center justify-center hover:bg-[#FF5F1F] disabled:opacity-50 disabled:hover:bg-[#1A1A1A]"
      >
        {isProcessing ? <RefreshCw className="animate-spin mr-2 shrink-0" size={16} /> : null}
        {isProcessing ? <RotatingLoadingText /> : 'Finalize Profile'}
      </button>
    </div>
  );

  const [scansSearchQuery, setScansSearchQuery] = useState('');
  const [scansTimeFilter, setScansTimeFilter] = useState<'all' | '7days' | '30days'>('all');

  const getEffectiveStatus = (standard_name: string, original_status: string) => {
    return profile?.ingredientOverrides?.[standard_name] || original_status;
  };

  const renderScansHistory = () => {
    const filteredHistory = history.filter(scan => {
      // Time filter
      const scanDate = new Date(scan.timestamp);
      const now = new Date();
      const diffTime = Math.abs(now.getTime() - scanDate.getTime());
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      
      let matchesTime = true;
      if (scansTimeFilter === '7days') matchesTime = diffDays <= 7;
      if (scansTimeFilter === '30days') matchesTime = diffDays <= 30;

      // Search filter (search by ingredient names or ID)
      const matchesSearch = scansSearchQuery === '' || 
        scan.id.toLowerCase().includes(scansSearchQuery.toLowerCase()) ||
        scan.results.some(r => r.standard_name.toLowerCase().includes(scansSearchQuery.toLowerCase()));

      return matchesTime && matchesSearch;
    });

    const scansLogTotalPages = Math.max(1, Math.ceil(filteredHistory.length / 8));
    const displayedScans = filteredHistory.slice((scansLogPage - 1) * 8, scansLogPage * 8);

    return (
      <div className="flex-1 flex flex-col bg-[#FDFCFB] p-6 pb-24 md:p-12 md:pb-12 max-w-4xl mx-auto w-full">
        <h2 className="text-4xl font-serif italic mb-8">Scans Log</h2>
        
        <div className="flex flex-col md:flex-row gap-4 mb-8">
           <div className="flex-1 relative">
             <Search size={16} className="absolute left-3 top-1/2 transform -translate-y-1/2 opacity-50" />
             <input 
               type="text" 
               placeholder="Search ingredients..." 
               value={scansSearchQuery}
               onChange={e => { setScansSearchQuery(e.target.value); setScansLogPage(1); }}
               className="w-full pl-10 border-b border-[#1A1A1A] bg-transparent pb-2 text-sm focus:outline-none focus:border-[#FF5F1F]"
             />
           </div>
           <select 
             value={scansTimeFilter} 
             onChange={e => { setScansTimeFilter(e.target.value as any); setScansLogPage(1); }}
             className="bg-transparent border-b border-[#1A1A1A] pb-2 text-sm focus:outline-none focus:border-[#FF5F1F]"
           >
             <option value="all">All Time</option>
             <option value="7days">Last 7 Days</option>
             <option value="30days">Last 30 Days</option>
           </select>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {displayedScans.length === 0 ? (
            <p className="opacity-40 italic font-serif text-sm col-span-full">No scans found matching filters.</p>
          ) : (
            displayedScans.map((scan) => {
              const hasRed = scan.results.some(r => getEffectiveStatus(r.standard_name, r.status) === 'red');
              const hasYellow = scan.results.some(r => getEffectiveStatus(r.standard_name, r.status) === 'yellow');
              let statusBorder = 'border-[#1A1A1A]';
              let statusBadge = 'bg-[#1A1A1A]';
              if (hasRed) { statusBorder = 'border-red-500'; statusBadge = 'bg-red-500'; }
              else if (hasYellow) { statusBorder = 'border-yellow-500'; statusBadge = 'bg-yellow-500'; }
              else { statusBorder = 'border-green-500'; statusBadge = 'bg-green-500'; }

              return (
                <div key={scan.id} className={`p-4 border border-[#1A1A1A] border-t-4 ${statusBorder} bg-white shadow-[4px_4px_0px_#1A1A1A] cursor-pointer hover:translate-y-[-2px] hover:shadow-[6px_6px_0px_#1A1A1A] transition-all flex flex-col`} onClick={() => { setCurrentScan(scan); setView('result'); setAutoAddedSafePlate(null); }}>
                  <div className="flex justify-between items-start mb-2">
                    <span className="text-[10px] font-mono opacity-60">ID: {scan.id.toUpperCase()}</span>
                    <div className={`w-2 h-2 rounded-full ${statusBadge}`}></div>
                  </div>
                  <p className="font-bold text-sm line-clamp-2 flex-1 mb-2">
                    {scan.foodName ? (
                      <>{scan.foodName} <span className="opacity-60 text-xs font-normal">({scan.results.map(r => r.standard_name).join(', ')})</span></>
                    ) : (
                      scan.results.map(r => r.standard_name).join(', ') || 'Unknown Object'
                    )}
                  </p>
                  <span className="text-[10px] opacity-60 uppercase font-mono">{new Date(scan.timestamp).toLocaleString()}</span>
                </div>
              );
            })
          )}
        </div>

        {scansLogTotalPages > 1 && (
          <div className="mt-8 flex justify-between items-center bg-[#1A1A1A] p-2 text-white shadow-[4px_4px_0px_#FF5F1F]">
            <button 
              disabled={scansLogPage === 1}
              onClick={() => setScansLogPage(p => Math.max(1, p - 1))}
              className="px-4 py-2 font-bold text-[10px] uppercase tracking-widest disabled:opacity-50 hover:bg-[#FF5F1F]"
            >
              Prev
            </button>
            <span className="font-mono text-xs">Page {scansLogPage} / {scansLogTotalPages}</span>
            <button 
              disabled={scansLogPage === scansLogTotalPages}
              onClick={() => setScansLogPage(p => Math.min(scansLogTotalPages, p + 1))}
              className="px-4 py-2 font-bold text-[10px] uppercase tracking-widest disabled:opacity-50 hover:bg-[#FF5F1F]"
            >
              Next
            </button>
          </div>
        )}
      </div>
    );
  };

  const renderDashboard = () => {
    const pendingReminders = history.filter(scan => {
      // User hasn't finished logging mood yet (null/undefined or 'deferred')
      if (scan.mood && scan.mood !== 'deferred') return false;
      
      // Only remind if there are yellow or blue flagged items 
      // (red items are unsafe so probably not eaten, green is safe)
      const hasFlags = scan.results.some(r => {
        const eff = getEffectiveStatus(r.standard_name, r.status);
        return eff === 'yellow' || eff === 'blue';
      });
      if (!hasFlags) return false;

      const diffTime = nowValue - new Date(scan.timestamp).getTime();
      return diffTime > 7200000;
    });

    return (
    <div className="flex-1 flex flex-col md:flex-row divide-y md:divide-y-0 md:divide-x divide-[#1A1A1A] relative">
      <section className="flex-1 p-6 md:p-10 flex flex-col">
        <h3 className="text-[11px] font-bold uppercase tracking-[0.15em] mb-6">Action Center</h3>
        {pendingReminders.length > 0 && (
          <div className="mb-8 p-4 border border-[#FF5F1F] bg-[#FF5F1F]/10">
            <h4 className="text-[11px] uppercase tracking-widest font-bold mb-2 flex items-center text-[#FF5F1F]">
              <AlertTriangle size={14} className="mr-2" />
              Symptom Reminders ({pendingReminders.length})
            </h4>
            <p className="text-sm mb-4">It has been over 2 hours since some of your scans. Please log your symptoms.</p>
            <div className="space-y-2">
              {pendingReminders.map(scan => (
                <button 
                  key={scan.id}
                  onClick={() => { setCurrentScan(scan); setView('result'); setAutoAddedSafePlate(null); }}
                  className="w-full text-left p-3 bg-white border border-[#1A1A1A] shadow-[2px_2px_0px_#1A1A1A] hover:translate-y-[-1px] hover:shadow-[4px_4px_0px_#1A1A1A] transition-all flex justify-between items-center"
                >
                  <span className="text-xs font-bold truncate flex-1">
                    {scan.foodName ? (
                      <>{scan.foodName} <span className="opacity-60 font-normal">({scan.results.length} items)</span></>
                    ) : (
                      scan.results.map(r => r.standard_name).join(', ') || 'Unknown Object'
                    )}
                  </span>
                  <ChevronRight size={14} className="ml-2" />
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="space-y-4 flex-1">
          <button 
            onClick={() => fileInputRef.current?.click()}
            className="w-full aspect-video border-2 border-dashed border-[#1A1A1A] flex flex-col items-center justify-center hover:bg-[#1A1A1A] hover:text-white transition-colors group"
          >
            <Camera size={48} className="mb-4 opacity-50 group-hover:opacity-100 group-hover:text-[#FF5F1F] transition-all" />
            <span className="font-serif italic text-2xl group-hover:underline decoration-[#FF5F1F] underline-offset-4">Scan Food/Label</span>
            <span className="text-[10px] uppercase tracking-widest mt-2 opacity-60">AI Mode Processing</span>
          </button>
          
          <input 
            type="file"
            accept="image/*"
            capture="environment"
            ref={fileInputRef}
            className="hidden"
            onChange={handleFileChange}
          />
          
          <button 
             onClick={() => setView('scanner')}
             className="w-full py-8 border border-[#1A1A1A] bg-[#F5F3EF] flex flex-col items-center justify-center hover:bg-[#EAE6DF] transition-colors"
          >
             <span className="font-bold uppercase tracking-widest text-xs">Manual Entry / API</span>
          </button>
        </div>
        {isProcessing && (
          <div className="mt-6 flex bg-[#1A1A1A] text-white p-4 items-center justify-center">
             <RefreshCw className="animate-spin mr-3 text-[#FF5F1F] shrink-0" size={20} />
             <span className="font-mono text-xs uppercase tracking-widest"><RotatingLoadingText /></span>
          </div>
        )}
        {errorObj && (
           <div className="mt-4 p-4 border border-red-500 text-red-700 bg-red-50 font-mono text-[10px] uppercase">
             {errorObj}
           </div>
        )}
      </section>

      <section className="w-full md:w-[360px] p-6 pb-24 md:p-10 md:pb-10 bg-[#F5F3EF] flex flex-col shrink-0">
        <h3 className="text-[11px] font-bold uppercase tracking-[0.15em] mb-6">Recent Scans</h3>
        <div className="space-y-4">
          {history.length === 0 ? (
            <p className="opacity-40 italic font-serif text-sm">No recent scans detected.</p>
          ) : (
            history.slice(0, 5).map((scan) => {
              const hasRed = scan.results.some(r => getEffectiveStatus(r.standard_name, r.status) === 'red');
              const hasYellow = scan.results.some(r => getEffectiveStatus(r.standard_name, r.status) === 'yellow');
              let statusBorder = 'border-[#1A1A1A]';
              let statusBadge = 'bg-[#1A1A1A]';
              if (hasRed) { statusBorder = 'border-red-500'; statusBadge = 'bg-red-500'; }
              else if (hasYellow) { statusBorder = 'border-yellow-500'; statusBadge = 'bg-yellow-500'; }
              else { statusBorder = 'border-green-500'; statusBadge = 'bg-green-500'; }

              return (
                <div key={scan.id} className={`p-4 border-l-4 ${statusBorder} bg-white shadow-sm cursor-pointer hover:shadow-md transition-all`} onClick={() => { setCurrentScan(scan); setView('result'); setAutoAddedSafePlate(null); }}>
                  <div className="flex justify-between items-start mb-2">
                    <span className="text-[10px] font-mono opacity-60">ID: {scan.id.toUpperCase()}</span>
                    <div className={`w-2 h-2 rounded-full ${statusBadge}`}></div>
                  </div>
                  <p className="font-bold text-sm truncate">
                    {scan.foodName ? (
                      <>{scan.foodName} <span className="opacity-60 font-normal">({scan.results.length} items)</span></>
                    ) : (
                      scan.results.map(r => r.standard_name).join(', ') || 'Unknown Object'
                    )}
                  </p>
                  <span className="text-[10px] opacity-60 uppercase">{new Date(scan.timestamp).toLocaleTimeString()}</span>
                </div>
              );
            })
          )}
        </div>
      </section>
    </div>
  );
};

  const renderResult = () => {
    if (!currentScan) return null;
    
    const reds = currentScan.results.filter(r => getEffectiveStatus(r.standard_name, r.status) === 'red');
    const yellows = currentScan.results.filter(r => getEffectiveStatus(r.standard_name, r.status) === 'yellow');
    const greens = currentScan.results.filter(r => getEffectiveStatus(r.standard_name, r.status) === 'green');
    const blues = currentScan.results.filter(r => getEffectiveStatus(r.standard_name, r.status) === 'blue');

    const isUnsafe = reds.length > 0;
    const isWarning = yellows.length > 0;

    return (
      <div className="flex-1 flex flex-col md:flex-row divide-y md:divide-y-0 md:divide-x divide-[#1A1A1A] bg-[#FDFCFB]">
        <section className="w-full md:w-1/3 p-6 md:p-10 bg-[#1A1A1A] text-white flex flex-col">
          <button onClick={() => setView('dashboard')} className="flex items-center text-[10px] uppercase font-bold tracking-widest mb-8 hover:text-[#FF5F1F] transition-colors w-fit">
            ← Back to Dashboard
          </button>
          
          <h2 className="text-5xl font-serif italic mb-4">
            {isUnsafe ? 'Unsafe' : isWarning ? 'Exercise Caution' : 'Clear'}
          </h2>

          {currentScan.foodName && (
            <h3 className="text-xl opacity-80 mb-8 border-l-2 pl-4 border-[#FF5F1F]">{currentScan.foodName}</h3>
          )}

          {currentScan.imageSrc && (
            <div className="mb-8 border border-white/20 p-2">
              <img src={currentScan.imageSrc} alt="Scanned" className="w-full h-auto object-cover opacity-80 mix-blend-screen" />
            </div>
          )}

          {/* Dish Reaction Tracker */}
          <div className="mt-auto p-6 bg-white/10 backdrop-blur border border-white/20">
            <h4 className="text-[11px] uppercase tracking-widest font-bold mb-4 flex items-center">
              <AlertTriangle size={14} className="mr-2 text-white/50" />
              Dish Reaction
            </h4>
            <p className="text-sm opacity-70 mb-4">
              Was this dish safe for you? Mark it below.
            </p>
            <div className="grid grid-cols-2 gap-2">
               <button 
                 onClick={() => setPendingConfirmSafe(currentScan)}
                 className={`flex-1 py-3 text-[10px] font-bold uppercase tracking-widest border transition-colors ${
                    currentScan.mood === 'good' ? 'bg-green-500 border-green-500 text-white' : 'border-white/30 hover:bg-white hover:text-black hover:bg-opacity-100 opacity-80'
                 }`}
               >
                 Mark as Safe
               </button>
               <button 
                 onClick={() => setPendingConfirmUnsafe(currentScan)}
                 className={`flex-1 py-3 text-[10px] font-bold uppercase tracking-widest border transition-colors ${
                    currentScan.mood === 'bad' ? 'bg-red-500 border-red-500 text-white' : 'border-white/30 hover:bg-white hover:text-black hover:bg-opacity-100 opacity-80'
                 }`}
               >
                 Mark as Unsafe
               </button>
            </div>
          </div>
        </section>

        <section className="w-full md:w-2/3 p-6 pb-24 md:p-10 md:pb-10 flex flex-col">
          <h3 className="text-[11px] font-bold uppercase tracking-[0.15em] mb-6">Assessment Breakdown</h3>
          
          <div className="space-y-6 max-w-2xl">
            {currentScan.results.map((res, i) => {
              const effStatus = getEffectiveStatus(res.standard_name, res.status);
              
              let statusBorder = 'border-[#1A1A1A]';
              let statusBadge = 'bg-[#1A1A1A]';
              if (effStatus === 'red') { statusBorder = 'border-red-500'; statusBadge = 'bg-red-500'; }
              else if (effStatus === 'yellow') { statusBorder = 'border-yellow-500'; statusBadge = 'bg-yellow-500'; }
              else if (effStatus === 'blue') { statusBorder = 'border-blue-500'; statusBadge = 'bg-blue-500'; }
              else { statusBorder = 'border-green-500'; statusBadge = 'bg-green-500'; }
              
              return (
              <div key={i} className={`p-4 border border-[#1A1A1A] border-t-4 ${statusBorder} bg-white shadow-[4px_4px_0px_#1A1A1A] hover:translate-y-[-2px] hover:shadow-[6px_6px_0px_#1A1A1A] transition-all flex flex-col md:flex-row gap-4`}>
                 <div className="md:w-1/3 text-left">
                   <div className="flex justify-between items-start">
                     <h4 className="font-bold text-sm uppercase tracking-wide">{res.standard_name}</h4>
                     <div className={`w-3 h-3 rounded-full border border-black/20 ${statusBadge}`}></div>
                   </div>
                   <span className="text-[10px] uppercase font-mono mt-1 block opacity-80">{effStatus} Classification</span>
                 </div>
                 <div className="md:w-2/3">
                   <p className="text-sm text-justify">{res.reason}</p>
                   {(effStatus === 'red' || effStatus === 'yellow') && (
                      <button
                         onClick={() => {
                            setDangerZoneFilter(effStatus);
                            setView('danger_zone');
                         }}
                         className="text-[10px] mt-2 uppercase font-bold tracking-widest px-3 py-1 bg-[#1A1A1A] text-white hover:bg-red-600 transition-colors inline-block"
                      >
                         Log Side Effects
                      </button>
                   )}
                 </div>
              </div>
            )})}
          </div>
        </section>
      </div>
    );
  };

  const handleOverride = (ingredient: string, status: 'red'|'yellow'|'blue'|'green') => {
    const newOverrides = { ...profile.ingredientOverrides, [ingredient]: status };
    
    let newAllergies = profile.allergies;
    if (status === 'red' && !newAllergies.includes(ingredient)) {
      newAllergies = [...newAllergies, ingredient];
    }
    
    const newProfile = { ...profile, ingredientOverrides: newOverrides, allergies: newAllergies };
    setProfile(newProfile);
    syncProfileToSupabase(newProfile);
  };

  // Calculate all scanned ingredients once unless history changes
  const computedAllIngredients = useMemo(() => {
    const allIngs = new Map<string, { originalStatus: string, occurences: Set<string> }>();

    history.forEach(scan => {
      const foodName = scan.foodName || scan.results.map(r => r.standard_name).join(', ') || 'Unknown Object';
      scan.results.forEach(res => {
        if (!allIngs.has(res.standard_name)) {
          allIngs.set(res.standard_name, { originalStatus: res.status, occurences: new Set([foodName]) });
        } else {
          allIngs.get(res.standard_name)!.occurences.add(foodName);
        }
      });
    });
    
    return Array.from(allIngs.entries());
  }, [history]);

  const renderIngredients = () => {
    const filtered = computedAllIngredients
      .filter(([name]) => {
         if (!name.toLowerCase().includes(ingredientsSearch.toLowerCase())) return false;
         if (ingredientsCategory !== 'All') {
            const isOther = ingredientsCategory === 'Other';
            if (isOther) {
               const matchesAny = Object.entries(BROAD_CATEGORIES).some(([cat, keywords]) => {
                  if (cat === 'All' || cat === 'Other') return false;
                  return keywords.some(k => name.toLowerCase().includes(k));
               });
               return !matchesAny;
            } else {
               const keywords = BROAD_CATEGORIES[ingredientsCategory] || [];
               return keywords.some(k => name.toLowerCase().includes(k));
            }
         }
         return true;
      })
      .sort((a, b) => a[0].localeCompare(b[0]));
      
    const ingredientsTotalPages = Math.max(1, Math.ceil(filtered.length / 8));

    return (
      <div className="flex-1 flex flex-col bg-[#FDFCFB] p-6 pb-24 md:p-12 md:pb-12 max-w-4xl mx-auto w-full">
        <div className="flex flex-col md:flex-row justify-between mb-8 gap-4">
          <h2 className="text-4xl font-serif italic">History & Ingredients</h2>
          <div className="flex flex-col sm:flex-row gap-2 shrink-0">
            <button 
              onClick={() => setView('allergies_edit')}
              className="px-6 py-3 bg-[#1A1A1A] text-white font-bold text-[10px] uppercase tracking-widest hover:bg-[#FF5F1F] flex items-center shrink-0 w-fit"
            >
              <Plus size={14} className="mr-2" /> Modify Allergies
            </button>
            <button 
              onClick={() => setView('safe_plates_edit')}
              className="px-6 py-3 bg-[#1A1A1A] text-white font-bold text-[10px] uppercase tracking-widest hover:bg-[#FF5F1F] flex items-center shrink-0 w-fit"
            >
              <Plus size={14} className="mr-2" /> Modify Safe Plates
            </button>
          </div>
        </div>

        <div className="mb-8">
          <h3 className="text-[11px] font-bold uppercase tracking-[0.15em] mb-4">Your Base Profile (Safe Plates)</h3>
          <div className="flex flex-wrap gap-2">
            {profile.safeMeals.filter(m => m.trim() !== '').length > 0 ? (
              <>
                {profile.safeMeals.filter(m => m.trim() !== '').slice(0, 10).map((meal, i) => (
                  <div key={i} className="px-3 py-1 bg-green-100 text-green-900 border border-green-500 font-bold text-xs uppercase shadow-sm">
                    {meal}
                  </div>
                ))}
                {profile.safeMeals.filter(m => m.trim() !== '').length > 10 && (
                  <button onClick={() => setView('safe_plates_edit')} className="px-3 py-1 bg-[#1A1A1A] text-white border border-[#1A1A1A] font-bold text-[10px] uppercase shadow-sm flex items-center hover:bg-[#FF5F1F] transition-colors">
                    +{profile.safeMeals.filter(m => m.trim() !== '').length - 10} more... Edit
                  </button>
                )}
              </>
            ) : <p className="text-xs opacity-50 italic font-serif">No safe plates logged yet.</p>}
          </div>

          {isSynthesizingBackground && <p className="text-xs opacity-50 italic font-serif mt-6">Synthesizing base ingredients in the background...</p>}
        </div>

        {isSynthesizingBackground ? (
          <div className="flex-1 flex flex-col items-center justify-center p-8 border border-dashed border-[#1A1A1A]">
             <RefreshCw className="animate-spin mb-4 text-[#FF5F1F]" size={32} />
             <h3 className="text-lg font-serif italic mb-2">Resynthesizing Profile...</h3>
             <p className="text-sm opacity-60 text-center max-w-sm">We are analyzing your safe plates and updating the underlying AI logic to ensure your ingredient statuses are accurate.</p>
          </div>
        ) : (
          <>
            <div className="mb-6 bg-white p-4 border border-[#1A1A1A] text-xs">
               <strong className="block mb-3 font-bold uppercase tracking-widest text-[#FF5F1F]">Danger Levels</strong>
               <p className="opacity-80 mb-4 leading-relaxed max-w-2xl">You can manually adjust the danger level of any ingredient below by clicking the color badges. This will override the AI's default classification for future scans.</p>
               <div className="flex flex-col sm:flex-row gap-4 sm:gap-6">
                  <div className="flex items-center gap-2"><div className="flex items-center justify-center w-5 h-5 bg-red-500 rounded-full border border-black/20"><ShieldAlert size={10} className="text-white font-bold" /></div> <span><strong className="font-bold">Red:</strong> Clinical Allergen</span></div>
                  <div className="flex items-center gap-2"><div className="flex items-center justify-center w-5 h-5 bg-yellow-500 rounded-full border border-black/20"><AlertTriangle size={10} className="text-white font-bold" /></div> <span><strong className="font-bold">Yellow:</strong> Sensitivity</span></div>
                  <div className="flex items-center gap-2"><div className="w-5 h-5 bg-blue-500 rounded-full border border-black/20" /> <span><strong className="font-bold">Blue:</strong> Novel/Untested</span></div>
                  <div className="flex items-center gap-2"><div className="w-5 h-5 bg-green-500 rounded-full border border-black/20" /> <span><strong className="font-bold">Green:</strong> Safe</span></div>
               </div>
            </div>

            <div className="mb-6 flex flex-col sm:flex-row gap-4">
               <div className="flex-1 bg-white border border-[#1A1A1A] p-4 flex items-center">
                 <Search size={18} className="mr-4 opacity-50" />
                 <input 
                   type="text" 
                   placeholder="Filter ingredients..." 
                   className="flex-1 bg-transparent border-none focus:outline-none text-sm font-mono"
                   value={ingredientsSearch}
                   onChange={(e) => { setIngredientsSearch(e.target.value); setIngredientsPage(1); }}
                 />
               </div>
               <select 
                 className="bg-white border border-[#1A1A1A] p-4 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-[#FF5F1F]"
                 value={ingredientsCategory}
                 onChange={(e) => { setIngredientsCategory(e.target.value); setIngredientsPage(1); }}
               >
                 {Object.keys(BROAD_CATEGORIES).map(cat => (
                   <option key={cat} value={cat}>{cat}</option>
                 ))}
               </select>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
               {filtered.length === 0 ? (
                  <p className="text-sm opacity-50 font-serif italic col-span-full">No ingredients found.</p>
               ) : (
                 <>
                  {filtered.slice((ingredientsPage - 1) * 8, ingredientsPage * 8).map(([name, data]) => {
                    const effStatus = getEffectiveStatus(name, data.originalStatus);
                    let statusBorder = 'border-[#1A1A1A]';
                    let statusBadge = 'bg-[#1A1A1A]';
                    if (effStatus === 'red') { statusBorder = 'border-red-500'; statusBadge = 'bg-red-500'; }
                    else if (effStatus === 'yellow') { statusBorder = 'border-yellow-500'; statusBadge = 'bg-yellow-500'; }
                    else if (effStatus === 'blue') { statusBorder = 'border-blue-500'; statusBadge = 'bg-blue-500'; }
                    else { statusBorder = 'border-green-500'; statusBadge = 'bg-green-500'; }

                    return (
                      <div key={name} className={`p-4 border border-[#1A1A1A] border-t-4 ${statusBorder} bg-white shadow-[4px_4px_0px_#1A1A1A] hover:translate-y-[-2px] hover:shadow-[6px_6px_0px_#1A1A1A] transition-all flex flex-col gap-4`}>
                         <div className="flex justify-between items-start">
                            <h4 className="font-bold text-sm uppercase">{name}</h4>
                            <div className={`w-3 h-3 rounded-full border border-black/20 ${statusBadge}`}></div>
                         </div>
                         <div className="flex flex-col gap-2 mt-auto pt-4 border-t border-black/10">
                            {(effStatus === 'red' || effStatus === 'yellow') && (
                               <button
                                  onClick={() => {
                                     setDangerZoneFilter(effStatus);
                                     setView('danger_zone');
                                  }}
                                  className="w-full text-center px-4 py-2 bg-[#1A1A1A] text-white border border-[#1A1A1A] text-[10px] font-bold uppercase tracking-widest hover:bg-[#FF5F1F] transition-colors"
                               >
                                  Log Side Effects
                               </button>
                            )}
                            <div className="flex justify-between items-center bg-[#F5F3EF] p-2 border border-black/10">
                               <span className="text-[8px] font-bold uppercase tracking-widest opacity-60">Override</span>
                               <div className="flex items-center gap-1">
                                  {(['red', 'yellow', 'blue', 'green'] as const).map(s => {
                                     let ringColor = 'ring-black';
                                     let bgColor = 'bg-[#1A1A1A]';
                                     if (s === 'red') bgColor = 'bg-red-500';
                                     if (s === 'yellow') bgColor = 'bg-yellow-500';
                                     if (s === 'blue') bgColor = 'bg-blue-500';
                                     if (s === 'green') bgColor = 'bg-green-500';
                                     
                                     return (
                                       <button 
                                          key={s}
                                          onClick={() => setPendingOverride({ingredient: name, status: s})}
                                          className={`w-6 h-6 rounded-full border border-black/20 flex items-center justify-center ${s === effStatus ? 'opacity-100 ring-2 ' + ringColor + ' scale-110' : 'opacity-20 hover:opacity-100'} ${bgColor}`}
                                          title={`Mark as ${s}`}
                                       >
                                          {s === effStatus && <Check size={10} className="text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.8)]" />}
                                       </button>
                                     );
                                  })}
                               </div>
                            </div>
                         </div>
                      </div>
                    )
                  })}
                 </>
               )}
            </div>
            
            {ingredientsTotalPages > 1 && (
              <div className="mt-8 flex justify-between items-center bg-[#1A1A1A] p-2 text-white shadow-[4px_4px_0px_#FF5F1F]">
                <button 
                  disabled={ingredientsPage === 1}
                  onClick={() => {
                     setIngredientsPage(p => Math.max(1, p - 1));
                     mainScrollRef.current?.scrollTo(0, 0);
                     document.querySelectorAll('.overflow-y-auto').forEach(el => el.scrollTo({ top: 0, behavior: 'smooth' }));
                  }}
                  className="px-4 py-2 font-bold text-[10px] uppercase tracking-widest disabled:opacity-50 hover:bg-[#FF5F1F]"
                >
                  Prev
                </button>
                <span className="font-mono text-xs">Page {ingredientsPage} / {ingredientsTotalPages}</span>
                <button 
                  disabled={ingredientsPage === ingredientsTotalPages}
                  onClick={() => {
                     setIngredientsPage(p => Math.min(ingredientsTotalPages, p + 1));
                     mainScrollRef.current?.scrollTo(0, 0);
                     document.querySelectorAll('.overflow-y-auto').forEach(el => el.scrollTo({ top: 0, behavior: 'smooth' }));
                  }}
                  className="px-4 py-2 font-bold text-[10px] uppercase tracking-widest disabled:opacity-50 hover:bg-[#FF5F1F]"
                >
                  Next
                </button>
              </div>
            )}
          </>
        )}
      </div>
    );
  };

  // Calculate danger ingredients once unless history or profile changes
  const computedDangers = React.useMemo(() => {
    const allIngs = new Map<string, { originalStatus: string, occurences: Set<string> }>();
    
    // Add explicitly configured clinical allergies
    profile.allergies.forEach(allergy => {
       allIngs.set(allergy, { originalStatus: 'red', occurences: new Set(['User Profile']) });
    });

    // Add base ingredients
    profile.baseIngredients.forEach(ing => {
       allIngs.set(ing, { originalStatus: 'green', occurences: new Set(['Safe Plates Baseline']) });
    });

    history.forEach(scan => {
      const foodName = scan.foodName || scan.results.map(r => r.standard_name).join(', ') || 'Unknown Object';
      scan.results.forEach(res => {
        if (!allIngs.has(res.standard_name)) {
          allIngs.set(res.standard_name, { originalStatus: res.status, occurences: new Set([foodName]) });
        } else {
          allIngs.get(res.standard_name)!.occurences.add(foodName);
        }
      });
    });

    return Array.from(allIngs.entries())
      .map(([name, data]) => {
         const effStatus = getEffectiveStatus(name, data.originalStatus);
         return { name, data, effStatus };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [history, profile.allergies, profile.baseIngredients, profile.ingredientOverrides]);

  const renderDangerZone = () => {
    // Filter only red/yellow based on effective status
    const dangers = computedDangers
      .filter(({ effStatus }) => {
         if (dangerZoneFilter === 'all') {
            return effStatus === 'red' || effStatus === 'yellow' || effStatus === 'blue';
         }
         return effStatus === dangerZoneFilter;
      });
      
    const dangerTotalPages = Math.max(1, Math.ceil(dangers.length / 5));

    return (
       <div className="flex-1 flex flex-col bg-[#FDFCFB] p-6 pb-24 md:p-12 md:pb-12 max-w-4xl mx-auto w-full">
         <h2 className="text-4xl font-serif italic text-red-600 mb-2">Danger Zone</h2>
         <p className="text-sm opacity-70 mb-6 max-w-2xl">This is a consolidated list of your red (clinical allergens), yellow (sensitivities), and blue (novel) ingredients based on your history and overrides. You can log specific side effects for each to track your reactions.</p>
         
         <div className="flex gap-2 mb-8 overflow-x-auto pb-2 shrink-0">
            {(['all', 'red', 'yellow', 'blue'] as const).map(filter => (
               <button
                  key={filter}
                  onClick={() => {
                     setDangerZoneFilter(filter);
                     setDangerZonePage(1);
                  }}
                  className={`px-6 py-2 text-[10px] font-bold uppercase tracking-widest border border-[#1A1A1A] transition-colors ${dangerZoneFilter === filter ? 'bg-[#1A1A1A] text-white' : 'bg-transparent text-[#1A1A1A] hover:bg-gray-100'}`}
               >
                  {filter}
               </button>
            ))}
         </div>

         <div className="space-y-6">
            {dangers.length === 0 ? (
               <p className="text-sm opacity-50 font-serif italic">No dangerous ingredients found yet.</p>
            ) : (
               <>
               {dangers.slice((dangerZonePage - 1) * 5, dangerZonePage * 5).map(({ name, data, effStatus }) => {
                 const sideEffects = profile.allergenSideEffects[name] || [];
                 const currentInput = sideEffectInputs[name] || '';
                 
                 let statusBorder = 'border-[#1A1A1A]';
                 let statusBadge = 'bg-[#1A1A1A]';
                 if (effStatus === 'red') { statusBorder = 'border-red-500'; statusBadge = 'bg-red-500'; }
                 else if (effStatus === 'yellow') { statusBorder = 'border-yellow-500'; statusBadge = 'bg-yellow-500'; }
                 else if (effStatus === 'blue') { statusBorder = 'border-blue-500'; statusBadge = 'bg-blue-500'; }
                 else { statusBorder = 'border-green-500'; statusBadge = 'bg-green-500'; }

                 return (
                   <div key={name} className={`p-4 md:p-6 border border-[#1A1A1A] border-t-4 ${statusBorder} bg-white shadow-[4px_4px_0px_#1A1A1A] flex flex-col gap-4 transition-all`}>
                      <div className="flex items-center gap-3 border-b border-black/10 pb-4">
                         {effStatus === 'red' ? <ShieldAlert size={20} className="text-red-500" /> : <AlertTriangle size={20} className="text-yellow-500" />}
                         <div className="flex-1 flex justify-between items-center">
                           <h4 className="font-bold text-lg uppercase tracking-wider">{name}</h4>
                           <div className={`w-3 h-3 rounded-full border border-black/20 ${statusBadge}`}></div>
                         </div>
                      </div>

                      <div className="pt-2">
                        <label className="block text-xs font-bold uppercase tracking-widest opacity-60 mb-3">Logged Side Effects</label>
                        <div className="flex flex-col gap-2 mb-4">
                           {sideEffects.length > 0 ? sideEffects.map((se, i) => (
                             <div key={i} className="flex items-center justify-between bg-[#F5F3EF] p-2 border border-[#1A1A1A] text-sm">
                                <span>{se}</span>
                                <button 
                                  onClick={() => {
                                    const newProfile = {...profile, allergenSideEffects: {...profile.allergenSideEffects, [name]: sideEffects.filter((_, idx) => idx !== i)}};
                                    setProfile(newProfile);
                                    syncProfileToSupabase(newProfile);
                                  }}
                                  className="text-[#1A1A1A] hover:text-red-500 p-1 transition-colors"
                                >&times;</button>
                             </div>
                           )) : (
                             <p className="text-[10px] italic font-serif opacity-50">No side effects logged.</p>
                           )}
                        </div>

                        <div className="flex gap-2">
                           <input 
                             type="text"
                             value={currentInput}
                             onChange={e => setSideEffectInputs(prev => ({...prev, [name]: e.target.value}))}
                             onKeyDown={e => {
                               if (e.key === 'Enter' && currentInput.trim()) {
                                 const newProfile = {...profile, allergenSideEffects: {...profile.allergenSideEffects, [name]: [...sideEffects, currentInput.trim()]}};
                                 setProfile(newProfile);
                                 syncProfileToSupabase(newProfile);
                                 setSideEffectInputs(prev => ({...prev, [name]: ''}));
                               }
                             }}
                             placeholder="E.g. Nausea, Rash..."
                             className="flex-1 bg-transparent border-b border-black/20 focus:border-[#FF5F1F] focus:outline-none text-sm pb-1"
                           />
                           <button
                             onClick={() => {
                               if (currentInput.trim()) {
                                 const newProfile = {...profile, allergenSideEffects: {...profile.allergenSideEffects, [name]: [...sideEffects, currentInput.trim()]}};
                                 setProfile(newProfile);
                                 syncProfileToSupabase(newProfile);
                                 setSideEffectInputs(prev => ({...prev, [name]: ''}));
                               }
                             }}
                             className="px-4 py-1 bg-[#1A1A1A] text-white hover:bg-[#FF5F1F] border border-[#1A1A1A] text-[10px] uppercase font-bold tracking-widest transition-colors"
                           >
                              Add
                           </button>
                        </div>
                      </div>
                   </div>
                 );
               })}
               
               {dangerTotalPages > 1 && (
                 <div className="mt-8 flex justify-between items-center bg-[#1A1A1A] p-2 text-white shadow-[4px_4px_0px_#FF5F1F]">
                   <button 
                     disabled={dangerZonePage === 1}
                     onClick={() => {
                        setDangerZonePage(p => Math.max(1, p - 1));
                     window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                  className="px-4 py-2 font-bold text-[10px] uppercase tracking-widest disabled:opacity-50 hover:bg-[#FF5F1F] transition-colors"
                >
                  Prev
                </button>
                <span className="font-mono text-xs">Page {dangerZonePage} / {dangerTotalPages}</span>
                <button 
                  disabled={dangerZonePage === dangerTotalPages}
                  onClick={() => {
                     setDangerZonePage(p => Math.min(dangerTotalPages, p + 1));
                     window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                     className="px-4 py-2 font-bold text-[10px] uppercase tracking-widest disabled:opacity-50 hover:bg-[#FF5F1F] transition-colors"
                   >
                     Next
                   </button>
                 </div>
               )}
               </>
            )}
         </div>
       </div>
    );
  };

  const renderSafePlatesEdit = () => {
     return (
       <>
       <div className="flex-1 p-6 pb-24 md:p-12 md:pb-12 max-w-3xl mx-auto w-full flex flex-col">
          <button onClick={() => setView('ingredients')} className="flex items-center text-[10px] uppercase font-bold tracking-widest mb-8 hover:text-[#FF5F1F] transition-colors w-fit">
              ← Back to Ingredients
          </button>
          <h2 className="text-4xl font-serif italic mb-8">Safe Plates</h2>
          <div className="space-y-4 flex-1">
            {profile.safeMeals.map((meal, index) => (
              <div key={index} className="flex gap-4">
                <input 
                  type="text" 
                  placeholder={`Meal 0${index + 1}`}
                  value={meal}
                  onChange={(e) => handleMealChange(index, e.target.value)}
                  className="flex-1 border-b border-[#1A1A1A] bg-transparent pb-2 text-md focus:outline-none focus:border-[#FF5F1F] transition-colors"
                />
              </div>
            ))}
            <button 
              onClick={() => setProfile({...profile, safeMeals: ['', ...profile.safeMeals]})}
              className="py-2 px-4 border border-[#1A1A1A] text-[10px] uppercase font-bold tracking-widest hover:bg-[#1A1A1A] hover:text-white transition-colors"
            >
              + Add Meal
            </button>
          </div>
          <button 
              onClick={() => setShowSafePlatesConfirm(true)}
              disabled={isProcessing}
              className="w-full py-4 mt-8 bg-[#FF5F1F] text-white font-bold text-[12px] uppercase tracking-widest flex items-center justify-center hover:bg-[#E04E15] disabled:opacity-50"
            >
              {isProcessing ? <RefreshCw className="animate-spin mr-2" size={16} /> : null}
              {isProcessing ? <RotatingLoadingText /> : 'Save and Synthesize'}
          </button>
       </div>

       {showSafePlatesConfirm && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-white p-6 max-w-sm w-full border border-[#1A1A1A] shadow-[8px_8px_0px_#1A1A1A]">
            <h3 className="text-xl font-serif italic mb-2">Confirm Synthesis</h3>
            <p className="text-sm opacity-80 mb-6 font-mono text-xs">Save and generate safe baseline ingredients? This may take a moment.</p>
            <div className="flex gap-4">
              <button 
                onClick={() => setShowSafePlatesConfirm(false)}
                disabled={isProcessing}
                className="flex-1 py-3 bg-[#1A1A1A] text-white font-bold text-[10px] uppercase tracking-widest hover:opacity-80 disabled:opacity-50"
              >
                Cancel
              </button>
              <button 
                onClick={() => {
                   setShowSafePlatesConfirm(false);
                   processSafeMeals('ingredients');
                }}
                disabled={isProcessing}
                className="flex-1 py-3 bg-[#FF5F1F] text-white font-bold text-[10px] uppercase tracking-widest hover:bg-[#E04E15] disabled:opacity-50 flex justify-center items-center"
              >
                {isProcessing ? <RefreshCw className="animate-spin" size={14} /> : 'Synthesize'}
              </button>
            </div>
          </div>
        </div>
       )}
       </>
     )
  }

  const renderAllergiesEdit = () => {
    return (
       <div className="flex-1 p-6 pb-24 md:p-12 md:pb-12 max-w-3xl mx-auto w-full flex flex-col">
          <button onClick={() => setView('ingredients')} className="flex items-center text-[10px] uppercase font-bold tracking-widest mb-8 hover:text-[#FF5F1F] transition-colors w-fit">
              ← Back to Ingredients
          </button>
          <h2 className="text-4xl font-serif italic mb-8">Allergies</h2>
          <div className="space-y-4 flex-1">
             <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  {COMMON_ALLERGIES.map(allergy => {
                    const isSelected = profile.allergies.includes(allergy);
                    return (
                      <button
                        key={allergy}
                        onClick={() => {
                          if (isSelected) {
                            setProfile({ ...profile, allergies: profile.allergies.filter(a => a !== allergy) });
                          } else {
                            setProfile({ ...profile, allergies: [...profile.allergies, allergy] });
                          }
                        }}
                        className={`p-3 border ${isSelected ? 'border-[#FF5F1F] bg-[#FF5F1F] text-white' : 'border-[#1A1A1A] bg-transparent'} font-bold text-xs tracking-wide transition-all`}
                      >
                        {allergy}
                      </button>
                    )
                  })}
             </div>
             
             <div className="mt-8 border-t border-[#1A1A1A] pt-8">
               <h3 className="block text-sm font-bold uppercase tracking-widest mb-4">Custom Allergies</h3>
               <p className="text-xs opacity-70 mb-4 font-mono">Add less common allergies or specific ingredient avoidances here.</p>
               <div className="flex gap-2">
                  <input 
                    type="text" 
                    value={customAllergyInput} 
                    onChange={e => setCustomAllergyInput(e.target.value)} 
                    onKeyDown={e => {
                       if (e.key === 'Enter' && customAllergyInput.trim()) {
                          if (!profile.allergies.includes(customAllergyInput.trim())) {
                             setProfile(prev => ({...prev, allergies: [...prev.allergies, customAllergyInput.trim()]}));
                          }
                          setCustomAllergyInput('');
                       }
                    }}
                    placeholder="e.g. Kiwi" 
                    className="flex-1 bg-transparent border-b-2 border-[#1A1A1A] focus:outline-none focus:border-[#FF5F1F] pb-2 text-md transition-colors" 
                  />
                  <button 
                    onClick={() => {
                       if (customAllergyInput.trim() && !profile.allergies.includes(customAllergyInput.trim())) {
                          setProfile(prev => ({...prev, allergies: [...prev.allergies, customAllergyInput.trim()]}));
                          setCustomAllergyInput('');
                       }
                    }} 
                    className="px-6 py-2 bg-[#1A1A1A] text-white text-xs uppercase font-bold tracking-widest hover:bg-[#FF5F1F] transition-colors"
                  >
                     Add
                  </button>
               </div>
               <div className="flex flex-wrap gap-2 mt-6">
                  {profile.allergies.filter(a => !COMMON_ALLERGIES.includes(a)).map(a => (
                     <span key={a} className="px-3 py-2 bg-gray-100 text-[#1A1A1A] border border-[#1A1A1A] font-bold text-xs flex items-center gap-2">
                       {a}
                       <button 
                         onClick={() => setProfile(prev => ({...prev, allergies: prev.allergies.filter(al => al !== a)}))}
                         className="hover:text-red-500 font-serif ml-2 opacity-60 hover:opacity-100"
                       >&times;</button>
                     </span>
                  ))}
               </div>
             </div>
          </div>
          <button 
              onClick={() => setShowAllergiesConfirm(true)}
              className="w-full py-4 mt-8 bg-[#FF5F1F] text-white font-bold text-[12px] uppercase tracking-widest flex items-center justify-center hover:bg-[#E04E15]"
            >
              Save
          </button>
          <button 
              onClick={() => setView('allergy_side_effects')}
              className="w-full py-4 mt-4 bg-transparent border border-[#FF5F1F] text-[#FF5F1F] font-bold text-[12px] uppercase tracking-widest flex items-center justify-center hover:bg-[#FF5F1F] hover:text-white transition-colors"
          >
              Manage Side Effects for Allergies
          </button>

          {showAllergiesConfirm && (
             <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
               <div className="bg-white p-6 max-w-sm w-full border border-[#1A1A1A] shadow-[8px_8px_0px_#1A1A1A]">
                 <h3 className="text-xl font-serif italic mb-2 text-[#1A1A1A]">Confirm Action</h3>
                 <p className="text-sm opacity-80 mb-6 font-mono text-xs text-[#1A1A1A]">Save updated allergies?</p>
                 <div className="flex gap-4">
                   <button 
                     onClick={() => setShowAllergiesConfirm(false)}
                     className="flex-1 py-3 bg-[#1A1A1A] text-white font-bold text-[10px] uppercase tracking-widest hover:opacity-80 disabled:opacity-50"
                   >
                     Cancel
                   </button>
                   <button 
                     onClick={() => {
                        setShowAllergiesConfirm(false);
                        syncProfileToSupabase(profile);
                        setView('ingredients');
                     }}
                     className="flex-1 py-3 bg-[#FF5F1F] text-white font-bold text-[10px] uppercase tracking-widest hover:bg-[#E04E15] disabled:opacity-50"
                   >
                     Yes, Save
                   </button>
                 </div>
               </div>
             </div>
          )}
       </div>
    );
  }

  const renderAllergySideEffects = () => {
    return (
       <div className="flex-1 p-6 pb-24 md:p-12 md:pb-12 max-w-4xl mx-auto w-full flex flex-col bg-[#FDFCFB]">
          <button onClick={() => setView('allergies_edit')} className="flex items-center text-[10px] uppercase font-bold tracking-widest mb-8 hover:text-[#FF5F1F] transition-colors w-fit">
              ← Back to Allergies
          </button>
          <h2 className="text-4xl font-serif italic text-red-600 mb-2">Allergy Side Effects</h2>
          <p className="text-sm opacity-70 mb-8 max-w-2xl">Log specific side effects for your configured clinical allergies to keep track of your reactions and general dangers.</p>
          
          <div className="space-y-6">
            {profile.allergies.length === 0 ? (
               <p className="text-sm opacity-50 font-serif italic">No clinical allergies configured yet.</p>
            ) : (
               profile.allergies.map(allergy => {
                 const sideEffects = profile.allergenSideEffects[allergy] || [];
                 const currentInput = sideEffectInputs[allergy] || '';

                 return (
                   <div key={allergy} className={`p-4 md:p-6 border border-[#1A1A1A] border-t-4 border-red-500 bg-white shadow-[4px_4px_0px_#1A1A1A] flex flex-col gap-4 transition-all`}>
                      <div className="flex items-center gap-3 border-b border-black/10 pb-4">
                         <ShieldAlert size={20} className="text-red-500" />
                         <div className="flex-1 flex justify-between items-center">
                           <h4 className="font-bold text-lg uppercase tracking-wider">{allergy}</h4>
                           <div className="w-3 h-3 rounded-full border border-black/20 bg-red-500"></div>
                         </div>
                      </div>

                      <div className="pt-2">
                        <label className="block text-xs font-bold uppercase tracking-widest opacity-60 mb-3">General Dangers & Side Effects</label>
                        <div className="flex flex-col gap-2 mb-4">
                           {sideEffects.length > 0 ? sideEffects.map((se, i) => (
                             <div key={i} className="flex items-center justify-between bg-[#F5F3EF] p-2 border border-[#1A1A1A] text-sm">
                                <span>{se}</span>
                                <button 
                                  onClick={() => {
                                    const newProfile = {...profile, allergenSideEffects: {...profile.allergenSideEffects, [allergy]: sideEffects.filter((_, idx) => idx !== i)}};
                                    setProfile(newProfile);
                                    syncProfileToSupabase(newProfile);
                                  }}
                                  className="text-[#1A1A1A] hover:text-red-500 p-1 transition-colors"
                                >&times;</button>
                             </div>
                           )) : (
                             <p className="text-[10px] italic font-serif opacity-50">No side effects logged.</p>
                           )}
                        </div>

                        <div className="flex gap-2">
                           <input 
                             type="text"
                             value={currentInput}
                             onChange={e => setSideEffectInputs(prev => ({...prev, [allergy]: e.target.value}))}
                             onKeyDown={e => {
                               if (e.key === 'Enter' && currentInput.trim()) {
                                 const newProfile = {...profile, allergenSideEffects: {...profile.allergenSideEffects, [allergy]: [...sideEffects, currentInput.trim()]}};
                                 setProfile(newProfile);
                                 syncProfileToSupabase(newProfile);
                                 setSideEffectInputs(prev => ({...prev, [allergy]: ''}));
                               }
                             }}
                             placeholder="E.g. Anaphylaxis, Hives..."
                             className="flex-1 bg-transparent border-b border-red-300 focus:border-red-600 focus:outline-none text-sm pb-1 text-red-900 placeholder:text-red-300"
                           />
                           <button
                             onClick={() => {
                               if (currentInput.trim()) {
                                 const newProfile = {...profile, allergenSideEffects: {...profile.allergenSideEffects, [allergy]: [...sideEffects, currentInput.trim()]}};
                                 setProfile(newProfile);
                                 syncProfileToSupabase(newProfile);
                                 setSideEffectInputs(prev => ({...prev, [allergy]: ''}));
                               }
                             }}
                             className="px-4 py-1 bg-white hover:bg-red-600 hover:text-white border border-red-300 text-[10px] uppercase font-bold tracking-widest transition-colors text-red-700"
                           >
                             Add
                           </button>
                        </div>
                      </div>
                   </div>
                 );
               })
            )}
          </div>
       </div>
    );
  };

  const handleChatSend = async () => {
     if (!chatInput.trim()) return;
     const newChatList = [...chatMessages, { role: 'user' as const, parts: [{ text: chatInput }] }];
     syncChat(newChatList);
     setChatInput('');
     setIsProcessing(true);
     try {
       const context = {
         allergies: profile.allergies,
         safeMeals: profile.safeMeals,
         allergenSideEffects: profile.allergenSideEffects,
         recentScans: history.slice(0, 5).map(s => s.results.map(r => r.standard_name).join(', '))
       };
       const resp = await chatWithAssistant(newChatList, context);
       syncChat([...newChatList, { role: 'model', parts: [{ text: resp }] }]);
     } catch(e) {
       console.error(e);
     } finally {
       setIsProcessing(false);
     }
  };

  const renderChat = () => {
    return (
      <div className="flex-1 flex flex-col p-6 pb-24 md:p-6 items-center justify-center w-full bg-[#F5F3EF] min-h-0">
        <div className="w-full max-w-md aspect-[9/16] md:aspect-[3/4] max-h-[85vh] bg-white border border-[#1A1A1A] shadow-[8px_8px_0px_#1A1A1A] flex flex-col min-h-0 shrink-0 relative overflow-hidden">
          <div className="p-4 border-b border-[#1A1A1A] flex items-center justify-between bg-[#FDFCFB] shrink-0">
            <h2 className="text-xl font-serif italic">SureChat</h2>
          </div>
          <div className="flex-1 p-6 flex flex-col gap-4 bg-[#FDFCFB] min-h-0 overflow-y-auto">
             {chatMessages.length === 0 && (
                <div className="my-auto text-center opacity-50 font-serif italic">
                   Ask me about ingredients, allergies, or your safe plates!
                </div>
             )}
             {chatMessages.map((msg, i) => (
               <div key={i} className={`max-w-[85%] p-4 ${msg.role === 'user' ? 'bg-[#1A1A1A] text-white self-end' : 'bg-transparent border border-[#1A1A1A] self-start'}`}>
                  {msg.role === 'user' ? (
                     <p className="text-sm leading-relaxed">{msg.parts[0].text}</p>
                  ) : (
                     <div className="markdown-style text-sm leading-relaxed">
                        <Markdown>{msg.parts[0].text}</Markdown>
                     </div>
                  )}
               </div>
             ))}
             {isProcessing && (
               <div className="max-w-[80%] p-3 bg-transparent border border-[#1A1A1A] self-start flex items-center">
                  <RefreshCw size={14} className="animate-spin mr-2 shrink-0" />
                  <span className="text-[10px] uppercase tracking-widest"><RotatingLoadingText /></span>
               </div>
             )}
             <div ref={chatEndRef} className="shrink-0" />
          </div>
          <div className="flex bg-white border-t border-[#1A1A1A] p-2 shrink-0">
             <input 
               ref={chatInputRef}
               type="text" 
               value={chatInput}
               onChange={e => setChatInput(e.target.value)}
               onKeyDown={e => e.key === 'Enter' && handleChatSend()}
               placeholder="Type your question..."
               className="flex-1 px-3 text-sm focus:outline-none"
             />
             <button 
               onClick={handleChatSend}
               disabled={isProcessing}
               className="p-3 bg-[#FF5F1F] text-white hover:bg-[#E04E15] disabled:opacity-50 ml-2 shadow-[2px_2px_0px_#1A1A1A] border border-[#1A1A1A]"
             >
                <Send size={16} />
             </button>
          </div>
          <div className="bg-[#FDFCFB] p-2 text-center border-t border-[#1A1A1A] shrink-0">
             <button 
                onClick={() => {
                  syncChat([]);
                }}
                className="text-[10px] uppercase font-bold tracking-widest text-red-600 opacity-60 hover:opacity-100 transition-opacity"
             >
                Clear Chat History
             </button>
          </div>
        </div>
      </div>
    );
  }

  if (isInitializing) {
    return (
      <div className="w-full h-full bg-[#FDFCFB] text-[#1A1A1A] font-sans flex flex-col items-center justify-center">
        <RefreshCw className="animate-spin mb-4 text-[#FF5F1F]" size={48} />
        <h2 className="text-xl font-serif italic mb-2">Connecting to Secure Systems</h2>
        <span className="font-mono text-xs uppercase tracking-widest bg-[#1A1A1A] text-white px-4 py-2 opacity-80 animate-pulse">Please wait...</span>
      </div>
    );
  }

  return (
    <div className="w-full min-h-screen bg-[#FDFCFB] text-[#1A1A1A] font-sans flex flex-col select-none relative">
      <header className="flex items-end justify-between px-6 pt-8 pb-4 border-b border-[#1A1A1A] shrink-0">
        <div className="flex flex-col">
          <span className="text-[10px] font-bold tracking-[0.2em] uppercase mb-1 opacity-60">Be sure of your bites.</span>
          <h1 className="text-4xl font-serif italic tracking-tight leading-none text-[#FF5F1F]">SureBite</h1>
        </div>
        <div className="flex flex-col items-end">
          <div className="flex items-center gap-4 mb-2">
            <div className="w-8 h-8 bg-[#1A1A1A] rounded-full flex items-center justify-center text-white shadow-[2px_2px_0px_#FF5F1F]">
              <ShieldAlert size={14} />
            </div>
          </div>
          <span className="text-[9px] font-mono uppercase tracking-widest border border-[#1A1A1A] px-1 py-0.5 shadow-[1px_1px_0px_#1A1A1A]">Active</span>
        </div>
      </header>

      <div className="flex-1 flex flex-col md:flex-row relative">
        {(view !== 'tos' && view !== 'auth') && (
          <nav className="fixed bottom-0 left-0 md:static md:sticky md:top-0 md:h-screen border-t md:border-t-0 md:border-b-0 md:border-r border-[#1A1A1A] flex flex-row md:flex-col items-center py-3 md:py-6 gap-2 md:gap-8 shrink-0 md:w-20 overflow-hidden px-2 md:px-0 bg-[#F5F3EF] z-40 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)] md:shadow-none justify-around md:justify-start w-full order-last md:order-first">
            <button className={`flex flex-col items-center gap-1 min-w-[44px] ${view === 'dashboard' ? 'text-[#FF5F1F]' : 'opacity-40 hover:opacity-100'} transition-all`} onClick={() => setView('dashboard')}>
              <LayoutDashboard size={20} className="hover:scale-110 transition-transform" />
              <span className="text-[7px] font-bold tracking-widest uppercase mt-1">Dash</span>
            </button>
            <button className={`flex flex-col items-center gap-1 min-w-[44px] ${['ingredients', 'safe_plates_edit', 'allergies_edit'].includes(view) ? 'text-[#FF5F1F]' : 'opacity-40 hover:opacity-100'} transition-all`} onClick={() => setView('ingredients')}>
              <List size={20} className="hover:scale-110 transition-transform" />
              <span className="text-[7px] font-bold tracking-widest uppercase mt-1">History</span>
            </button>
            <button className={`flex flex-col items-center gap-1 min-w-[44px] ${view === 'scans_history' ? 'text-[#FF5F1F]' : 'opacity-40 hover:opacity-100'} transition-all`} onClick={() => setView('scans_history')}>
              <Search size={20} className="hover:scale-110 transition-transform" />
              <span className="text-[7px] font-bold tracking-widest uppercase mt-1">Scans</span>
            </button>
            <button className={`flex flex-col items-center gap-1 min-w-[44px] ${view === 'danger_zone' ? 'text-red-600' : 'opacity-40 hover:opacity-100'} transition-all`} onClick={() => setView('danger_zone')}>
              <AlertTriangle size={20} className="hover:scale-110 transition-transform" />
              <span className="text-[7px] font-bold tracking-widest uppercase mt-1">Danger</span>
            </button>
            <button className={`flex flex-col items-center gap-1 min-w-[44px] ${view === 'chat' ? 'text-[#FF5F1F]' : 'opacity-40 hover:opacity-100'} transition-all`} onClick={() => setView('chat')}>
               <MessageSquare size={20} className="hover:scale-110 transition-transform" />
               <span className="text-[7px] font-bold tracking-widest uppercase mt-1">Chat</span>
            </button>
            <div className="flex-1 hidden md:block" />
            <button className={`flex flex-col items-center gap-1 min-w-[44px] ${view === 'settings' ? 'text-[#FF5F1F]' : 'opacity-40 hover:opacity-100'} transition-all mb-0 md:mb-4`} onClick={() => setView('settings')}>
              <Settings size={20} className="hover:scale-110 transition-transform" />
              <span className="text-[7px] font-bold tracking-widest uppercase mt-1">Settings</span>
            </button>
          </nav>
        )}
        
        <main className="flex-1 flex flex-col min-w-0 relative">
          {(isProcessing || isSynthesizingBackground) && view !== 'result' && view !== 'chat' && view !== 'auth' && view !== 'tos' && view !== 'onboarding_age' && view !== 'onboarding_allergies' && view !== 'onboarding_meals' && (
            <div className="absolute inset-0 z-50 bg-white/90 backdrop-blur-sm flex flex-col items-center justify-center pointer-events-auto border-4 border-[#FF5F1F]">
              <RefreshCw className="animate-spin mb-4 text-[#FF5F1F]" size={48} />
              <h2 className="text-xl font-serif italic mb-2">Synthesizing Data</h2>
              <span className="font-mono text-xs uppercase tracking-widest bg-[#1A1A1A] text-white px-4 py-2 opacity-80"><RotatingLoadingText /></span>
            </div>
          )}
          {view === 'auth' && renderAuth()}
          {view === 'tos' && renderToS()}
          {view === 'onboarding_age' && renderOnboardingAge()}
          {view === 'onboarding_allergies' && renderOnboardingAllergies()}
          {view === 'onboarding_meals' && renderOnboardingMeals()}
          {view === 'dashboard' && renderDashboard()}
          {view === 'result' && renderResult()}
          {view === 'ingredients' && renderIngredients()}
          {view === 'danger_zone' && renderDangerZone()}
          {view === 'allergy_side_effects' && renderAllergySideEffects()}
          {view === 'safe_plates_edit' && renderSafePlatesEdit()}
          {view === 'allergies_edit' && renderAllergiesEdit()}
          {view === 'chat' && renderChat()}
          {view === 'scans_history' && renderScansHistory()}
          {view === 'settings' && (
            <div className="flex-1 p-6 pb-24 md:p-12 md:pb-12 flex flex-col max-w-3xl mx-auto w-full min-h-0">
            <button onClick={() => setView('dashboard')} className="flex items-center text-[10px] uppercase font-bold tracking-widest mb-8 hover:text-[#FF5F1F] transition-colors w-fit bg-[#1A1A1A] text-white px-4 py-2 hover:translate-y-[-1px] shadow-[2px_2px_0px_#1A1A1A] hover:shadow-[4px_4px_0px_#1A1A1A]">
              ← Dashboard
            </button>
            <h3 className="text-[11px] font-bold uppercase tracking-[0.15em] mb-6">Profile Configuration</h3>
            <h2 className="text-4xl font-serif italic mb-8">Settings</h2>
            
            <div className="space-y-8 flex-1">
              {/* DOB */}
              <div className="bg-white p-4 border border-[#1A1A1A] shadow-[2px_2px_0px_#1A1A1A]">
                <label className="block text-sm font-bold uppercase tracking-widest mb-4">Date of Birth</label>
                <input 
                  type="date" 
                  value={profile.dob}
                  onChange={(e) => setProfile({ ...profile, dob: e.target.value })}
                  className="w-full border-b-2 border-[#1A1A1A] bg-transparent pb-2 text-xl focus:outline-none focus:border-[#FF5F1F] transition-colors"
                />
              </div>

              {/* Allergies */}
              <div className="bg-white p-4 border border-[#1A1A1A] shadow-[2px_2px_0px_#1A1A1A]">
                <label className="block text-sm font-bold uppercase tracking-widest mb-4">Clinical Allergies</label>
                <div className="flex flex-wrap gap-2 mb-4">
                  {profile.allergies.length > 0 ? profile.allergies.map((allergy, i) => (
                    <span key={i} className="px-3 py-1 bg-[#1A1A1A] text-white font-bold text-xs tracking-wide">
                      {allergy}
                    </span>
                  )) : <span className="opacity-50 text-sm font-serif italic">No allergies configured</span>}
                </div>
                <button 
                  onClick={() => setView('allergies_edit')}
                  className="w-full flex items-center justify-between p-3 border border-[#1A1A1A] bg-[#FDFCFB] text-[10px] uppercase font-bold tracking-widest hover:bg-[#1A1A1A] hover:text-white active:bg-[#1A1A1A] active:text-white transition-colors"
                >
                  <span className="flex items-center gap-2">Configure Allergies</span>
                  <ChevronRight size={14} className="opacity-50" />
                </button>
              </div>

              {/* Meals */}
              <div className="bg-white p-4 border border-[#1A1A1A] shadow-[2px_2px_0px_#1A1A1A]">
                <label className="block text-sm font-bold uppercase tracking-widest mb-4">Safe Plates</label>
                <div className="space-y-2 mb-4">
                  {profile.safeMeals.filter(m => m.trim() !== '').length > 0 ? profile.safeMeals.filter(m => m.trim() !== '').map((meal, index) => (
                    <div key={index} className="flex gap-2">
                       <span className="opacity-50 font-mono text-xs mt-1">0{index + 1}</span>
                       <span className="font-bold text-sm tracking-wide">{meal}</span>
                    </div>
                  )) : <span className="opacity-50 text-sm font-serif italic">No safe plates configured</span>}
                </div>
                <button 
                  onClick={() => setView('safe_plates_edit')}
                  className="w-full flex items-center justify-between p-3 border border-[#1A1A1A] bg-[#FDFCFB] text-[10px] uppercase font-bold tracking-widest hover:bg-[#1A1A1A] hover:text-white active:bg-[#1A1A1A] active:text-white transition-colors"
                >
                  <span className="flex items-center gap-2">Configure Safe Plates</span>
                  <ChevronRight size={14} className="opacity-50" />
                </button>
              </div>
            </div>

            <button 
              onClick={saveSettings}
              disabled={isProcessing}
              className="w-full py-4 mt-8 bg-[#1A1A1A] text-white font-bold text-[12px] uppercase tracking-widest flex items-center justify-center hover:bg-[#FF5F1F] disabled:opacity-50 disabled:hover:bg-[#1A1A1A]"
            >
              {isProcessing ? <RefreshCw className="animate-spin mr-2" size={16} /> : null}
              {isProcessing ? 'Saving Configuration...' : 'Save Settings'}
            </button>
            <div className="mt-12 flex flex-col gap-4 pb-12 border-t border-[#1A1A1A] pt-8">
              <h3 className="text-[11px] font-bold uppercase tracking-[0.15em] mb-2 opacity-60 px-1">Account Actions</h3>
              <button 
                onClick={() => setShowTutorialConfirm(true)}
                className="w-full flex items-center justify-between p-4 border border-[#1A1A1A] bg-white text-[10px] md:text-[12px] font-bold uppercase tracking-widest text-[#1A1A1A] active:bg-[#1A1A1A] active:text-white transition-colors shadow-[2px_2px_0px_#1A1A1A] hover:translate-y-[-1px] hover:shadow-[4px_4px_0px_#1A1A1A]"
                title="Replay Onboarding Tutorial"
              >
                <span className="flex items-center gap-3"><RefreshCw size={18} /> Replay Tutorial</span>
                <ChevronRight size={16} className="opacity-50" />
              </button>
              <button 
                onClick={() => setShowChangePasswordConfirm(true)}
                className="w-full flex items-center justify-between p-4 border border-[#1A1A1A] bg-white text-[10px] md:text-[12px] font-bold uppercase tracking-widest text-[#1A1A1A] active:bg-[#1A1A1A] active:text-white transition-colors shadow-[2px_2px_0px_#1A1A1A] hover:translate-y-[-1px] hover:shadow-[4px_4px_0px_#1A1A1A]"
                title="Change Password"
              >
                <span className="flex items-center gap-3"><Lock size={18} /> Change Password</span>
                <ChevronRight size={16} className="opacity-50" />
              </button>
              <button 
                onClick={() => setShowLogoutConfirm(true)}
                className="w-full flex items-center justify-between p-4 border border-[#1A1A1A] bg-white text-[10px] md:text-[12px] font-bold uppercase tracking-widest text-[#1A1A1A] active:bg-[#1A1A1A] active:text-white transition-colors shadow-[2px_2px_0px_#1A1A1A] hover:translate-y-[-1px] hover:shadow-[4px_4px_0px_#1A1A1A]"
                title="Logout"
              >
                <span className="flex items-center gap-3"><LogOut size={18} /> Logout</span>
                <ChevronRight size={16} className="opacity-50" />
              </button>
              <button 
                onClick={() => setShowDeleteAccountConfirm(true)}
                className="w-full flex items-center justify-between p-4 border border-red-600 bg-red-50 text-[10px] md:text-[12px] font-bold uppercase tracking-widest text-red-600 active:bg-red-600 active:text-white transition-colors shadow-[2px_2px_0px_#DC2626] hover:translate-y-[-1px] hover:shadow-[4px_4px_0px_#DC2626] mt-4"
                title="Delete Account"
              >
                <span className="flex items-center gap-3"><AlertTriangle size={18} /> Delete Account</span>
                <ChevronRight size={16} className="opacity-50" />
              </button>
            </div>
          </div>
        )}
        
        {view === 'settings' && showTutorialConfirm && (
          <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
            <div className="bg-white p-6 max-w-sm w-full border border-[#1A1A1A] shadow-[8px_8px_0px_#1A1A1A]">
              <h3 className="text-xl font-serif italic mb-2 text-[#1A1A1A]">Replay Tutorial</h3>
              <p className="text-sm opacity-80 mb-6 font-mono text-xs text-[#1A1A1A]">Would you like to repeat the onboarding tutorial to learn how to use SureBite?</p>
              <div className="flex gap-4">
                <button 
                  onClick={() => setShowTutorialConfirm(false)}
                  className="flex-1 py-3 bg-transparent border border-[#1A1A1A] text-[#1A1A1A] font-bold text-[10px] uppercase tracking-widest hover:bg-[#1A1A1A] hover:text-white"
                >
                  Cancel
                </button>
                <button 
                  onClick={() => {
                     setShowTutorialConfirm(false);
                     setView('dashboard');
                     setTutorialStep(1);
                  }}
                  className="flex-1 py-3 bg-[#FF5F1F] text-white font-bold text-[10px] uppercase tracking-widest hover:bg-[#E04E15]"
                >
                  Start
                </button>
              </div>
            </div>
          </div>
        )}

        {view === 'settings' && showChangePasswordConfirm && (
          <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
            <div className="bg-white p-6 max-w-sm w-full border border-[#1A1A1A] shadow-[8px_8px_0px_#1A1A1A]">
              <h3 className="text-xl font-serif italic mb-2 text-[#1A1A1A]">Change Password</h3>
              <p className="text-sm opacity-80 mb-4 font-mono text-xs text-[#1A1A1A]">Update your password. You need your current password to proceed.</p>
              
              <div className="space-y-3 mb-6">
                 <div>
                    <label className="text-[10px] font-bold uppercase tracking-widest opacity-60">Old Password</label>
                    <div className="relative">
                       <input 
                         type={showChangePasswordOld ? "text" : "password"} 
                         value={changePasswordOld}
                         onChange={(e) => setChangePasswordOld(e.target.value)}
                         className="w-full bg-white border border-[#1A1A1A] p-3 text-sm focus:outline-none focus:ring-1 focus:ring-[#FF5F1F]"
                      />
                      <button 
                        type="button"
                        onClick={() => setShowChangePasswordOld(!showChangePasswordOld)}
                        className="absolute right-3 top-3 opacity-40 hover:opacity-100"
                      >
                         {showChangePasswordOld ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                 </div>
                 
                 <div>
                    <label className="text-[10px] font-bold uppercase tracking-widest opacity-60">New Password</label>
                    <div className="relative">
                       <input 
                         type={showChangePasswordNew ? "text" : "password"} 
                         value={changePasswordNew}
                         onChange={(e) => setChangePasswordNew(e.target.value)}
                         className="w-full bg-white border border-[#1A1A1A] p-3 text-sm focus:outline-none focus:ring-1 focus:ring-[#FF5F1F]"
                      />
                      <button 
                        type="button"
                        onClick={() => setShowChangePasswordNew(!showChangePasswordNew)}
                        className="absolute right-3 top-3 opacity-40 hover:opacity-100"
                      >
                         {showChangePasswordNew ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                 </div>
                 
                 <div>
                    <label className="text-[10px] font-bold uppercase tracking-widest opacity-60">Confirm New Password</label>
                    <div className="relative">
                       <input 
                         type={showChangePasswordNew ? "text" : "password"} 
                         value={changePasswordNewConfirm}
                         onChange={(e) => setChangePasswordNewConfirm(e.target.value)}
                         className="w-full bg-white border border-[#1A1A1A] p-3 text-sm focus:outline-none focus:ring-1 focus:ring-[#FF5F1F]"
                      />
                    </div>
                 </div>
              </div>
              
              <div className="flex gap-4">
                <button 
                  onClick={() => {
                     setShowChangePasswordConfirm(false);
                     setChangePasswordOld('');
                     setChangePasswordNew('');
                     setChangePasswordNewConfirm('');
                  }}
                  className="flex-1 py-3 bg-transparent border border-[#1A1A1A] text-[#1A1A1A] font-bold text-[10px] uppercase tracking-widest hover:bg-[#1A1A1A] hover:text-white"
                >
                  Cancel
                </button>
                <button 
                  onClick={async () => {
                     setIsProcessing(true);
                     if (changePasswordNew !== changePasswordNewConfirm) {
                       alert("New passwords do not match.");
                       setIsProcessing(false);
                       return;
                     }
                     if (changePasswordNew.length < 12) {
                       alert("Password must be at least 12 characters.");
                       setIsProcessing(false);
                       return;
                     }
                     try {
                        const { error: signInError } = await supabase.auth.signInWithPassword({ email: user?.email || '', password: changePasswordOld });
                        if (signInError) {
                          alert("Incorrect old password.");
                          setIsProcessing(false);
                          return;
                        }
                        const { error: updateError } = await supabase.auth.updateUser({ password: changePasswordNew });
                        if (updateError) throw updateError;
                        
                        alert("Password successfully updated.");
                        setShowChangePasswordConfirm(false);
                        setChangePasswordOld('');
                        setChangePasswordNew('');
                        setChangePasswordNewConfirm('');
                     } catch (e: any) {
                        alert(e.message || "Failed to update password");
                     } finally {
                        setIsProcessing(false);
                     }
                  }}
                  disabled={isProcessing}
                  className="flex-1 py-3 bg-[#FF5F1F] text-white font-bold text-[10px] uppercase tracking-widest hover:bg-[#E04E15] disabled:opacity-50"
                >
                  {isProcessing ? 'Updating...' : 'Update'}
                </button>
              </div>
              
              <button 
                onClick={() => {
                   setShowChangePasswordConfirm(false);
                   setShowResetPasswordConfirm(true);
                }}
                className="mt-4 text-[10px] uppercase tracking-widest font-bold underline text-[#FF5F1F] hover:text-[#E04E15]"
              >
                 Forgot Password?
              </button>
            </div>
          </div>
        )}

        {view === 'settings' && showResetPasswordConfirm && (
          <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
            <div className="bg-white p-6 max-w-sm w-full border border-[#1A1A1A] shadow-[8px_8px_0px_#1A1A1A]">
              <h3 className="text-xl font-serif italic mb-2 text-[#1A1A1A]">Reset Password</h3>
              <p className="text-sm opacity-80 mb-6 font-mono text-xs text-[#1A1A1A]">Do you want to send a password reset link via {user?.email}?</p>
              <div className="flex gap-4">
                <button 
                  onClick={() => setShowResetPasswordConfirm(false)}
                  className="flex-1 py-3 bg-transparent border border-[#1A1A1A] text-[#1A1A1A] font-bold text-[10px] uppercase tracking-widest hover:bg-[#1A1A1A] hover:text-white disabled:opacity-50"
                  disabled={isProcessing}
                >
                  No
                </button>
                <button 
                  onClick={async () => {
                     setIsProcessing(true);
                     try {
                        const { error } = await supabase.auth.resetPasswordForEmail(user?.email || '');
                        if (error) throw error;
                        alert("Reset link sent!");
                        setShowResetPasswordConfirm(false);
                     } catch (err: any) {
                        alert(err.message || "Failed to send reset link");
                     } finally {
                        setIsProcessing(false);
                     }
                  }}
                  className="flex-1 py-3 bg-[#FF5F1F] text-white font-bold text-[10px] uppercase tracking-widest hover:bg-[#E04E15] disabled:opacity-50"
                  disabled={isProcessing}
                >
                  {isProcessing ? 'Sending...' : 'Yes'}
                </button>
              </div>
            </div>
          </div>
        )}

        {view === 'settings' && showLogoutConfirm && (
          <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
            <div className="bg-white p-6 max-w-sm w-full border border-[#1A1A1A] shadow-[8px_8px_0px_#1A1A1A]">
              <h3 className="text-xl font-serif italic mb-2 text-[#1A1A1A]">Confirm Logout</h3>
              <p className="text-sm opacity-80 mb-6 font-mono text-xs text-[#1A1A1A]">Are you sure you want to log out?</p>
              <div className="flex gap-4">
                <button 
                  onClick={() => setShowLogoutConfirm(false)}
                  className="flex-1 py-3 bg-transparent border border-[#1A1A1A] text-[#1A1A1A] font-bold text-[10px] uppercase tracking-widest hover:bg-[#1A1A1A] hover:text-white"
                >
                  Cancel
                </button>
                <button 
                  onClick={() => {
                    setShowLogoutConfirm(false);
                    supabase.auth.signOut();
                  }}
                  className="flex-1 py-3 bg-[#FF5F1F] text-white font-bold text-[10px] uppercase tracking-widest hover:bg-[#E04E15]"
                >
                  Logout
                </button>
              </div>
            </div>
          </div>
        )}

        {view === 'settings' && showDeleteAccountConfirm && (
          <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
            <div className="bg-white p-6 max-w-sm w-full border border-red-600 shadow-[8px_8px_0px_#DC2626]">
              <h3 className="text-xl font-serif italic mb-2 text-red-600">Delete Account</h3>
              <p className="text-sm opacity-80 mb-6 font-mono text-xs text-[#1A1A1A]">Are you absolutely sure? This action cannot be undone and will delete all your settings, scans history, and chat logs.</p>
              <div className="flex gap-4">
                <button 
                  onClick={() => setShowDeleteAccountConfirm(false)}
                  className="flex-1 py-3 bg-[#1A1A1A] text-white font-bold text-[10px] uppercase tracking-widest hover:opacity-80"
                >
                  Cancel
                </button>
                <button 
                  onClick={async () => {
                    try {
                      setIsProcessing(true);
                      const { data: { session } } = await supabase.auth.getSession();
                      if (session?.user?.id) {
                         // As we don't have Edge functions set up, deleting a user fully often requires admin API.
                         // For AI Studio prototype, we'll clear data and sign out.
                         await supabase.from('chat_history').delete().eq('user_id', session.user.id);
                         await supabase.from('scan_history').delete().eq('user_id', session.user.id);
                         await supabase.from('user_profiles').delete().eq('id', session.user.id);
                         await supabase.auth.signOut();
                      }
                      setShowDeleteAccountConfirm(false);
                      setIsProcessing(false);
                    } catch (e) {
                      console.error(e);
                      setIsProcessing(false);
                    }
                  }}
                  className="flex-1 py-3 bg-red-600 text-white font-bold text-[10px] uppercase tracking-widest hover:bg-red-700 disabled:opacity-50"
                  disabled={isProcessing}
                >
                  {isProcessing ? 'Deleting...' : 'Delete Forever'}
                </button>
              </div>
            </div>
          </div>
        )}
        {view === 'scanner' && (
          <div className="flex-1 p-10 flex flex-col items-center justify-center">
             <div className="max-w-md w-full border border-[#1A1A1A] p-10 bg-white">
               <h3 className="font-serif italic text-2xl mb-4 text-center">Open Food Facts API</h3>
               <p className="text-center text-sm mb-6 opacity-70">Simulation of a fallback search view. In the mobile app, this searches via text directly.</p>
               <input 
                 type="text" 
                 placeholder="Search product (e.g., Oreos) or ingredients"
                 value={manualInput}
                 onChange={(e) => setManualInput(e.target.value)}
                 onKeyDown={(e) => e.key === 'Enter' && handleManualSearch()}
                 className="w-full border p-3 border-[#1A1A1A] mb-4 text-sm font-mono focus:outline-none focus:border-[#FF5F1F]" 
               />
               <button 
                 onClick={handleManualSearch} 
                 disabled={isProcessing}
                 className="w-full py-3 mb-2 bg-[#FF5F1F] text-white font-bold text-xs uppercase tracking-widest hover:bg-[#E04E15] flex items-center justify-center disabled:opacity-50"
               >
                 {isProcessing ? <RefreshCw className="animate-spin mr-2 shrink-0" size={14} /> : <Search size={14} className="mr-2" />}
                 {isProcessing ? <RotatingLoadingText /> : 'Analyze'}
               </button>
               <button onClick={() => setView('dashboard')} className="w-full py-3 bg-[#1A1A1A] text-white font-bold text-xs uppercase tracking-widest hover:opacity-80">Cancel</button>
               {errorObj && (
                 <div className="mt-4 p-2 border border-red-500 text-red-700 bg-red-50 font-mono text-[10px] uppercase text-center">
                   {errorObj}
                 </div>
               )}
             </div>
          </div>
        )}

            {pendingOverride && (
              <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
                 <div className="bg-white border-2 border-[#1A1A1A] p-6 max-w-sm w-full shadow-[8px_8px_0px_#1A1A1A]">
                    <h3 className="font-serif italic text-xl mb-4">Confirm Override</h3>
                    <p className="text-sm mb-6 opacity-80 leading-relaxed">
                       Are you sure you want to manually classify <strong>{pendingOverride.ingredient}</strong> as <strong className="uppercase">{pendingOverride.status}</strong>? This changes how it's flagged across the application.
                    </p>
                    <div className="flex gap-4">
                       <button 
                         onClick={() => setPendingOverride(null)}
                         className="flex-1 py-3 text-xs font-bold uppercase tracking-widest border border-[#1A1A1A] hover:bg-[#1A1A1A] hover:text-white transition-colors"
                       >
                         Cancel
                       </button>
                       <button 
                         onClick={() => {
                            handleOverride(pendingOverride.ingredient, pendingOverride.status);
                            setPendingOverride(null);
                         }}
                         className="flex-1 py-3 text-xs font-bold uppercase tracking-widest bg-[#FF5F1F] text-white hover:bg-[#E04E15] transition-colors"
                       >
                         Confirm
                       </button>
                    </div>
                 </div>
              </div>
            )}

            {pendingAutoSafePlateDialog && (
              <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
                 <div className="bg-white border-2 border-[#1A1A1A] p-6 max-w-sm w-full shadow-[8px_8px_0px_#1A1A1A]">
                    <h3 className="font-serif italic text-xl mb-2 flex items-center text-green-600">
                      <Check size={20} className="mr-2" /> Safe Plate
                    </h3>
                    <p className="text-sm mb-6 opacity-80 leading-relaxed">
                       What name would you like to give this dish to remember it as a Safe Plate?
                    </p>
                    <input 
                      type="text"
                      className="w-full mb-6 py-2 bg-transparent border-b border-gray-400 focus:border-[#FF5F1F] focus:outline-none placeholder-gray-400"
                      value={pendingAutoSafePlateDialog.defaultName}
                      onChange={(e) => setPendingAutoSafePlateDialog({ defaultName: e.target.value })}
                      autoFocus
                    />
                    <div className="flex gap-4">
                       <button 
                         onClick={() => setPendingAutoSafePlateDialog(null)}
                         className="flex-1 py-3 text-xs font-bold uppercase tracking-widest border border-[#1A1A1A] hover:bg-[#1A1A1A] hover:text-white transition-colors"
                       >
                         Skip
                       </button>
                       <button 
                         onClick={() => {
                            const name = pendingAutoSafePlateDialog.defaultName.trim() || 'Scanned Safe Meal';
                            
                            // Remove any old reference to the scan's existing foodName if any
                            let newSafeMeals = profile.safeMeals.filter(m => m.trim() !== '');
                            if (currentScan?.foodName && currentScan.foodName !== name) {
                               newSafeMeals = newSafeMeals.filter(m => m !== currentScan.foodName);
                            }
                            // Add the new name
                            if (!newSafeMeals.includes(name)) {
                               newSafeMeals = [name, ...newSafeMeals];
                            }
                            
                            const updatedProfile = { ...profile, safeMeals: newSafeMeals };
                            setProfile(updatedProfile);
                            syncProfileToSupabase(updatedProfile);
                            setAutoAddedSafePlate({ original: name, current: name });
                            
                            if (currentScan) {
                               const updatedScan = { ...currentScan, foodName: name };
                               setCurrentScan(updatedScan);
                               const updatedHistory = history.map(s => s.id === updatedScan.id ? updatedScan : s);
                               syncHistory(updatedHistory);
                            }
                            
                            setPendingAutoSafePlateDialog(null);
                         }}
                         className="flex-1 py-3 text-xs font-bold uppercase tracking-widest bg-[#FF5F1F] text-white hover:bg-[#E04E15] transition-colors"
                       >
                         Save
                       </button>
                    </div>
                 </div>
              </div>
            )}

            {pendingConfirmSafe && (
              <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
                 <div className="bg-white border-2 border-[#1A1A1A] p-6 max-w-sm w-full shadow-[8px_8px_0px_#1A1A1A]">
                    <h3 className="font-serif italic text-xl mb-4 text-green-600 flex items-center"><Check size={20} className="mr-2"/> Confirm Mark Safe</h3>
                    <p className="text-sm mb-6 opacity-80 leading-relaxed">
                       Are you sure you want to mark <strong>{pendingConfirmSafe.foodName || 'this dish'}</strong> as safe? This will add all its ingredients to your Safe Plates!
                    </p>
                    <div className="flex gap-4">
                       <button 
                         onClick={() => setPendingConfirmSafe(null)}
                         className="flex-1 py-3 text-xs font-bold uppercase tracking-widest border border-[#1A1A1A] hover:bg-[#1A1A1A] hover:text-white transition-colors"
                       >
                         Cancel
                       </button>
                       <button 
                         onClick={() => {
                            const updatedScan = { ...pendingConfirmSafe, mood: 'good' as const };
                            setCurrentScan(updatedScan);
                            const updatedHistory = history.map(s => s.id === pendingConfirmSafe.id ? updatedScan : s);
                            setHistory(updatedHistory);
                            syncHistory(updatedHistory);
                            
                            const newOverrides = { ...profile.ingredientOverrides };
                            pendingConfirmSafe.results.forEach(r => {
                              newOverrides[r.standard_name] = 'green';
                            });
                            const newProfile = { ...profile, ingredientOverrides: newOverrides };
                            setProfile(newProfile);
                            syncProfileToSupabase(newProfile);
                            
                            const defaultName = pendingConfirmSafe.foodName || "Scanned Item";
                            if (!profile.safeMeals.includes(defaultName)) {
                              setPendingAutoSafePlateDialog({ defaultName });
                            }
                            setPendingConfirmSafe(null);
                         }}
                         className="flex-1 py-3 text-xs font-bold uppercase tracking-widest bg-green-500 text-white hover:bg-green-600 transition-colors"
                       >
                         Confirm
                       </button>
                    </div>
                 </div>
              </div>
            )}

            {pendingConfirmUnsafe && (
              <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
                 <div className="bg-white border-2 border-[#1A1A1A] p-6 max-w-sm w-full shadow-[8px_8px_0px_#1A1A1A]">
                    <h3 className="font-serif italic text-xl mb-4 text-red-600 flex items-center"><AlertTriangle size={20} className="mr-2"/> Confirm Mark Unsafe</h3>
                    <p className="text-sm mb-6 opacity-80 leading-relaxed">
                       Are you sure this dish caused a reaction? <strong>{pendingConfirmUnsafe.foodName || 'This dish'}</strong> will be removed from your Safe Plates, and you'll be able to select which ingredients caused it.
                    </p>
                    <div className="flex gap-4">
                       <button 
                         onClick={() => setPendingConfirmUnsafe(null)}
                         className="flex-1 py-3 text-xs font-bold uppercase tracking-widest border border-[#1A1A1A] hover:bg-[#1A1A1A] hover:text-white transition-colors"
                       >
                         Cancel
                       </button>
                       <button 
                         onClick={() => {
                            const updatedScan = { ...pendingConfirmUnsafe, mood: 'bad' as const };
                            setCurrentScan(updatedScan);
                            const updatedHistory = history.map(s => s.id === pendingConfirmUnsafe.id ? updatedScan : s);
                            setHistory(updatedHistory);
                            syncHistory(updatedHistory);
                            
                            if (pendingConfirmUnsafe.foodName && profile.safeMeals.includes(pendingConfirmUnsafe.foodName)) {
                              const newSafeMeals = profile.safeMeals.filter(m => m !== pendingConfirmUnsafe.foodName);
                              const newProfile = { ...profile, safeMeals: newSafeMeals };
                              setProfile(newProfile);
                              syncProfileToSupabase(newProfile);
                            }
                            
                            setPendingUnsafeIngredientsDialog(pendingConfirmUnsafe);
                            setSelectedUnsafeIngredients([]);
                            setPendingConfirmUnsafe(null);
                         }}
                         className="flex-1 py-3 text-xs font-bold uppercase tracking-widest bg-red-500 text-white hover:bg-red-600 transition-colors"
                       >
                         Confirm
                       </button>
                    </div>
                 </div>
              </div>
            )}

            {pendingUnsafeIngredientsDialog && (
              <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
                 <div className="bg-white border-2 border-[#1A1A1A] p-6 max-w-md w-full shadow-[8px_8px_0px_#1A1A1A] text-black max-h-[80vh] flex flex-col">
                    <h3 className="font-serif italic text-xl mb-2 flex items-center text-red-600">
                      <AlertTriangle size={20} className="mr-2" /> Mark Unsafe Ingredients
                    </h3>
                    <p className="text-sm mb-4 opacity-80 leading-relaxed">
                       Which ingredients do you feel made it not safe? We've hidden ingredients you've already established as safe in your Safe Plates. 
                       <br/><br/>
                       <span className="italic">If you aren't sure which one caused it, you can select all of them, or ask the AI chat for help!</span>
                    </p>
                    <div className="flex justify-end mb-2">
                      <button 
                         className="text-[10px] uppercase tracking-widest font-bold text-[#FF5F1F] hover:underline"
                         onClick={() => {
                           const available = pendingUnsafeIngredientsDialog.results
                             .filter(r => !profile.baseIngredients.includes(r.standard_name.toLowerCase()) && !profile.safeMeals.includes(r.standard_name))
                             .map(r => r.standard_name);
                           setSelectedUnsafeIngredients(available);
                         }}
                      >
                         Select All Listed
                      </button>
                    </div>
                    <div className="flex-1 overflow-y-auto min-h-0 border border-gray-200 mb-6 p-2">
                       {pendingUnsafeIngredientsDialog.results
                         .filter(r => !profile.baseIngredients.includes(r.standard_name.toLowerCase()) && !profile.safeMeals.includes(r.standard_name))
                         .map(r => (
                           <label key={r.standard_name} className="flex items-center gap-3 p-3 hover:bg-gray-50 border-b border-gray-100 last:border-b-0 cursor-pointer">
                             <input 
                               type="checkbox" 
                               className="w-4 h-4 accent-[#FF5F1F]"
                               checked={selectedUnsafeIngredients.includes(r.standard_name)}
                               onChange={(e) => {
                                 if (e.target.checked) {
                                   setSelectedUnsafeIngredients([...selectedUnsafeIngredients, r.standard_name]);
                                 } else {
                                   setSelectedUnsafeIngredients(selectedUnsafeIngredients.filter(ing => ing !== r.standard_name));
                                 }
                               }}
                             />
                             <span className="text-sm font-bold uppercase">{r.standard_name}</span>
                           </label>
                         ))}
                       {pendingUnsafeIngredientsDialog.results.filter(r => !profile.baseIngredients.includes(r.standard_name.toLowerCase()) && !profile.safeMeals.includes(r.standard_name)).length === 0 && (
                          <div className="p-4 text-center text-sm opacity-50 italic font-serif">
                            All ingredients in this scan are currently in your Safe Plates base profile.
                          </div>
                       )}
                    </div>
                    <div className="flex gap-4 shrink-0 mt-auto">
                       <button 
                         onClick={() => setPendingUnsafeIngredientsDialog(null)}
                         className="flex-1 py-3 text-xs font-bold uppercase tracking-widest border border-[#1A1A1A] hover:bg-[#1A1A1A] hover:text-white transition-colors"
                       >
                         Cancel
                       </button>
                       <button 
                         onClick={() => {
                            const newOverrides = { ...profile.ingredientOverrides };
                            let newAllergies = [...profile.allergies];
                            
                            selectedUnsafeIngredients.forEach(ing => {
                              newOverrides[ing] = 'red';
                              if (!newAllergies.includes(ing)) {
                                newAllergies.push(ing);
                              }
                            });
                            
                            // Remove from safe plates if any
                            let newSafeMeals = profile.safeMeals.filter(m => m.trim() !== '');
                            if (currentScan?.foodName) {
                               newSafeMeals = newSafeMeals.filter(m => m !== currentScan.foodName);
                            }
                            
                            const newProfile = { ...profile, ingredientOverrides: newOverrides, safeMeals: newSafeMeals, allergies: newAllergies };
                            setProfile(newProfile);
                            syncProfileToSupabase(newProfile);
                            setPendingUnsafeIngredientsDialog(null);
                         }}
                         className="flex-1 py-3 text-xs font-bold uppercase tracking-widest bg-[#FF5F1F] text-white hover:bg-[#E04E15] transition-colors"
                       >
                         Save Flags
                       </button>
                    </div>
                 </div>
              </div>
            )}
            
        {tutorialStep > 0 && (
           <div className="fixed inset-0 z-[100] bg-black/40 pointer-events-none flex flex-col items-center p-4">
              <div 
                className={`bg-white border-2 pointer-events-auto border-[#1A1A1A] shadow-[8px_8px_0px_#1A1A1A] p-6 max-w-sm w-full absolute transition-all duration-500 ease-in-out ${
                  tutorialStep === 3 ? 'bottom-24' : tutorialStep === 4 ? 'top-24' : 'top-1/4'
                }`}
              >
                 {tutorialStep === 1 && (
                   <>
                     <h3 className="text-xl font-serif italic mb-4">Welcome to SureBite</h3>
                     <p className="text-sm opacity-80 mb-6">This is your dashboard. Here you will see your scan history and current status. Let's show you how to use the app.</p>
                   </>
                 )}
                 {tutorialStep === 2 && (
                   <>
                     <h3 className="text-xl font-serif italic mb-4">Scans Log & Danger Levels</h3>
                     <p className="text-sm opacity-80 mb-6">Each item in your scan history is marked by a danger level. <span className="text-red-500 font-bold">Red</span> is dangerous (severe allergies), <span className="text-yellow-500 font-bold">Yellow</span> means proceed with caution, and <span className="text-green-500 font-bold">Green</span> is safe.</p>
                   </>
                 )}
                 {tutorialStep === 3 && (
                   <>
                     <h3 className="text-xl font-serif italic mb-4">Scanning Food</h3>
                     <p className="text-sm opacity-80 mb-6">Use the large '+' button just below this box to quickly scan ingredients with your camera or search them by text.</p>
                   </>
                 )}
                 {tutorialStep === 4 && (
                   <>
                     <h3 className="text-xl font-serif italic mb-4">Safe Plates</h3>
                     <p className="text-sm opacity-80 mb-6">Here on the Ingredients page, you can edit your custom baseline diet and ingredients! This trains the AI on what you safely eat.</p>
                   </>
                 )}
                 {tutorialStep === 5 && (
                   <>
                     <h3 className="text-xl font-serif italic mb-4">AI Chat</h3>
                     <p className="text-sm opacity-80 mb-6">The AI Chat remembers your allergies and safe plates. Ask it anything about your food risk profile here!</p>
                   </>
                 )}
                 <div className="flex justify-between items-center mt-6">
                   <div className="flex gap-1">
                     {[1,2,3,4,5].map(s => (
                       <div key={s} className={`w-2 h-2 rounded-full transition-colors ${tutorialStep === s ? 'bg-[#FF5F1F]' : 'bg-gray-300'}`} />
                     ))}
                   </div>
                   <div className="flex gap-3 items-center">
                     {tutorialStep < 5 ? (
                       <>
                         <button onClick={() => { setTutorialStep(0); setView('dashboard'); }} className="text-[10px] uppercase font-bold tracking-widest opacity-50 hover:opacity-100 p-2">Skip</button>
                         <button onClick={() => { 
                            const nextStep = tutorialStep + 1;
                            setTutorialStep(nextStep); 
                            if (nextStep === 3) setView('dashboard'); // Scanning
                            if (nextStep === 4) setView('ingredients');
                            if (nextStep === 5) setView('chat');
                         }} className="px-4 py-3 bg-[#1A1A1A] text-white text-[10px] uppercase font-bold tracking-widest hover:bg-[#FF5F1F]">Next ➝</button>
                       </>
                     ) : (
                       <button onClick={() => { setTutorialStep(0); setView('dashboard'); }} className="px-6 py-3 bg-[#FF5F1F] text-white text-[10px] uppercase font-bold tracking-widest hover:bg-[#E04E15]">Get Started</button>
                     )}
                   </div>
                 </div>
              </div>
           </div>
        )}
      </main>
      </div>

      {(view !== 'tos' && view !== 'auth') && (
        <footer className="h-12 border-t border-[#1A1A1A] flex items-center px-6 justify-between bg-white shrink-0 mb-[72px] md:mb-0">
          <div className="flex gap-4 md:gap-8 text-[9px] font-bold tracking-widest uppercase items-center">
            <span className="hidden md:inline">SureBite System</span>
            <span className="flex items-center"><div className="w-2 h-2 bg-green-500 rounded-full mr-2"></div>Zero-Budget Stack</span>
          </div>
          <div className="text-[9px] font-mono">
            BUILD // EXPO-EAS
          </div>
        </footer>
      )}
    </div>
  );
}
