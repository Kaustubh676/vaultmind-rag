import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut as firebaseSignOut } from 'firebase/auth';
import { auth, googleAuthProvider } from '../lib/firebase.ts';
import type { User, WsServerMessage } from '../types.ts';

type WsListener = (msg: WsServerMessage) => void;

interface AuthContextValue {
  user: User | null;
  token: string | null;
  loading: boolean;
  wsConnected: boolean;
  loginWithEmail: (email: string, password: string) => Promise<void>;
  registerWithEmail: (name: string, email: string, password: string) => Promise<void>;
  loginWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
  apiFetch: <T = unknown>(url: string, init?: RequestInit) => Promise<T>;
  sendWsMessage: (payload: Record<string, unknown>) => boolean;
  subscribeWs: (listener: WsListener) => () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [wsConnected, setWsConnected] = useState(false);

  const tokenRef = useRef<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const listenersRef = useRef<Set<WsListener>>(new Set());
  const reconnectTimerRef = useRef<number | null>(null);
  const manualSessionRef = useRef(false);

  const updateToken = useCallback((nextToken: string | null) => {
    tokenRef.current = nextToken;
    setToken(nextToken);
  }, []);

  // Hydrate Firebase Google session if active on page load
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (fbUser) => {
      if (manualSessionRef.current) {
        setLoading(false);
        return;
      }

      if (!fbUser) {
        setLoading(false);
        return;
      }

      try {
        const idToken = await fbUser.getIdToken();
        const res = await fetch('/api/auth/google', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ idToken }),
        });
        if (res.ok) {
          const data = await res.json();
          updateToken(idToken);
          setUser(data.user);
        }
      } catch (err) {
        console.error('Failed to restore Google session:', err);
      } finally {
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, [updateToken]);

  // WebSocket lifecycle synchronized to active bearer token
  useEffect(() => {
    if (!token || !user) {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      setWsConnected(false);
      return;
    }

    let cancelled = false;

    const connect = () => {
      if (cancelled || !tokenRef.current) return;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const url = `${protocol}//${window.location.host}/ws?token=${encodeURIComponent(tokenRef.current)}`;
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!cancelled) setWsConnected(true);
      };

      ws.onmessage = (event) => {
        try {
          const msg: WsServerMessage = JSON.parse(event.data);
          for (const listener of listenersRef.current) {
            listener(msg);
          }
        } catch {
          // Ignore malformed frame
        }
      };

      ws.onclose = () => {
        if (!cancelled) {
          setWsConnected(false);
          reconnectTimerRef.current = window.setTimeout(connect, 2500);
        }
      };

      ws.onerror = () => {
        ws.close();
      };
    };

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      setWsConnected(false);
    };
  }, [token, user]);

  const apiFetch = useCallback(async <T = unknown>(url: string, init: RequestInit = {}): Promise<T> => {
    const activeToken = tokenRef.current;
    const headers = new Headers(init.headers);
    if (activeToken) {
      headers.set('Authorization', `Bearer ${activeToken}`);
    }
    if (!(init.body instanceof FormData) && !headers.has('Content-Type') && init.body) {
      headers.set('Content-Type', 'application/json');
    }

    const res = await fetch(url, { ...init, headers });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || `Request failed (${res.status})`);
    }
    return data as T;
  }, []);

  const loginWithEmail = useCallback(
    async (email: string, password: string) => {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'Invalid email or password.');
      }
      manualSessionRef.current = true;
      updateToken(data.token);
      setUser(data.user);
    },
    [updateToken]
  );

  const registerWithEmail = useCallback(
    async (name: string, email: string, password: string) => {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'Registration failed.');
      }
      manualSessionRef.current = true;
      updateToken(data.token);
      setUser(data.user);
    },
    [updateToken]
  );

  const loginWithGoogle = useCallback(async () => {
    manualSessionRef.current = true;
    const credential = await signInWithPopup(auth, googleAuthProvider);
    const idToken = await credential.user.getIdToken();
    const res = await fetch('/api/auth/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      manualSessionRef.current = false;
      throw new Error(data.error || 'Google authentication failed.');
    }
    updateToken(idToken);
    setUser(data.user);
  }, [updateToken]);

  const logout = useCallback(async () => {
    manualSessionRef.current = false;
    try {
      await firebaseSignOut(auth);
    } catch {
      // Ignore if signed in via password
    }
    updateToken(null);
    setUser(null);
  }, [updateToken]);

  const sendWsMessage = useCallback((payload: Record<string, unknown>) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return false;
    }
    ws.send(JSON.stringify(payload));
    return true;
  }, []);

  const subscribeWs = useCallback((listener: WsListener) => {
    listenersRef.current.add(listener);
    return () => {
      listenersRef.current.delete(listener);
    };
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        loading,
        wsConnected,
        loginWithEmail,
        registerWithEmail,
        loginWithGoogle,
        logout,
        apiFetch,
        sendWsMessage,
        subscribeWs,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return ctx;
}
