import { AuthProvider, useAuth } from './contexts/AuthContext';
import AdminPage from './pages/AdminPage';
import AuthForm from './components/AuthForm';
import AdminOrderNotifications from './components/AdminOrderNotifications';
import { LogOut, Home } from 'lucide-react';

const userAppUrl = (import.meta.env.VITE_USER_APP_URL ?? '').trim();
// Show cross-link only if the URL is an https domain (avoid localhost links on production).
const userAppOpensNewTab = /^https:\/\//i.test(userAppUrl);

function AdminContent() {
  const { user, adminProfile, signOut } = useAuth();

  if (!user) {
    return (
      <AuthForm
        onSuccess={() => {}}
        requireAddress={false}
        adminSignUp
      />
    );
  }

  const isAdminProfile = !!adminProfile;
  const isApprovedAdmin = !!adminProfile?.is_active;

  // Logged in but not an approved admin
  if (!isApprovedAdmin) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-black to-neutral-900 flex items-center justify-center px-4">
        <div className="max-w-md w-full bg-neutral-900 rounded-2xl shadow-2xl p-8 border border-yellow-500/30 text-center">
          <h1 className="text-2xl font-bold text-yellow-300 mb-4">
            {isAdminProfile ? 'Account pending approval' : 'Administrators only'}
          </h1>
          <p className="text-gray-300 mb-6">
            {isAdminProfile
              ? 'Your admin account is not yet approved by the Master Admin. Please wait for approval, then log in again.'
              : "This page is for KaeDy's Pizza Hub administrators. Your account is a customer account."}
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            {userAppOpensNewTab ? (
              <a
                href={userAppUrl}
                {...{ target: '_blank', rel: 'noopener noreferrer' }}
                className="inline-flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-yellow-400 text-black font-semibold hover:bg-yellow-300 transition-all"
              >
                <Home className="w-4 h-4" />
                Go to main site
              </a>
            ) : null}
            <button
              onClick={async () => {
                await signOut();
                window.location.reload();
              }}
              className="inline-flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-neutral-700 text-gray-200 font-semibold hover:bg-neutral-600 transition-all"
            >
              <LogOut className="w-4 h-4" />
              Log out
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <AdminOrderNotifications enabled={isApprovedAdmin} soundSrc="/sounds/neworder-meme.mp3" />
      <AdminPage />
    </>
  );
}

export default function AdminApp() {
  return (
    <AuthProvider>
      <AdminContent />
    </AuthProvider>
  );
}

