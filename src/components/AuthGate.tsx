import React, { useState } from 'react';
import { ArrowRight, BookOpen, FileText, Lock, ShieldCheck, Sun, Moon } from 'lucide-react';
import { useAuth } from '../context/AuthContext.tsx';

interface AuthGateProps {
  darkMode: boolean;
  onToggleDark: () => void;
}

export function AuthGate({ darkMode, onToggleDark }: AuthGateProps) {
  const { loginWithEmail, registerWithEmail, loginWithGoogle } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (mode === 'login') {
        await loginWithEmail(email, password);
      } else {
        await registerWithEmail(name, email, password);
      }
    } catch (err: any) {
      setError(err?.message || 'Authentication failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogle = async () => {
    setError(null);
    setSubmitting(true);
    try {
      await loginWithGoogle();
    } catch (err: any) {
      setError(err?.message || 'Google sign-in failed or was cancelled.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col">
      <header className="h-16 px-6 lg:px-10 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center justify-between gap-8">
        <div className="flex items-center gap-2.5 whitespace-nowrap shrink-0">
          <BookOpen className="w-5 h-5 text-blue-600 dark:text-blue-400" />
          <span className="font-display text-lg font-bold tracking-tight">Verity Vault</span>
        </div>
        <button
          type="button"
          onClick={onToggleDark}
          aria-label="Toggle color theme"
          className="p-2 rounded-lg border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
        >
          {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </button>
      </header>

      <main className="flex-1 grid lg:grid-cols-12 max-w-6xl w-full mx-auto px-6 py-10 lg:py-16 gap-10 items-center">
        <section className="lg:col-span-6 space-y-6">
          <p className="text-xs font-medium tracking-wide text-blue-600 dark:text-blue-400">
            Enterprise Knowledge Base &amp; RAG Workspace
          </p>
          <h1 className="font-display text-3xl lg:text-4xl font-bold tracking-tight text-slate-900 dark:text-white leading-tight [text-wrap:balance]">
            Grounded team intelligence from every PDF in your vault.
          </h1>
          <p className="text-base text-slate-600 dark:text-slate-300 leading-relaxed max-w-xl">
            Index internal manuals, research, and engineering specs into PostgreSQL with pgvector. Ask questions in real time over WebSockets and verify every claim with page-level source citations.
          </p>

          <div className="pt-4 border-t border-slate-200 dark:border-slate-800 space-y-4">
            <div className="flex items-start gap-3">
              <FileText className="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
              <div>
                <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                  Page-Indexed Vector Retrieval
                </h2>
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  Automatic PDF extraction, overlapping chunking, and clickable inline citations mapped to exact page numbers.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <ShieldCheck className="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
              <div>
                <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                  Role-Based Governance &amp; Audit Trail
                </h2>
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  First registered member receives Administrator privileges, with live latency metrics and full activity audit logs.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <Lock className="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
              <div>
                <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                  Flexible Team Authentication
                </h2>
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  Sign in with Google OAuth or workspace email and password backed by verified JWT sessions.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="lg:col-span-6 w-full max-w-md mx-auto">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 sm:p-8">
            <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg mb-6">
              <button
                type="button"
                onClick={() => {
                  setMode('login');
                  setError(null);
                }}
                className={`flex-1 py-2 px-3 text-sm font-medium rounded-md transition-colors whitespace-nowrap ${
                  mode === 'login'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                Sign In
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode('register');
                  setError(null);
                }}
                className={`flex-1 py-2 px-3 text-sm font-medium rounded-md transition-colors whitespace-nowrap ${
                  mode === 'register'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                Create Account
              </button>
            </div>

            <button
              type="button"
              disabled={submitting}
              onClick={handleGoogle}
              className="w-full py-2.5 px-4 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700/70 text-sm font-medium text-slate-800 dark:text-slate-100 flex items-center justify-center gap-2.5 transition-colors disabled:opacity-50"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  fill="#4285F4"
                  d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"
                />
                <path
                  fill="#34A853"
                  d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24Z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14Z"
                />
                <path
                  fill="#EA4335"
                  d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96Z"
                />
              </svg>
              <span>Continue with Google</span>
            </button>

            <div className="my-5 flex items-center gap-3 text-xs text-slate-400">
              <div className="flex-1 h-px bg-slate-200 dark:bg-slate-800" />
              <span>or use email</span>
              <div className="flex-1 h-px bg-slate-200 dark:bg-slate-800" />
            </div>

            {error && (
              <div
                role="alert"
                className="mb-4 p-3 rounded-lg bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900 text-xs text-red-700 dark:text-red-300"
              >
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              {mode === 'register' && (
                <div>
                  <label
                    htmlFor="auth-name"
                    className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
                  >
                    Full Name
                  </label>
                  <input
                    id="auth-name"
                    type="text"
                    required
                    minLength={2}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Maya Lin"
                    className="w-full px-3.5 py-2.5 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600/30 focus:border-blue-600"
                  />
                </div>
              )}

              <div>
                <label
                  htmlFor="auth-email"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
                >
                  Work Email
                </label>
                <input
                  id="auth-email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@company.com"
                  className="w-full px-3.5 py-2.5 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600/30 focus:border-blue-600"
                />
              </div>

              <div>
                <label
                  htmlFor="auth-password"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
                >
                  Password
                </label>
                <input
                  id="auth-password"
                  type="password"
                  required
                  minLength={mode === 'register' ? 8 : 1}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={mode === 'register' ? 'Minimum 8 characters' : 'Enter your password'}
                  className="w-full px-3.5 py-2.5 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600/30 focus:border-blue-600"
                />
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full py-2.5 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
              >
                <span>
                  {submitting
                    ? 'Authenticating...'
                    : mode === 'login'
                      ? 'Sign In to Workspace'
                      : 'Create Workspace Account'}
                </span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </form>

            <p className="mt-5 text-xs text-slate-500 dark:text-slate-400 text-center">
              The first user registered in this organization is automatically granted Administrator permissions.
            </p>
          </div>
        </section>
      </main>
    </div>
  );
}
