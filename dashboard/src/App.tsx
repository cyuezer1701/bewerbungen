import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { hasToken } from './api/client';
import Shell from './components/layout/Shell';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Jobs from './pages/Jobs';
import JobDetail from './pages/JobDetail';
import Applications from './pages/Applications';
import ApplicationEdit from './pages/ApplicationEdit';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  if (!hasToken()) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function Placeholder({ title }: { title: string }) {
  return (
    <div className="bg-card border border-border rounded-lg p-8 text-center">
      <h2 className="text-lg font-semibold text-text mb-2">{title}</h2>
      <p className="text-text-muted">Kommt in der naechsten Phase</p>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          element={
            <ProtectedRoute>
              <Shell />
            </ProtectedRoute>
          }
        >
          <Route path="/" element={<Dashboard />} />
          <Route path="/jobs" element={<Jobs />} />
          <Route path="/jobs/:id" element={<JobDetail />} />
          <Route path="/applications" element={<Applications />} />
          <Route path="/applications/:id" element={<ApplicationEdit />} />
          <Route path="/profiles" element={<Placeholder title="Suchprofile" />} />
          <Route path="/documents" element={<Placeholder title="Dokumente" />} />
          <Route path="/settings" element={<Placeholder title="Einstellungen" />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
