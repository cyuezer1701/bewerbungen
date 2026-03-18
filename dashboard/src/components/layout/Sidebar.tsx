import { NavLink } from 'react-router-dom';
import { LayoutDashboard, Briefcase, FileText, Search, FolderOpen, Settings, LogOut, BarChart3, Activity } from 'lucide-react';
import { clearToken } from '../../api/client';

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/jobs', icon: Briefcase, label: 'Jobs' },
  { to: '/applications', icon: FileText, label: 'Bewerbungen' },
  { to: '/profiles', icon: Search, label: 'Suchprofile' },
  { to: '/documents', icon: FolderOpen, label: 'Dokumente' },
  { to: '/settings', icon: Settings, label: 'Einstellungen' },
  { to: '/analytics', icon: BarChart3, label: 'Analytics' },
  { to: '/activity', icon: Activity, label: 'Aktivitaeten' },
];

export default function Sidebar() {
  function handleLogout() {
    clearToken();
    window.location.href = '/login';
  }

  return (
    <aside className="w-56 bg-card border-r border-border flex flex-col min-h-screen">
      <div className="p-4 border-b border-border">
        <h1 className="text-accent font-mono font-bold text-sm tracking-widest">AUTOBEWERBER</h1>
      </div>

      <nav className="flex-1 p-2">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2 rounded text-sm transition ${
                isActive
                  ? 'bg-accent/10 text-accent'
                  : 'text-text-muted hover:text-text hover:bg-navy'
              }`
            }
          >
            <item.icon size={18} />
            {item.label}
          </NavLink>
        ))}
      </nav>

      <div className="p-2 border-t border-border">
        <button
          onClick={handleLogout}
          className="flex items-center gap-3 px-3 py-2 rounded text-sm text-text-muted hover:text-danger w-full transition"
        >
          <LogOut size={18} />
          Abmelden
        </button>
      </div>
    </aside>
  );
}
