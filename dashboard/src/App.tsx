import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { hasToken } from './api/client';
import Shell from './components/layout/Shell';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Jobs from './pages/Jobs';
import JobDetail from './pages/JobDetail';
import Applications from './pages/Applications';
import ApplicationEdit from './pages/ApplicationEdit';
import SearchProfiles from './pages/SearchProfiles';
import Documents from './pages/Documents';
import Settings from './pages/Settings';
import Analytics from './pages/Analytics';
import ActivityLog from './pages/ActivityLog';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  if (!hasToken()) return <Navigate to="/login" replace />;
  return <>{children}</>;
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
          <Route path="/profiles" element={<SearchProfiles />} />
          <Route path="/documents" element={<Documents />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/analytics" element={<Analytics />} />
          <Route path="/activity" element={<ActivityLog />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
