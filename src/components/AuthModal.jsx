import React, { useState } from 'react';
import { X, Sparkles, LogIn, UserPlus } from 'lucide-react';
import { apiClient } from '../services/apiClient';
import { soundEngine } from '../audio/soundEngine';

export default function AuthModal({ isOpen, onClose, onAuthSuccess }) {
  const [mode, setMode] = useState('register'); // 'register' | 'login'
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const res =
        mode === 'register'
          ? await apiClient.register({ name: name.trim(), email: email.trim(), password })
          : await apiClient.login({ email: email.trim(), password });
      soundEngine.playBucketLand(10);
      onAuthSuccess?.(res);
      onClose();
    } catch (err) {
      setError(err.message || 'Authentication failed.');
      soundEngine.playButtonClick(200);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal-card compact"
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <h2 id="auth-modal-title">
              {mode === 'register' ? 'Create Account & Claim 10.00 FREE SC' : 'Sign In to Newsroom'}
            </h2>
            <p className="modal-sub">
              {mode === 'register'
                ? 'Instant 100,000 GC + 10.00 Sweeps Coins ($10.00 prize value) — no purchase necessary.'
                : 'Access your Gold Coins, Sweeps Coins & prize redemptions.'}
            </p>
          </div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close sign in dialog">
            <X size={20} aria-hidden="true" />
          </button>
        </div>

        <div className="tab-pills">
          <button
            type="button"
            className={mode === 'register' ? 'active' : ''}
            onClick={() => {
              setMode('register');
              setError('');
            }}
          >
            <UserPlus size={15} aria-hidden="true" /> New Account (+10 SC)
          </button>
          <button
            type="button"
            className={mode === 'login' ? 'active' : ''}
            onClick={() => {
              setMode('login');
              setError('');
            }}
          >
            <LogIn size={15} aria-hidden="true" /> Sign In
          </button>
        </div>

        <form onSubmit={handleSubmit} className="stack-form">
          {mode === 'register' && (
            <div className="field">
              <label htmlFor="auth-name">Display Name</label>
              <input
                id="auth-name"
                type="text"
                placeholder="e.g. ChairDriver2026"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
          )}

          <div className="field">
            <label htmlFor="auth-email">Email Address</label>
            <input
              id="auth-email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          <div className="field">
            <label htmlFor="auth-password">Password (8+ characters)</label>
            <input
              id="auth-password"
              type="password"
              minLength={8}
              placeholder="Minimum 8 characters"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          {error && (
            <div className="alert error" role="alert">
              {error}
            </div>
          )}

          <button type="submit" className="btn-primary full" disabled={busy}>
            <Sparkles size={16} aria-hidden="true" />
            <span>
              {busy
                ? 'Securing Session…'
                : mode === 'register'
                ? 'Register & Claim 100,000 GC + 10.00 SC'
                : 'Sign In'}
            </span>
          </button>
        </form>
      </div>
    </div>
  );
}
