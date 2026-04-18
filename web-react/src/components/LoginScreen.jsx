/**
 * SilentChat - Login Screen Component
 */

import { useState, useRef } from 'react';
import { useApp } from '../context/AppContext';
import { requestNotificationPermission } from '../lib/utils';

export default function LoginScreen() {
    const { state, login, importIdentity } = useApp();
    const [alias, setAlias] = useState('');
    const fileRef = useRef();

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
                    <h1>silentchat</h1>
                    <p className="tagline">end-to-end encrypted messaging</p>
                </div>

                <form className="login-form" onSubmit={handleSubmit}>
                    <div className="input-group">
                        <input
                            type="text"
                            id="aliasInput"
                            placeholder="enter your username"
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
                            <span className="btn-text">login / register</span>
                        )}
                    </button>

                    {state.loginError && (
                        <p className="status-message error">{state.loginError}</p>
                    )}
                </form>

                <div className="security-info">
                    <div className="security-badge">
                        <span>🔒</span>
                        <span>your keys never leave this device</span>
                    </div>
                    <button
                        type="button"
                        className="import-identity-btn"
                        onClick={() => fileRef.current.click()}
                    >
                        import identity from file
                    </button>
                    <input
                        ref={fileRef}
                        type="file"
                        accept=".pem"
                        style={{ display: 'none' }}
                        onChange={(e) => {
                            const file = e.target.files[0];
                            if (!file) return;
                            const reader = new FileReader();
                            reader.onload = (ev) => importIdentity(ev.target.result);
                            reader.readAsText(file);
                            e.target.value = '';
                        }}
                    />
                </div>
            </div>
        </div>
    );
}
