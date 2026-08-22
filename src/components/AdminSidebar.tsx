import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Upload, CheckCircle, ChevronDown, ChevronRight, ShieldX, Wifi, Bell, List } from "lucide-react";
import ThemeToggle from "./ThemeToggle";

type AdminSidebarProps = {
  /** "desktop" = fixed sidebar (hidden di mobile), "drawer" = isi menu untuk Sheet mobile */
  variant?: "desktop" | "drawer";
  /** dipanggil setelah menu di-klik (dipakai untuk menutup drawer) */
  onNavigate?: () => void;
};

const AdminSidebar = ({ variant = "desktop", onNavigate }: AdminSidebarProps) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [autoMatchOpen, setAutoMatchOpen] = useState(true);

  const isActive = (path: string) => location.pathname === path;
  const isAutoMatchSection = location.pathname === "/admin/upload-video" || 
                             location.pathname === "/admin/auto-matching" ||
                             location.pathname === "/admin/transactions";

  const go = (path: string) => {
    navigate(path);
    onNavigate?.();
  };

  const shellClass = variant === "drawer"
    ? "flex flex-col w-full h-full bg-[#0f1424]"
    : "hidden lg:flex flex-col w-56 bg-[#0f1424] border-r border-white/5 fixed h-screen";

  return (
    <aside className={shellClass}>
      <div className="p-6 border-b border-white/5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-purple-500 to-blue-600 flex items-center justify-center">
            <CheckCircle className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="font-bold text-white text-sm">Resi AH</h2>
            <p className="text-xs text-gray-400">Dashboard Validasi</p>
          </div>
        </div>
      </div>
      
      <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
        <button 
          onClick={() => go("/admin/dashboard")} 
          className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg font-medium text-sm transition-colors ${
            isActive("/admin/dashboard") 
              ? "bg-purple-500/10 text-purple-400" 
              : "text-gray-400 hover:bg-white/5 hover:text-white"
          }`}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
          </svg>
          <span>Dashboard</span>
        </button>

        <button 
          onClick={() => go("/admin/create-group")} 
          className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg font-medium text-sm transition-colors ${
            isActive("/admin/create-group") 
              ? "bg-purple-500/10 text-purple-400" 
              : "text-gray-400 hover:bg-white/5 hover:text-white"
          }`}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
          </svg>
          <span>Create Group</span>
        </button>

        <button 
          onClick={() => go("/admin/monthly-report")} 
          className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg font-medium text-sm transition-colors ${
            isActive("/admin/monthly-report") 
              ? "bg-purple-500/10 text-purple-400" 
              : "text-gray-400 hover:bg-white/5 hover:text-white"
          }`}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <span>Laporan Bulanan</span>
        </button>

        {/* Auto Match (OCR) - Parent with submenu */}
        <div className="space-y-1">
          <button 
            onClick={() => setAutoMatchOpen(!autoMatchOpen)}
            className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg font-medium text-sm transition-colors ${
              isAutoMatchSection 
                ? "text-purple-400" 
                : "text-gray-400 hover:text-white"
            }`}
          >
            <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <span className="flex-1 text-left whitespace-nowrap">Auto Match (OCR)</span>
            {autoMatchOpen ? (
              <ChevronDown className="w-3 h-3 shrink-0" />
            ) : (
              <ChevronRight className="w-3 h-3 shrink-0" />
            )}
          </button>

          {/* Submenu */}
          {autoMatchOpen && (
            <div className="ml-4 pl-4 border-l border-white/10 space-y-1">
              <button 
                onClick={() => go("/admin/upload-video")}
                className={`w-full flex items-center gap-3 px-4 py-2 rounded-lg font-medium text-sm transition-colors ${
                  isActive("/admin/upload-video") 
                    ? "bg-purple-500/10 text-purple-400" 
                    : "text-gray-400 hover:bg-white/5 hover:text-white"
                }`}
              >
                <Upload className="w-4 h-4" />
                <span>Upload Video</span>
              </button>

              <button 
                onClick={() => go("/admin/auto-matching")}
                className={`w-full flex items-center gap-3 px-4 py-2 rounded-lg font-medium text-sm transition-colors ${
                  isActive("/admin/auto-matching") 
                    ? "bg-purple-500/10 text-purple-400" 
                    : "text-gray-400 hover:bg-white/5 hover:text-white"
                }`}
              >
                <CheckCircle className="w-4 h-4" />
                <span>Auto Matching</span>
              </button>

              <button 
                onClick={() => go("/admin/transactions")}
                className={`w-full flex items-center gap-3 px-4 py-2 rounded-lg font-medium text-sm transition-colors ${
                  isActive("/admin/transactions") 
                    ? "bg-blue-500/10 text-blue-400" 
                    : "text-gray-400 hover:bg-white/5 hover:text-white"
                }`}
              >
                <List className="w-4 h-4" />
                <span>Transaksi Masuk</span>
              </button>
            </div>
          )}
        </div>

        <button 
          onClick={() => go("/admin/storage")} 
          className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg font-medium text-sm transition-colors ${
            isActive("/admin/storage") 
              ? "bg-purple-500/10 text-purple-400" 
              : "text-gray-400 hover:bg-white/5 hover:text-white"
          }`}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
          </svg>
          <span>Storage</span>
        </button>

        <button 
          onClick={() => go("/admin/blocked-list")} 
          className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg font-medium text-sm transition-colors ${
            isActive("/admin/blocked-list") 
              ? "bg-red-500/10 text-red-400" 
              : "text-gray-400 hover:bg-white/5 hover:text-white"
          }`}
        >
          <ShieldX className="w-4 h-4" />
          <span>Daftar Blokir</span>
        </button>

        <button 
          onClick={() => go("/admin/wa-connection")} 
          className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg font-medium text-sm transition-colors ${
            isActive("/admin/wa-connection") 
              ? "bg-green-500/10 text-green-400" 
              : "text-gray-400 hover:bg-white/5 hover:text-white"
          }`}
        >
          <Wifi className="w-4 h-4" />
          <span>WA Connection</span>
        </button>

        <button 
          onClick={() => go("/admin/notification-settings")} 
          className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg font-medium text-sm transition-colors ${
            isActive("/admin/notification-settings") 
              ? "bg-purple-500/10 text-purple-400" 
              : "text-gray-400 hover:bg-white/5 hover:text-white"
          }`}
        >
          <Bell className="w-4 h-4" />
          <span>Notifikasi WA</span>
        </button>
      </nav>

      <div className="p-4 border-t border-white/5">
        <div className="flex items-center gap-3 p-3 rounded-lg bg-white/5">
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-500 to-blue-600 flex items-center justify-center text-white font-bold text-sm">
            AD
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-white truncate">Admin AH</p>
            <p className="text-xs text-gray-400">Super Admin</p>
          </div>
        </div>
        <div className="mt-3 flex items-center justify-between">
          <span className="text-xs text-gray-400">Mode Gelap</span>
          <ThemeToggle />
        </div>
      </div>
    </aside>
  );
};

export default AdminSidebar;
