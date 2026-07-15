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
import GroupCommands from "./pages/GroupCommands";
import TransaksiUpload from "./pages/TransaksiUpload";
import RiwayatTransaksi from "./pages/RiwayatTransaksi";
import AutoMatching from "./pages/AutoMatching";
import NotFound from "./pages/NotFound";

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
          <Route path="/admin/dashboard" element={<AdminDashboard />} />
          <Route path="/admin/create-group" element={<CreateGroup />} />
          <Route path="/admin/monthly-report" element={<MonthlyReport />} />
          <Route path="/admin/storage" element={<StorageManager />} />
          <Route path="/admin/group-commands" element={<GroupCommands />} />
          <Route path="/admin/transaksi" element={<TransaksiUpload />} />
          <Route path="/admin/transaksi/riwayat" element={<RiwayatTransaksi />} />
          <Route path="/admin/auto-matching" element={<AutoMatching />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
