import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import AdminLogin from "./pages/AdminLogin";
import AdminDashboard from "./pages/AdminDashboard";
import CreateGroup from "./pages/CreateGroup";
import MonthlyReport from "./pages/MonthlyReport";
import StorageManager from "./pages/StorageManager";
import TransaksiUpload from "./pages/TransaksiUpload";
import RiwayatTransaksi from "./pages/RiwayatTransaksi";
import AutoMatching from "./pages/AutoMatching";
import Transactions from "./pages/Transactions";
import BlockedList from "./pages/BlockedList";
import WAConnection from "./pages/WAConnection";
import NotificationSettings from "./pages/NotificationSettings";
import NotFound from "./pages/NotFound";
import ProtectedRoute from "./components/ProtectedRoute";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Navigate to="/admin/login" replace />} />
          <Route path="/admin/login" element={<AdminLogin />} />

          {/* Semua role (admin + user) */}
          <Route path="/admin/dashboard" element={<ProtectedRoute><AdminDashboard /></ProtectedRoute>} />
          <Route path="/admin/auto-matching" element={<ProtectedRoute><AutoMatching /></ProtectedRoute>} />
          <Route path="/admin/upload-video" element={<ProtectedRoute><TransaksiUpload /></ProtectedRoute>} />
          <Route path="/admin/transactions" element={<ProtectedRoute><Transactions /></ProtectedRoute>} />

          {/* Admin only */}
          <Route path="/admin/create-group" element={<ProtectedRoute allowedRoles={["admin"]}><CreateGroup /></ProtectedRoute>} />
          <Route path="/admin/monthly-report" element={<ProtectedRoute allowedRoles={["admin"]}><MonthlyReport /></ProtectedRoute>} />
          <Route path="/admin/storage" element={<ProtectedRoute allowedRoles={["admin"]}><StorageManager /></ProtectedRoute>} />
          <Route path="/admin/blocked-list" element={<ProtectedRoute allowedRoles={["admin"]}><BlockedList /></ProtectedRoute>} />
          <Route path="/admin/wa-connection" element={<ProtectedRoute allowedRoles={["admin"]}><WAConnection /></ProtectedRoute>} />
          <Route path="/admin/notification-settings" element={<ProtectedRoute allowedRoles={["admin"]}><NotificationSettings /></ProtectedRoute>} />

          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
