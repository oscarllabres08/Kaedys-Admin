import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { LegalModal } from './LegalModal';

type AuthFormProps = {
  onSuccess: () => void;
  requireAddress?: boolean;
  adminSignUp?: boolean;
};

export default function AuthForm({ onSuccess, requireAddress = true, adminSignUp = false }: AuthFormProps) {
  const [isSignUp, setIsSignUp] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [showPrivacyAfterSignUp, setShowPrivacyAfterSignUp] = useState(false);
  const { signIn, signUp, signOut } = useAuth();

  const userAppUrl = (import.meta.env.VITE_USER_APP_URL ?? '').trim();
  // Show customer-site link only for https domains (avoid localhost links on production).
  const userAppOpensNewTab = /^https:\/\//i.test(userAppUrl);

  const [formData, setFormData] = useState({
    login: '',
    email: '',
    username: '',
    password: '',
    confirmPassword: '',
    full_name: '',
    phone: '',
    address: '',
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (isSignUp) {
        if (formData.password !== formData.confirmPassword) {
          setError('Password and Confirm Password do not match.');
          return;
        }
        if (!adminSignUp) {
          const normalizedUsername = formData.username.trim().toLowerCase();
          if (!/^[a-z0-9_]{3,30}$/.test(normalizedUsername)) {
            setError('Username must be 3-30 chars, letters/numbers/underscore only.');
            return;
          }
        }
        const { requiresAdminApproval } = await signUp(
          formData.email,
          formData.password,
          {
            full_name: formData.full_name,
            username: formData.username.trim().toLowerCase(),
            phone: formData.phone,
            address: formData.address,
          },
          adminSignUp
        );

        if (adminSignUp && requiresAdminApproval) {
          setSuccessMessage('Account created successfully. Please wait for Master Admin approval, then log in.');
          await signOut();
          setIsSignUp(false);
          setFormData((p) => ({
            ...p,
            password: '',
            confirmPassword: '',
          }));
          return;
        }

        setSuccessMessage('Account created successfully');
        if (adminSignUp) {
          setLoading(false);
          setTimeout(() => {
            onSuccess();
          }, 1200);
          return;
        }
        setShowPrivacyAfterSignUp(true);
        return;
      }
      await signIn(formData.login, formData.password);
      onSuccess();
    } catch (err: unknown) {
      const error = err as Error;
      setError(error.message || 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-black to-neutral-900 flex items-center justify-center px-4 py-8">
      <div className="max-w-md w-full bg-neutral-900 rounded-2xl shadow-2xl p-8 transform transition-all border border-yellow-500/40">
        <div className="text-center mb-8">
          <img
            src="/assets/kaedypizza.jpg"
            alt="KaeDy's Pizza Hub"
            className="h-20 w-20 mx-auto rounded-full border-4 border-yellow-400 shadow-lg object-cover"
          />
          <h2 className="mt-6 text-3xl font-bold text-white">
            {isSignUp ? 'Create Account' : 'Welcome Back'}
          </h2>
          <p className="mt-2 text-sm text-gray-400">
            {adminSignUp
              ? isSignUp
                ? 'Create an administrator account'
                : 'Sign in to the admin dashboard'
              : isSignUp
                ? 'Sign up to start ordering delicious pizza'
                : 'Sign in to your account'}
          </p>
          {adminSignUp && (
            <p className="mt-3 text-sm text-gray-400">
              Looking to order pizza?{' '}
              {userAppOpensNewTab ? (
                <a
                  href={userAppUrl}
                  {...{ target: '_blank', rel: 'noopener noreferrer' }}
                  className="text-yellow-400 hover:text-yellow-300 font-medium underline-offset-2 hover:underline"
                >
                  Go to the customer site
                </a>
              ) : null}
            </p>
          )}
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-100 border border-red-400 text-red-700 rounded-lg text-sm">
            {error}
          </div>
        )}

        {successMessage && (
          <div className="mb-4 p-3 bg-green-100 border border-green-500 text-green-800 rounded-lg text-sm font-medium text-center">
            {successMessage}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {isSignUp && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-200 mb-1">
                  Full Name
                </label>
                <input
                  type="text"
                  required
                  value={formData.full_name}
                  onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
                  className="w-full px-4 py-3 border border-gray-700 rounded-lg bg-black text-white focus:ring-2 focus:ring-yellow-400 focus:border-transparent transition-all"
                  placeholder="Enter your full name"
                />
              </div>

              {!adminSignUp && (
                <div>
                  <label className="block text-sm font-medium text-gray-200 mb-1">
                    Username
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.username}
                    onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                    className="w-full px-4 py-3 border border-gray-700 rounded-lg bg-black text-white focus:ring-2 focus:ring-yellow-400 focus:border-transparent transition-all"
                    placeholder="e.g. oscar_jomer"
                  />
                  <p className="text-[11px] text-gray-400 mt-1">Letters, numbers, underscore only (3-30 chars)</p>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-200 mb-1">
                  Phone Number
                </label>
                <input
                  type="tel"
                  required
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  className="w-full px-4 py-3 border border-gray-700 rounded-lg bg-black text-white focus:ring-2 focus:ring-yellow-400 focus:border-transparent transition-all"
                  placeholder="Enter your phone number"
                />
              </div>

              {requireAddress && (
                <div>
                  <label className="block text-sm font-medium text-gray-200 mb-1">
                    Address
                  </label>
                  <textarea
                    required
                    value={formData.address}
                    onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                    className="w-full px-4 py-3 border border-gray-700 rounded-lg bg-black text-white focus:ring-2 focus:ring-yellow-400 focus:border-transparent transition-all"
                    placeholder="Enter your delivery address"
                    rows={3}
                  />
                </div>
              )}
            </>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-200 mb-1">
              {isSignUp ? 'Email Address' : adminSignUp ? 'Email Address' : 'Email or Username'}
            </label>
            <input
              type={isSignUp || adminSignUp ? 'email' : 'text'}
              required
              value={isSignUp ? formData.email : formData.login}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  ...(isSignUp ? { email: e.target.value } : { login: e.target.value }),
                })
              }
              className="w-full px-4 py-3 border border-gray-700 rounded-lg bg-black text-white focus:ring-2 focus:ring-yellow-400 focus:border-transparent transition-all"
              placeholder={isSignUp || adminSignUp ? 'Enter your email' : 'Enter email or username'}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-200 mb-1">
              Password
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                required
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                className="w-full px-4 py-3 pr-11 border border-gray-700 rounded-lg bg-black text-white focus:ring-2 focus:ring-yellow-400 focus:border-transparent transition-all"
                placeholder="Enter your password"
                minLength={6}
              />
              <button
                type="button"
                onClick={() => setShowPassword((p) => !p)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-md text-gray-400 hover:text-yellow-400 hover:bg-yellow-400/10 transition-all"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <Eye className="w-5 h-5" /> : <EyeOff className="w-5 h-5" />}
              </button>
            </div>
          </div>

          {isSignUp && (
            <div>
              <label className="block text-sm font-medium text-gray-200 mb-1">
                Confirm Password
              </label>
              <div className="relative">
                <input
                  type={showConfirmPassword ? 'text' : 'password'}
                  required
                  value={formData.confirmPassword}
                  onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                  className="w-full px-4 py-3 pr-11 border border-gray-700 rounded-lg bg-black text-white focus:ring-2 focus:ring-yellow-400 focus:border-transparent transition-all"
                  placeholder="Re-enter your password"
                  minLength={6}
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword((p) => !p)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-md text-gray-400 hover:text-yellow-400 hover:bg-yellow-400/10 transition-all"
                  aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
                >
                  {showConfirmPassword ? <Eye className="w-5 h-5" /> : <EyeOff className="w-5 h-5" />}
                </button>
              </div>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-yellow-400 text-black py-3 rounded-lg font-semibold hover:bg-yellow-300 transition-all transform hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg"
          >
            {loading ? 'Please wait...' : isSignUp ? 'Sign Up' : 'Sign In'}
          </button>
        </form>

        <div className="mt-6 text-center">
          <button
            onClick={() => setIsSignUp(!isSignUp)}
            className="text-yellow-400 hover:text-yellow-300 font-medium transition-colors"
          >
            {isSignUp
              ? 'Already have an account? Sign In'
              : "Don't have an account? Sign Up"}
          </button>
        </div>
      </div>

      <LegalModal
        open={showPrivacyAfterSignUp}
        onClose={() => {
          setShowPrivacyAfterSignUp(false);
          onSuccess();
        }}
        title="Privacy Policy"
        description={
          <p className="text-xs text-gray-400">By continuing, you acknowledge and accept this privacy notice.</p>
        }
      >
        <div className="mt-4 max-h-[55vh] space-y-3 overflow-auto rounded-xl border border-yellow-500/20 bg-black/40 p-4 text-sm text-gray-200">
          <p>We collect account and order information to provide food ordering and delivery services.</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>Collected data may include full name, username, email, phone number, address, and order history.</li>
            <li>For GCash orders, we also process payment reference and uploaded proof of payment for verification.</li>
            <li>We use your data to process orders, contact you about deliveries, and provide customer support.</li>
            <li>Authorized staff only can access your order data for operations and verification.</li>
            <li>We do not sell your personal data to third parties.</li>
          </ul>
          <p>By using this service, you consent to the collection and processing of your data for these purposes.</p>
        </div>
        <div className="mt-5 flex justify-end">
          <button
            type="button"
            onClick={() => {
              setShowPrivacyAfterSignUp(false);
              onSuccess();
            }}
            className="rounded-lg bg-yellow-400 px-4 py-2 font-semibold text-black transition-all duration-200 hover:bg-yellow-300 active:scale-[0.98]"
          >
            I Agree and Continue
          </button>
        </div>
      </LegalModal>
    </div>
  );
}
