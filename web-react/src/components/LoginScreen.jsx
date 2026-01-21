/**
 * SilentChat - Login Screen Component
 */

import { useState } from 'react';
import { useApp } from '../context/AppContext';
import { requestNotificationPermission } from '../lib/utils';

export default function LoginScreen() {
    const { state, login } = useApp();
    const [alias, setAlias] = useState('');

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!alias.trim()) return;
        requestNotificationPermission();
        await login(alias.trim());
    };

    return (
        <div className="login-screen">
            <div className="login-container">
                <div className="login-header">
                    <div className="login-icon">🔐</div>
                    <h1>SilentChat</h1>
                    <p className="tagline">End-to-End Encrypted Messaging</p>
                </div>

                <form className="login-form" onSubmit={handleSubmit}>
                    <div className="input-group">
                        <label htmlFor="aliasInput">Your Alias</label>
                        <input
                            type="text"
                            id="aliasInput"
                            placeholder="Enter your username"
                            value={alias}
                            onChange={(e) => setAlias(e.target.value)}
                            autoComplete="off"
                            autoFocus
                        />
                    </div>

                    <button
                        type="submit"
                        className="btn btn-primary"
                        disabled={!alias.trim() || state.loginStatus}
                    >
                        {state.loginStatus ? (
                            <>
                                <span className="btn-loader"></span>
                                <span>{state.loginStatus}</span>
                            </>
                        ) : (
                            <span className="btn-text">Login / Register</span>
                        )}
                    </button>

                    {state.loginError && (
                        <p className="status-message error">{state.loginError}</p>
                    )}
                </form>

                <div className="security-info">
                    <div className="security-badge">
                        <span>🔒</span>
                        <span>Your keys never leave this device</span>
                    </div>
                </div>
            </div>
        </div>
    );
}
