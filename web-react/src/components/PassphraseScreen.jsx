/**
 * SilentChat - Passphrase Screen
 * Handles both unlock (returning user) and setup (new user) flows
 */

import { useState } from 'react';
import { useApp } from '../context/AppContext.jsx';

export default function PassphraseScreen() {
    const { state, unlockWithPassphrase, setupPassphrase, logout } = useApp();
    const [passphrase, setPassphrase] = useState('');
    const [confirm, setConfirm] = useState('');

    const isSetup = state.needsPassphraseSetup;
    const mismatch = isSetup && passphrase && confirm && passphrase !== confirm;

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!passphrase.trim() || mismatch) return;

        if (isSetup) {
            await setupPassphrase(passphrase);
        } else {
            await unlockWithPassphrase(passphrase);
        }
    };

    return (
        <div className="login-screen">
            <div className="login-container">
                <div className="login-header">
                    <div className="login-icon">🔐</div>
                    <h1>silentchat</h1>
                    <p className="tagline">
                        {isSetup
                            ? 'set a passphrase to encrypt your data on this device.'
                            : `welcome back, @${state.savedAlias}`}
                    </p>
                </div>

                <form className="login-form" onSubmit={handleSubmit}>
                    <div className="input-group">
                        <input
                            type="password"
                            placeholder="passphrase"
                            value={passphrase}
                            onChange={(e) => setPassphrase(e.target.value)}
                            autoFocus
                        />
                    </div>
                    {isSetup && (
                        <div className="input-group">
                            <input
                                type="password"
                                placeholder="confirm passphrase"
                                value={confirm}
                                onChange={(e) => setConfirm(e.target.value)}
                            />
                        </div>
                    )}
                    <button
                        type="submit"
                        className="btn btn-primary"
                        disabled={!passphrase.trim() || !!mismatch || !!state.loginStatus}
                    >
                        {state.loginStatus ? (
                            <>
                                <span className="btn-loader"></span>
                                <span>{state.loginStatus}</span>
                            </>
                        ) : (
                            <span className="btn-text">continue</span>
                        )}
                    </button>

                    {mismatch && (
                        <p className="status-message error">passphrases do not match.</p>
                    )}
                    {state.loginError && (
                        <p className="status-message error">{state.loginError}</p>
                    )}
                </form>

                {!isSetup && (
                    <div className="security-info">
                        <button className="import-identity-btn" onClick={logout}>
                            sign out
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
