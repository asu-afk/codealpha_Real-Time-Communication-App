import React, { useState } from "react";
import { 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signInAnonymously,
  updateProfile,
  signInWithPopup,
  GoogleAuthProvider
} from "firebase/auth";
import { doc, setDoc } from "firebase/firestore";
import { auth, db } from "../lib/firebase";
import { Shield, Key, Mail, User, Radio, Sparkles, LogIn } from "lucide-react";

interface AuthScreenProps {
  onAuthSuccess: () => void;
}

export default function AuthScreen({ onAuthSuccess }: AuthScreenProps) {
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setErrorMsg("");

    try {
      if (isSignUp) {
        if (!displayName.trim()) {
          throw new Error("Please enter a display name.");
        }
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;
        
        await updateProfile(user, { displayName });
        
        // Save profile in Firestore
        const avatarUrl = `https://api.dicebear.com/7.x/identicon/svg?seed=${encodeURIComponent(displayName)}`;
        await setDoc(doc(db, "profiles", user.uid), {
          uid: user.uid,
          display_name: displayName,
          avatar_url: avatarUrl
        });
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }
      onAuthSuccess();
    } catch (err: any) {
      console.error("Auth error:", err);
      let friendlyMessage = err.message;
      if (err.code === "auth/user-not-found" || err.code === "auth/wrong-password") {
        friendlyMessage = "Incorrect email or password.";
      } else if (err.code === "auth/email-already-in-use") {
        friendlyMessage = "This email is already registered.";
      } else if (err.code === "auth/weak-password") {
        friendlyMessage = "Password should be at least 6 characters.";
      } else if (err.code === "auth/admin-restricted-operation" || err.message?.includes("admin-restricted-operation")) {
        friendlyMessage = "Email/Password registration is restricted. Please sign in via Google below or check the console config.";
      } else if (err.code === "auth/operation-not-allowed" || err.message?.includes("operation-not-allowed")) {
        friendlyMessage = "Email/Password sign-in is not enabled in your Firebase project. To enable it, navigate to Firebase Console > Authentication > Sign-in method and enable 'Email/Password'.";
      }
      setErrorMsg(friendlyMessage);
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setIsLoading(true);
    setErrorMsg("");
    try {
      const provider = new GoogleAuthProvider();
      const userCredential = await signInWithPopup(auth, provider);
      const user = userCredential.user;

      const displayName = user.displayName || `Agent ${user.uid.slice(0, 4)}`;
      const avatarUrl = user.photoURL || `https://api.dicebear.com/7.x/identicon/svg?seed=${encodeURIComponent(displayName)}`;

      await setDoc(doc(db, "profiles", user.uid), {
        uid: user.uid,
        display_name: displayName,
        avatar_url: avatarUrl
      });

      onAuthSuccess();
    } catch (err: any) {
      console.error("Google Auth error:", err);
      if (err.code === "auth/operation-not-allowed" || err.message?.includes("operation-not-allowed")) {
        setErrorMsg("Google Sign-In is not enabled on this Firebase project. To enable it, navigate to Firebase Console > Authentication > Sign-in method and enable 'Google'.");
      } else {
        setErrorMsg("Failed to connect via Google Sign-In: " + err.message);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleInstantDemo = async () => {
    setIsLoading(true);
    setErrorMsg("");
    try {
      let user;
      const coolAdjectives = ["Neon", "Cyber", "Delta", "Echo", "Solar", "Quantum", "Hyper", "Vortex"];
      const coolNouns = ["Operator", "Pilot", "Sentry", "Core", "Vanguard", "Rover", "Nexus", "Matrix"];
      const randAdjective = coolAdjectives[Math.floor(Math.random() * coolAdjectives.length)];
      const randNoun = coolNouns[Math.floor(Math.random() * coolNouns.length)];
      const randomNum = Math.floor(100 + Math.random() * 900);
      const guestName = `${randAdjective} ${randNoun} ${randomNum}`;

      try {
        const userCredential = await signInAnonymously(auth);
        user = userCredential.user;
      } catch (anonErr: any) {
        console.warn("Anonymous sign-in restricted or failed. Attempting Email/Password auto-registration proxy fallback...", anonErr);
        // Fallback to generating an ephemeral guest email/password
        const randomSuffix = `${Date.now()}_${Math.floor(1000 + Math.random() * 9000)}`;
        const fallbackEmail = `guest_${randomSuffix}@secure-room.io`;
        const fallbackPassword = `SecureGuestPass_${randomSuffix}!`;
        
        const userCredential = await createUserWithEmailAndPassword(auth, fallbackEmail, fallbackPassword);
        user = userCredential.user;
      }
      
      await updateProfile(user, { displayName: guestName });
      
      const avatarUrl = `https://api.dicebear.com/7.x/identicon/svg?seed=${encodeURIComponent(guestName)}`;
      await setDoc(doc(db, "profiles", user.uid), {
        uid: user.uid,
        display_name: guestName,
        avatar_url: avatarUrl
      });
      
      onAuthSuccess();
    } catch (err: any) {
      console.error("Demo Auth error:", err);
      if (err.code === "auth/operation-not-allowed" || err.message?.includes("operation-not-allowed")) {
        setErrorMsg("Anonymous Sign-In and Email/Password sign-ins are not enabled on this Firebase project. To enable guest access, navigate to Firebase Console > Authentication > Sign-in method, click 'Add new provider', and enable 'Anonymous'. Alternatively, try Google Sign-In below.");
      } else if (err.code === "auth/admin-restricted-operation" || err.message?.includes("admin-restricted-operation")) {
        setErrorMsg("Guest connection is disabled on this server. Please click 'Continue with Google' to log in instantly!");
      } else {
        setErrorMsg("Failed to connect guest session: " + err.message);
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-brand-bg flex flex-col justify-center items-center p-4 selection:bg-brand-accent selection:text-slate-950 font-sans">
      
      {/* Background elegant subtle geometric structure */}
      <div className="absolute inset-0 bg-[linear-gradient(rgba(45,51,61,0.15)_1px,transparent_1px),linear-gradient(90deg,rgba(45,51,61,0.15)_1px,transparent_1px)] bg-[size:40px_40px] pointer-events-none opacity-20" />
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-brand-accent/5 rounded-full filter blur-[100px] pointer-events-none" />

      <div className="w-full max-w-md relative z-10">
        
        {/* Header Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-3 bg-[#15171d] border border-brand-border rounded-full px-4 py-2 text-brand-accent text-xs font-mono tracking-wider mb-4 shadow-[0_0_12px_rgba(20,184,166,0.1)]">
            <div className="w-2.5 h-2.5 rounded-full bg-brand-accent shadow-[0_0_8px_#14b8a6] animate-pulse"></div>
            OPERATIONAL COMMAND
          </div>
          <h1 className="text-3xl font-bold text-slate-100 tracking-tight font-sans">
            Control Room
          </h1>
          <p className="text-slate-400 text-sm mt-1 font-sans">
            Secure, low-latency, real-time tactical communications
          </p>
        </div>

        {/* Content Box */}
        <div id="auth-panel" className="bg-[#15171d] border-2 border-brand-border rounded-xl p-6 shadow-2xl relative overflow-hidden">
          
          {/* Active border accent */}
          <div className="absolute top-0 left-0 right-0 h-[3px] bg-brand-accent" />

          {errorMsg && (
            <div className="mb-4 p-3 bg-red-950/40 border border-red-500/30 text-red-400 text-xs rounded-lg font-mono">
              [SYSTEM ERROR] {errorMsg}
            </div>
          )}

          <form onSubmit={handleEmailAuth} className="space-y-4">
            {isSignUp && (
              <div>
                <label className="block text-xs font-mono text-slate-400 uppercase tracking-widest mb-1.5">
                  Display Name
                </label>
                <div className="relative">
                  <User className="absolute left-3 top-3 w-4 h-4 text-slate-500" />
                  <input
                    type="text"
                    required
                    placeholder="e.g. Comms-Leader-01"
                    className="w-full bg-brand-bg border border-brand-border rounded-lg py-2.5 pl-10 pr-4 text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-brand-accent text-sm font-sans"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                  />
                </div>
              </div>
            )}

            <div>
              <label className="block text-xs font-mono text-slate-400 uppercase tracking-widest mb-1.5">
                Terminal Email
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-3 w-4 h-4 text-slate-500" />
                <input
                  type="email"
                  required
                  placeholder="name@agency.gov"
                  className="w-full bg-brand-bg border border-brand-border rounded-lg py-2.5 pl-10 pr-4 text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-brand-accent text-sm font-sans"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-mono text-slate-400 uppercase tracking-widest mb-1.5">
                Passcode
              </label>
              <div className="relative">
                <Key className="absolute left-3 top-3 w-4 h-4 text-slate-500" />
                <input
                  type="password"
                  required
                  placeholder="••••••••"
                  className="w-full bg-brand-bg border border-brand-border rounded-lg py-2.5 pl-10 pr-4 text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-brand-accent text-sm font-sans"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
            </div>

            <button
              id="submit-auth-btn"
              type="submit"
              disabled={isLoading}
              className="w-full bg-brand-accent text-slate-950 font-bold uppercase tracking-widest py-2.5 px-4 rounded-lg text-xs hover:brightness-110 active:scale-98 transition duration-150 flex justify-center items-center disabled:opacity-50 cursor-pointer"
            >
              {isLoading ? (
                <span className="w-5 h-5 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" />
              ) : (
                isSignUp ? "Initialize Profile" : "Access Terminal"
              )}
            </button>
          </form>

          {/* Divider */}
          <div className="relative flex py-4 items-center">
            <div className="flex-grow border-t border-brand-border"></div>
            <span className="flex-shrink mx-4 text-[10px] font-mono text-slate-600 uppercase tracking-widest">or</span>
            <div className="flex-grow border-t border-brand-border"></div>
          </div>

          {/* Continue with Google */}
          <button
            id="google-signin-btn"
            type="button"
            disabled={isLoading}
            onClick={handleGoogleSignIn}
            className="w-full bg-slate-100 hover:bg-white text-slate-950 font-bold py-2.5 px-4 rounded-lg text-xs uppercase tracking-widest transition duration-200 flex justify-center items-center gap-2 cursor-pointer mb-3"
          >
            <LogIn className="w-4 h-4 text-slate-950" />
            Continue with Google
          </button>

          {/* Quick Instant Connection Button */}
          <button
            id="instant-demo-btn"
            type="button"
            disabled={isLoading}
            onClick={handleInstantDemo}
            className="w-full bg-[#1e222a] border border-brand-border hover:border-brand-accent/50 hover:bg-brand-accent/5 text-brand-accent font-mono py-2.5 px-4 rounded-lg text-xs tracking-wider uppercase transition duration-200 flex justify-center items-center gap-2 cursor-pointer"
          >
            <Sparkles className="w-4 h-4" />
            Instant Guest Session
          </button>

          {/* Mode Switcher */}
          <div className="mt-6 text-center">
            <button
              id="switch-auth-mode-btn"
              type="button"
              className="text-slate-400 hover:text-brand-accent text-xs font-mono transition cursor-pointer"
              onClick={() => setIsSignUp(!isSignUp)}
            >
              {isSignUp ? "Already registered? Login here." : "New Operative? Register secure profile."}
            </button>
          </div>

        </div>

        {/* Footer info lockups */}
        <div className="text-center mt-6 text-[10px] font-mono text-slate-500 tracking-wider flex items-center justify-center gap-1.5 uppercase">
          <Shield className="w-3.5 h-3.5 text-brand-accent" />
          SECURE ENCRYPTED WEBRTC TACTICAL CHANNEL
        </div>

      </div>
    </div>
  );
}
