/**
 * SilentChat - Main App Component
 */

import { AppProvider, useApp } from './context/AppContext';
import LoginScreen from './components/LoginScreen';
import ChatScreen from './components/ChatScreen';
import './index.css';

function AppContent() {
  const { state } = useApp();

  if (state.isLoading) {
    return (
      <div className="loading-screen">
        <div className="loading-spinner"></div>
        <p>Loading...</p>
      </div>
    );
  }

  return state.isLoggedIn ? <ChatScreen /> : <LoginScreen />;
}

export default function App() {
  return (
    <AppProvider>
      <AppContent />
    </AppProvider>
  );
}
