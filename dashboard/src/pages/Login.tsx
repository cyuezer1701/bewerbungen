import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { setToken } from '../api/client';
import { KeyRound } from 'lucide-react';

export default function Login() {
  const [token, setTokenValue] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/health', {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.ok) {
        setToken(token);
        navigate('/');
      } else {
        setError('Ungueltiger Token');
      }
    } catch {
      setError('Verbindung fehlgeschlagen');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-navy flex items-center justify-center">
      <form onSubmit={handleSubmit} className="bg-card border border-border rounded-lg p-8 w-full max-w-md">
        <div className="flex items-center gap-3 mb-6">
          <KeyRound className="text-accent" size={28} />
          <h1 className="text-xl font-semibold text-text">AutoBewerber</h1>
        </div>

        <label className="block text-text-muted text-sm mb-2">API Token</label>
        <input
          type="password"
          value={token}
          onChange={(e) => setTokenValue(e.target.value)}
          placeholder="Dashboard API Token eingeben"
          className="w-full bg-navy border border-border rounded px-3 py-2 text-text focus:outline-none focus:border-accent mb-4"
          autoFocus
        />

        {error && <p className="text-danger text-sm mb-4">{error}</p>}

        <button
          type="submit"
          disabled={loading || !token}
          className="w-full bg-accent text-navy font-semibold py-2 rounded hover:opacity-90 disabled:opacity-50 transition"
        >
          {loading ? 'Verbinde...' : 'Verbinden'}
        </button>
      </form>
    </div>
  );
}
